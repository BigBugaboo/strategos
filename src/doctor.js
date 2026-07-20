import { BUILTIN_AGENT_NAMES, versionInvocation } from "./adapters.js";
import { runCommand, commandExistsError } from "./process.js";

async function checkCommand(name, command, args, cwd) {
  const result = await runCommand(command, args, { cwd, timeoutMs: 10_000, maxOutputBytes: 256_000 });
  if (commandExistsError(result)) {
    return { name, command, ok: false, detail: "not found on PATH" };
  }
  const detail = (result.stdout || result.stderr).trim().split("\n")[0] || `exit ${result.code}`;
  return { name, command, ok: result.code === 0, detail };
}

export async function runDoctor(config, cwd = process.cwd()) {
  const checks = [
    checkCommand("git", "git", ["--version"], cwd),
    checkCommand("node", process.execPath, ["--version"], cwd),
    ...BUILTIN_AGENT_NAMES.map((agent) => {
      const invocation = versionInvocation(agent, config);
      return checkCommand(agent, invocation.command, invocation.args, cwd);
    }),
  ];
  return Promise.all(checks);
}
