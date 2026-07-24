import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentInvocation, interactiveInvocation } from "./adapters.js";
import { materializeAttachments } from "./attachments.js";
import { buildTaskPrompt, collectContext } from "./context.js";
import { runInteractiveTask } from "./interactive.js";
import { runCodexAppServer } from "./codex-appserver.js";
import { runClaudeInteractive } from "./claude-interactive.js";
import {
  assertCleanRepo,
  captureWorktreeChanges,
  changedFiles,
  createTaskWorktree,
  currentHead,
} from "./git.js";
import { buildWaves, validatePlan } from "./plan.js";
import { runCommand, commandExistsError, ptyAvailable } from "./process.js";
import { isQuotaError } from "./quota.js";
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
    plannedAgent: result.plannedAgent ?? result.agent,
    failoverFrom: result.failoverFrom ?? undefined,
    mode: result.mode,
    sessionId: result.sessionId ?? null,
    sessionName: result.sessionName ?? null,
    status: result.status,
    exitCode: result.exitCode ?? null,
    branch: result.branch ?? null,
    worktree: relative(result.worktree),
    artifactDir: relative(result.artifactDir),
    changedFiles: result.changedFiles ?? [],
    diff: result.diff ?? { available: false, bytes: 0, truncated: false },
    attachments: result.attachments?.map(({ id, relativePath, mimeType }) => ({
      id,
      relativePath,
      mimeType,
    })) ?? [],
    error: result.error ?? null,
    startedAt: result.startedAt ?? null,
    finishedAt: result.finishedAt ?? null,
  };
}

async function prepareTask({
  root,
  config,
  plan,
  task,
  runId,
  runDir,
  results,
  runMemory,
  sessionIdFactory,
}) {
  const artifactDir = path.join(runDir, task.id);
  await ensureDir(artifactDir);
  const startedAt = new Date().toISOString();
  const sessionId = sessionIdFactory();
  const sessionName = `strategos-${task.id}-${sessionId.slice(0, 8)}`;
  try {
    const worktree = await createTaskWorktree({
      root,
      worktreeRoot: config.worktreeRoot,
      runId,
      taskId: task.id,
      baseRef: config.baseRef,
    });
    const baseCommit = await currentHead(worktree.path);
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
    const attachments = await materializeAttachments(root, worktree.path, plan.attachments);
    const prompt = buildTaskPrompt({
      plan,
      task,
      sharedContext,
      dependencyReports,
      runMemory,
      attachments,
    });
    const invocation = agentInvocation(task.agent, {
      prompt,
      mode: task.mode,
      workspace: worktree.path,
      config,
      attachments,
      sessionId,
      sessionName,
    });
    const interactive = interactiveInvocation(task.agent, {
      prompt,
      mode: task.mode,
      workspace: worktree.path,
      config,
      attachments,
    });
    await fs.writeFile(path.join(artifactDir, "prompt.md"), prompt, "utf8");
    return {
      id: task.id,
      agent: task.agent,
      mode: task.mode,
      sessionId,
      sessionName,
      attachments,
      artifactDir,
      branch: worktree.branch,
      worktree: worktree.path,
      baseCommit,
      invocation,
      interactiveInvocation: interactive,
      prompt,
      startedAt,
    };
  } catch (error) {
    return {
      id: task.id,
      agent: task.agent,
      mode: task.mode,
      sessionId,
      sessionName,
      status: "failed",
      artifactDir,
      report: "",
      error: error.message,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }
}

// Run one worker attempt with a specific agent + its invocations, honoring
// interactive mode. Returns the raw process-style result.
async function runWorkerOnce({ prepared, agent, invocation, interactiveInvocation, config, signal, onPrompt, onSteer, timeoutMs }) {
  const env = {
    ...process.env,
    STRATEGOS_TASK_ID: prepared.id,
    STRATEGOS_AGENT: agent,
    STRATEGOS_MODE: prepared.mode,
    STRATEGOS_SESSION_ID: prepared.sessionId,
    STRATEGOS_WORKTREE: prepared.worktree,
  };
  const interactiveEnabled = Boolean(config.interactive && onPrompt);
  const useCodexAppServer = interactiveEnabled && agent === "codex";
  const useClaudeInteractive = interactiveEnabled && agent === "claude";
  const usePty =
    interactiveEnabled &&
    !useCodexAppServer &&
    !useClaudeInteractive &&
    interactiveInvocation &&
    (await ptyAvailable());
  const task = { id: prepared.id, agent };
  if (useClaudeInteractive) {
    const r = await runClaudeInteractive({
      command: invocation.command, prompt: prepared.prompt, cwd: prepared.worktree, env, signal, timeoutMs, onPrompt, task,
    });
    return { stdout: r.report || "", stderr: r.error || "", code: r.code, aborted: r.aborted, timedOut: r.timedOut, error: null };
  }
  if (useCodexAppServer) {
    const r = await runCodexAppServer({
      command: invocation.command, prompt: prepared.prompt, cwd: prepared.worktree, env,
      sandbox: prepared.mode === "read-only" ? "read-only" : "workspace-write",
      approvalPolicy: "on-request", signal, timeoutMs, onPrompt, onSteer, task,
    });
    return { stdout: r.report || "", stderr: r.error || "", code: r.code, aborted: r.aborted, timedOut: r.timedOut, error: null };
  }
  if (usePty) {
    const r = await runInteractiveTask({
      command: interactiveInvocation.command, args: interactiveInvocation.args, cwd: prepared.worktree, signal, timeoutMs, env, onPrompt, task,
    });
    return { stdout: r.output || "", stderr: "", code: r.code, aborted: r.aborted, timedOut: r.timedOut, error: null };
  }
  return runCommand(invocation.command, invocation.args, { cwd: prepared.worktree, signal, timeoutMs, env });
}

async function executePreparedTask(prepared, config, signal, onPrompt, onSteer, emit) {
  if (prepared.status === "failed") return prepared;
  const timeoutMs = config.taskTimeoutMinutes * 60_000;
  // Candidate CLIs to hand the task to if the current one exhausts its quota,
  // in configured order, starting with the task's assigned agent.
  const enabled = Object.entries(config.agents || {})
    .filter(([, value]) => value.enabled !== false)
    .map(([name]) => name);
  let agent = prepared.agent;
  let invocation = prepared.invocation;
  let interactiveInv = prepared.interactiveInvocation;
  const attempts = [];
  let result;
  while (true) {
    result = await runWorkerOnce({
      prepared,
      agent,
      invocation,
      interactiveInvocation: interactiveInv,
      config,
      signal,
      onPrompt,
      onSteer,
      timeoutMs,
    });
    attempts.push(agent);
    const failed = result.aborted
      ? false
      : commandExistsError(result) || result.timedOut || result.code !== 0 || !result.stdout.trim();
    // Fail over only when the failure looks like quota/rate-limit exhaustion,
    // the run was not interrupted, and another CLI is available to take over.
    if (!failed || result.aborted || signal?.aborted || !isQuotaError(result)) break;
    const next = enabled.find((candidate) => !attempts.includes(candidate));
    if (!next) break;
    await emit?.({
      type: "task_failover",
      task: { id: prepared.id, agent, mode: prepared.mode },
      from: agent,
      to: next,
      reason: "quota",
    });
    agent = next;
    invocation = agentInvocation(next, {
      prompt: prepared.prompt,
      mode: prepared.mode,
      workspace: prepared.worktree,
      config,
      attachments: prepared.attachments,
      sessionId: prepared.sessionId,
      sessionName: prepared.sessionName,
    });
    interactiveInv = interactiveInvocation(next, {
      prompt: prepared.prompt,
      mode: prepared.mode,
      workspace: prepared.worktree,
      config,
      attachments: prepared.attachments,
    });
  }

  const report = result.stdout.trim();
  await fs.writeFile(path.join(prepared.artifactDir, "report.md"), `${report}\n`, "utf8");
  await fs.writeFile(path.join(prepared.artifactDir, "stderr.log"), result.stderr, "utf8");
  let files = [];
  let diff = { available: false, bytes: 0, truncated: false };
  try {
    const captured = await captureWorktreeChanges(prepared.worktree, prepared.baseCommit);
    files = captured.files;
    if (captured.files.length > 0) {
      await fs.writeFile(path.join(prepared.artifactDir, "changes.diff"), captured.patch, "utf8");
      diff = {
        available: true,
        bytes: captured.bytes,
        truncated: captured.truncated,
      };
    }
  } catch {
    files = await changedFiles(prepared.worktree).catch(() => []);
  }
  let error = null;
  if (commandExistsError(result)) error = `${invocation.command} not found on PATH`;
  else if (result.aborted) error = "task interrupted by user";
  else if (result.timedOut) error = `task exceeded ${config.taskTimeoutMinutes} minutes`;
  else if (result.code !== 0) error = result.stderr.trim() || `agent exited with code ${result.code}`;
  else if (!report) error = "agent exited without returning a report";

  return {
    ...prepared,
    // Reflect the CLI that actually finished the task (may differ from the
    // planned agent after a quota failover).
    agent,
    plannedAgent: prepared.agent,
    failoverFrom: agent !== prepared.agent ? attempts.slice(0, -1) : undefined,
    status: result.aborted ? "interrupted" : error ? "failed" : "succeeded",
    exitCode: result.code,
    report,
    error,
    changedFiles: files,
    diff,
    finishedAt: new Date().toISOString(),
  };
}

async function saveManifest(file, manifest, results, root) {
  manifest.tasks = Object.fromEntries(
    [...results.entries()].map(([id, result]) => [id, publicTaskResult(result, root)]),
  );
  await writeJson(file, manifest);
}

export async function runPlan({
  root,
  config,
  planInput,
  dryRun = false,
  maxParallel,
  onEvent = () => {},
  onPrompt,
  onSteer,
  sessionIdFactory = () => crypto.randomUUID(),
  signal,
}) {
  const emit = async (event) => {
    try {
      await onEvent(event);
    } catch {
      // Progress rendering must never interrupt orchestration.
    }
  };
  const configuredAgents = Object.entries(config.agents || {})
    .filter(([, value]) => value.enabled !== false)
    .map(([name]) => name);
  const plan = validatePlan(planInput, configuredAgents);
  const allowedAgents = new Set(configuredAgents);
  for (const task of plan.tasks) {
    if (!allowedAgents.has(task.agent)) {
      throw new Error(`task ${task.id} uses an unavailable or disabled agent: ${task.agent}`);
    }
  }
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
    sessionMode: new Set(plan.tasks.map((task) => task.agent)).size === 1
      ? (plan.tasks.length > 1 ? "single-cli-multi-session" : "single-cli")
      : "multi-cli",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tasks: {},
  };
  const results = new Map();
  const pending = new Map(plan.tasks.map((task) => [task.id, task]));
  let runMemory = await readOptional(path.join(root, ".strategos", "memory.md"));
  await saveManifest(manifestFile, manifest, results, root);
  await emit({ type: "run_started", runId, goal: plan.goal });

  while (pending.size > 0) {
    if (signal?.aborted) break;
    for (const task of [...pending.values()]) {
      const blockedBy = task.dependsOn.find((id) => {
        const dependency = results.get(id);
        return dependency && dependency.status !== "succeeded";
      });
      if (blockedBy) {
        const skipped = {
          id: task.id,
          agent: task.agent,
          mode: task.mode,
          status: "skipped",
          report: "",
          error: `dependency ${blockedBy} did not succeed`,
          finishedAt: new Date().toISOString(),
        };
        results.set(task.id, skipped);
        pending.delete(task.id);
        await emit({ type: "task_skipped", task: skipped });
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
      await emit({ type: "task_preparing", task });
      prepared.push(
        await prepareTask({
          root,
          config,
          plan,
          task,
          runId,
          runDir,
          results,
          runMemory,
          sessionIdFactory,
        }),
      );
      pending.delete(task.id);
    }
    for (const task of prepared) {
      if (task.status !== "failed") await emit({ type: "task_started", task });
    }
    const batch = await Promise.all(
      prepared.map((task) => executePreparedTask(task, config, signal, onPrompt, onSteer, emit)),
    );
    for (const result of batch) {
      results.set(result.id, result);
      await emit({ type: "task_finished", task: result });
      const summary = result.report
        ? truncateText(result.report, 4_000)
        : result.error || "No report returned.";
      runMemory += `\n\n## ${result.id} (${result.status})\n\n${summary}`;
    }
    await fs.writeFile(path.join(runDir, "shared-memory.md"), runMemory, "utf8");
    await saveManifest(manifestFile, manifest, results, root);
  }

  if (signal?.aborted) {
    for (const task of pending.values()) {
      results.set(task.id, {
        id: task.id,
        agent: task.agent,
        mode: task.mode,
        status: "skipped",
        report: "",
        error: "run interrupted before task started",
        finishedAt: new Date().toISOString(),
      });
    }
    pending.clear();
  }
  manifest.status = signal?.aborted
    ? "interrupted"
    : [...results.values()].every((result) => result.status === "succeeded")
      ? "succeeded"
      : "failed";
  manifest.finishedAt = new Date().toISOString();
  await saveManifest(manifestFile, manifest, results, root);
  await emit({ type: "run_finished", runId, manifest });
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
