import test from "node:test";
import assert from "node:assert/strict";
import { agentInvocation, resumeInvocation, strategistInvocation } from "../src/adapters.js";
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

test("Claude resume continues the original session id without shell interpolation", () => {
  const invocation = resumeInvocation("claude", {
    nativeSessionId: "e4e1f53f-e3b8-49b7-8bb4-9cbb18034e88",
    prompt: "Continue $(whoami) safely",
    mode: "write",
    workspace: "/tmp/worktree",
    config: DEFAULT_CONFIG,
  });
  assert.equal(invocation.command, "claude");
  assert.deepEqual(
    invocation.args.slice(invocation.args.indexOf("--resume"), invocation.args.indexOf("--resume") + 2),
    ["--resume", "e4e1f53f-e3b8-49b7-8bb4-9cbb18034e88"],
  );
  assert.ok(invocation.args.includes("auto"));
  assert.equal(invocation.args[invocation.args.indexOf("-p") + 1], "Continue $(whoami) safely");
});

test("Codex resume uses the exec resume subcommand with the workspace sandbox", () => {
  const invocation = resumeInvocation("codex", {
    nativeSessionId: "019c4c41-065c-7b41-be73-13bfa3e77e81",
    prompt: "Keep going",
    mode: "write",
    workspace: "/tmp/worktree",
    config: DEFAULT_CONFIG,
  });
  assert.equal(invocation.command, "codex");
  assert.deepEqual(invocation.args.slice(0, 3), ["exec", "resume", "019c4c41-065c-7b41-be73-13bfa3e77e81"]);
  assert.ok(invocation.args.includes("workspace-write"));
  assert.equal(invocation.args.at(-1), "Keep going");
});

test("Claude resume in read-only mode plans instead of writing", () => {
  const invocation = resumeInvocation("claude", {
    nativeSessionId: "id",
    prompt: "review",
    mode: "read-only",
    workspace: "/tmp/worktree",
    config: DEFAULT_CONFIG,
  });
  assert.ok(invocation.args.includes("plan"));
});

test("Resume rejects a missing session id and unsupported agents", () => {
  assert.throws(
    () => resumeInvocation("claude", { prompt: "x", mode: "write", config: DEFAULT_CONFIG }),
    /nativeSessionId is required/,
  );
  assert.throws(
    () => resumeInvocation("copilot", { nativeSessionId: "id", prompt: "x", mode: "write", config: DEFAULT_CONFIG }),
    /native resume is not supported/,
  );
});
