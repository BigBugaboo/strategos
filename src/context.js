import fs from "node:fs/promises";
import path from "node:path";
import { isInside, truncateText } from "./utils.js";

async function readContextFile(root, realRoot, relativePath, remainingBytes) {
  const file = path.resolve(root, relativePath);
  if (!isInside(root, file)) {
    throw new Error(`context path escapes the repository: ${relativePath}`);
  }
  const realFile = await fs.realpath(file);
  if (!isInside(realRoot, realFile)) {
    throw new Error(`context symlink escapes the repository: ${relativePath}`);
  }
  const content = await fs.readFile(realFile, "utf8");
  return `## ${relativePath}\n\n${truncateText(content, remainingBytes)}`;
}

export async function collectContext(root, paths, maxBytes) {
  const realRoot = await fs.realpath(root);
  const unique = [...new Set(paths)];
  const sections = [];
  let used = 0;
  for (const relativePath of unique) {
    const remaining = maxBytes - used;
    if (remaining <= 0) break;
    try {
      const section = await readContextFile(root, realRoot, relativePath, remaining);
      sections.push(section);
      used += Buffer.byteLength(section);
    } catch (error) {
      if (error.code === "ENOENT") {
        sections.push(`## ${relativePath}\n\n[context file not found]`);
        continue;
      }
      throw error;
    }
  }
  return sections.join("\n\n");
}

export function buildTaskPrompt({ plan, task, sharedContext, dependencyReports, runMemory }) {
  const dependencies = dependencyReports.length
    ? truncateText(
        dependencyReports
          .map(({ id, report }) => `### Report from ${id}\n\n${truncateText(report, 16_000)}`)
          .join("\n\n"),
        64_000,
      )
    : "No dependency reports are available for this task.";

  return `# Strategos assignment

You are the **${task.agent}** worker for task **${task.id}**.

## Overall goal

${plan.goal}

## Your task

${task.prompt}

## Operating mode

${task.mode}. Stay inside the assigned Git worktree. Do not push, merge, delete
branches, or modify other worktrees. Do not expose secrets in your report.

## Shared repository context

${sharedContext || "No shared context was provided."}

## Run memory

${runMemory ? truncateText(runMemory, 32_000) : "No earlier run memory is available."}

## Dependency reports

${dependencies}

## Completion contract

Return a concise report with:

1. Outcome and approach.
2. Files changed, or files inspected for read-only work.
3. Commands/tests run and their results.
4. Remaining risks, assumptions, or blockers.
`;
}
