import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { initializeProject, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { planWithStrategist } from "./planner.js";
import { buildWaves, validatePlan } from "./plan.js";
import { createTerminalUi, renderInputChrome, renderWelcome } from "./terminal.js";
import { ensureDir, writeJson } from "./utils.js";

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
  return [
    `${ui.muted("Goal ")} ${ui.bold(plan.goal)}`,
    "",
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
    if (task.branch) lines.push(`  ${ui.muted("branch")} ${task.branch}`);
    if (task.error) lines.push(`  ${ui.error("error")} ${task.error}`);
  }
  return lines.join("\n");
}

function formatEvent(event, ui = createTerminalUi()) {
  if (event.type === "run_started") return `${ui.info("●")} Run ${event.runId} started`;
  if (event.type === "task_preparing") return `${ui.muted("○")} ${event.task.id}  ${event.task.agent}  preparing`;
  if (event.type === "task_started") return `${ui.info("●")} ${event.task.id}  ${event.task.agent}  running`;
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
  /strategist [agent]
                  Show or select the planning CLI for this session
  /plan           Show the current plan
  /load <file>    Load and validate a JSON plan
  /save [file]    Save the current plan for editing or version control
  /preview        Show dependency waves without running agents
  /run            Execute the current plan
  /status [id]    Show a run manifest
  /agents         Recheck Git, Node.js, and agent CLIs
  /context        Show shared context files
  /init           Initialize Strategos without overwriting existing files
  /clear          Clear the terminal
  /help           Show this help
  /exit           Exit Strategos

${ui.muted("Enter ordinary text to ask the strategist CLI to create a task graph.")}`;
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
  const interactive = Boolean(input.isTTY && output.isTTY);
  const ui = createTerminalUi({
    interactive,
    columns: output.columns,
    env: options.env || process.env,
  });
  let config = await loadConfigFn(root);
  let checks = await runDoctorFn(config, root);
  let currentPlan;
  let planningController;
  let shouldExit = false;
  const configuredAgents = () => Object.keys(config.agents || {});
  const availableAgents = () =>
    checks
      .filter((check) => check.ok && configuredAgents().includes(check.name))
      .map((check) => check.name);
  let currentStrategist = config.strategist || "codex";
  if (!availableAgents().includes(currentStrategist) && availableAgents().length) {
    currentStrategist = availableAgents()[0];
  }

  const renderHeader = () => {
    if (interactive) {
      writeLine(output, renderWelcome(ui, { version, root, strategist: currentStrategist, checks }));
      return;
    }
    writeLine(output, `Strategos ${version}`);
    writeLine(output, `Project: ${path.basename(root)}`);
    writeLine(output, `Path: ${root}`);
    writeLine(output, `Strategist: ${currentStrategist}`);
    writeLine(output);
    writeLine(output, formatDoctor(checks));
    writeLine(output);
    writeLine(output, "What do you want to accomplish?");
    writeLine(output, "Enter a goal to ask the strategist, or use /help for commands.");
  };
  renderHeader();

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
    historySize: 100,
  });
  const promptUser = () => {
    if (!interactive || rl.closed) return;
    writeLine(output);
    writeLine(output, renderInputChrome(ui, currentStrategist));
    rl.setPrompt(ui.prompt);
    rl.prompt();
  };
  if (interactive) {
    rl.on("SIGINT", () => {
      if (planningController) {
        writeLine(output, `\n${ui.warning("Cancelling strategist...")}`);
        planningController.abort();
        return;
      }
      writeLine(output, `\n${ui.muted("Use /exit to leave Strategos.")}`);
      promptUser();
    });
    promptUser();
  }

  const propose = async (goal) => {
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
      });
    } finally {
      planningController = undefined;
    }
    writeLine(output);
    writeLine(output, `${ui.success("Plan ready")}  ${ui.muted(`proposed by ${currentStrategist}`)}`);
    writeLine(output, formatPlan(currentPlan, ui));
    writeLine(output);
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
      if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
      const result = await runPlanFn({ root, config, planInput: currentPlan, dryRun: true });
      writeLine(output, `Max parallel: ${result.maxParallel}`);
      result.waves.forEach((wave, index) => writeLine(output, `Wave ${index + 1}: ${wave.join(", ")}`));
      return;
    }
    if (name === "run") {
      if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
      writeLine(output, `${ui.info("Executing")}  Starting the approved plan...`);
      const result = await runPlanFn({
        root,
        config,
        planInput: currentPlan,
        onEvent: (event) => {
          const message = formatEvent(event, ui);
          if (message) writeLine(output, message);
        },
      });
      writeLine(output, formatManifest(result.manifest, ui));
      return;
    }
    if (name === "status") {
      const manifest = await loadRunFn(root, argument || undefined);
      writeLine(output, formatManifest(manifest, ui));
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
}
