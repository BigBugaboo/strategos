import test from "node:test";
import assert from "node:assert/strict";
import { agentInvocation } from "../src/adapters.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const input = {
  prompt: "Fix $(touch /tmp/not-executed) and `whoami` safely",
  workspace: "/tmp/worktree",
  config: DEFAULT_CONFIG,
};

test("Codex uses a workspace sandbox without shell interpolation", () => {
  const invocation = agentInvocation("codex", { ...input, mode: "write" });
  assert.equal(invocation.command, "codex");
  assert.ok(invocation.args.includes("workspace-write"));
  assert.equal(invocation.args.at(-1), input.prompt);
  assert.ok(!invocation.args.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("Claude read-only work uses plan mode", () => {
  const invocation = agentInvocation("claude", { ...input, mode: "read-only" });
  assert.ok(invocation.args.includes("plan"));
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
});

test("Copilot does not grant write permissions by default", () => {
  const invocation = agentInvocation("copilot", { ...input, mode: "write" });
  assert.ok(invocation.args.includes("--no-ask-user"));
  assert.ok(!invocation.args.includes("--allow-all-tools"));
  assert.ok(!invocation.args.includes("--allow-all-paths"));
});

test("custom adapters replace only complete placeholders", () => {
  const config = {
    ...DEFAULT_CONFIG,
    agents: {
      worker: {
        command: "worker",
        args: ["--cwd", "{{workspace}}", "{{mode}}", "{{prompt}}"],
      },
    },
  };
  const invocation = agentInvocation("worker", { ...input, mode: "write", config });
  assert.deepEqual(invocation.args, ["--cwd", input.workspace, "write", input.prompt]);
});
