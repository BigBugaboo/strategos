import { spawn } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    signal: abortSignal,
    timeoutMs = 0,
    maxOutputBytes = 8 * 1024 * 1024,
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let aborted = false;
    let timer;
    let forceKillTimer;

    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const terminate = (signal) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    };

    const abort = () => {
      aborted = true;
      terminate("SIGTERM");
      forceKillTimer ||= setTimeout(() => terminate("SIGKILL"), 5_000);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (abortSignal) abortSignal.removeEventListener("abort", abort);
      resolve({ stdout, stderr, timedOut, aborted, ...result });
    };

    const collect = (kind, chunk) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        stderr += "\nStrategos stopped the process because output exceeded the configured limit.\n";
        terminate("SIGTERM");
        return;
      }
      if (kind === "stdout") stdout += text;
      else stderr += text;
    };

    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => finish({ code: 127, signal: null, error }));
    child.on("close", (code, signal) => finish({ code: code ?? 1, signal, error: null }));

    if (abortSignal) {
      if (abortSignal.aborted) abort();
      else abortSignal.addEventListener("abort", abort, { once: true });
    }

    if (input !== undefined) {
      child.stdin.end(input);
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminate("SIGTERM");
        forceKillTimer = setTimeout(() => terminate("SIGKILL"), 5_000);
      }, timeoutMs);
    }
  });
}

export function commandExistsError(result) {
  return result.error?.code === "ENOENT";
}

// node-pty is an optional native dependency. Load it lazily so the base tool
// stays dependency-free and interactive features degrade gracefully when the
// native binary was never built.
let ptyModulePromise;

function loadPtyModule() {
  if (ptyModulePromise === undefined) {
    ptyModulePromise = import("node-pty")
      .then((module) => (typeof module?.spawn === "function" ? module : module?.default))
      .catch(() => null);
  }
  return ptyModulePromise;
}

export async function ptyAvailable() {
  const module = await loadPtyModule();
  return Boolean(module && typeof module.spawn === "function");
}

export async function runPty(command, args = [], options = {}) {
  const { cwd, env = process.env, signal: abortSignal, timeoutMs = 0, cols = 120, rows = 40, onData } = options;
  const module = await loadPtyModule();
  if (!module || typeof module.spawn !== "function") {
    throw Object.assign(
      new Error("interactive PTY support is unavailable; build it with `npm rebuild node-pty`"),
      { code: "ENOPTY" },
    );
  }
  return new Promise((resolve) => {
    let settled = false;
    let output = "";
    let timedOut = false;
    let aborted = false;
    let timer;
    const child = module.spawn(command, args, { name: "xterm-256color", cols, rows, cwd, env });
    const abort = () => {
      aborted = true;
      try {
        child.kill();
      } catch {
        // The child may have already exited.
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (abortSignal) abortSignal.removeEventListener("abort", abort);
      resolve({ output, timedOut, aborted, ...result });
    };
    child.onData((chunk) => {
      output += chunk;
      if (output.length > 262_144) output = output.slice(-262_144);
      try {
        onData?.(chunk, child);
      } catch {
        // A detector callback must never break the stream.
      }
    });
    child.onExit(({ exitCode, signal }) => finish({ code: exitCode ?? 1, signal: signal ?? null }));
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        abort();
      }, timeoutMs);
    }
    if (abortSignal) {
      if (abortSignal.aborted) abort();
      else abortSignal.addEventListener("abort", abort, { once: true });
    }
  });
}
