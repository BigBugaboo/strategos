import assert from "node:assert/strict";
import test from "node:test";
import {
  capacitySummary,
  eligibleAgents,
  mergeCapacitySettings,
  normalizeCapacity,
} from "../src/capacity.js";
import { runPlan } from "../src/orchestrator.js";

const config = {
  agents: { claude: {}, codex: {}, copilot: {} },
  capacity: {
    excludeExhausted: true,
    agents: {
      claude: { state: "available", remainingPercent: 72 },
      codex: { state: "unknown", remainingPercent: null },
      copilot: { state: "exhausted", remainingPercent: 0 },
    },
  },
};

test("capacity excludes exhausted CLIs while retaining unknown capacity", () => {
  assert.deepEqual(eligibleAgents(["claude", "codex", "copilot"], config), ["claude", "codex"]);
  assert.equal(normalizeCapacity(config).agents.codex.remainingPercent, null);
});

test("capacity summary combines installation and eligibility", () => {
  const summary = capacitySummary(config, [
    { name: "claude", ok: true, detail: "Claude Code" },
    { name: "codex", ok: false, detail: "not found" },
    { name: "copilot", ok: true, detail: "Copilot CLI" },
  ]);
  assert.equal(summary.find((item) => item.name === "claude").eligible, true);
  assert.equal(summary.find((item) => item.name === "codex").eligible, false);
  assert.equal(summary.find((item) => item.name === "copilot").eligible, false);
});

test("capacity settings are validated and normalized", () => {
  const updated = mergeCapacitySettings(config, {
    excludeExhausted: true,
    agents: {
      claude: { state: "available", remainingPercent: 63 },
      codex: { state: "unknown", remainingPercent: null },
      copilot: { state: "exhausted", remainingPercent: 0 },
    },
  });
  assert.equal(updated.agents.claude.remainingPercent, 63);
  assert.equal(updated.agents.claude.source, "manual");
  assert.throws(() => mergeCapacitySettings(config, {
    agents: { claude: { state: "available", remainingPercent: 101 } },
  }), /between 0 and 100/);
});

test("direct plan execution rejects an exhausted CLI before creating worktrees", async () => {
  await assert.rejects(
    runPlan({
      root: "/tmp/strategos-capacity-test",
      config: {
        ...config,
        maxParallel: 1,
        maxContextBytes: 1_000,
        taskTimeoutMinutes: 1,
      },
      dryRun: true,
      planInput: {
        version: 1,
        goal: "Review the repository",
        context: [],
        tasks: [{
          id: "review",
          agent: "copilot",
          mode: "read-only",
          prompt: "Review the repository.",
          dependsOn: [],
          context: [],
        }],
      },
    }),
    /unavailable or exhausted agent: copilot/,
  );
});
