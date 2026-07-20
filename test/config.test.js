import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeProject } from "../src/config.js";

test("init is non-destructive and idempotent", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-init-"));
  await fs.writeFile(path.join(root, "AGENTS.md"), "keep me\n", "utf8");
  const first = await initializeProject(root);
  const second = await initializeProject(root);
  assert.ok(first.includes(".strategos/config.json"));
  assert.equal(await fs.readFile(path.join(root, "AGENTS.md"), "utf8"), "keep me\n");
  assert.deepEqual(second, []);
});
