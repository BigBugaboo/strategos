import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scanNativeSessions, publicNativeSession } from "../src/native-sessions.js";

async function writeLines(file, objects) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, objects.map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
}

async function fixtureHome(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-native-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  return home;
}

test("scans Claude and Codex transcripts and flags the current project", async (t) => {
  const home = await fixtureHome(t);
  const projectRoot = "/Users/dev/app";

  const claudeId = "e4e1f53f-e3b8-49b7-8bb4-9cbb18034e88";
  await writeLines(path.join(home, ".claude", "projects", "-Users-dev-app", `${claudeId}.jsonl`), [
    { type: "queue-operation", operation: "enqueue", timestamp: "2026-07-16T11:35:56.704Z" },
    {
      type: "user",
      timestamp: "2026-07-16T11:36:00.000Z",
      cwd: projectRoot,
      gitBranch: "feature/login",
      message: { role: "user", content: "Add a login form" },
    },
    { type: "assistant", message: { role: "assistant", content: "Sure." } },
  ]);

  const codexId = "019c4c41-065c-7b41-be73-13bfa3e77e81";
  await writeLines(
    path.join(home, ".codex", "sessions", "2026", "07", "20", `rollout-2026-07-20T10-30-55-${codexId}.jsonl`),
    [
      {
        type: "session_meta",
        timestamp: "2026-07-20T10:30:55.875Z",
        payload: {
          id: codexId,
          cwd: "/Users/dev/other",
          cli_version: "0.98.0",
          timestamp: "2026-07-20T10:30:55.836Z",
        },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "<permissions>" }] },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Refactor the parser" }] },
      },
    ],
  );

  const sessions = await scanNativeSessions({ home, projectRoot });
  assert.equal(sessions.length, 2);

  const claude = sessions.find((session) => session.source === "claude");
  assert.equal(claude.nativeSessionId, claudeId);
  assert.equal(claude.title, "Add a login form");
  assert.equal(claude.cwd, projectRoot);
  assert.equal(claude.gitBranch, "feature/login");
  assert.equal(claude.matchesProject, true);
  assert.equal(claude.id, `claude-${claudeId}`);

  const codex = sessions.find((session) => session.source === "codex");
  assert.equal(codex.nativeSessionId, codexId);
  // The injected permissions turn is skipped in favour of the first real prompt.
  assert.equal(codex.title, "Refactor the parser");
  assert.equal(codex.cliVersion, "0.98.0");
  assert.equal(codex.matchesProject, false);
});

test("skips damaged lines and files without a session id", async (t) => {
  const home = await fixtureHome(t);
  const codexDir = path.join(home, ".codex", "sessions", "2026", "07", "21");
  await fs.mkdir(codexDir, { recursive: true });
  // A rollout with no session_meta payload id must be ignored.
  await fs.writeFile(
    path.join(codexDir, "rollout-2026-07-21T00-00-00-bad.jsonl"),
    'not json\n{"type":"response_item","payload":{"type":"message","role":"user","content":"hi"}}\n',
    "utf8",
  );
  const sessions = await scanNativeSessions({ home });
  assert.deepEqual(sessions, []);
});

test("returns an empty list when no CLI history exists", async (t) => {
  const home = await fixtureHome(t);
  const sessions = await scanNativeSessions({ home });
  assert.deepEqual(sessions, []);
});

test("public descriptor omits the absolute transcript path", async (t) => {
  const home = await fixtureHome(t);
  const claudeId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  await writeLines(path.join(home, ".claude", "projects", "-x", `${claudeId}.jsonl`), [
    { type: "user", cwd: "/tmp/x", message: { role: "user", content: "hello" } },
  ]);
  const [descriptor] = await scanNativeSessions({ home });
  assert.ok(descriptor.transcriptPath);
  const published = publicNativeSession(descriptor);
  assert.equal(published.transcriptPath, undefined);
  assert.equal(published.title, "hello");
});
