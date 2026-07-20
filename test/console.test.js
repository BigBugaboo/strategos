import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { DEFAULT_CONFIG } from "../src/config.js";
import { startConsole } from "../src/console.js";

const healthyChecks = [
  { name: "git", ok: true, detail: "git version test" },
  { name: "node", ok: true, detail: "v24.0.0" },
  { name: "claude", ok: true, detail: "Claude Code test" },
  { name: "codex", ok: true, detail: "codex-cli test" },
  { name: "copilot", ok: true, detail: "Copilot CLI test" },
];

function captureOutput() {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  return { output, read: () => text };
}

function consoleOptions(input, output, overrides = {}) {
  return {
    root: "/tmp/example-repository",
    version: "0.4.0-test",
    input: Readable.from([input]),
    output,
    loadConfigFn: async () => DEFAULT_CONFIG,
    runDoctorFn: async () => healthyChecks,
    initializeProjectFn: async () => [],
    planWithStrategistFn: async ({ goal }) => ({
      version: 1,
      goal,
      context: [],
      tasks: [
        {
          id: "implementation",
          agent: "claude",
          mode: "write",
          prompt: "Implement the requested goal.",
          dependsOn: [],
        },
      ],
    }),
    ...overrides,
  };
}

test("ordinary console input proposes a plan and previews its waves", async () => {
  const captured = captureOutput();
  let planningInput;
  await startConsole(
    consoleOptions("Add CSV export\n/preview\n/exit\n", captured.output, {
      planWithStrategistFn: async (input) => {
        planningInput = input;
        return {
          version: 1,
          goal: input.goal,
          context: [],
          tasks: [
            {
              id: "implementation",
              agent: "claude",
              mode: "write",
              prompt: "Implement CSV export.",
              dependsOn: [],
            },
            {
              id: "review",
              agent: "copilot",
              mode: "read-only",
              prompt: "Review CSV export.",
              dependsOn: ["implementation"],
            },
          ],
        };
      },
      runPlanFn: async ({ planInput, dryRun }) => {
        assert.equal(dryRun, true);
        assert.equal(planInput.goal, "Add CSV export");
        return {
          dryRun: true,
          maxParallel: 3,
          waves: [["implementation"], ["review"]],
        };
      },
    }),
  );
  const output = captured.read();
  assert.equal(planningInput.strategist, "codex");
  assert.deepEqual(planningInput.workerAgents, ["claude", "copilot"]);
  assert.match(output, /What do you want to accomplish/);
  assert.match(output, /Asking codex to plan in read-only mode/);
  assert.match(output, /Proposed by codex/);
  assert.match(output, /Max parallel: 3/);
});

test("strategist can be changed for the current console session", async () => {
  const captured = captureOutput();
  let planningInput;
  await startConsole(
    consoleOptions("/strategist claude\nPlan a release\n/exit\n", captured.output, {
      planWithStrategistFn: async (input) => {
        planningInput = input;
        return {
          version: 1,
          goal: input.goal,
          context: [],
          tasks: [
            {
              id: "release",
              agent: "codex",
              mode: "write",
              prompt: "Prepare the release.",
              dependsOn: [],
            },
          ],
        };
      },
    }),
  );
  assert.equal(planningInput.strategist, "claude");
  assert.deepEqual(planningInput.workerAgents, ["codex", "copilot"]);
  assert.match(captured.read(), /Strategist: claude/);
});

test("run command renders live orchestration events", async () => {
  const captured = captureOutput();
  const manifest = {
    id: "run-test",
    status: "succeeded",
    tasks: {
      implementation: {
        id: "implementation",
        agent: "claude",
        status: "succeeded",
        branch: "strategos/run-test/implementation",
      },
    },
  };
  await startConsole(
    consoleOptions("Ship the feature\n/run\n/exit\n", captured.output, {
      runPlanFn: async ({ onEvent }) => {
        onEvent({ type: "run_started", runId: "run-test", goal: "Ship the feature" });
        onEvent({
          type: "task_started",
          task: { id: "implementation", agent: "claude", status: "running" },
        });
        onEvent({
          type: "task_finished",
          task: { id: "implementation", agent: "claude", status: "succeeded" },
        });
        onEvent({ type: "run_finished", runId: "run-test", manifest });
        return { dryRun: false, runId: "run-test", manifest };
      },
    }),
  );
  const output = captured.read();
  assert.match(output, /Run run-test started/);
  assert.match(output, /implementation  claude  running/);
  assert.match(output, /Run finished: succeeded/);
  assert.match(output, /branch: strategos\/run-test\/implementation/);
});
