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

test("runs independent custom workers in isolated worktrees and preserves reports", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-run-"));
  const root = path.join(parent, "repo");
  await fs.mkdir(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "AGENTS.md"), "Test project\n", "utf8");
  await fs.mkdir(path.join(root, ".strategos"));
  await fs.writeFile(path.join(root, ".strategos", "context.md"), "Shared context\n", "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), ".strategos/runs/\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");

  const script = [
    "const fs=require('node:fs');",
    "const id=process.env.STRATEGOS_TASK_ID;",
    "fs.writeFileSync(id+'.txt','done\\n');",
    "console.log('completed '+id);",
  ].join("");
  const config = {
    ...DEFAULT_CONFIG,
    worktreeRoot: path.join(parent, "worktrees"),
    maxParallel: 2,
    taskTimeoutMinutes: 1,
    agents: {
      worker: { command: process.execPath, args: ["-e", script, "{{prompt}}"] },
      reviewer: { command: process.execPath, args: ["-e", "console.log('review complete')"] },
    },
  };
  const planInput = {
    version: 1,
    goal: "integration test",
    tasks: [
      { id: "one", agent: "worker", prompt: "one", dependsOn: [] },
      { id: "two", agent: "worker", prompt: "two", dependsOn: [] },
      { id: "review", agent: "reviewer", mode: "read-only", prompt: "review", dependsOn: ["one", "two"] },
    ],
  };

  const result = await runPlan({ root, config, planInput });
  assert.equal(result.manifest.status, "succeeded");
  assert.equal(result.manifest.tasks.one.status, "succeeded");
  assert.equal(result.manifest.tasks.two.status, "succeeded");
  assert.ok(result.manifest.tasks.one.changedFiles.includes("one.txt"));
  assert.notEqual(result.manifest.tasks.one.worktree, result.manifest.tasks.two.worktree);
  assert.match(
    await fs.readFile(path.join(root, result.manifest.tasks.one.artifactDir, "report.md"), "utf8"),
    /completed one/,
  );
});

test("does not treat a silent zero-exit agent as successful", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-silent-"));
  const root = path.join(parent, "repo");
  await fs.mkdir(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "AGENTS.md"), "Test project\n", "utf8");
  await fs.writeFile(path.join(root, ".gitignore"), ".strategos/runs/\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const config = {
    ...DEFAULT_CONFIG,
    worktreeRoot: path.join(parent, "worktrees"),
    taskTimeoutMinutes: 1,
    agents: { silent: { command: process.execPath, args: ["-e", "process.exit(0)"] } },
  };
  const result = await runPlan({
    root,
    config,
    planInput: {
      version: 1,
      goal: "detect silent failure",
      tasks: [{ id: "silent", agent: "silent", prompt: "report", dependsOn: [] }],
    },
  });
  assert.equal(result.manifest.status, "failed");
  assert.match(result.manifest.tasks.silent.error, /without returning a report/);
});
