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
