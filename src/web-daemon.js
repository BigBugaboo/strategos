import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { ensureDir } from "./utils.js";
import { startWebServer } from "./web-server.js";

const STATE_NAME = "web.json";
const LOG_NAME = "web.log";
const CONTROL_HEADER = "x-strategos-web-token";
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 50;

function daemonPaths(root) {
  const directory = path.join(path.resolve(root), ".strategos");
  return {
    directory,
    state: path.join(directory, STATE_NAME),
    log: path.join(directory, LOG_NAME),
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isProcessRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readState(root) {
  try {
    return JSON.parse(await fs.readFile(daemonPaths(root).state, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeState(root, state) {
  const paths = daemonPaths(root);
  await ensureDir(paths.directory);
  const temporary = `${paths.state}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, paths.state);
    await fs.chmod(paths.state, 0o600);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function removeState(root, instanceId) {
  const paths = daemonPaths(root);
  if (instanceId) {
    const state = await readState(root);
    if (state?.instanceId !== instanceId) return;
  }
  await fs.rm(paths.state, { force: true });
}

function validateStateUrl(state) {
  try {
    const url = new URL(state.url);
    return url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

async function requestControl(state, pathname, options = {}) {
  const baseUrl = validateStateUrl(state);
  if (!baseUrl || typeof state.token !== "string" || !state.token) return undefined;
  const url = new URL(pathname, baseUrl);
  try {
    return await fetch(url, {
      method: options.method || "GET",
      headers: { [CONTROL_HEADER]: state.token },
      signal: AbortSignal.timeout(options.timeoutMs || 1_000),
    });
  } catch {
    return undefined;
  }
}

async function probeState(state) {
  const response = await requestControl(state, "/api/web/status");
  if (!response?.ok) return false;
  try {
    const body = await response.json();
    return body.instanceId === state.instanceId && body.pid === state.pid;
  } catch {
    return false;
  }
}

function validatePort(port) {
  const value = Number(port ?? 4310);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error("port must be between 0 and 65535");
  }
  return value;
}

export async function startWebDaemon(options) {
  const root = path.resolve(options.root);
  const host = options.host || "127.0.0.1";
  const port = validatePort(options.port);
  const paths = daemonPaths(root);
  const existing = await readState(root);
  if (existing && await probeState(existing)) {
    return { ...existing, alreadyRunning: true, log: paths.log };
  }
  if (existing && isProcessRunning(existing.pid)) {
    throw new Error(`Web UI process ${existing.pid} is running but could not be verified`);
  }
  await removeState(root);

  const instanceId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const entrypoint = path.resolve(options.entrypoint || process.argv[1]);
  await ensureDir(paths.directory);
  const log = await fs.open(paths.log, "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, [
      entrypoint,
      "web",
      "__serve",
      "--host",
      host,
      "--port",
      String(port),
    ], {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        STRATEGOS_WEB_INSTANCE_ID: instanceId,
        STRATEGOS_WEB_TOKEN: token,
      },
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
    });
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    child.unref();
  } finally {
    await log.close();
  }

  const deadline = Date.now() + (options.startTimeoutMs || START_TIMEOUT_MS);
  while (Date.now() < deadline) {
    const state = await readState(root);
    if (state?.instanceId === instanceId && await probeState(state)) {
      return { ...state, alreadyRunning: false, log: paths.log };
    }
    if (!isProcessRunning(child.pid)) {
      throw new Error(`Web UI failed to start; see ${paths.log}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  if (isProcessRunning(child.pid)) {
    try {
      process.kill(child.pid, "SIGTERM");
    } catch {
      // The child exited between the liveness check and termination.
    }
  }
  throw new Error(`Web UI did not become ready; see ${paths.log}`);
}

export async function stopWebDaemon(options) {
  const root = path.resolve(options.root);
  const state = await readState(root);
  if (!state) {
    await removeState(root);
    return { alreadyStopped: true };
  }
  if (!await probeState(state)) {
    if (!isProcessRunning(state.pid)) {
      await removeState(root, state.instanceId);
      return { alreadyStopped: true };
    }
    throw new Error(`Web UI process ${state.pid} is running but did not accept the stop request`);
  }

  const response = await requestControl(state, "/api/web/stop", {
    method: "POST",
    timeoutMs: 2_000,
  });
  if (!response?.ok) throw new Error("Web UI did not accept the stop request");

  const deadline = Date.now() + (options.stopTimeoutMs || STOP_TIMEOUT_MS);
  while (Date.now() < deadline) {
    if (!isProcessRunning(state.pid) || !(await readState(root))) {
      await removeState(root, state.instanceId);
      return { alreadyStopped: false, url: state.url, pid: state.pid };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Web UI process ${state.pid} did not stop in time`);
}

export async function restartWebDaemon(options) {
  const root = path.resolve(options.root);
  const state = await readState(root);
  const host = options.host || state?.host || "127.0.0.1";
  const port = options.port === undefined
    ? validatePort(state?.port ?? 4310)
    : validatePort(options.port);
  const stopped = await stopWebDaemon({ root, stopTimeoutMs: options.stopTimeoutMs });
  const started = await startWebDaemon({
    ...options,
    root,
    host,
    port,
  });
  return {
    ...started,
    restarted: !stopped.alreadyStopped,
  };
}

export async function runWebDaemon(options) {
  const root = path.resolve(options.root);
  const instanceId = options.instanceId;
  const token = options.token;
  if (!instanceId || !token) throw new Error("missing Web UI daemon credentials");

  let requestStop;
  const stopRequested = new Promise((resolve) => {
    requestStop = resolve;
  });
  const result = await startWebServer({
    ...options,
    root,
    webControl: {
      instanceId,
      token,
      pid: process.pid,
      stop: requestStop,
    },
  });
  const paths = daemonPaths(root);
  await writeState(root, {
    instanceId,
    token,
    pid: process.pid,
    root,
    host: options.host || "127.0.0.1",
    port: new URL(result.url).port,
    url: result.url,
    startedAt: new Date().toISOString(),
  });

  const handleSignal = () => requestStop();
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  try {
    await stopRequested;
    result.server.closeAllConnections?.();
    await new Promise((resolve, reject) => {
      result.server.close((error) => error ? reject(error) : resolve());
    });
  } finally {
    process.removeListener("SIGINT", handleSignal);
    process.removeListener("SIGTERM", handleSignal);
    await removeState(root, instanceId);
    await fs.appendFile(paths.log, `Stopped at ${new Date().toISOString()}\n`, "utf8");
  }
}
