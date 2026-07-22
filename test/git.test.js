import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureWorktreeChanges, currentHead } from "../src/git.js";

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("captures committed and untracked worktree changes from the task base", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-diff-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "existing.js"), "export const value = 1;\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const baseCommit = await currentHead(root);

  await fs.writeFile(path.join(root, "existing.js"), "export const value = 2;\n", "utf8");
  git(root, "add", "existing.js");
  git(root, "commit", "-m", "task commit");
  await fs.writeFile(path.join(root, "untracked.js"), "export const added = true;\n", "utf8");

  const captured = await captureWorktreeChanges(root, baseCommit);
  assert.deepEqual(captured.files, ["existing.js", "untracked.js"]);
  assert.equal(captured.truncated, false);
  assert.match(captured.patch, /-export const value = 1;/);
  assert.match(captured.patch, /\+export const value = 2;/);
  assert.match(captured.patch, /\+export const added = true;/);
});

test("bounds large task patches without persisting a partial file block", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-diff-limit-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Strategos Test");
  git(root, "config", "user.email", "strategos@example.invalid");
  await fs.writeFile(path.join(root, "large.txt"), "before\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  const baseCommit = await currentHead(root);
  await fs.writeFile(path.join(root, "large.txt"), `${"after\n".repeat(200)}`, "utf8");

  const captured = await captureWorktreeChanges(root, baseCommit, { maxBytes: 128 });
  assert.deepEqual(captured.files, ["large.txt"]);
  assert.equal(captured.truncated, true);
  assert.equal(captured.patch, "");
  assert.ok(captured.bytes <= 128);
});
