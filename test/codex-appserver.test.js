import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCodexAppServer } from "../src/codex-appserver.js";

// A fake `codex app-server --stdio` that speaks the newline-delimited JSON-RPC
// protocol: it starts a thread/turn, then either finishes plainly or, when the
// client injects a `turn/steer`, echoes the steered text back as the report.
const FAKE = `import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
const send = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let steered = null;
rl.on("line", (line) => {
  let m; try { m = JSON.parse(line); } catch { return; }
  if (m.method === "initialize") send({ id: m.id, result: {} });
  else if (m.method === "thread/start") send({ id: m.id, result: { thread: { id: "t1" } } });
  else if (m.method === "turn/start") {
    send({ id: m.id, result: { turn: { id: "turn1" } } });
    send({ method: "turn/started", params: { turn: { id: "turn1" } } });
    setTimeout(() => {
      if (!steered) {
        send({ method: "item/completed", params: { item: { type: "agentMessage", text: "NO_STEER" } } });
        send({ method: "turn/completed", params: {} });
      }
    }, 2500);
  } else if (m.method === "turn/steer") {
    steered = m.params?.input?.[0]?.text;
    send({ id: m.id, result: { turnId: "turn1" } });
    send({ method: "item/completed", params: { item: { type: "agentMessage", text: "STEERED:" + steered + "|" + m.params?.expectedTurnId } } });
    send({ method: "turn/completed", params: {} });
  }
});
`;

async function fakeCodex(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-codex-fake-"));
  await fs.writeFile(path.join(dir, "fake.mjs"), FAKE);
  const bin = path.join(dir, "codex");
  await fs.writeFile(bin, `#!/bin/sh\nexec node "${path.join(dir, "fake.mjs")}" "$@"\n`);
  await fs.chmod(bin, 0o755);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return bin;
}

test("codex app-server client captures the agent message report", async (t) => {
  const command = await fakeCodex(t);
  const result = await runCodexAppServer({
    command,
    prompt: "do the thing",
    cwd: os.tmpdir(),
    timeoutMs: 15_000,
    onPrompt: async () => "denied",
  });
  assert.equal(result.error, null);
  assert.match(result.report, /NO_STEER/);
});

test("codex app-server client injects guidance into the running turn", async (t) => {
  const command = await fakeCodex(t);
  let steer = null;
  const run = runCodexAppServer({
    command,
    prompt: "do the thing",
    cwd: os.tmpdir(),
    timeoutMs: 15_000,
    onPrompt: async () => "denied",
    onSteer: (fn) => {
      steer = fn;
      return () => {
        steer = null;
      };
    },
  });
  for (let attempt = 0; attempt < 40 && !steer; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(steer, "steer function should register once the turn is active");
  assert.equal(await steer("focus on tests"), true);
  const result = await run;
  assert.match(result.report, /STEERED:focus on tests\|turn1/);
});
