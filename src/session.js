import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRunId, ensureDir, truncateText } from "./utils.js";

const RESUMABLE_STATUSES = new Set([
  "planning",
  "planned",
  "previewed",
  "running",
  "failed",
  "interrupted",
]);
const MAX_EVENTS = 50;

function assertSessionId(id) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error(`invalid session id: ${id}`);
}

async function resolveSessionDirectory(root) {
  const dotGit = path.join(root, ".git");
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) return path.join(dotGit, "strategos", "sessions");
    if (stat.isFile()) {
      const pointer = await fs.readFile(dotGit, "utf8");
      const match = pointer.match(/^gitdir:\s*(.+)$/m);
      if (match) {
        return path.join(path.resolve(root, match[1].trim()), "strategos", "sessions");
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return path.join(root, ".strategos", "sessions");
}

async function writeAtomicJson(file, value) {
  await ensureDir(path.dirname(file));
  const suffix = crypto.randomBytes(4).toString("hex");
  const temporary = `${file}.${process.pid}-${suffix}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function compactEvent(event, at) {
  const saved = { type: event.type, at: event.at || at };
  if (event.runId) saved.runId = event.runId;
  if (event.goal) saved.goal = event.goal;
  if (event.strategist) saved.strategist = event.strategist;
  if (event.workerAgents) saved.workerAgents = event.workerAgents;
  if (event.manifest) saved.runStatus = event.manifest.status;
  if (event.task) {
    saved.task = {
      id: event.task.id,
      agent: event.task.agent,
      mode: event.task.mode,
      sessionId: event.task.sessionId,
      sessionName: event.task.sessionName,
      status: event.task.status,
      branch: event.task.branch,
      changedFiles: event.task.changedFiles,
      error: event.task.error ? truncateText(String(event.task.error), 2_000) : undefined,
      report: event.task.report ? truncateText(String(event.task.report), 2_000) : undefined,
    };
  }
  return saved;
}

export function buildResumeContext(session) {
  const snapshot = {
    sessionId: session.id,
    originalGoal: session.goal,
    previousStatus: session.status,
    previousStrategist: session.strategist,
    previousPlan: session.plan,
    imageAttachments: session.attachments || [],
    runId: session.runId,
    lastManifest: session.manifest,
    executionEvents: session.events,
    lastError: session.error,
    lastUpdatedAt: session.updatedAt,
  };
  return truncateText(JSON.stringify(snapshot, null, 2), 24_000);
}

export function createSessionStore(root, options = {}) {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || (() => createRunId(now()));
  const directoryPromise = options.directory
    ? Promise.resolve(options.directory)
    : resolveSessionDirectory(root);
  const timestamp = () => now().toISOString();
  const fileFor = async (id) => {
    assertSessionId(id);
    return path.join(await directoryPromise, `${id}.json`);
  };

  const save = async (session) => {
    const next = { ...session, updatedAt: timestamp() };
    await writeAtomicJson(await fileFor(next.id), next);
    return next;
  };

  const load = async (id) => {
    const file = await fileFor(id);
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return undefined;
      throw new Error(`cannot read session ${id}: ${error.message}`);
    }
  };

  const list = async ({ resumableOnly = false, limit = 20 } = {}) => {
    const directory = await directoryPromise;
    let files;
    try {
      files = await fs.readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const sessions = [];
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      try {
        const session = JSON.parse(await fs.readFile(path.join(directory, file), "utf8"));
        if (!resumableOnly || RESUMABLE_STATUSES.has(session.status)) sessions.push(session);
      } catch {
        // A damaged journal must not hide other recoverable sessions.
      }
    }
    return sessions
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, limit);
  };

  return {
    async create({ goal, strategist, workerAgents, executionMode, attachments = [] }) {
      const createdAt = timestamp();
      const session = {
        version: 1,
        id: idFactory(),
        repository: root,
        goal: goal.trim(),
        strategist,
        workerAgents,
        executionMode,
        attachments,
        status: "planning",
        attempts: 1,
        plan: null,
        runId: null,
        events: [],
        error: null,
        createdAt,
        updatedAt: createdAt,
        finishedAt: null,
      };
      await writeAtomicJson(await fileFor(session.id), session);
      return session;
    },
    load,
    list,
    async latestResumable() {
      return (await list({ resumableOnly: true, limit: 1 }))[0];
    },
    async update(session, patch) {
      return save({ ...session, ...patch });
    },
    async appendEvent(session, event) {
      const at = timestamp();
      const events = [...(session.events || []), compactEvent(event, at)].slice(-MAX_EVENTS);
      const runId = event.runId || session.runId;
      return save({ ...session, events, runId });
    },
  };
}
