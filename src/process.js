import { spawn } from "node:child_process";

export function runCommand(command, args = [], options = {}) {
  const {
    cwd,
    env = process.env,
    input,
    timeoutMs = 0,
    maxOutputBytes = 8 * 1024 * 1024,
  } = options;

  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let timer;
    let forceKillTimer;

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      resolve({ stdout, stderr, timedOut, ...result });
    };

    const collect = (kind, chunk) => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        stderr += "\nStrategos stopped the process because output exceeded the configured limit.\n";
        child.kill("SIGTERM");
        return;
      }
      if (kind === "stdout") stdout += text;
      else stderr += text;
    };

    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => finish({ code: 127, signal: null, error }));
    child.on("close", (code, signal) => finish({ code: code ?? 1, signal, error: null }));

    if (input !== undefined) {
      child.stdin.end(input);
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      }, timeoutMs);
    }
  });
}

export function commandExistsError(result) {
  return result.error?.code === "ENOENT";
}
