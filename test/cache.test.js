import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearStrategosCache, formatCacheClearResult } from "../src/cache.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-cache-"));
  const stateRoot = path.join(root, ".strategos");
  const cacheRoot = path.join(stateRoot, "cache");
  await fs.mkdir(cacheRoot, { recursive: true });
  await fs.writeFile(path.join(cacheRoot, "temporary.json"), "{}\n");
  await fs.writeFile(path.join(stateRoot, "projects.json"), "[]\n");
  return { stateRoot, cacheRoot };
}

test("cache clear dry-run preserves cached and durable files", async () => {
  const { stateRoot, cacheRoot } = await fixture();
  const result = await clearStrategosCache({ cacheRoot, dryRun: true });
  assert.equal(result.cleared, false);
  assert.equal(await fs.readFile(path.join(cacheRoot, "temporary.json"), "utf8"), "{}\n");
  assert.equal(await fs.readFile(path.join(stateRoot, "projects.json"), "utf8"), "[]\n");
  assert.match(formatCacheClearResult(result), /would be removed/);
});

test("cache clear removes only the Strategos cache directory", async () => {
  const { stateRoot, cacheRoot } = await fixture();
  const result = await clearStrategosCache({ cacheRoot });
  assert.equal(result.cleared, true);
  await assert.rejects(fs.access(cacheRoot));
  assert.equal(await fs.readFile(path.join(stateRoot, "projects.json"), "utf8"), "[]\n");
  assert.match(formatCacheClearResult(result), /sessions, attachments, and run history were preserved/);
});

test("cache clear rejects paths outside a Strategos cache directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-cache-unsafe-"));
  await assert.rejects(
    clearStrategosCache({ cacheRoot: root }),
    /refusing to clear an unexpected cache path/,
  );
});
