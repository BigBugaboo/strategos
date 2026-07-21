import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { commandExistsError, runCommand } from "./process.js";
import { ensureDir, isInside } from "./utils.js";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = Object.freeze([
  {
    mimeType: "image/png",
    extension: ".png",
    matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  },
  {
    mimeType: "image/jpeg",
    extension: ".jpg",
    matches: (buffer) => buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  },
  {
    mimeType: "image/gif",
    extension: ".gif",
    matches: (buffer) => ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii")),
  },
  {
    mimeType: "image/webp",
    extension: ".webp",
    matches: (buffer) =>
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
]);

function detectImage(buffer) {
  return IMAGE_TYPES.find((type) => type.matches(buffer));
}

function normalizeInputPath(input) {
  let value = String(input || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replaceAll("\\ ", " ");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function safeBaseName(file, extension) {
  const stem = path.basename(file, path.extname(file))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${stem || "image"}${extension}`;
}

async function resolveCommonGitDirectory(root) {
  const dotGit = path.join(root, ".git");
  const stat = await fs.stat(dotGit).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!stat) return undefined;
  let gitDirectory = dotGit;
  if (stat.isFile()) {
    const pointer = await fs.readFile(dotGit, "utf8");
    const target = pointer.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    if (!target) return undefined;
    gitDirectory = path.resolve(root, target);
  }
  const commonPointer = path.join(gitDirectory, "commondir");
  try {
    const common = (await fs.readFile(commonPointer, "utf8")).trim();
    if (common) return path.resolve(gitDirectory, common);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return gitDirectory;
}

export async function ensureAttachmentsIgnored(root) {
  const gitDirectory = await resolveCommonGitDirectory(root);
  if (!gitDirectory) return false;
  const exclude = path.join(gitDirectory, "info", "exclude");
  await ensureDir(path.dirname(exclude));
  let current = "";
  try {
    current = await fs.readFile(exclude, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rule = ".strategos/attachments/";
  if (current.split(/\r?\n/).includes(rule)) return false;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await fs.writeFile(exclude, `${current}${prefix}${rule}\n`, "utf8");
  return true;
}

export async function attachImage(root, input) {
  const source = path.resolve(root, normalizeInputPath(input));
  const buffer = await fs.readFile(source).catch((error) => {
    if (error.code === "ENOENT") throw new Error(`image file not found: ${input}`);
    throw error;
  });
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`image exceeds the ${MAX_IMAGE_BYTES / 1024 / 1024} MB attachment limit`);
  }
  const type = detectImage(buffer);
  if (!type) throw new Error("unsupported image format; use PNG, JPEG, GIF, or WebP");

  await ensureAttachmentsIgnored(root);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const id = sha256.slice(0, 12);
  const name = safeBaseName(source, type.extension);
  const relativePath = path.posix.join(".strategos", "attachments", `${id}-${name}`);
  const destination = path.join(root, ...relativePath.split("/"));
  await ensureDir(path.dirname(destination));
  await fs.writeFile(destination, buffer, { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  return {
    id,
    name,
    mimeType: type.mimeType,
    size: buffer.byteLength,
    sha256,
    relativePath,
    addedAt: new Date().toISOString(),
  };
}

export async function captureClipboardImage(root, options = {}) {
  if (process.platform !== "darwin") {
    throw new Error("clipboard image capture currently requires macOS; use /attach <path>");
  }
  const runCommandFn = options.runCommandFn || runCommand;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-clipboard-"));
  const file = path.join(directory, "clipboard.png");
  try {
    const result = await runCommandFn("pngpaste", [file], { cwd: root, timeoutMs: 10_000 });
    if (commandExistsError(result)) {
      throw new Error("clipboard image capture needs pngpaste; install it with `brew install pngpaste`, or use /attach <path>");
    }
    if (result.code !== 0) {
      throw new Error("the clipboard does not contain an image; copy an image first or use /attach <path>");
    }
    return await attachImage(root, file);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function resolveAttachments(root, attachments = []) {
  if (!attachments.length) return [];
  const realRoot = await fs.realpath(root);
  const resolved = [];
  for (const input of attachments) {
    const relativePath = typeof input === "string" ? input : input?.relativePath;
    if (!relativePath) throw new Error("attachment is missing relativePath");
    const file = path.resolve(root, relativePath);
    if (!isInside(root, file)) throw new Error(`attachment path escapes the repository: ${relativePath}`);
    const realFile = await fs.realpath(file);
    if (!isInside(realRoot, realFile)) throw new Error(`attachment symlink escapes the repository: ${relativePath}`);
    const buffer = await fs.readFile(realFile);
    const type = detectImage(buffer);
    if (!type) throw new Error(`unsupported image attachment: ${relativePath}`);
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    resolved.push({
      id: sha256.slice(0, 12),
      name: input?.name || path.basename(relativePath),
      mimeType: type.mimeType,
      size: buffer.byteLength,
      sha256,
      relativePath: relativePath.split(path.sep).join("/"),
      addedAt: input?.addedAt,
      path: realFile,
    });
  }
  return resolved;
}

export async function materializeAttachments(root, workspace, attachments = []) {
  const resolved = await resolveAttachments(root, attachments);
  const materialized = [];
  for (const attachment of resolved) {
    const destination = path.join(workspace, ...attachment.relativePath.split("/"));
    await ensureDir(path.dirname(destination));
    await fs.copyFile(attachment.path, destination);
    materialized.push({ ...attachment, path: destination });
  }
  return materialized;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
