import fs from "node:fs/promises";
import path from "node:path";
import { runCommand } from "./process.js";
import { ensureDir, slugify } from "./utils.js";

export const MAX_TASK_DIFF_BYTES = 2 * 1024 * 1024;

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

function nulSeparatedPaths(output) {
  return output.split("\0").filter(Boolean);
}

async function gitDiff(cwd, args, maxOutputBytes) {
  const result = await runCommand("git", ["diff", ...args], {
    cwd,
    timeoutMs: 60_000,
    maxOutputBytes: maxOutputBytes + 1,
  });
  const exceededLimit = result.stderr.includes("output exceeded the configured limit");
  const isNoIndexDifference = args.includes("--no-index") && result.code === 1;
  if (result.code !== 0 && !exceededLimit && !isNoIndexDifference) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new Error(`git diff failed: ${detail}`);
  }
  return { patch: result.stdout, truncated: exceededLimit };
}

/**
 * Capture every task change relative to the worktree's starting commit.
 * This includes committed, staged, unstaged, and untracked files while keeping
 * the persisted patch bounded for local UI rendering.
 */
export async function captureWorktreeChanges(
  worktree,
  baseCommit,
  { maxBytes = MAX_TASK_DIFF_BYTES } = {},
) {
  const trackedOutput = await git(worktree, ["diff", "--name-only", "-z", baseCommit, "--"]);
  const untrackedOutput = await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const trackedFiles = nulSeparatedPaths(trackedOutput);
  const untrackedFiles = nulSeparatedPaths(untrackedOutput);
  const files = [...new Set([...trackedFiles, ...untrackedFiles])].sort();

  const tracked = await gitDiff(
    worktree,
    ["--no-ext-diff", "--no-color", "--unified=3", baseCommit, "--"],
    maxBytes,
  );
  let patch = tracked.patch;
  let truncated = tracked.truncated;

  for (const file of untrackedFiles) {
    if (truncated || Buffer.byteLength(patch, "utf8") >= maxBytes) {
      truncated = true;
      break;
    }
    const remainingBytes = maxBytes - Buffer.byteLength(patch, "utf8");
    const addition = await gitDiff(
      worktree,
      ["--no-ext-diff", "--no-color", "--unified=3", "--no-index", "--", "/dev/null", file],
      remainingBytes,
    );
    patch += addition.patch;
    truncated ||= addition.truncated;
  }

  const patchBuffer = Buffer.from(patch, "utf8");
  if (patchBuffer.byteLength > maxBytes) {
    patch = patchBuffer.subarray(0, maxBytes).toString("utf8");
    truncated = true;
  }
  if (truncated) {
    const lastFileStart = patch.lastIndexOf("\ndiff --git ");
    patch = lastFileStart > 0 ? patch.slice(0, lastFileStart + 1) : "";
  }

  return {
    files,
    patch,
    bytes: Buffer.byteLength(patch, "utf8"),
    truncated,
  };
}

export async function currentHead(root) {
  return git(root, ["rev-parse", "HEAD"]);
}

export async function currentBranch(root) {
  return (await git(root, ["branch", "--show-current"])) || "detached HEAD";
}

export async function listBranches(root) {
  const output = await git(root, [
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=-committerdate",
    "refs/heads",
  ]);
  return output ? output.split("\n").filter(Boolean) : [];
}

export async function createBranch(root, name, startPoint = "HEAD") {
  await git(root, ["branch", name, startPoint]);
  return name;
}

// Directories that never hold a user-facing sub-repo worth listing.
const SUBREPO_SKIP = new Set([".git", "node_modules", ".strategos", ".strategos-worktrees"]);

// Discover nested Git repositories inside a workspace project (up to two levels
// deep, e.g. `repos/<name>`), excluding the workspace root itself. Returns each
// with its path relative to the root and current branch.
export async function listSubRepos(root, { maxDepth = 2 } = {}) {
  const found = [];
  const walk = async (dir, depth) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SUBREPO_SKIP.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const child = path.join(dir, entry.name);
      let isRepo = false;
      try {
        await fs.access(path.join(child, ".git"));
        isRepo = true;
      } catch {
        isRepo = false;
      }
      if (isRepo) {
        found.push(child);
      } else if (depth < maxDepth) {
        await walk(child, depth + 1);
      }
    }
  };
  await walk(root, 1);
  found.sort();
  return Promise.all(
    found.map(async (repoPath) => ({
      name: path.basename(repoPath),
      relativePath: path.relative(root, repoPath),
      branch: await currentBranch(repoPath).catch(() => "unknown"),
    })),
  );
}

export async function isRepoClean(root) {
  const status = await git(root, ["status", "--porcelain"]);
  return status.length === 0;
}

export async function switchBranch(root, branch) {
  await git(root, ["switch", branch]);
  return branch;
}
