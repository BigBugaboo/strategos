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
  await fs.writeFile(path.join(root, ".gitignore"), ".strategos/runs/\n.strategos/attachments/\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const attachmentPath = path.join(root, ".strategos", "attachments", "design.png");
  await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
  await fs.writeFile(
    attachmentPath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
  );

  const script = [
    "const fs=require('node:fs');",
    "const id=process.env.STRATEGOS_TASK_ID;",
    "const images=fs.readdirSync('.strategos/attachments');",
    "fs.writeFileSync(id+'.txt','done\\n');",
    "console.log('completed '+id+' session '+process.env.STRATEGOS_SESSION_ID+' image '+images[0]);",
  ].join("");
  const config = {
    ...DEFAULT_CONFIG,
    worktreeRoot: path.join(parent, "worktrees"),
    maxParallel: 2,
    taskTimeoutMinutes: 1,
    agents: {
      worker: { command: process.execPath, args: ["-e", script, "{{prompt}}"] },
    },
  };
  const planInput = {
    version: 1,
    goal: "integration test",
    attachments: [".strategos/attachments/design.png"],
    tasks: [
      { id: "one", agent: "worker", prompt: "one", dependsOn: [] },
      { id: "two", agent: "worker", prompt: "two", dependsOn: [] },
      { id: "review", agent: "worker", mode: "read-only", prompt: "review", dependsOn: ["one", "two"] },
    ],
  };

  const events = [];
  const sessionIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
  ];
  const result = await runPlan({
    root,
    config,
    planInput,
    sessionIdFactory: () => sessionIds.shift(),
    onEvent: async (event) => {
      await Promise.resolve();
      events.push(event);
    },
  });
  assert.equal(result.manifest.status, "succeeded");
  assert.equal(result.manifest.tasks.one.status, "succeeded");
  assert.equal(result.manifest.tasks.two.status, "succeeded");
  assert.ok(result.manifest.tasks.one.changedFiles.includes("one.txt"));
  assert.deepEqual(result.manifest.tasks.one.diff, {
    available: true,
    bytes: result.manifest.tasks.one.diff.bytes,
    truncated: false,
  });
  assert.ok(result.manifest.tasks.one.diff.bytes > 0);
  assert.notEqual(result.manifest.tasks.one.worktree, result.manifest.tasks.two.worktree);
  assert.equal(result.manifest.sessionMode, "single-cli-multi-session");
  assert.notEqual(result.manifest.tasks.one.sessionId, result.manifest.tasks.two.sessionId);
  assert.equal(result.manifest.tasks.one.attachments[0].relativePath, ".strategos/attachments/design.png");
  assert.match(
    await fs.readFile(path.join(root, result.manifest.tasks.one.artifactDir, "report.md"), "utf8"),
    /completed one session 11111111-1111-4111-8111-111111111111 image design\.png/,
  );
  assert.match(
    await fs.readFile(path.join(root, result.manifest.tasks.one.artifactDir, "changes.diff"), "utf8"),
    /\+done/,
  );
  assert.equal(events[0].type, "run_started");
  assert.equal(events.at(-1).type, "run_finished");
  assert.deepEqual(
    events.filter((event) => event.type === "task_started").map((event) => event.task.id),
    ["one", "two", "review"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "task_finished").map((event) => event.task.id),
    ["one", "two", "review"],
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

test("interrupts active workers and skips pending dependent tasks", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-interrupt-"));
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
    maxParallel: 1,
    taskTimeoutMinutes: 1,
    agents: {
      worker: {
        command: process.execPath,
        args: ["-e", "setTimeout(() => console.log('late report'), 30000)"],
      },
    },
  };
  const controller = new AbortController();
  const result = await runPlan({
    root,
    config,
    signal: controller.signal,
    planInput: {
      version: 1,
      goal: "interrupt workers",
      tasks: [
        { id: "implementation", agent: "worker", prompt: "work", dependsOn: [] },
        {
          id: "review",
          agent: "worker",
          mode: "read-only",
          prompt: "review",
          dependsOn: ["implementation"],
        },
      ],
    },
    onEvent: (event) => {
      if (event.type === "task_started") controller.abort();
    },
  });

  assert.equal(result.manifest.status, "interrupted");
  assert.equal(result.manifest.tasks.implementation.status, "interrupted");
  assert.equal(result.manifest.tasks.review.status, "skipped");
  assert.match(result.manifest.tasks.implementation.error, /interrupted by user/);
});
