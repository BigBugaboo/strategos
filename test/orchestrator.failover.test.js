import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runPlan } from "../src/orchestrator.js";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("hands a quota-exhausted task to another CLI and records the failover", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-failover-"));
  const root = path.join(parent, "repo");
  await fs.mkdir(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "README.md"), "# repo\n", "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), ".strategos/runs/\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");

  // primary always fails with a quota message; backup succeeds.
  const primaryScript = "console.error('Error: 429 you have exceeded your current quota'); process.exit(1);";
  const backupScript = "console.log('completed by backup for ' + process.env.STRATEGOS_AGENT);";

  const config = {
    ...DEFAULT_CONFIG,
    worktreeRoot: path.join(parent, "worktrees"),
    maxParallel: 1,
    taskTimeoutMinutes: 1,
    agents: {
      primary: { command: process.execPath, args: ["-e", primaryScript, "{{prompt}}"] },
      backup: { command: process.execPath, args: ["-e", backupScript, "{{prompt}}"] },
    },
  };
  const planInput = {
    version: 1,
    goal: "failover test",
    tasks: [{ id: "solo", agent: "primary", prompt: "do it", dependsOn: [] }],
  };

  const events = [];
  const result = await runPlan({
    root,
    config,
    planInput,
    onEvent: (event) => events.push(event),
  });

  const taskResult = result.manifest.tasks.solo;
  assert.equal(taskResult.status, "succeeded");
  assert.equal(taskResult.agent, "backup"); // the CLI that finished
  assert.equal(taskResult.plannedAgent, "primary"); // the originally assigned CLI
  const finished = events.find((event) => event.type === "task_finished" && event.task?.id === "solo");
  assert.match(finished?.task?.report || "", /completed by backup/);

  const failover = events.find((event) => event.type === "task_failover");
  assert.ok(failover, "a task_failover event should be emitted");
  assert.equal(failover.from, "primary");
  assert.equal(failover.to, "backup");
  assert.equal(failover.reason, "quota");

  await fs.rm(parent, { recursive: true, force: true });
});

test("does not fail over on an ordinary (non-quota) failure", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-nofailover-"));
  const root = path.join(parent, "repo");
  await fs.mkdir(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "README.md"), "# repo\n", "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), ".strategos/runs/\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");

  const config = {
    ...DEFAULT_CONFIG,
    worktreeRoot: path.join(parent, "worktrees"),
    maxParallel: 1,
    taskTimeoutMinutes: 1,
    agents: {
      primary: { command: process.execPath, args: ["-e", "console.error('syntax error'); process.exit(1);", "{{prompt}}"] },
      backup: { command: process.execPath, args: ["-e", "console.log('backup ran');", "{{prompt}}"] },
    },
  };
  const planInput = {
    version: 1,
    goal: "no failover",
    tasks: [{ id: "solo", agent: "primary", prompt: "x", dependsOn: [] }],
  };
  const events = [];
  const result = await runPlan({ root, config, planInput, onEvent: (event) => events.push(event) });

  assert.equal(result.manifest.tasks.solo.status, "failed");
  assert.equal(result.manifest.tasks.solo.agent, "primary");
  assert.equal(events.some((event) => event.type === "task_failover"), false);

  await fs.rm(parent, { recursive: true, force: true });
});
