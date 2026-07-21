import test from "node:test";
import assert from "node:assert/strict";
import { buildWaves, validatePlan } from "../src/plan.js";

function validPlan() {
  return {
    version: 1,
    goal: "Ship a feature",
    tasks: [
      { id: "a", agent: "claude", prompt: "Implement A", dependsOn: [] },
      { id: "b", agent: "codex", prompt: "Implement B", dependsOn: [] },
      { id: "review", agent: "copilot", prompt: "Review", dependsOn: ["a", "b"] },
    ],
  };
}

test("normalizes tasks and builds parallel dependency waves", () => {
  const plan = validatePlan(validPlan());
  assert.equal(plan.tasks[0].mode, "write");
  assert.deepEqual(
    buildWaves(plan).map((wave) => wave.map((task) => task.id)),
    [["a", "b"], ["review"]],
  );
});

test("rejects missing dependencies", () => {
  const plan = validPlan();
  plan.tasks[2].dependsOn = ["missing"];
  assert.throws(() => validatePlan(plan), /depends on missing task/);
});

test("rejects dependency cycles before execution", () => {
  const plan = validPlan();
  plan.tasks[0].dependsOn = ["review"];
  assert.throws(() => validatePlan(plan), /contains a cycle/);
});

test("accepts configured custom adapters", () => {
  const plan = validPlan();
  plan.tasks[0].agent = "local-agent";
  assert.doesNotThrow(() => validatePlan(plan, ["local-agent"]));
});

test("rejects invalid plan-level context", () => {
  const plan = validPlan();
  plan.context = ["AGENTS.md", { path: "secret" }];
  assert.throws(() => validatePlan(plan), /plan.context must be an array/);
});

test("normalizes image attachments and rejects non-path entries", () => {
  const plan = validPlan();
  plan.attachments = [".strategos/attachments/design.png"];
  assert.deepEqual(validatePlan(plan).attachments, plan.attachments);
  plan.attachments = [{ path: "design.png" }];
  assert.throws(() => validatePlan(plan), /plan.attachments must be an array/);
});
