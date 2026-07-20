import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/config.js";
import { extractPlanJson, planWithStrategist } from "../src/planner.js";

function plannedOutput(agent = "codex", mode = "write") {
  return JSON.stringify({
    version: 1,
    goal: "Add CSV export",
    context: ["AGENTS.md"],
    tasks: [
      {
        id: "csv-export",
        agent,
        mode,
        prompt: "Implement CSV export and run focused tests.",
        dependsOn: [],
        context: [],
      },
    ],
  });
}

test("extracts a JSON plan from fenced strategist output", () => {
  const output = `Planning complete.\n\n\`\`\`json\n${plannedOutput()}\n\`\`\``;
  assert.equal(extractPlanJson(output).tasks[0].id, "csv-export");
});

test("skips unrelated balanced prose before the JSON plan", () => {
  const output = `Use {task graphs} for this goal.\n${plannedOutput()}`;
  assert.equal(extractPlanJson(output).tasks[0].agent, "codex");
});

test("unwraps Claude structured output", () => {
  const output = JSON.stringify({
    type: "result",
    subtype: "success",
    structured_output: JSON.parse(plannedOutput()),
  });
  assert.equal(extractPlanJson(output).tasks[0].id, "csv-export");
});

test("invokes the selected CLI in read-only mode and validates its plan", async () => {
  let invocation;
  const plan = await planWithStrategist({
    root: "/tmp/example-repository",
    config: DEFAULT_CONFIG,
    goal: "Add CSV export",
    strategist: "claude",
    workerAgents: ["codex", "copilot"],
    collectContextFn: async () => "# Repository guidance\n\nRun npm test.",
    runCommandFn: async (command, args, options) => {
      invocation = { command, args, options };
      return { code: 0, stdout: plannedOutput(), stderr: "", timedOut: false };
    },
  });

  assert.equal(invocation.command, "claude");
  assert.ok(invocation.args.includes("plan"));
  assert.ok(invocation.args.includes("--json-schema"));
  assert.equal(invocation.options.cwd, "/tmp/example-repository");
  assert.match(invocation.args.join("\n"), /Available workers/);
  assert.match(invocation.args.join("\n"), /codex/);
  assert.equal(plan.tasks[0].agent, "codex");
});

test("rejects tasks assigned to the strategist instead of a worker", async () => {
  await assert.rejects(
    planWithStrategist({
      root: "/tmp/example-repository",
      config: DEFAULT_CONFIG,
      goal: "Add CSV export",
      strategist: "claude",
      workerAgents: ["codex", "copilot"],
      collectContextFn: async () => "",
      runCommandFn: async () => ({
        code: 0,
        stdout: plannedOutput("claude"),
        stderr: "",
        timedOut: false,
      }),
    }),
    /unavailable worker: claude/,
  );
});

test("rejects Copilot write tasks", async () => {
  await assert.rejects(
    planWithStrategist({
      root: "/tmp/example-repository",
      config: DEFAULT_CONFIG,
      goal: "Add CSV export",
      strategist: "claude",
      workerAgents: ["codex", "copilot"],
      collectContextFn: async () => "",
      runCommandFn: async () => ({
        code: 0,
        stdout: plannedOutput("copilot", "write"),
        stderr: "",
        timedOut: false,
      }),
    }),
    /assigned Copilot a write task/,
  );
});

test("reports an aborted strategist process as cancelled", async () => {
  await assert.rejects(
    planWithStrategist({
      root: "/tmp/example-repository",
      config: DEFAULT_CONFIG,
      goal: "Add CSV export",
      strategist: "claude",
      workerAgents: ["codex"],
      collectContextFn: async () => "",
      runCommandFn: async () => ({
        code: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        aborted: true,
      }),
    }),
    /planning cancelled/,
  );
});
