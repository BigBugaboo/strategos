import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attachImage, resolveAttachments } from "./attachments.js";
import { capacitySummary, eligibleAgents, mergeCapacitySettings } from "./capacity.js";
import { loadConfig, saveConfig } from "./config.js";
import { selectWorkerAgents } from "./console.js";
import { runDoctor } from "./doctor.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { planWithStrategist } from "./planner.js";
import { buildResumeContext, createSessionStore } from "./session.js";

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
    attachments: (session.attachments || []).map(({ path: _path, ...attachment }) => attachment),
    status: session.status,
    attempts: session.attempts,
    plan: session.plan,
    runId: session.runId,
    manifest: session.manifest,
    events: session.events || [],
    error: session.error,
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
  return checks.filter((check) => check.ok && configured.has(check.name)).map((check) => check.name);
}

function selectStrategist(config, agents) {
  if (agents.includes(config.strategist)) return config.strategist;
  if (agents.length) return agents[0];
  throw new Error("no installed agent CLI has usable capacity");
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

export function createWebApplication(options) {
  const root = options.root;
  const version = options.version || "development";
  const webRoot = options.webRoot || WEB_ROOT;
  const loadConfigFn = options.loadConfigFn || loadConfig;
  const saveConfigFn = options.saveConfigFn || saveConfig;
  const runDoctorFn = options.runDoctorFn || runDoctor;
  const planWithStrategistFn = options.planWithStrategistFn || planWithStrategist;
  const runPlanFn = options.runPlanFn || runPlan;
  const attachImageFn = options.attachImageFn || attachImage;
  const resolveAttachmentsFn = options.resolveAttachmentsFn || resolveAttachments;
  const sessionStore = options.sessionStore || createSessionStore(root);
  const subscribers = new Map();
  const active = new Map();

  const publish = (sessionId, event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const response of subscribers.get(sessionId) || []) response.write(payload);
  };

  const updateSession = async (session, patch, event) => {
    const updated = await sessionStore.update(session, patch);
    if (event) publish(updated.id, event);
    return updated;
  };

  const runSession = async (initialSession, config, planInput) => {
    let session = await updateSession(initialSession, {
      status: "running",
      plan: planInput,
      error: null,
      finishedAt: null,
    }, { type: "session_updated", session: { status: "running", plan: planInput } });
    let checkpoint = Promise.resolve();
    try {
      const result = await runPlanFn({
        root,
        config,
        planInput,
        onEvent: (event) => {
          publish(session.id, event);
          checkpoint = checkpoint.then(async () => {
            session = await sessionStore.appendEvent(session, event);
          });
          return checkpoint;
        },
      });
      await checkpoint;
      session = await updateSession(session, {
        status: result.manifest.status === "succeeded" ? "succeeded" : "failed",
        runId: result.runId,
        manifest: result.manifest,
        error: result.manifest.status === "succeeded" ? null : "one or more worker tasks failed",
        finishedAt: new Date().toISOString(),
      }, { type: "session_complete", status: result.manifest.status, runId: result.runId });
    } catch (error) {
      await checkpoint.catch(() => {});
      session = await updateSession(session, {
        status: "failed",
        error: String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      }, { type: "session_error", error: String(error.message || error) });
    } finally {
      active.delete(session.id);
    }
  };

  const planSession = async ({ goal, attachmentPaths = [], executionMode = "auto", resumeSession, existingSession }) => {
    let config = await loadConfigFn(root);
    const checks = await runDoctorFn(config, root);
    const healthy = healthyAgentNames(checks, config);
    const agents = eligibleAgents(healthy, config);
    const strategist = selectStrategist(config, agents);
    const workerAgents = selectWorkerAgents(agents, strategist, config.workerMode);
    const attachments = await resolveAttachmentsFn(root, attachmentPaths);
    let session = resumeSession
      ? await sessionStore.update(resumeSession, {
        goal: goal.trim(),
        strategist,
        workerAgents,
        executionMode,
        attachments: serializableAttachments(attachments),
        status: "planning",
        attempts: (resumeSession.attempts || 1) + 1,
        error: null,
        finishedAt: null,
      })
      : existingSession
        ? await sessionStore.update(existingSession, {
          attachments: serializableAttachments(attachments),
          executionMode,
        })
        : await sessionStore.create({
          goal,
          strategist,
          workerAgents,
          executionMode,
          attachments: serializableAttachments(attachments),
        });
    publish(session.id, { type: "planning_started", strategist, workerAgents });
    try {
      const plan = await planWithStrategistFn({
        root,
        config,
        goal,
        strategist,
        workerAgents,
        attachments,
        resumeContext: resumeSession ? buildResumeContext(resumeSession) : undefined,
      });
      const planWithAttachments = {
        ...plan,
        attachments: attachments.map((attachment) => attachment.relativePath),
      };
      session = await updateSession(session, {
        status: executionMode === "auto" ? "previewed" : "planned",
        plan: planWithAttachments,
        attachments: serializableAttachments(attachments),
      }, { type: "plan_ready", plan: planWithAttachments, executionMode });
      if (executionMode === "auto") await runSession(session, config, planWithAttachments);
    } catch (error) {
      session = await updateSession(session, {
        status: "failed",
        error: String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      }, { type: "session_error", error: String(error.message || error) });
      active.delete(session.id);
    }
  };

  const startBackground = (session, promise) => {
    active.set(session.id, promise);
    promise.catch(() => active.delete(session.id));
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
      if (request.method === "GET" && pathname === "/api/bootstrap") {
        const config = await loadConfigFn(root);
        const checks = await runDoctorFn(config, root);
        const sessions = await sessionStore.list({ limit: 30 });
        sendJson(response, 200, {
          version,
          repository: { name: path.basename(root), path: root },
          executionMode: config.executionMode || "auto",
          strategist: config.strategist,
          workerMode: config.workerMode,
          checks,
          capacity: capacitySummary(config, checks),
          excludeExhausted: config.capacity?.excludeExhausted !== false,
          sessions: sessions.map(publicSession),
          activeSessionIds: [...active.keys()],
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/sessions") {
        const sessions = await sessionStore.list({ limit: 100 });
        sendJson(response, 200, sessions.map(publicSession));
        return;
      }
      const sessionMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)$/);
      if (request.method === "GET" && sessionMatch) {
        const session = await sessionStore.load(sessionMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        sendJson(response, 200, publicSession(session));
        return;
      }
      const eventMatch = pathname.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
      if (request.method === "GET" && eventMatch) {
        const sessionId = eventMatch[1];
        response.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        response.write(`data: ${JSON.stringify({ type: "connected", sessionId })}\n\n`);
        const clients = subscribers.get(sessionId) || new Set();
        clients.add(response);
        subscribers.set(sessionId, clients);
        request.on("close", () => {
          clients.delete(response);
          if (!clients.size) subscribers.delete(sessionId);
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
          capacity: mergeCapacitySettings(config, input.capacity || config.capacity),
        };
        await saveConfigFn(root, next);
        const checks = await runDoctorFn(next, root);
        sendJson(response, 200, {
          executionMode: next.executionMode,
          strategist: next.strategist,
          capacity: capacitySummary(next, checks),
          excludeExhausted: next.capacity.excludeExhausted,
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
      if (request.method === "POST" && pathname === "/api/goals") {
        const input = await readJsonBody(request);
        const goal = String(input.goal || "").trim();
        if (!goal) throw Object.assign(new Error("goal cannot be empty"), { status: 400 });
        const executionMode = input.executionMode === "manual" ? "manual" : "auto";
        const config = await loadConfigFn(root);
        const checks = await runDoctorFn(config, root);
        const agents = eligibleAgents(healthyAgentNames(checks, config), config);
        const strategist = selectStrategist(config, agents);
        const session = await sessionStore.create({
          goal,
          strategist,
          workerAgents: selectWorkerAgents(agents, strategist, config.workerMode),
          executionMode,
          attachments: [],
        });
        const background = planSession({
          goal,
          attachmentPaths: input.attachmentPaths || [],
          executionMode,
          existingSession: session,
        });
        startBackground(session, background);
        sendJson(response, 202, publicSession(session));
        return;
      }
      const runMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/run$/);
      if (request.method === "POST" && runMatch) {
        const session = await sessionStore.load(runMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        if (!session.plan) throw Object.assign(new Error("session has no plan"), { status: 409 });
        if (active.has(session.id)) throw Object.assign(new Error("session is already active"), { status: 409 });
        const config = await loadConfigFn(root);
        const background = runSession(session, config, session.plan);
        startBackground(session, background);
        sendJson(response, 202, publicSession(session));
        return;
      }
      const resumeMatch = pathname.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)\/resume$/);
      if (request.method === "POST" && resumeMatch) {
        const session = await sessionStore.load(resumeMatch[1]);
        if (!session) return sendJson(response, 404, { error: "session not found" });
        if (active.has(session.id)) throw Object.assign(new Error("session is already active"), { status: 409 });
        const input = await readJsonBody(request);
        const background = planSession({
          goal: String(input.goal || session.goal),
          attachmentPaths: input.attachmentPaths || session.attachments || [],
          executionMode: input.executionMode || session.executionMode || "auto",
          resumeSession: session,
        });
        startBackground(session, background);
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
