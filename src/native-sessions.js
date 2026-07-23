import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Only the head of each transcript is read to derive metadata: enough to reach
// the session banner, cwd, and first human prompt without loading multi-megabyte
// histories into memory during a scan.
const PREFIX_BYTES = 96 * 1024;
const TITLE_MAX = 120;
const PREVIEW_MAX = 280;
// Bound the scan so a machine with thousands of transcripts cannot stall the UI.
const MAX_SESSIONS_PER_SOURCE = 500;

export const NATIVE_SESSION_SOURCES = Object.freeze(["claude", "codex"]);

function collapse(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function truncate(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// Read up to `maxBytes` from the start of a JSONL file and return the fully
// parsed lines. A trailing partial line and any damaged lines are skipped so a
// truncated read never hides an otherwise usable session.
async function readPrefixJsonLines(file, maxBytes) {
  let handle;
  try {
    handle = await fs.open(file, "r");
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    if (!bytesRead) return [];
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const complete = bytesRead < maxBytes ? text : text.slice(0, text.lastIndexOf("\n") + 1);
    const lines = [];
    for (const raw of complete.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch {
        // A single corrupt line must not discard the whole transcript.
      }
    }
    return lines;
  } finally {
    await handle?.close();
  }
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") return part.text || part.content || "";
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (content && typeof content === "object") return content.text || "";
  return "";
}

// Both CLIs inject synthetic "user" turns (permissions banners, AGENTS.md, and
// system reminders) ahead of the real prompt. Skip those when guessing a title.
function isInjectedPrompt(text) {
  if (!text) return true;
  const head = text.trimStart();
  return (
    head.startsWith("<") ||
    head.startsWith("# AGENTS.md") ||
    head.startsWith("Caveat:") ||
    head.startsWith("[Request interrupted")
  );
}

function toIso(value) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

async function describeClaude(file, nativeSessionId) {
  const [stat, lines] = await Promise.all([
    fs.stat(file),
    readPrefixJsonLines(file, PREFIX_BYTES),
  ]);
  let cwd = null;
  let gitBranch = null;
  let customTitle = null;
  let firstPrompt = null;
  let createdAt = null;
  for (const line of lines) {
    if (!createdAt && line.timestamp) createdAt = toIso(line.timestamp);
    if (!cwd && typeof line.cwd === "string") cwd = line.cwd;
    if (!gitBranch && typeof line.gitBranch === "string") gitBranch = line.gitBranch;
    if (!customTitle && line.type === "custom-title" && line.title) {
      customTitle = collapse(line.title);
    }
    if (!firstPrompt && line.type === "user" && line.message) {
      const text = collapse(messageText(line.message.content ?? line.message));
      if (text && !isInjectedPrompt(text)) firstPrompt = text;
    }
  }
  const label = customTitle || firstPrompt;
  return {
    id: `claude-${nativeSessionId}`,
    source: "claude",
    nativeSessionId,
    title: truncate(label || "(untitled Claude session)", TITLE_MAX),
    preview: truncate(firstPrompt || label || "", PREVIEW_MAX),
    cwd: cwd || null,
    gitBranch: gitBranch || null,
    cliVersion: null,
    createdAt: createdAt || toIso(stat.mtime),
    updatedAt: toIso(stat.mtime),
    transcriptPath: file,
    matchesProject: false,
  };
}

async function scanClaude(home) {
  const base = path.join(home, ".claude", "projects");
  let projectDirs;
  try {
    projectDirs = await fs.readdir(base, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const results = [];
  for (const dirent of projectDirs) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(base, dirent.name);
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const nativeSessionId = file.slice(0, -".jsonl".length);
      // Claude names each transcript after its session UUID; anything else is a
      // stray file we should not surface as resumable.
      if (!/^[0-9a-fA-F-]{16,}$/.test(nativeSessionId)) continue;
      try {
        results.push(await describeClaude(path.join(dir, file), nativeSessionId));
      } catch {
        // Unreadable transcript; keep scanning the rest.
      }
      if (results.length >= MAX_SESSIONS_PER_SOURCE) return results;
    }
  }
  return results;
}

async function describeCodex(file) {
  const [stat, lines] = await Promise.all([
    fs.stat(file),
    readPrefixJsonLines(file, PREFIX_BYTES),
  ]);
  const meta = lines.find((line) => line.type === "session_meta");
  const payload = meta?.payload || {};
  const nativeSessionId = payload.id;
  if (!nativeSessionId) return null;
  let firstPrompt = null;
  for (const line of lines) {
    if (line.type !== "response_item") continue;
    const item = line.payload;
    if (item?.type === "message" && item.role === "user") {
      const text = collapse(messageText(item.content));
      if (text && !isInjectedPrompt(text)) {
        firstPrompt = text;
        break;
      }
    }
  }
  return {
    id: `codex-${nativeSessionId}`,
    source: "codex",
    nativeSessionId,
    title: truncate(firstPrompt || "(untitled Codex session)", TITLE_MAX),
    preview: truncate(firstPrompt || "", PREVIEW_MAX),
    cwd: typeof payload.cwd === "string" ? payload.cwd : null,
    gitBranch: null,
    cliVersion: payload.cli_version || null,
    createdAt: toIso(payload.timestamp) || toIso(meta?.timestamp) || toIso(stat.mtime),
    updatedAt: toIso(stat.mtime),
    transcriptPath: file,
    matchesProject: false,
  };
}

async function scanCodex(home) {
  const base = path.join(home, ".codex", "sessions");
  const results = [];
  const walk = async (dir) => {
    if (results.length >= MAX_SESSIONS_PER_SOURCE) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= MAX_SESSIONS_PER_SOURCE) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try {
          const descriptor = await describeCodex(full);
          if (descriptor) results.push(descriptor);
        } catch {
          // Skip a damaged rollout and keep walking.
        }
      }
    }
  };
  await walk(base);
  return results;
}

const SCANNERS = { claude: scanClaude, codex: scanCodex };

// Discover the native Claude/Codex transcripts on this machine and describe each
// one with the metadata Strategos needs to offer it for import. The scan is
// read-only and never mutates the underlying CLI history.
export async function scanNativeSessions({
  home = os.homedir(),
  projectRoot,
  sources = NATIVE_SESSION_SOURCES,
  limit = 300,
} = {}) {
  const resolvedProject = projectRoot ? path.resolve(projectRoot) : null;
  const requested = sources.filter((source) => SCANNERS[source]);
  const batches = await Promise.all(requested.map((source) => SCANNERS[source](home)));
  const all = batches.flat();
  for (const descriptor of all) {
    descriptor.matchesProject = Boolean(
      resolvedProject && descriptor.cwd && path.resolve(descriptor.cwd) === resolvedProject,
    );
  }
  all.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return all.slice(0, limit);
}

// The client only needs display metadata; the absolute transcript path stays on
// the server so imports are always resolved from a fresh, trusted scan.
export function publicNativeSession(descriptor) {
  return {
    id: descriptor.id,
    source: descriptor.source,
    nativeSessionId: descriptor.nativeSessionId,
    title: descriptor.title,
    preview: descriptor.preview,
    cwd: descriptor.cwd,
    gitBranch: descriptor.gitBranch,
    cliVersion: descriptor.cliVersion,
    createdAt: descriptor.createdAt,
    updatedAt: descriptor.updatedAt,
    matchesProject: descriptor.matchesProject,
  };
}
