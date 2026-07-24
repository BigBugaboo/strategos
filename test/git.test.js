import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  captureWorktreeChanges,
  currentHead,
  isRepoClean,
  listSubRepos,
  switchBranch,
} from "../src/git.js";

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

test("discovers nested sub-repos, reports cleanliness, and switches branches", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-subrepos-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Workspace root is itself a repo; sub-repos live under repos/<name>.
  git(root, "init", "-b", "main");
  await fs.mkdir(path.join(root, "repos", "alpha"), { recursive: true });
  await fs.mkdir(path.join(root, "repos", "beta"), { recursive: true });
  for (const name of ["alpha", "beta"]) {
    const repo = path.join(root, "repos", name);
    git(repo, "init", "-b", "main");
    git(repo, "config", "user.name", "Strategos Test");
    git(repo, "config", "user.email", "strategos@example.invalid");
    await fs.writeFile(path.join(repo, "README.md"), `# ${name}\n`, "utf8");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "init");
    git(repo, "branch", "feature/x");
  }

  const subs = await listSubRepos(root);
  assert.deepEqual(
    subs.map((r) => r.relativePath).sort(),
    ["repos/alpha", "repos/beta"],
  );
  assert.equal(subs.every((r) => r.branch === "main"), true);

  const alpha = path.join(root, "repos", "alpha");
  assert.equal(await isRepoClean(alpha), true);
  await switchBranch(alpha, "feature/x");
  assert.equal((await listSubRepos(root)).find((r) => r.name === "alpha").branch, "feature/x");

  // A dirty sub-repo is reported unclean (the endpoint refuses to switch it).
  await fs.writeFile(path.join(alpha, "README.md"), "# alpha changed\n", "utf8");
  assert.equal(await isRepoClean(alpha), false);
});
