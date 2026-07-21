import test from "node:test";
import assert from "node:assert/strict";
import { agentInvocation, strategistInvocation } from "../src/adapters.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const input = {
  prompt: "Fix $(touch /tmp/not-executed) and `whoami` safely",
  workspace: "/tmp/worktree",
  config: DEFAULT_CONFIG,
};

test("Codex uses a workspace sandbox without shell interpolation", () => {
  const invocation = agentInvocation("codex", {
    ...input,
    mode: "write",
    attachments: [{ path: "/tmp/worktree/.strategos/attachments/mock.png" }],
  });
  assert.equal(invocation.command, "codex");
  assert.ok(invocation.args.includes("workspace-write"));
  assert.equal(invocation.args.at(-1), input.prompt);
  assert.ok(!invocation.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf("--image"), invocation.args.indexOf("--image") + 2),
    ["--image", "/tmp/worktree/.strategos/attachments/mock.png"],
  );
});

test("Claude read-only work uses plan mode", () => {
  const invocation = agentInvocation("claude", {
    ...input,
    mode: "read-only",
    sessionId: "11111111-1111-4111-8111-111111111111",
    sessionName: "strategos-review",
  });
  assert.ok(invocation.args.includes("plan"));
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
  assert.ok(invocation.args.includes("--session-id"));
  assert.ok(invocation.args.includes("--name"));
});

test("Copilot does not grant write permissions by default", () => {
  const invocation = agentInvocation("copilot", {
    ...input,
    mode: "write",
    sessionId: "22222222-2222-4222-8222-222222222222",
    attachments: [{ path: "/tmp/worktree/.strategos/attachments/mock.png" }],
  });
  assert.ok(invocation.args.includes("--no-ask-user"));
  assert.ok(!invocation.args.includes("--allow-all-tools"));
  assert.ok(!invocation.args.includes("--allow-all-paths"));
  assert.ok(invocation.args.includes("--session-id"));
  assert.ok(invocation.args.includes("--attachment"));
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

test("Claude strategist uses native structured output and read-only tools", () => {
  const invocation = strategistInvocation("claude", {
    ...input,
    jsonSchema: { type: "object" },
  });
  assert.ok(invocation.args.includes("--json-schema"));
  assert.ok(invocation.args.includes("Read,Glob,Grep"));
  assert.ok(invocation.args.includes("plan"));
  assert.ok(!invocation.args.includes("--dangerously-skip-permissions"));
});

test("Codex strategist uses a read-only sandbox and output schema", () => {
  const invocation = strategistInvocation("codex", {
    ...input,
    jsonSchema: { type: "object" },
    schemaPath: "/tmp/plan.schema.json",
    attachments: [{ path: "/tmp/worktree/.strategos/attachments/mock.png" }],
  });
  assert.ok(invocation.args.includes("read-only"));
  assert.ok(invocation.args.includes("--output-schema"));
  assert.ok(invocation.args.includes("/tmp/plan.schema.json"));
  assert.ok(invocation.args.includes("--image"));
});
