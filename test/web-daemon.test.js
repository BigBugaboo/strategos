import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  restartWebDaemon,
  startWebDaemon,
  stopWebDaemon,
} from "../src/web-daemon.js";

const execFileAsync = promisify(execFile);
const entrypoint = fileURLToPath(new URL("../bin/strategos.js", import.meta.url));

test("Web daemon survives its starter and stops only through the stop command", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-web-daemon-test-"));
  await execFileAsync("git", ["init", "--quiet", root]);
  t.after(async () => {
    await stopWebDaemon({ root }).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  const started = await startWebDaemon({
    root,
    entrypoint,
    host: "127.0.0.1",
    port: 0,
  });
  assert.equal(started.alreadyRunning, false);
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await fetch(started.url)).status, 200);

  const duplicate = await startWebDaemon({
    root,
    entrypoint,
    host: "127.0.0.1",
    port: 0,
  });
  assert.equal(duplicate.alreadyRunning, true);
  assert.equal(duplicate.pid, started.pid);
  assert.equal(duplicate.url, started.url);

  const restarted = await restartWebDaemon({ root, entrypoint });
  assert.equal(restarted.restarted, true);
  assert.notEqual(restarted.pid, started.pid);
  assert.equal(restarted.url, started.url);
  assert.equal((await fetch(restarted.url)).status, 200);

  const stopped = await stopWebDaemon({ root });
  assert.equal(stopped.alreadyStopped, false);
  await assert.rejects(fetch(restarted.url));
  await assert.rejects(fs.access(path.join(root, ".strategos", "web.json")));

  const stoppedAgain = await stopWebDaemon({ root });
  assert.equal(stoppedAgain.alreadyStopped, true);

  const startedByRestart = await restartWebDaemon({ root, entrypoint, port: 0 });
  assert.equal(startedByRestart.restarted, false);
  assert.equal((await fetch(startedByRestart.url)).status, 200);
  assert.equal((await stopWebDaemon({ root })).alreadyStopped, false);
});

test("Web daemon refuses to overwrite unverified state for a live PID", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-web-daemon-state-test-"));
  const stateDirectory = path.join(root, ".strategos");
  await fs.mkdir(stateDirectory, { recursive: true });
  await fs.writeFile(path.join(stateDirectory, "web.json"), JSON.stringify({
    instanceId: "unverified",
    token: "invalid",
    pid: process.pid,
    url: "http://127.0.0.1:1",
  }));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await assert.rejects(
    startWebDaemon({ root, entrypoint, port: 0 }),
    /is running but could not be verified/,
  );
});
