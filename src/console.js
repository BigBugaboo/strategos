import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import {
  attachImage,
  captureClipboardImage,
  formatBytes,
  resolveAttachments,
} from "./attachments.js";
import { initializeProject, loadConfig } from "./config.js";
import { eligibleAgents } from "./capacity.js";
import { runDoctor } from "./doctor.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { planWithStrategist } from "./planner.js";
import { buildWaves, validatePlan } from "./plan.js";
import { buildResumeContext, createSessionStore } from "./session.js";
import {
  createTerminalUi,
  formatResumeSession,
  renderInputChrome,
  renderWelcome,
  selectResumeSession,
} from "./terminal.js";
import { ensureDir, parsePositiveInteger, writeJson } from "./utils.js";

const DEFAULT_CONTEXT_PATHS = Object.freeze([
  "AGENTS.md",
  ".strategos/context.md",
  ".strategos/memory.md",
]);

function writeLine(output, text = "") {
  output.write(`${text}\n`);
}

export function formatPlan(plan, ui = createTerminalUi()) {
  const waves = buildWaves(plan);
  const rows = plan.tasks.map((task) => [
    task.id,
    task.agent,
    task.mode,
    task.dependsOn.length ? task.dependsOn.join(",") : "—",
  ]);
  const headers = ["Task", "Agent", "Mode", "Depends on"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );
  const render = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ");
  const attachmentSummary = plan.attachments?.length
    ? [`${ui.muted("Images")} ${plan.attachments.join(", ")}`, ""]
    : [];
  const agents = new Set(plan.tasks.map((task) => task.agent));
  const sessionSummary = agents.size === 1 && plan.tasks.length > 1
    ? [`${ui.muted("Mode  ")} ${ui.bold(`parallel ${[...agents][0]} sessions`)} ${ui.muted("· isolated worktrees")}`, ""]
    : [];
  return [
    `${ui.muted("Goal ")} ${ui.bold(plan.goal)}`,
    "",
    ...attachmentSummary,
    ...sessionSummary,
    render(headers),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map(render),
    "",
    `${ui.muted("Flow ")} ${waves
      .map((wave, index) => `${index + 1} ${wave.map((task) => task.id).join(" + ")}`)
      .join(ui.muted("  →  "))}`,
  ].join("\n");
}

function formatDoctor(checks, ui = createTerminalUi()) {
  const width = Math.max(...checks.map((check) => check.name.length));
  return checks
    .map((check) => {
      const marker = check.ok ? ui.success("●") : ui.error("●");
      return `${marker} ${check.name.padEnd(width)}  ${ui.muted(check.detail)}`;
    })
    .join("\n");
}

function formatManifest(manifest, ui = createTerminalUi()) {
  const status = manifest.status === "succeeded" ? ui.success(manifest.status) : ui.error(manifest.status);
  const lines = [`${ui.muted("Run   ")} ${manifest.id}`, `${ui.muted("Status")} ${status}`];
  for (const task of Object.values(manifest.tasks)) {
    const marker = task.status === "succeeded" ? ui.success("●") : ui.error("●");
    lines.push(`${marker} ${task.id}  ${ui.accent(task.agent)}  ${task.status}`);
    if (task.sessionId) lines.push(`  ${ui.muted("session")} ${task.sessionId}`);
    if (task.branch) lines.push(`  ${ui.muted("branch")} ${task.branch}`);
    if (task.error) lines.push(`  ${ui.error("error")} ${task.error}`);
  }
  return lines.join("\n");
}

function formatEvent(event, ui = createTerminalUi()) {
  if (event.type === "run_started") return `${ui.info("●")} Run ${event.runId} started`;
  if (event.type === "task_preparing") return `${ui.muted("○")} ${event.task.id}  ${event.task.agent}  preparing`;
  if (event.type === "task_started") {
    const session = event.task.sessionId ? `  session ${event.task.sessionId.slice(0, 8)}` : "";
    return `${ui.info("●")} ${event.task.id}  ${event.task.agent}  running${ui.muted(session)}`;
  }
  if (event.type === "task_skipped") return `${ui.warning("○")} ${event.task.id}  skipped  ${event.task.error}`;
  if (event.type === "task_finished") {
    const marker = event.task.status === "succeeded" ? ui.success("●") : ui.error("●");
    return `${marker} ${event.task.id}  ${event.task.agent}  ${event.task.status}`;
  }
  if (event.type === "run_finished") {
    const status = event.manifest.status === "succeeded" ? ui.success(event.manifest.status) : ui.error(event.manifest.status);
    return `${ui.info("●")} Run finished: ${status}`;
  }
  return undefined;
}

function consoleHelp(ui = createTerminalUi()) {
  return `${ui.bold("Commands")}
  /new [goal]     Ask the strategist to create a new plan
  /mode [auto|manual]
                  Show or change execution mode for this session
  /strategist [agent]
                  Show or select the planning CLI for this session
  /attach [path]  Attach an image path, or capture the macOS clipboard
  /attachments    List image context for the next goal/current session
  /detach <id|all>
                  Remove an image from the current context
  /plan           Show the current plan
  /load <file>    Load and validate a JSON plan
  /save [file]    Save the current plan for editing or version control
  /preview        Show dependency waves without running agents
  /run            Execute the current plan
  /status [id]    Show a run manifest
  /sessions       List recent durable sessions
  /resume [id]    Re-plan and continue the latest or selected session
  /web [port]     Start the local Web UI for this repository
  /agents         Recheck Git, Node.js, and agent CLIs
  /context        Show shared context files
  /init           Initialize Strategos without overwriting existing files
  /clear          Clear the terminal
  /help           Show this help
  /exit           Exit Strategos (Ctrl+C also exits when idle)

${ui.muted("Enter ordinary text to ask the strategist CLI to create a task graph.")}`;
}

function serializableAttachments(attachments) {
  return attachments.map(({ path: _path, ...attachment }) => attachment);
}

function formatAttachments(attachments, ui) {
  if (!attachments.length) return "No image attachments selected.";
  return [
    ui.bold("Image attachments"),
    ...attachments.map((attachment) =>
      `${ui.accent(attachment.id)}  ${attachment.name}  ${ui.muted(`${attachment.mimeType} · ${formatBytes(attachment.size)}`)}`,
    ),
  ].join("\n");
}

function safeRepoPath(root, input) {
  const target = path.resolve(root, input);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("path must stay inside the repository");
  }
  return target;
}

function defaultPlanPath(root) {
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  return path.join(root, ".strategos", "plans", `plan-${timestamp}.json`);
}

async function existingContextPaths(root, plan) {
  const candidates = [...DEFAULT_CONTEXT_PATHS, ...(plan?.context || [])];
  const existing = [];
  for (const relative of [...new Set(candidates)]) {
    try {
      await fs.access(path.join(root, relative));
      existing.push(relative);
    } catch {
      // Missing optional context is omitted from the console summary.
    }
  }
  return existing;
}

export function selectWorkerAgents(healthyAgents, strategist, mode = "hybrid") {
  if (mode === "hybrid") return [...healthyAgents];
  if (mode === "separated") {
    const workers = healthyAgents.filter((agent) => agent !== strategist);
    if (!workers.length) {
      throw new Error("separated worker mode requires a healthy CLI besides the strategist");
    }
    return workers;
  }
  throw new Error(`invalid workerMode: ${mode}; expected hybrid or separated`);
}

export function normalizeExecutionMode(mode = "auto") {
  if (mode === "auto" || mode === "manual") return mode;
  throw new Error(`invalid executionMode: ${mode}; expected auto or manual`);
}

export async function startConsole(options) {
  const root = options.root;
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const version = options.version || "development";
  const loadConfigFn = options.loadConfigFn || loadConfig;
  const runDoctorFn = options.runDoctorFn || runDoctor;
  const runPlanFn = options.runPlanFn || runPlan;
  const planWithStrategistFn = options.planWithStrategistFn || planWithStrategist;
  const loadRunFn = options.loadRunFn || loadRun;
  const initializeProjectFn = options.initializeProjectFn || initializeProject;
  const attachImageFn = options.attachImageFn || attachImage;
  const captureClipboardImageFn = options.captureClipboardImageFn || captureClipboardImage;
  const resolveAttachmentsFn = options.resolveAttachmentsFn || resolveAttachments;
  const startWebServerFn = options.startWebServerFn;
  const sessionStore = options.sessionStore || createSessionStore(root);
  const selectResumeSessionFn = options.selectResumeSessionFn || selectResumeSession;
  const interactive = Boolean(input.isTTY && output.isTTY);
  const ui = createTerminalUi({
    interactive,
    columns: output.columns,
    env: options.env || process.env,
  });
  let config = await loadConfigFn(root);
  let checks = await runDoctorFn(config, root);
  let currentPlan;
  let currentSession;
  let currentAttachments = [];
  let planningController;
  let planningInterruptArmed = false;
  let planningInterruptTimer;
  let executionActive = false;
  let webServer;
  let webUrl;
  let shouldExit = false;
  let currentExecutionMode = normalizeExecutionMode(config.executionMode);
  const configuredAgents = () => Object.keys(config.agents || {});
  const availableAgents = () => eligibleAgents(
    checks
      .filter((check) => check.ok && configuredAgents().includes(check.name))
      .map((check) => check.name),
    config,
  );
  let currentStrategist = config.strategist || "codex";
  if (!availableAgents().includes(currentStrategist) && availableAgents().length) {
    currentStrategist = availableAgents()[0];
  }

  const renderHeader = () => {
    if (interactive) {
      writeLine(output, renderWelcome(ui, {
        version,
        root,
        strategist: currentStrategist,
        executionMode: currentExecutionMode,
        checks,
      }));
      return;
    }
    writeLine(output, `Strategos ${version}`);
    writeLine(output, `Project: ${path.basename(root)}`);
    writeLine(output, `Path: ${root}`);
    writeLine(output, `Strategist: ${currentStrategist}`);
    writeLine(output, `Execution mode: ${currentExecutionMode}`);
    writeLine(output);
    writeLine(output, formatDoctor(checks));
    writeLine(output);
    writeLine(output, "What do you want to accomplish?");
    writeLine(output, "Enter a goal to ask the strategist, or use /help for commands.");
  };
  renderHeader();
  const resumableSession = await sessionStore.latestResumable();
  if (resumableSession) {
    writeLine(output);
    writeLine(
      output,
      `${ui.warning("Recovery")}  Session ${resumableSession.id} (${resumableSession.status}) can be continued with ${ui.accent("/resume")}.`,
    );
  }

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
    historySize: 100,
  });
  const promptUser = () => {
    if (!interactive || rl.closed) return;
    writeLine(output);
    writeLine(output, renderInputChrome(ui, currentExecutionMode, currentAttachments.length));
    rl.setPrompt(ui.prompt);
    rl.prompt();
  };
  const resetPlanningInterrupt = () => {
    planningInterruptArmed = false;
    if (planningInterruptTimer) clearTimeout(planningInterruptTimer);
    planningInterruptTimer = undefined;
  };
  if (interactive) {
    rl.on("SIGINT", () => {
      if (planningController) {
        if (!planningInterruptArmed) {
          planningInterruptArmed = true;
          writeLine(
            output,
            `\n${ui.warning("Press Ctrl+C again within 3 seconds to interrupt planning.")}`,
          );
          planningInterruptTimer = setTimeout(resetPlanningInterrupt, 3_000);
          planningInterruptTimer.unref?.();
          return;
        }
        resetPlanningInterrupt();
        writeLine(output, `\n${ui.warning("Cancelling strategist...")}`);
        planningController.abort();
        return;
      }
      if (executionActive) {
        writeLine(
          output,
          `\n${ui.warning("Worker execution is still running; cancellation is not supported yet.")}`,
        );
        return;
      }
      shouldExit = true;
      writeLine(output, `\n${ui.muted("Goodbye.")}`);
      rl.close();
    });
    promptUser();
  }

  const syncAttachmentState = async () => {
    if (currentPlan) {
      currentPlan = validatePlan({
        ...currentPlan,
        attachments: currentAttachments.map((attachment) => attachment.relativePath),
      }, configuredAgents());
    }
    if (currentSession) {
      currentSession = await sessionStore.update(currentSession, {
        attachments: serializableAttachments(currentAttachments),
        ...(currentPlan ? { plan: currentPlan } : {}),
      });
    }
  };

  const previewCurrentPlan = async () => {
    if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
    const result = await runPlanFn({ root, config, planInput: currentPlan, dryRun: true });
    if (currentSession) {
      currentSession = await sessionStore.update(currentSession, {
        status: "previewed",
        plan: currentPlan,
        attachments: serializableAttachments(currentAttachments),
      });
    }
    writeLine(output, `${ui.info("Preview")}  Max parallel: ${result.maxParallel}`);
    result.waves.forEach((wave, index) =>
      writeLine(output, `Wave ${index + 1}: ${wave.join(", ")}`),
    );
    return result;
  };

  const executeCurrentPlan = async () => {
    if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
    if (!currentSession) {
      currentSession = await sessionStore.create({
        goal: currentPlan.goal,
        strategist: currentStrategist,
        workerAgents: availableAgents(),
        executionMode: currentExecutionMode,
        attachments: serializableAttachments(currentAttachments),
      });
    }
    currentSession = await sessionStore.update(currentSession, {
      status: "running",
      plan: currentPlan,
      attachments: serializableAttachments(currentAttachments),
      error: null,
      finishedAt: null,
    });
    writeLine(output, `${ui.info("Executing")}  Starting the current plan...`);
    executionActive = true;
    let eventCheckpoint = Promise.resolve();
    let checkpointError;
    try {
      const result = await runPlanFn({
        root,
        config,
        planInput: currentPlan,
        onEvent: (event) => {
          const message = formatEvent(event, ui);
          if (message) writeLine(output, message);
          eventCheckpoint = eventCheckpoint
            .then(async () => {
              currentSession = await sessionStore.appendEvent(currentSession, event);
            })
            .catch((error) => {
              checkpointError ||= error;
            });
          return eventCheckpoint;
        },
      });
      await eventCheckpoint;
      if (checkpointError) throw checkpointError;
      currentSession = await sessionStore.update(currentSession, {
        status: result.manifest.status === "succeeded" ? "succeeded" : "failed",
        runId: result.runId,
        manifest: result.manifest,
        error: result.manifest.status === "succeeded" ? null : "one or more worker tasks failed",
        finishedAt: new Date().toISOString(),
      });
      writeLine(output, formatManifest(result.manifest, ui));
      return result;
    } catch (error) {
      await eventCheckpoint;
      currentSession = await sessionStore.update(currentSession, {
        status: "failed",
        error: String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      executionActive = false;
    }
  };

  const propose = async (goal, resumeSession) => {
    const healthyAgents = availableAgents();
    if (!healthyAgents.includes(currentStrategist)) {
      throw new Error(`strategist ${currentStrategist} is unavailable; use /strategist <agent>`);
    }
    const workerAgents = selectWorkerAgents(
      healthyAgents,
      currentStrategist,
      config.workerMode,
    );
    currentPlan = undefined;
    if (resumeSession) {
      currentAttachments = await resolveAttachmentsFn(
        root,
        resumeSession.attachments || resumeSession.plan?.attachments || [],
      );
      currentSession = await sessionStore.update(resumeSession, {
        strategist: currentStrategist,
        workerAgents,
        executionMode: currentExecutionMode,
        attachments: serializableAttachments(currentAttachments),
        status: "planning",
        attempts: (resumeSession.attempts || 1) + 1,
        error: null,
        finishedAt: null,
      });
    } else {
      const superseded = await sessionStore.latestResumable();
      if (superseded) {
        await sessionStore.update(superseded, {
          status: "abandoned",
          finishedAt: new Date().toISOString(),
        });
      }
      currentSession = await sessionStore.create({
        goal,
        strategist: currentStrategist,
        workerAgents,
        executionMode: currentExecutionMode,
        attachments: serializableAttachments(currentAttachments),
      });
    }
    writeLine(output, `${ui.info("Planning")}  ${currentStrategist} is reading the repository in read-only mode...`);
    planningController = new AbortController();
    try {
      currentPlan = await planWithStrategistFn({
        root,
        config,
        goal,
        strategist: currentStrategist,
        workerAgents,
        signal: planningController.signal,
        resumeContext: resumeSession ? buildResumeContext(resumeSession) : undefined,
        attachments: currentAttachments,
      });
    } catch (error) {
      currentSession = await sessionStore.update(currentSession, {
        status: /cancelled/i.test(error.message) ? "interrupted" : "failed",
        error: String(error.message || error).slice(0, 4_000),
        finishedAt: new Date().toISOString(),
      });
      throw error;
    } finally {
      resetPlanningInterrupt();
      planningController = undefined;
    }
    currentPlan = validatePlan({
      ...currentPlan,
      attachments: currentAttachments.map((attachment) => attachment.relativePath),
    }, configuredAgents());
    currentSession = await sessionStore.update(currentSession, {
      status: "planned",
      plan: currentPlan,
      attachments: serializableAttachments(currentAttachments),
      error: null,
    });
    writeLine(output);
    writeLine(output, `${ui.success("Plan ready")}  ${ui.muted(`proposed by ${currentStrategist}`)}`);
    writeLine(output, formatPlan(currentPlan, ui));
    writeLine(output);
    if (currentExecutionMode === "auto") {
      writeLine(output, `${ui.info("Auto mode")}  Previewing before execution...`);
      await previewCurrentPlan();
      await executeCurrentPlan();
      return;
    }
    writeLine(output, `${ui.muted("Next ")} ${ui.accent("/preview")}  ${ui.accent("/run")}  ${ui.accent("/save")}`);
  };

  const handleCommand = async (line) => {
    const [name, ...parts] = line.slice(1).trim().split(/\s+/);
    const argument = parts.join(" ").trim();

    if (name === "exit" || name === "quit") {
      shouldExit = true;
      rl.close();
      return;
    }
    if (name === "help" || !name) {
      writeLine(output, consoleHelp(ui));
      return;
    }
    if (name === "clear") {
      if (interactive) {
        output.write("\u001Bc");
        renderHeader();
      }
      return;
    }
    if (name === "new") {
      if (argument) await propose(argument);
      else {
        writeLine(output, "Describe the new goal on the next line.");
      }
      return;
    }
    if (name === "mode") {
      if (!argument) {
        writeLine(output, `${ui.muted("Execution mode")} ${ui.accent(currentExecutionMode)}`);
        return;
      }
      currentExecutionMode = normalizeExecutionMode(argument.toLowerCase());
      writeLine(output, `${ui.success("Execution mode changed")}  ${currentExecutionMode}`);
      writeLine(
        output,
        ui.muted(
          currentExecutionMode === "auto"
            ? "New goals will preview and run automatically."
            : "New goals will stop after planning until you use /run.",
        ),
      );
      return;
    }
    if (name === "attach" || name === "paste-image") {
      const added = argument
        ? await attachImageFn(root, argument)
        : await captureClipboardImageFn(root);
      const [resolved] = await resolveAttachmentsFn(root, [added]);
      currentAttachments = [
        ...currentAttachments.filter((attachment) => attachment.id !== resolved.id),
        resolved,
      ];
      await syncAttachmentState();
      writeLine(
        output,
        `${ui.success("Attached")}  ${resolved.name} ${ui.muted(`(${resolved.id}, ${formatBytes(resolved.size)})`)}`,
      );
      writeLine(output, ui.muted("The image will be sent to the strategist and every worker session."));
      return;
    }
    if (name === "attachments") {
      writeLine(output, formatAttachments(currentAttachments, ui));
      return;
    }
    if (name === "detach") {
      if (!argument) throw new Error("/detach requires an attachment id or all");
      const before = currentAttachments.length;
      currentAttachments = argument === "all"
        ? []
        : currentAttachments.filter((attachment) => attachment.id !== argument);
      if (argument !== "all" && currentAttachments.length === before) {
        throw new Error(`attachment not found: ${argument}`);
      }
      await syncAttachmentState();
      writeLine(output, `${ui.success("Detached")}  ${argument === "all" ? `${before} image${before === 1 ? "" : "s"}` : argument}`);
      return;
    }
    if (name === "strategist") {
      if (!argument) {
        writeLine(output, `${ui.muted("Strategist")} ${ui.accent(currentStrategist)}`);
        return;
      }
      if (!configuredAgents().includes(argument)) {
        throw new Error(`agent is not configured: ${argument}`);
      }
      if (!availableAgents().includes(argument)) {
        throw new Error(`agent CLI is unavailable: ${argument}`);
      }
      currentStrategist = argument;
      currentPlan = undefined;
      currentSession = undefined;
      writeLine(output, `${ui.success("Strategist changed")}  ${currentStrategist}`);
      writeLine(output, ui.muted("Enter a goal to generate a new plan."));
      return;
    }
    if (name === "plan") {
      if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
      writeLine(output, formatPlan(currentPlan, ui));
      return;
    }
    if (name === "load") {
      if (!argument) throw new Error("/load requires a plan file");
      const file = safeRepoPath(root, argument);
      const inputPlan = JSON.parse(await fs.readFile(file, "utf8"));
      currentPlan = validatePlan(inputPlan, configuredAgents());
      currentAttachments = await resolveAttachmentsFn(root, currentPlan.attachments);
      currentSession = undefined;
      writeLine(output, `${ui.success("Loaded")}  ${path.relative(root, file)}`);
      writeLine(output, formatPlan(currentPlan, ui));
      return;
    }
    if (name === "save") {
      if (!currentPlan) throw new Error("no current plan to save");
      const file = argument ? safeRepoPath(root, argument) : defaultPlanPath(root);
      await ensureDir(path.dirname(file));
      await writeJson(file, currentPlan);
      writeLine(output, `${ui.success("Saved")}  ${path.relative(root, file)}`);
      writeLine(output, ui.warning("Commit the plan before /run if the repository is now dirty."));
      return;
    }
    if (name === "preview") {
      await previewCurrentPlan();
      return;
    }
    if (name === "run") {
      await executeCurrentPlan();
      return;
    }
    if (name === "status") {
      const manifest = await loadRunFn(root, argument || undefined);
      writeLine(output, formatManifest(manifest, ui));
      return;
    }
    if (name === "sessions") {
      const sessions = await sessionStore.list({ limit: 10 });
      if (!sessions.length) {
        writeLine(output, "No durable sessions found.");
        return;
      }
      writeLine(output, ui.bold("Recent sessions"));
      sessions.forEach((session) => {
        const item = formatResumeSession(ui, session);
        writeLine(output, `${session.id}  ${item.title}`);
        writeLine(output, `  ${ui.muted(item.description)}`);
      });
      return;
    }
    if (name === "resume") {
      let session;
      if (argument) {
        session = await sessionStore.load(argument);
      } else if (interactive) {
        const sessions = await sessionStore.list({ resumableOnly: true, limit: 10 });
        if (!sessions.length) throw new Error("no resumable session found");
        session = await selectResumeSessionFn({ sessions, input, output, ui });
        if (!session) return;
      } else {
        session = await sessionStore.latestResumable();
      }
      if (!session) throw new Error(argument ? `session not found: ${argument}` : "no resumable session found");
      if (session.status === "succeeded") throw new Error(`session is already complete: ${session.id}`);
      if (availableAgents().includes(session.strategist)) {
        currentStrategist = session.strategist;
      } else if (session.strategist) {
        writeLine(
          output,
          ui.warning(`Saved strategist ${session.strategist} is unavailable; using ${currentStrategist}.`),
        );
      }
      writeLine(output, `${ui.info("Resuming")}  ${session.id} from ${session.status}`);
      await propose(session.goal, session);
      return;
    }
    if (name === "web") {
      if (webServer) {
        writeLine(output, `${ui.info("Web UI")}  Already running at ${ui.accent(webUrl)}`);
        return;
      }
      if (!startWebServerFn) throw new Error("Web UI startup is unavailable in this console");
      const port = argument ? parsePositiveInteger(argument, "/web port") : 4310;
      const result = await startWebServerFn({
        root,
        host: "127.0.0.1",
        port,
        version,
      });
      webServer = result.server;
      webUrl = result.url;
      writeLine(output, `${ui.success("Web UI running")}  ${ui.accent(webUrl)}`);
      writeLine(output, ui.muted("Keep this Strategos console open while using the browser."));
      return;
    }
    if (name === "agents" || name === "doctor") {
      config = await loadConfigFn(root);
      checks = await runDoctorFn(config, root);
      writeLine(output, `${ui.bold("Agents & runtime")}\n${formatDoctor(checks, ui)}`);
      return;
    }
    if (name === "context") {
      const contextPaths = await existingContextPaths(root, currentPlan);
      writeLine(output, contextPaths.length ? contextPaths.map((item) => `- ${item}`).join("\n") : "No shared context files found.");
      return;
    }
    if (name === "init") {
      const created = await initializeProjectFn(root);
      writeLine(output, created.length ? `Created: ${created.join(", ")}` : "Strategos is already initialized.");
      config = await loadConfigFn(root);
      checks = await runDoctorFn(config, root);
      return;
    }
    throw new Error(`unknown console command: /${name}`);
  };

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      try {
        if (line.startsWith("/")) await handleCommand(line);
        else if (line) await propose(line);
      } catch (error) {
        writeLine(output, `${ui.error("Error")}  ${error.message}`);
      }
      if (shouldExit) break;
      promptUser();
    }
  } finally {
    if (webServer) {
      webServer.closeAllConnections?.();
      await new Promise((resolve, reject) => {
        webServer.close((error) => error ? reject(error) : resolve());
      });
    }
  }
}
