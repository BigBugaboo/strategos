import fs from "node:fs/promises";
import path from "node:path";
import { agentInvocation } from "./adapters.js";
import { buildTaskPrompt, collectContext } from "./context.js";
import { assertCleanRepo, changedFiles, createTaskWorktree, currentHead } from "./git.js";
import { buildWaves, validatePlan } from "./plan.js";
import { runCommand, commandExistsError } from "./process.js";
import { createRunId, ensureDir, readJson, truncateText, writeJson } from "./utils.js";

async function readOptional(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function publicTaskResult(result, root) {
  const relative = (value) => (value ? path.relative(root, value) : null);
  return {
    id: result.id,
    agent: result.agent,
    mode: result.mode,
    status: result.status,
    exitCode: result.exitCode ?? null,
    branch: result.branch ?? null,
    worktree: relative(result.worktree),
    artifactDir: relative(result.artifactDir),
    changedFiles: result.changedFiles ?? [],
    error: result.error ?? null,
    startedAt: result.startedAt ?? null,
    finishedAt: result.finishedAt ?? null,
  };
}

async function prepareTask({ root, config, plan, task, runId, runDir, results, runMemory }) {
  const artifactDir = path.join(runDir, task.id);
  await ensureDir(artifactDir);
  const startedAt = new Date().toISOString();
  try {
    const worktree = await createTaskWorktree({
      root,
      worktreeRoot: config.worktreeRoot,
      runId,
      taskId: task.id,
      baseRef: config.baseRef,
    });
    const contextPaths = [
      "AGENTS.md",
      ".strategos/context.md",
      ".strategos/memory.md",
      ...plan.context,
      ...task.context,
    ];
    const sharedContext = await collectContext(root, contextPaths, config.maxContextBytes);
    const dependencyReports = task.dependsOn.map((id) => ({
      id,
      report: results.get(id)?.report || "[dependency produced no report]",
    }));
    const prompt = buildTaskPrompt({ plan, task, sharedContext, dependencyReports, runMemory });
    const invocation = agentInvocation(task.agent, {
      prompt,
      mode: task.mode,
      workspace: worktree.path,
      config,
    });
    await fs.writeFile(path.join(artifactDir, "prompt.md"), prompt, "utf8");
    return {
      id: task.id,
      agent: task.agent,
      mode: task.mode,
      artifactDir,
      branch: worktree.branch,
      worktree: worktree.path,
      invocation,
      startedAt,
    };
  } catch (error) {
    return {
      id: task.id,
      agent: task.agent,
      mode: task.mode,
      status: "failed",
      artifactDir,
      report: "",
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

async function executePreparedTask(prepared, config) {
  if (prepared.status === "failed") return prepared;
  const timeoutMs = config.taskTimeoutMinutes * 60_000;
  const result = await runCommand(prepared.invocation.command, prepared.invocation.args, {
    cwd: prepared.worktree,
    timeoutMs,
    env: {
      ...process.env,
      STRATEGOS_TASK_ID: prepared.id,
      STRATEGOS_AGENT: prepared.agent,
      STRATEGOS_MODE: prepared.mode,
      STRATEGOS_WORKTREE: prepared.worktree,
    },
  });

  const report = result.stdout.trim();
  await fs.writeFile(path.join(prepared.artifactDir, "report.md"), `${report}\n`, "utf8");
  await fs.writeFile(path.join(prepared.artifactDir, "stderr.log"), result.stderr, "utf8");
  const files = await changedFiles(prepared.worktree).catch(() => []);
  let error = null;
  if (commandExistsError(result)) error = `${prepared.invocation.command} not found on PATH`;
  else if (result.timedOut) error = `task exceeded ${config.taskTimeoutMinutes} minutes`;
  else if (result.code !== 0) error = result.stderr.trim() || `agent exited with code ${result.code}`;
  else if (!report) error = "agent exited without returning a report";

  return {
    ...prepared,
    status: error ? "failed" : "succeeded",
    exitCode: result.code,
    report,
    error,
    changedFiles: files,
    finishedAt: new Date().toISOString(),
  };
}

async function saveManifest(file, manifest, results, root) {
  manifest.tasks = Object.fromEntries(
    [...results.entries()].map(([id, result]) => [id, publicTaskResult(result, root)]),
  );
  await writeJson(file, manifest);
}

export async function runPlan({ root, config, planInput, dryRun = false, maxParallel }) {
  const configuredAgents = Object.keys(config.agents || {});
  const plan = validatePlan(planInput, configuredAgents);
  const concurrency = maxParallel || config.maxParallel;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("maxParallel must be a positive integer");
  }
  if (!Number.isInteger(config.maxContextBytes) || config.maxContextBytes < 1) {
    throw new Error("maxContextBytes must be a positive integer");
  }
  if (!(Number.isFinite(config.taskTimeoutMinutes) && config.taskTimeoutMinutes > 0)) {
    throw new Error("taskTimeoutMinutes must be a positive number");
  }
  const waves = buildWaves(plan).map((wave) => wave.map((task) => task.id));
  if (dryRun) return { dryRun: true, plan, waves, maxParallel: concurrency };

  await assertCleanRepo(root);
  const head = await currentHead(root);
  const runId = createRunId();
  const runDir = path.join(root, ".strategos", "runs", runId);
  const manifestFile = path.join(runDir, "run.json");
  await ensureDir(runDir);
  await writeJson(path.join(runDir, "plan.json"), plan);

  const manifest = {
    version: 1,
    id: runId,
    goal: plan.goal,
    repository: root,
    head,
    baseRef: config.baseRef,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tasks: {},
  };
  const results = new Map();
  const pending = new Map(plan.tasks.map((task) => [task.id, task]));
  let runMemory = await readOptional(path.join(root, ".strategos", "memory.md"));
  await saveManifest(manifestFile, manifest, results, root);

  while (pending.size > 0) {
    for (const task of [...pending.values()]) {
      const blockedBy = task.dependsOn.find((id) => {
        const dependency = results.get(id);
        return dependency && dependency.status !== "succeeded";
      });
      if (blockedBy) {
        results.set(task.id, {
          id: task.id,
          agent: task.agent,
          mode: task.mode,
          status: "skipped",
          report: "",
          error: `dependency ${blockedBy} did not succeed`,
          finishedAt: new Date().toISOString(),
        });
        pending.delete(task.id);
      }
    }

    const ready = [...pending.values()]
      .filter((task) => task.dependsOn.every((id) => results.get(id)?.status === "succeeded"))
      .slice(0, concurrency);
    if (ready.length === 0) {
      if (pending.size === 0) break;
      throw new Error("no runnable tasks remain; dependency state is inconsistent");
    }

    const prepared = [];
    for (const task of ready) {
      prepared.push(
        await prepareTask({ root, config, plan, task, runId, runDir, results, runMemory }),
      );
      pending.delete(task.id);
    }
    const batch = await Promise.all(prepared.map((task) => executePreparedTask(task, config)));
    for (const result of batch) {
      results.set(result.id, result);
      const summary = result.report
        ? truncateText(result.report, 4_000)
        : result.error || "No report returned.";
      runMemory += `\n\n## ${result.id} (${result.status})\n\n${summary}`;
    }
    await fs.writeFile(path.join(runDir, "shared-memory.md"), runMemory, "utf8");
    await saveManifest(manifestFile, manifest, results, root);
  }

  manifest.status = [...results.values()].every((result) => result.status === "succeeded")
    ? "succeeded"
    : "failed";
  manifest.finishedAt = new Date().toISOString();
  await saveManifest(manifestFile, manifest, results, root);
  return { dryRun: false, runId, manifest, results };
}

export async function loadRun(root, runId) {
  const runsDir = path.join(root, ".strategos", "runs");
  let selected = runId;
  if (!selected) {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    selected = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .at(-1);
  }
  if (!selected) throw new Error("no Strategos runs found");
  return readJson(path.join(runsDir, selected, "run.json"));
}
