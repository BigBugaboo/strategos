import fs from "node:fs/promises";
import path from "node:path";
import { MAX_TASK_DIFF_BYTES } from "./git.js";
import { isInside } from "./utils.js";

const SAFE_ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

export async function loadSessionTaskDiff(root, session, taskId) {
  if (!SAFE_ARTIFACT_ID.test(String(taskId || ""))) {
    throw httpError("task must be a valid task id", 400);
  }
  if (!SAFE_ARTIFACT_ID.test(String(session?.runId || ""))) {
    throw httpError("session has no persisted run diff", 404);
  }
  const task = session.manifest?.tasks?.[taskId];
  if (!task || task.diff?.available !== true) {
    throw httpError("diff is not available for this task", 404);
  }

  const runsRoot = path.resolve(root, ".strategos", "runs");
  const diffFile = path.resolve(runsRoot, session.runId, taskId, "changes.diff");
  if (!isInside(runsRoot, diffFile)) throw httpError("invalid diff path", 400);

  let stat;
  try {
    stat = await fs.stat(diffFile);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError("persisted diff was not found", 404);
    throw error;
  }
  if (!stat.isFile()) throw httpError("persisted diff was not found", 404);
  if (stat.size > MAX_TASK_DIFF_BYTES) {
    throw httpError("persisted diff exceeds the safe preview limit", 413);
  }

  return {
    taskId,
    files: task.changedFiles || [],
    patch: await fs.readFile(diffFile, "utf8"),
    bytes: stat.size,
    truncated: Boolean(task.diff.truncated),
  };
}
