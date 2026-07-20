import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./process.js";
import { ensureDir, slugify } from "./utils.js";

async function git(cwd, args, options = {}) {
  const result = await runCommand("git", args, { cwd, timeoutMs: 60_000, ...options });
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new Error(`git ${args[0]} failed: ${detail}`);
  }
  return result.stdout.trim();
}

export async function findRepoRoot(cwd = process.cwd()) {
  return git(cwd, ["rev-parse", "--show-toplevel"]);
}

export async function assertCleanRepo(root) {
  const status = await git(root, ["status", "--porcelain"]);
  if (status) {
    throw new Error(
      "repository has uncommitted changes; commit or stash them before creating isolated task worktrees",
    );
  }
}

export async function createTaskWorktree({ root, worktreeRoot, runId, taskId, baseRef }) {
  const repoName = path.basename(root);
  const taskSlug = slugify(taskId);
  const target = path.resolve(root, worktreeRoot, repoName, runId, taskSlug);
  const branch = `strategos/${slugify(runId)}/${taskSlug}`;

  await ensureDir(path.dirname(target));
  try {
    await fs.access(target);
    throw new Error(`worktree target already exists: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await git(root, ["worktree", "add", "-b", branch, target, baseRef]);
  return { path: target, branch };
}

export async function changedFiles(worktree) {
  const output = await git(worktree, ["status", "--porcelain"]);
  if (!output) return [];
  return output.split("\n").map((line) => line.slice(3)).filter(Boolean);
}

export async function currentHead(root) {
  return git(root, ["rev-parse", "HEAD"]);
}
