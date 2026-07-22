import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachImage, resolveAttachments } from "./attachments.js";
import { loadConfig, normalizeNotificationSettings, saveConfig } from "./config.js";
import { selectWorkerAgents } from "./console.js";
import { runDoctor } from "./doctor.js";
import { loadSessionTaskDiff } from "./diffs.js";
import { createBranch, currentBranch, listBranches } from "./git.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { planWithStrategist } from "./planner.js";
import { createProjectRegistry } from "./projects.js";
import { ptyAvailable, runCommand } from "./process.js";
import { createRequire } from "node:module";
import { buildResumeContext, createSessionStore } from "./session.js";

// Build node-pty's native binary on demand so users whose package manager
// blocks install scripts can enable interactive prompts from the UI.
async function buildInteractiveSupport() {
  let ptyDir;
  try {
    ptyDir = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return { ok: false, log: "node-pty is not installed; run `npm install` first." };
  }
  const result = await runCommand("npx", ["--yes", "node-gyp", "rebuild"], {
    cwd: ptyDir,
    timeoutMs: 300_000,
  });
  const log = `${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-8).join("\n");
  return { ok: result.code === 0, log };
}

const BRANCH_NAME_PATTERN = /^(?!-)(?!.*\.\.)(?!.*[/.]$)[A-Za-z0-9._/-]+$/;

async function pickDirectory() {
  if (process.platform !== "darwin") {
    throw Object.assign(
      new Error("the folder picker is only available on macOS; enter the path manually"),
      { status: 501 },
    );
  }
  const script = 'POSIX path of (choose folder with prompt "Select a Git repository for Strategos")';
  const result = await runCommand("osascript", ["-e", script], { timeoutMs: 120_000 });
  if (result.code !== 0) {
    if (/User canceled/i.test(result.stderr)) return null;
    throw new Error(result.stderr.trim() || "could not open the folder picker");
  }
  return result.stdout.trim() || null;
}

const WEB_ROOT = fileURLToPath(new URL("../web/dist/", import.meta.url));
const MAX_BODY_BYTES = 28 * 1024 * 1024;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error("request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("request body must be valid JSON"), { status: 400 });
  }
}

function publicSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    repository: session.repository,
    goal: session.goal,
    strategist: session.strategist,
    workerAgents: session.workerAgents || [],
    executionMode: session.executionMode,
    soloAgent: session.soloAgent || null,
    baseRef: session.baseRef || null,
    attachments: (session.attachments || []).map(({ path: _path, ...attachment }) => attachment),
    status: session.status,
    attempts: session.attempts,
    plan: session.plan,
    runId: session.runId,
    manifest: session.manifest,
    events: session.events || [],
    error: session.error,
    pinned: Boolean(session.pinned),
    archivedAt: session.archivedAt || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    finishedAt: session.finishedAt,
  };
}

function serializableAttachments(attachments) {
  return attachments.map(({ path: _path, ...attachment }) => attachment);
}

function healthyAgentNames(checks, config) {
  const configured = new Set(Object.keys(config.agents || {}));
  return checks
    .filter((check) => (
      check.ok &&
      configured.has(check.name) &&
      config.agents?.[check.name]?.enabled !== false
    ))
    .map((check) => check.name);
}

function selectStrategist(config, agents) {
  if (agents.includes(config.strategist)) return config.strategist;
  if (agents.length) return agents[0];
  throw new Error("no installed and enabled agent CLI is available");
}

const SOLO_AGENTS = new Set(["claude", "codex"]);

// Only-one mode: the user pins a single CLI to both plan and execute the goal,
// bypassing automatic strategist/worker selection. Returns null when unset.
function normalizeSoloAgent(value, agents) {
  if (value == null || value === "") return null;
  const soloAgent = String(value);
  if (!SOLO_AGENTS.has(soloAgent)) {
    throw Object.assign(new Error(`invalid soloAgent: ${soloAgent}; expected claude or codex`), { status: 400 });
  }
  if (!agents.includes(soloAgent)) {
    throw Object.assign(
      new Error(`solo agent ${soloAgent} is not installed and enabled`),
      { status: 400 },
    );
  }
  return soloAgent;
}

// Resolve the strategist and worker roster, honoring an only-one pin when set.
function resolvePlanAgents(config, agents, soloAgent) {
  if (soloAgent && agents.includes(soloAgent)) {
    return { strategist: soloAgent, workerAgents: [soloAgent] };
  }
  const strategist = selectStrategist(config, agents);
  return { strategist, workerAgents: selectWorkerAgents(agents, strategist, config.workerMode) };
}

function extensionForMimeType(mimeType) {
  return ({
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
  })[mimeType];
}

function safeAttachmentName(name, extension) {
  const stem = path.basename(String(name || "attachment"), path.extname(String(name || "")))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .slice(0, 80);
  return `${stem || "attachment"}${extension}`;
}

function interruptionError() {
  const error = new Error("session stopped by user");
  error.name = "AbortError";
  return error;
}

function throwIfStopped(signal) {
  if (signal?.aborted) throw interruptionError();
}

export function createWebApplication(options) {
  const initialRoot = path.resolve(options.root);
  const version = options.version || "development";
  const webRoot = options.webRoot || WEB_ROOT;
  const loadConfigFn = options.loadConfigFn || loadConfig;
  const saveConfigFn = options.saveConfigFn || saveConfig;
  const runDoctorFn = options.runDoctorFn || runDoctor;
  const planWithStrategistFn = options.planWithStrategistFn || planWithStrategist;
  const runPlanFn = options.runPlanFn || runPlan;
  const loadSessionTaskDiffFn = options.loadSessionTaskDiffFn || loadSessionTaskDiff;
  const attachImageFn = options.attachImageFn || attachImage;
  const resolveAttachmentsFn = options.resolveAttachmentsFn || resolveAttachments;
  const createSessionStoreFn = options.createSessionStoreFn || createSessionStore;
  const currentBranchFn = options.currentBranchFn || currentBranch;
  const listBranchesFn = options.listBranchesFn || listBranches;
  const createBranchFn = options.createBranchFn || createBranch;
  const pickDirectoryFn = options.pickDirectoryFn || pickDirectory;
  const ptyAvailableFn = options.ptyAvailableFn || ptyAvailable;
  const buildInteractiveSupportFn = options.buildInteractiveSupportFn || buildInteractiveSupport;
  const projectRegistry = options.projectRegistry || createProjectRegistry({ initialRoot });
  const webControl = options.webControl;
  const sessionStores = new Map();
  if (options.sessionStore) sessionStores.set(initialRoot, options.sessionStore);
  const subscribers = new Map();
  const active = new Map();
  const pendingPrompts = new Map();

  const projectContext = async (projectPath) => {
    const project = await projectRegistry.resolve(projectPath || initialRoot);
    let sessionStore = sessionStores.get(project.path);
    if (!sessionStore) {
      sessionStore = createSessionStoreFn(project.path);
      sessionStores.set(project.path, sessionStore);
    }
    return { project, root: project.path, sessionStore };
  };
  const contextKey = (context, sessionId) => `${context.root}\u0000${sessionId}`;

  const resolveBaseRef = async (root, requested) => {
    const value = typeof requested === "string" ? requested.trim() : "";
    if (!value) return undefined;
    const branches = await listBranchesFn(root);
    if (!branches.includes(value)) {
      throw Object.assign(new Error(`unknown branch: ${value}`), { status: 400 });
    }
    return value;
  };

  const listSessionGroups = async () => {
    const projects = await projectRegistry.list();
    return Promise.all(projects.map(async (project) => {
      try {
        const projectSessionContext = await projectContext(project.path);
        const [sessions, branch] = await Promise.all([
          projectSessionContext.sessionStore.list({ limit: 30 }),
          currentBranchFn(project.path),
        ]);
        return {
          ...project,
          branch,
          sessions: sessions.map(publicSession),
          activeSessionIds: [...active.keys()]
            .filter((key) => key.startsWith(`${project.path}\u0000`))
            .map((key) => key.slice(project.path.length + 1)),
        };
      } catch {
        return { ...project, sessions: [], activeSessionIds: [], unavailable: true };
      }
    }));
  };

  const publish = (context, sessionId, event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of subscribers.get(contextKey(context, sessionId)) || []) response.write(payload);
  };

  // Bridge a worker's interactive prompt to the UI: publish a `prompt_requested`
  // event and return a promise the answer endpoint resolves once the user picks.
  const makeOnPrompt = (context, sessionId) => (request) => {
    const promptId = String(request.id || "");
    if (!promptId) return Promise.resolve(null);
    const key = `${contextKey(context, sessionId)} ${promptId}`;
    publish(context, sessionId, {
      type: "prompt_requested",
      at: new Date().toISOString(),
      task: request.task || (request.taskId ? { id: request.taskId, agent: request.agent } : undefined),
      prompt: {
        id: promptId,
        question: request.question || "",
        options: Array.isArray(request.options) ? request.options : [],
        kind: request.kind || (request.options?.length ? "select" : "text"),
        defaultValue: request.defaultValue ?? null,
      },
    });
    return new Promise((resolve) => pendingPrompts.set(key, { resolve }));
  };

  const settlePrompts = (context, sessionId, value = null) => {
    const prefix = `${contextKey(context, sessionId)} `;
    for (const [key, pending] of pendingPrompts) {
      if (key.startsWith(prefix)) {
        pendingPrompts.delete(key);
        pending.resolve(value);
      }
    }
  };

  const updateSession = async (context, session, patch, event) => {
    const updated = await context.sessionStore.update(session, patch);
    if (event) publish(context, updated.id, event);
    return updated;
  };

  const runSession = async (context, initialSession, config, planInput, signal) => {
    let session = await updateSession(context, initialSession, {
      status: "running",
      plan: planInput,
      error: null,
      finishedAt: null,
    }, { type: "session_updated", session: { status: "running", plan: planInput } });
    let checkpoint = Promise.resolve();
    try {
      throwIfStopped(signal);
      const result = await runPlanFn({
        root: context.root,
        config,
        planInput,
        signal,
        onPrompt: makeOnPrompt(context, session.id),
        onEvent: (event) => {
          const stampedEvent = { ...event, at: event.at || new Date().toISOString() };
          publish(context, session.id, stampedEvent);
          checkpoint = checkpoint.then(async () => {
            session = await context.sessionStore.appendEvent(session, stampedEvent);
          });
          return checkpoint;
        },
      });
      await checkpoint;
      const status = result.manifest.status;
      session = await updateSession(context, session, {
        status,
        runId: result.runId,
        manifest: result.manifest,
        error: status === "failed" ? "one or more worker tasks failed" : null,
        finishedAt: new Date().toISOString(),
      }, status === "interrupted"
        ? { type: "session_interrupted", phase: "running", runId: result.runId }
        : { type: "session_complete", status, runId: result.runId });
    } catch (error) {
      await checkpoint.catch(() => {});
      const interrupted = signal?.aborted;
      session = await updateSession(context, session, {
        status: interrupted ? "interrupted" : "failed",
        error: interrupted ? null : String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      }, interrupted
        ? { type: "session_interrupted", phase: "running" }
        : { type: "session_error", error: String(error.message || error) });
    } finally {
      settlePrompts(context, session.id);
    }
  };

  const planSession = async (context, { goal, attachmentPaths = [], executionMode = "auto", soloAgent = null, baseRef, resumeSession, existingSession, signal }) => {
    let config = await loadConfigFn(context.root);
    if (baseRef) config = { ...config, baseRef };
    const checks = await runDoctorFn(config, context.root);
    const healthy = healthyAgentNames(checks, config);
    const agents = healthy;
    const solo = soloAgent && agents.includes(soloAgent) ? soloAgent : null;
    // Only-one sessions always auto-run: there is no worker roster to review.
    const effectiveMode = solo ? "auto" : executionMode;
    const { strategist, workerAgents } = resolvePlanAgents(config, agents, solo);
    const attachments = await resolveAttachmentsFn(context.root, attachmentPaths);
    let session = resumeSession
      ? await context.sessionStore.update(resumeSession, {
        goal: goal.trim(),
        strategist,
        workerAgents,
        executionMode: effectiveMode,
        soloAgent: solo,
        attachments: serializableAttachments(attachments),
        status: "planning",
        attempts: (resumeSession.attempts || 1) + 1,
        error: null,
        finishedAt: null,
      })
      : existingSession
        ? await context.sessionStore.update(existingSession, {
          strategist,
          workerAgents,
          soloAgent: solo,
          attachments: serializableAttachments(attachments),
          executionMode: effectiveMode,
        })
        : await context.sessionStore.create({
          goal,
          strategist,
          workerAgents,
          executionMode: effectiveMode,
          soloAgent: solo,
          attachments: serializableAttachments(attachments),
        });
    const planningEvent = {
      type: "planning_started",
      strategist,
      workerAgents,
      at: new Date().toISOString(),
    };
    session = await context.sessionStore.appendEvent(session, planningEvent);
    publish(context, session.id, planningEvent);
    try {
      const plan = await planWithStrategistFn({
        root: context.root,
        config,
        goal,
        strategist,
        workerAgents,
        attachments,
        signal,
        resumeContext: resumeSession ? buildResumeContext(resumeSession) : undefined,
      });
      throwIfStopped(signal);
      const planWithAttachments = {
        ...plan,
        attachments: attachments.map((attachment) => attachment.relativePath),
      };
      session = await updateSession(context, session, {
        status: effectiveMode === "auto" ? "previewed" : "planned",
        plan: planWithAttachments,
        attachments: serializableAttachments(attachments),
      }, { type: "plan_ready", plan: planWithAttachments, executionMode: effectiveMode });
      if (effectiveMode === "auto") {
        await runSession(context, session, config, planWithAttachments, signal);
      }
    } catch (error) {
      const interrupted = signal?.aborted;
      session = await updateSession(context, session, {
        status: interrupted ? "interrupted" : "failed",
        error: interrupted ? null : String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      }, interrupted
        ? { type: "session_interrupted", phase: "planning" }
        : { type: "session_error", error: String(error.message || error) });
    }
  };

  const startBackground = (context, session, operation) => {
    const key = contextKey(context, session.id);
    const controller = new AbortController();
    const record = { controller, promise: null };
    active.set(key, record);
    record.promise = Promise.resolve().then(() => operation(controller.signal));
    const finish = () => {
      if (active.get(key) !== record) return;
      active.delete(key);
      publish(context, session.id, {
        type: "session_inactive",
        at: new Date().toISOString(),
      });
    };
    record.promise.then(
      finish,
      finish,
    );
  };

  const serveStatic = async (request, response, pathname) => {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const requested = path.resolve(webRoot, relative);
    const safe = requested === path.resolve(webRoot) || requested.startsWith(`${path.resolve(webRoot)}${path.sep}`);
    if (!safe) return false;
    let file = requested;
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, "index.html");
    } catch {
      file = path.join(webRoot, "index.html");
    }
    try {
      const body = await fs.readFile(file);
      response.writeHead(200, {
        "content-type": MIME_TYPES.get(path.extname(file)) || "application/octet-stream",
        "content-length": body.byteLength,
        "cache-control": path.basename(file) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      });
      response.end(body);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  };

  return async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (webControl && (pathname === "/api/web/status" || pathname === "/api/web/stop")) {
        if (request.headers["x-strategos-web-token"] !== webControl.token) {
          sendJson(response, 404, { error: "not found" });
          return;
        }
        if (request.method === "GET" && pathname === "/api/web/status") {
          sendJson(response, 200, {
            instanceId: webControl.instanceId,
            pid: webControl.pid,
          });
          return;
        }
        if (request.method === "POST" && pathname === "/api/web/stop") {
          response.once("finish", webControl.stop);
          sendJson(response, 202, { status: "stopping" });
          return;
        }
        sendJson(response, 405, { error: "method not allowed" });
        return;
      }
      if (request.method === "POST" && pathname === "/api/projects") {
        const input = await readJsonBody(request);
        const project = await projectRegistry.add(input.path);
        sendJson(response, 201, { project, projects: await projectRegistry.list() });
        return;
      }
      const projectHeader = request.headers["x-strategos-project"];
      const selectedProject = typeof projectHeader === "string"
        ? decodeURIComponent(projectHeader)
        : url.searchParams.get("project");
      const context = await projectContext(typeof selectedProject === "string" ? selectedProject : undefined);
      const { root, sessionStore } = context;
      if (request.method === "GET" && pathname === "/api/bootstrap") {
        const config = await loadConfigFn(root);
        const checks = await runDoctorFn(config, root);
        const sessionGroups = await listSessionGroups();
        const selectedGroup = sessionGroups.find((group) => group.path === root);
        const sessions = selectedGroup?.sessions || [];
        sendJson(response, 200, {
          version,
          repository: selectedGroup
            ? {
                name: selectedGroup.name,
                path: selectedGroup.path,
                branch: selectedGroup.branch,
              }
            : { ...context.project, branch: await currentBranchFn(root) },
          projects: sessionGroups.map(({ sessions: _sessions, activeSessionIds: _activeIds, ...project }) => project),
          sessionGroups,
          executionMode: config.executionMode || "auto",
          strategist: config.strategist,
          workerMode: config.workerMode,
          interactive: Boolean(config.interactive),
          notifications: normalizeNotificationSettings(config.notifications),
          agents: Object.keys(config.agents || {}),
          checks,
          sessions,
          activeSessionIds: selectedGroup?.activeSessionIds || [],
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/sessions") {
        const sessions = await sessionStore.list({
          includeArchived: url.searchParams.get("includeArchived") === "true",
          limit: 100,
        });
        sendJson(response, 200, sessions.map(publicSession));
        return;
      }
      if (request.method === "POST" && pathname === "/api/sessions/batch") {
        const input = await readJsonBody(request);
        const action = String(input.action || "");
        if (!["archive", "restore", "delete"].includes(action)) {
          throw Object.assign(new Error("action must be archive, restore, or delete"), {
            status: 400,
          });
        }
        if (!Array.isArray(input.sessionIds) || !input.sessionIds.length) {
          throw Object.assign(new Error("sessionIds must be a non-empty array"), { status: 400 });
        }
        const sessionIds = [...new Set(input.sessionIds.map((id) => String(id)))];
        if (sessionIds.length > 100 || sessionIds.some((id) => !/^[a-zA-Z0-9-]+$/.test(id))) {
          throw Object.assign(new Error("sessionIds contains an invalid session id"), { status: 400 });
        }
        const sessions = [];
        for (const id of sessionIds) {
          const session = await sessionStore.load(id);
          if (!session) {
            throw Object.assign(new Error(`session not found: ${id}`), { status: 404 });
          }
          if (active.has(contextKey(context, id))) {
            throw Object.assign(new Error(`active session cannot be managed: ${id}`), {
              status: 409,
            });
          }
          sessions.push(session);
        }
        if (action === "delete" && typeof sessionStore.remove !== "function") {
          throw Object.assign(new Error("session deletion is unavailable"), { status: 501 });
        }
        const updated = [];
        for (const session of sessions) {
          if (action === "delete") {
            await sessionStore.remove(session);
            continue;
          }
          const archived = action === "archive";
          const next =
            typeof sessionStore.setArchived === "function"
              ? await sessionStore.setArchived(session, archived)
              : await sessionStore.update(session, {
                  archivedAt: archived ? new Date().toISOString() : null,
                });
          updated.push(publicSession(next));
        }
        sendJson(response, 200, {
          action,
          sessionIds,
          sessions: updated,
        });
        return;
      }
      const diffMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/diff$/);
      if (request.method === "GET" && diffMatch) {
        const taskId = url.searchParams.get("task");
        if (!taskId) throw Object.assign(new Error("task query parameter is required"), { status: 400 });
        const session = await sessionStore.load(diffMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        sendJson(response, 200, await loadSessionTaskDiffFn(root, session, taskId));
        return;
      }
      const sessionMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const session = await sessionStore.load(sessionMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        sendJson(response, 200, publicSession(session));
        return;
      }
      const pinMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/pin$/);
      if (request.method === "PUT" && pinMatch) {
        const input = await readJsonBody(request);
        if (typeof input.pinned !== "boolean") {
          throw Object.assign(new Error("pinned must be a boolean"), { status: 400 });
        }
        const session = await sessionStore.load(pinMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        const updated = typeof sessionStore.setPinned === "function"
          ? await sessionStore.setPinned(session, input.pinned)
          : await sessionStore.update(session, { pinned: input.pinned });
        sendJson(response, 200, publicSession(updated));
        return;
      }
      const eventMatch = pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
      if (request.method === "GET" && eventMatch) {
        const sessionId = eventMatch[1];
        const key = contextKey(context, sessionId);
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);
        const clients = subscribers.get(key) || new Set();
        clients.add(response);
        subscribers.set(key, clients);
        request.on("close", () => {
          clients.delete(response);
          if (!clients.size) subscribers.delete(key);
        });
        return;
      }
      if (request.method === "PUT" && pathname === "/api/settings") {
        const input = await readJsonBody(request);
        const config = await loadConfigFn(root);
        const executionMode = ["auto", "manual"].includes(input.executionMode)
          ? input.executionMode
          : config.executionMode;
        const strategist = Object.hasOwn(config.agents || {}, input.strategist)
          ? input.strategist
          : config.strategist;
        const next = {
          ...config,
          executionMode,
          strategist,
          interactive:
            typeof input.interactive === "boolean" ? input.interactive : Boolean(config.interactive),
          notifications: normalizeNotificationSettings(input.notifications, config.notifications),
        };
        await saveConfigFn(root, next);
        sendJson(response, 200, {
          executionMode: next.executionMode,
          strategist: next.strategist,
          interactive: next.interactive,
          notifications: next.notifications,
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/attachments") {
        const input = await readJsonBody(request);
        const extension = extensionForMimeType(input.mimeType);
        if (!extension) throw Object.assign(new Error("unsupported image type"), { status: 400 });
        const buffer = Buffer.from(String(input.dataBase64 || ""), "base64");
        if (!buffer.length) throw Object.assign(new Error("attachment data is empty"), { status: 400 });
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-web-attachment-"));
        const file = path.join(directory, safeAttachmentName(input.name, extension));
        try {
          await fs.writeFile(file, buffer);
          sendJson(response, 201, await attachImageFn(root, file));
        } finally {
          await fs.rm(directory, { recursive: true, force: true });
        }
        return;
      }
      if (request.method === "GET" && pathname === "/api/branches") {
        const [current, branches] = await Promise.all([
          currentBranchFn(root),
          listBranchesFn(root),
        ]);
        sendJson(response, 200, {
          current,
          branches: branches.filter((branch) => !branch.startsWith("strategos/")),
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/branches") {
        const input = await readJsonBody(request);
        const name = String(input.name || "").trim();
        if (!BRANCH_NAME_PATTERN.test(name)) {
          throw Object.assign(new Error("invalid branch name"), { status: 400 });
        }
        const existing = await listBranchesFn(root);
        if (existing.includes(name)) {
          throw Object.assign(new Error(`branch already exists: ${name}`), { status: 409 });
        }
        const startPoint = await resolveBaseRef(root, input.from);
        await createBranchFn(root, name, startPoint || "HEAD");
        const [current, branches] = await Promise.all([
          currentBranchFn(root),
          listBranchesFn(root),
        ]);
        sendJson(response, 201, {
          current,
          created: name,
          branches: branches.filter((branch) => !branch.startsWith("strategos/")),
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/pick-directory") {
        sendJson(response, 200, { path: await pickDirectoryFn() });
        return;
      }
      if (request.method === "GET" && pathname === "/api/interactive") {
        sendJson(response, 200, { available: await ptyAvailableFn() });
        return;
      }
      if (request.method === "POST" && pathname === "/api/interactive/enable") {
        const build = await buildInteractiveSupportFn();
        sendJson(response, build.ok ? 200 : 500, {
          ok: build.ok,
          available: await ptyAvailableFn(),
          needsRestart: build.ok,
          log: build.log,
        });
        return;
      }
      if (request.method === "POST" && pathname === "/api/goals") {
        const input = await readJsonBody(request);
        const goal = String(input.goal || "").trim();
        if (!goal) throw Object.assign(new Error("goal cannot be empty"), { status: 400 });
        const config = await loadConfigFn(root);
        const baseRef = await resolveBaseRef(root, input.baseRef);
        const checks = await runDoctorFn(config, root);
        const agents = healthyAgentNames(checks, config);
        const soloAgent = normalizeSoloAgent(input.soloAgent, agents);
        // Only-one sessions always auto-run the pinned CLI.
        const executionMode = soloAgent
          ? "auto"
          : input.executionMode === "manual" ? "manual" : "auto";
        const { strategist, workerAgents } = resolvePlanAgents(config, agents, soloAgent);
        let session = await sessionStore.create({
          goal,
          strategist,
          workerAgents,
          executionMode,
          soloAgent,
          attachments: [],
        });
        if (baseRef) session = await sessionStore.update(session, { baseRef });
        startBackground(context, session, (signal) => planSession(context, {
          goal,
          attachmentPaths: input.attachmentPaths || [],
          executionMode,
          soloAgent,
          baseRef,
          existingSession: session,
          signal,
        }));
        sendJson(response, 202, publicSession(session));
        return;
      }
      const answerMatch = pathname.match(
        /^\/api\/sessions\/([a-zA-Z0-9-]+)\/tasks\/([a-zA-Z0-9._-]+)\/answer$/,
      );
      if (request.method === "POST" && answerMatch) {
        const [, answerSessionId, answerTaskId] = answerMatch;
        const input = await readJsonBody(request);
        const promptId = String(input.promptId || "");
        const key = `${contextKey(context, answerSessionId)} ${promptId}`;
        const pending = pendingPrompts.get(key);
        if (!pending) throw Object.assign(new Error("no pending prompt"), { status: 404 });
        pendingPrompts.delete(key);
        pending.resolve(input.value ?? null);
        publish(context, answerSessionId, {
          type: "prompt_answered",
          at: new Date().toISOString(),
          task: { id: answerTaskId },
          prompt: { id: promptId, value: input.value ?? null },
        });
        sendJson(response, 200, { ok: true });
        return;
      }
      const stopMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/stop$/);
      if (request.method === "POST" && stopMatch) {
        const session = await sessionStore.load(stopMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        const record = active.get(contextKey(context, session.id));
        if (!record) {
          throw Object.assign(new Error("session is not active"), { status: 409 });
        }
        record.controller.abort();
        publish(context, session.id, {
          type: "session_stopping",
          at: new Date().toISOString(),
        });
        sendJson(response, 202, { id: session.id, status: "stopping" });
        return;
      }
      const runMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/run$/);
      if (request.method === "POST" && runMatch) {
        const session = await sessionStore.load(runMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        if (!session.plan) throw Object.assign(new Error("session has no plan"), { status: 409 });
        if (active.has(contextKey(context, session.id))) {
          throw Object.assign(new Error("session is already active"), { status: 409 });
        }
        const loadedConfig = await loadConfigFn(root);
        const config = session.baseRef
          ? { ...loadedConfig, baseRef: session.baseRef }
          : loadedConfig;
        startBackground(context, session, (signal) => (
          runSession(context, session, config, session.plan, signal)
        ));
        sendJson(response, 202, publicSession(session));
        return;
      }
      const resumeMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/resume$/);
      if (request.method === "POST" && resumeMatch) {
        let session = await sessionStore.load(resumeMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        if (active.has(contextKey(context, session.id))) {
          throw Object.assign(new Error("session is already active"), { status: 409 });
        }
        const input = await readJsonBody(request);
        const resumeBaseRef = await resolveBaseRef(root, input.baseRef ?? session.baseRef);
        if (resumeBaseRef && resumeBaseRef !== session.baseRef) {
          session = await sessionStore.update(session, { baseRef: resumeBaseRef });
        }
        startBackground(context, session, (signal) => planSession(context, {
          goal: String(input.goal || session.goal),
          attachmentPaths: input.attachmentPaths || session.attachments || [],
          executionMode: input.executionMode || session.executionMode || "auto",
          soloAgent: input.soloAgent ?? session.soloAgent ?? null,
          baseRef: resumeBaseRef,
          resumeSession: session,
          signal,
        }));
        sendJson(response, 202, publicSession(session));
        return;
      }
      const runStatusMatch = pathname.match(/^\/api\/runs\/([a-zA-Z0-9-]+)$/);
      if (request.method === "GET" && runStatusMatch) {
        sendJson(response, 200, await loadRun(root, runStatusMatch[1]));
        return;
      }
      if (request.method === "GET" && await serveStatic(request, response, pathname)) return;
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, error.status || 500, { error: String(error.message || error) });
    }
  };
}

export async function startWebServer(options) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port ?? 4310);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("port must be between 0 and 65535");
  const handler = createWebApplication(options);
  const server = http.createServer((request, response) => void handler(request, response));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { server, url: `http://${host}:${actualPort}` };
}
