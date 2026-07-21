import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createProjectRegistry } from "../src/projects.js";

test("project registry validates, persists, and resolves Git repository paths", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-projects-test-"));
  const initialRoot = path.join(directory, "alpha");
  const secondRoot = path.join(directory, "beta");
  const nested = path.join(secondRoot, "packages", "web");
  const file = path.join(directory, "projects.json");
  const findRepoRootFn = async (candidate) => {
    if (candidate === nested || candidate === secondRoot) return secondRoot;
    throw new Error("not a Git repository");
  };
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const registry = createProjectRegistry({ initialRoot, file, findRepoRootFn });
  assert.deepEqual(await registry.list(), [{ name: "alpha", path: initialRoot }]);
  assert.deepEqual(await registry.add(nested), { name: "beta", path: secondRoot });
  assert.deepEqual(await registry.resolve(secondRoot), { name: "beta", path: secondRoot });
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
    version: 1,
    projects: [initialRoot, secondRoot],
  });
  await assert.rejects(() => registry.add(path.join(directory, "missing")), /Git repository/);
  await assert.rejects(() => registry.resolve(path.join(directory, "unregistered")), /not registered/);
});
