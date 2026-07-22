import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { installGitHooks } from "../scripts/install-hooks.js";

async function createRepository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-hooks-"));
  await fs.mkdir(path.join(root, ".githooks"));
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  return root;
}

function hooksPath(root) {
  return execFileSync("git", ["config", "--local", "--get", "core.hooksPath"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

test("installs the repository-managed Git hooks path", async () => {
  const root = await createRepository();
  const messages = [];

  const result = installGitHooks({ root, log: (message) => messages.push(message) });

  assert.equal(result.status, "installed");
  assert.equal(hooksPath(root), ".githooks");
  assert.match(messages.join("\n"), /Enabled Strategos Git hooks/);
});

test("preserves an existing hooks path unless replacement is explicit", async () => {
  const root = await createRepository();
  execFileSync("git", ["config", "--local", "core.hooksPath", ".custom-hooks"], { cwd: root });
  const warnings = [];

  const preserved = installGitHooks({
    root,
    log: () => {},
    warn: (message) => warnings.push(message),
  });
  assert.equal(preserved.status, "preserved");
  assert.equal(hooksPath(root), ".custom-hooks");
  assert.match(warnings.join("\n"), /--force/);

  const replaced = installGitHooks({ root, force: true, log: () => {} });
  assert.equal(replaced.status, "installed");
  assert.equal(hooksPath(root), ".githooks");
});

test("Git hooks isolate project checks from the invoking repository environment", async () => {
  for (const name of ["pre-commit", "pre-push"]) {
    const source = await fs.readFile(path.join(process.cwd(), ".githooks", name), "utf8");
    assert.match(source, /git rev-parse --local-env-vars/);
    assert.match(source, /unset "\$variable"/);
  }
});
