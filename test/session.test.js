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
    attachments: [
      {
        id: "image-1",
        relativePath: ".strategos/attachments/image-1-design.png",
        mimeType: "image/png",
      },
    ],
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
      sessionId: "11111111-1111-4111-8111-111111111111",
      report: "Release notes completed.",
    },
  });

  const file = path.join(root, ".git", "strategos", "sessions", "session-test.json");
  assert.equal(JSON.parse(await fs.readFile(file, "utf8")).status, "running");
  assert.equal((await store.latestResumable()).events[0].task.id, "release-notes");
  assert.equal((await store.latestResumable()).events[0].task.sessionId, "11111111-1111-4111-8111-111111111111");
  assert.equal((await store.latestResumable()).attachments[0].id, "image-1");

  const updatedAt = session.updatedAt;
  session = await store.setPinned(session, true);
  assert.equal(session.pinned, true);
  assert.equal(session.updatedAt, updatedAt);
  assert.equal((await store.load(session.id)).pinned, true);

  session = await store.setArchived(session, true);
  assert.equal(session.archivedAt !== null, true);
  assert.equal(session.pinned, true);
  assert.equal(session.updatedAt, updatedAt);
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.list({ includeArchived: true })).length, 1);
  assert.equal(await store.latestResumable(), undefined);

  session = await store.setArchived(session, false);
  assert.equal(session.archivedAt, null);
  assert.equal((await store.list()).length, 1);
  await store.remove(session);
  assert.equal(await store.load(session.id), undefined);
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

test("planning events retain the CLI identity and original timestamp", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-planning-event-"));
  const store = createSessionStore("/tmp/example", {
    directory,
    idFactory: () => "planning-session",
  });
  let session = await store.create({
    goal: "Plan the work",
    strategist: "codex",
    workerAgents: ["claude", "codex"],
    executionMode: "auto",
  });
  session = await store.appendEvent(session, {
    type: "planning_started",
    strategist: "codex",
    workerAgents: ["claude", "codex"],
    at: "2026-07-21T10:41:53.000Z",
  });

  assert.deepEqual(session.events[0], {
    type: "planning_started",
    strategist: "codex",
    workerAgents: ["claude", "codex"],
    at: "2026-07-21T10:41:53.000Z",
  });
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
    attachments: [{ id: "design", relativePath: ".strategos/attachments/design.png" }],
  });

  assert.match(context, /Add exports/);
  assert.match(context, /implementation/);
  assert.match(context, /network unavailable/);
  assert.match(context, /\.strategos\/attachments\/design\.png/);
});
