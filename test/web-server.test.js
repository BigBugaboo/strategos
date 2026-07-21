import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startWebServer } from "../src/web-server.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-web-test-"));
  const webRoot = path.join(root, "dist");
  await fs.mkdir(webRoot, { recursive: true });
  await fs.writeFile(path.join(webRoot, "index.html"), "<main>Strategos Web</main>");
  const config = {
    executionMode: "auto",
    strategist: "codex",
    workerMode: "hybrid",
    agents: { claude: {}, codex: {}, copilot: {} },
    capacity: {
      excludeExhausted: true,
      agents: {
        claude: { state: "available", remainingPercent: 72 },
        codex: { state: "available", remainingPercent: 18 },
        copilot: { state: "exhausted", remainingPercent: 0 },
      },
    },
  };
  const sessionStore = {
    list: async () => [],
    load: async () => undefined,
  };
  const result = await startWebServer({
    root,
    webRoot,
    port: 0,
    version: "test",
    loadConfigFn: async () => config,
    runDoctorFn: async () => [
      { name: "git", ok: true, detail: "git" },
      { name: "node", ok: true, detail: "node" },
      { name: "claude", ok: true, detail: "claude" },
      { name: "codex", ok: true, detail: "codex" },
      { name: "copilot", ok: true, detail: "copilot" },
    ],
    sessionStore,
  });
  t.after(async () => {
    result.server.closeAllConnections();
    await new Promise((resolve) => result.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { ...result, root };
}

test("Web bootstrap exposes repository, sessions, and eligible capacity", async (t) => {
  const { url, root } = await fixture(t);
  const response = await fetch(`${url}/api/bootstrap`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.repository, { name: path.basename(root), path: root });
  assert.equal(body.capacity.find((agent) => agent.name === "copilot").eligible, false);
  assert.deepEqual(body.sessions, []);
});

test("Web server serves the built single-page application", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/some/client/route`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Strategos Web/);
});
