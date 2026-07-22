import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, initializeProject, loadConfig } from "../src/config.js";

test("init is non-destructive and idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-init-"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "keep me\n", "utf8");
  const first = await initializeProject(root);
  const second = await initializeProject(root);
  assert.ok(first.includes(".strategos/config.json"));
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "keep me\n");
  assert.match(await fs.readFile(path.join(root, ".gitignore"), "utf8"), /\.strategos\/attachments\//);
  assert.deepEqual(second, []);
});

test("hybrid worker participation is the default and can be separated", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-config-"));
  assert.equal(DEFAULT_CONFIG.workerMode, "hybrid");
  assert.equal(DEFAULT_CONFIG.executionMode, "auto");
  assert.equal((await loadConfig(root)).workerMode, "hybrid");
  assert.equal((await loadConfig(root)).executionMode, "auto");

  await fs.mkdir(path.join(root, ".strategos"));
  await fs.writeFile(
    path.join(root, ".strategos", "config.json"),
    `${JSON.stringify({
      workerMode: "separated",
      executionMode: "manual",
      capacity: { excludeExhausted: true },
    })}\n`,
    "utf8",
  );
  assert.equal((await loadConfig(root)).workerMode, "separated");
  assert.equal((await loadConfig(root)).executionMode, "manual");
  assert.equal(Object.hasOwn(await loadConfig(root), "capacity"), false);
});
