import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { initializeProject, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { buildWaves, validatePlan } from "./plan.js";
import { ensureDir, writeJson } from "./utils.js";

const BUILTIN_AGENT_ORDER = Object.freeze(["claude", "codex", "copilot"]);
const DEFAULT_CONTEXT_PATHS = Object.freeze([
  "AGENTS.md",
  ".strategos/context.md",
  ".strategos/memory.md",
]);

function writeLine(output, text = "") {
  output.write(`${text}\n`);
}

function orderedAgents(agents) {
  const unique = [...new Set(agents)];
  return [
    ...BUILTIN_AGENT_ORDER.filter((agent) => unique.includes(agent)),
    ...unique.filter((agent) => !BUILTIN_AGENT_ORDER.includes(agent)).sort(),
  ];
}

export function createStarterPlan(goal, availableAgents) {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) throw new Error("goal cannot be empty");
  const agents = orderedAgents(availableAgents);
  if (agents.length === 0) throw new Error("no available agent CLI was detected");

  const primary = agents.find((agent) => agent !== "copilot") || agents[0];
  const primaryMode = primary === "copilot" ? "read-only" : "write";
  const tasks = [
    {
      id: "implementation",
      agent: primary,
      mode: primaryMode,
      prompt:
        primaryMode === "write"
          ? `Implement this goal: ${normalizedGoal}. Keep the change focused, follow repository guidance, and run relevant checks.`
          : `Analyze this goal and produce an implementation plan: ${normalizedGoal}. Do not modify files.`,
      dependsOn: [],
    },
  ];

  const unused = agents.filter((agent) => agent !== primary);
  if (unused.length >= 2) {
    const testAgent =
      unused.includes("codex") ? "codex" : unused.find((agent) => agent !== "copilot") || unused[0];
    tasks.push({
      id: "tests",
      agent: testAgent,
      mode: "write",
      prompt: `Independently add focused tests and edge-case coverage for this goal: ${normalizedGoal}. Follow the documented contract and run relevant checks.`,
      dependsOn: [],
    });
    const reviewer = unused.find((agent) => agent !== testAgent);
    tasks.push({
      id: "review",
      agent: reviewer,
      mode: "read-only",
      prompt: `Review the completed implementation and test reports for this goal: ${normalizedGoal}. Identify correctness, integration, security, and compatibility risks. Do not modify files.`,
      dependsOn: ["implementation", "tests"],
    });
  } else if (unused.length === 1) {
    tasks.push({
      id: "review",
      agent: unused[0],
      mode: "read-only",
      prompt: `Review the completed implementation report for this goal: ${normalizedGoal}. Identify correctness, integration, security, and compatibility risks. Do not modify files.`,
      dependsOn: ["implementation"],
    });
  }

  return { version: 1, goal: normalizedGoal, context: [], tasks };
}

export function formatPlan(plan) {
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
    `Goal: ${plan.goal}`,
    "",
    render(headers),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map(render),
    "",
    ...waves.map((wave, index) => `Wave ${index + 1}: ${wave.map((task) => task.id).join(", ")}`),
  ].join("\n");
}

function formatDoctor(checks) {
  const width = Math.max(...checks.map((check) => check.name.length));
  return checks
    .map((check) => {
      const marker = check.ok ? "✓" : "✗";
      return `${marker} ${check.name.padEnd(width)}  ${check.detail}`;
    })
    .join("\n");
}

function formatManifest(manifest) {
  const lines = [`Run: ${manifest.id}`, `Status: ${manifest.status}`];
  for (const task of Object.values(manifest.tasks)) {
    lines.push(`${task.status === "succeeded" ? "✓" : "✗"} ${task.id}  ${task.agent}  ${task.status}`);
    if (task.branch) lines.push(`  branch: ${task.branch}`);
    if (task.error) lines.push(`  error: ${task.error}`);
  }
  return lines.join("\n");
}

function formatEvent(event) {
  if (event.type === "run_started") return `◆ Run ${event.runId} started`;
  if (event.type === "task_preparing") return `○ ${event.task.id}  ${event.task.agent}  preparing`;
  if (event.type === "task_started") return `◆ ${event.task.id}  ${event.task.agent}  running`;
  if (event.type === "task_skipped") return `- ${event.task.id}  skipped  ${event.task.error}`;
  if (event.type === "task_finished") {
    const marker = event.task.status === "succeeded" ? "✓" : "✗";
    return `${marker} ${event.task.id}  ${event.task.agent}  ${event.task.status}`;
  }
  if (event.type === "run_finished") return `◆ Run finished: ${event.manifest.status}`;
  return undefined;
}

function consoleHelp() {
  return `Commands:
  /new [goal]     Propose a new starter strategy
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

Enter ordinary text to propose a strategy for that goal.`;
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

export async function startConsole(options) {
  const root = options.root;
  const input = options.input || process.stdin;
  const output = options.output || process.stdout;
  const version = options.version || "development";
  const loadConfigFn = options.loadConfigFn || loadConfig;
  const runDoctorFn = options.runDoctorFn || runDoctor;
  const runPlanFn = options.runPlanFn || runPlan;
  const loadRunFn = options.loadRunFn || loadRun;
  const initializeProjectFn = options.initializeProjectFn || initializeProject;
  let config = await loadConfigFn(root);
  let checks = await runDoctorFn(config, root);
  let currentPlan;
  let shouldExit = false;

  writeLine(output, `Strategos ${version}`);
  writeLine(output, `Project: ${path.basename(root)}`);
  writeLine(output, `Path: ${root}`);
  writeLine(output);
  writeLine(output, formatDoctor(checks));
  writeLine(output);
  writeLine(output, "What do you want to accomplish?");
  writeLine(output, "Enter a goal, or use /help for commands.");

  const rl = readline.createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
    historySize: 100,
  });
  const interactive = Boolean(input.isTTY && output.isTTY);
  if (interactive) {
    rl.setPrompt("strategos › ");
    rl.prompt();
    rl.on("SIGINT", () => {
      writeLine(output, "\nUse /exit to leave Strategos.");
      rl.prompt();
    });
  }

  const configuredAgents = () => Object.keys(config.agents || {});
  const availableAgents = () =>
    checks
      .filter((check) => check.ok && configuredAgents().includes(check.name))
      .map((check) => check.name);

  const propose = (goal) => {
    currentPlan = validatePlan(createStarterPlan(goal, availableAgents()), configuredAgents());
    writeLine(output);
    writeLine(output, "Proposed starter strategy (review before running):");
    writeLine(output, formatPlan(currentPlan));
    writeLine(output);
    writeLine(output, "Next: /preview, /run, /save, or enter a different goal.");
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
      writeLine(output, consoleHelp());
      return;
    }
    if (name === "clear") {
      if (interactive) output.write("\u001Bc");
      return;
    }
    if (name === "new") {
      if (argument) propose(argument);
      else {
        writeLine(output, "Describe the new goal on the next line.");
      }
      return;
    }
    if (name === "plan") {
      if (!currentPlan) throw new Error("no current plan; enter a goal or use /load");
      writeLine(output, formatPlan(currentPlan));
      return;
    }
    if (name === "load") {
      if (!argument) throw new Error("/load requires a plan file");
      const file = safeRepoPath(root, argument);
      const inputPlan = JSON.parse(await fs.readFile(file, "utf8"));
      currentPlan = validatePlan(inputPlan, configuredAgents());
      writeLine(output, `Loaded: ${path.relative(root, file)}`);
      writeLine(output, formatPlan(currentPlan));
      return;
    }
    if (name === "save") {
      if (!currentPlan) throw new Error("no current plan to save");
      const file = argument ? safeRepoPath(root, argument) : defaultPlanPath(root);
      await ensureDir(path.dirname(file));
      await writeJson(file, currentPlan);
      writeLine(output, `Saved: ${path.relative(root, file)}`);
      writeLine(output, "Commit the plan before /run if the repository is now dirty.");
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
      writeLine(output, "Starting approved plan...");
      const result = await runPlanFn({
        root,
        config,
        planInput: currentPlan,
        onEvent: (event) => {
          const message = formatEvent(event);
          if (message) writeLine(output, message);
        },
      });
      writeLine(output, formatManifest(result.manifest));
      return;
    }
    if (name === "status") {
      const manifest = await loadRunFn(root, argument || undefined);
      writeLine(output, formatManifest(manifest));
      return;
    }
    if (name === "agents" || name === "doctor") {
      config = await loadConfigFn(root);
      checks = await runDoctorFn(config, root);
      writeLine(output, formatDoctor(checks));
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
      if (!line) continue;
      if (line.startsWith("/")) await handleCommand(line);
      else propose(line);
    } catch (error) {
      writeLine(output, `Error: ${error.message}`);
    }
    if (shouldExit) break;
    if (interactive) rl.prompt();
  }
}
