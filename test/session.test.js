import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildResumeContext, createSessionStore } from "../src/session.js";

test("stores durable sessions under Git metadata and restores checkpoints", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-session-"));
  await fs.mkdir(path.join(root, ".git"));
  const store = createSessionStore(root, {
    idFactory: () => "session-test",
  });

  let session = await store.create({
    goal: "Ship a release",
    strategist: "codex",
    workerAgents: ["claude", "codex"],
    executionMode: "auto",
  });
  session = await store.update(session, {
    status: "running",
    plan: { version: 1, goal: "Ship a release", tasks: [] },
  });
  session = await store.appendEvent(session, {
    type: "task_finished",
    task: {
      id: "release-notes",
      agent: "claude",
      status: "succeeded",
      report: "Release notes completed.",
    },
  });

  const file = path.join(root, ".git", "strategos", "sessions", "session-test.json");
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).status, "running");
  assert.equal((await store.latestResumable()).events[0].task.id, "release-notes");
});

test("completed sessions remain inspectable but are not offered for recovery", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-session-store-"));
  const store = createSessionStore("/tmp/example", {
    directory,
    idFactory: () => "completed-session",
  });
  let session = await store.create({
    goal: "Complete work",
    strategist: "codex",
    workerAgents: ["codex"],
    executionMode: "manual",
  });
  session = await store.update(session, { status: "succeeded" });

  assert.equal((await store.list()).length, 1);
  assert.equal(await store.latestResumable(), undefined);
  await assert.rejects(store.load("../outside"), /invalid session id/);
});

test("resume context carries the prior plan, progress, and failure", () => {
  const context = buildResumeContext({
    id: "session-context",
    goal: "Add exports",
    strategist: "claude",
    status: "failed",
    plan: { tasks: [{ id: "implementation" }] },
    runId: "run-1",
    events: [{ type: "task_finished", task: { id: "implementation", status: "succeeded" } }],
    error: "network unavailable",
    updatedAt: "2026-07-21T00:00:00.000Z",
  });

  assert.match(context, /Add exports/);
  assert.match(context, /implementation/);
  assert.match(context, /network unavailable/);
});
