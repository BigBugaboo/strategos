import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { initializeProject, loadConfig } from "./config.js";
import { runDoctor } from "./doctor.js";
import { findRepoRoot } from "./git.js";
import { loadRun, runPlan } from "./orchestrator.js";
import { parsePositiveInteger } from "./utils.js";

const VERSION = "0.1.0";

function help() {
  return `Strategos ${VERSION} — local-first coding-agent orchestration

Usage:
  strategos init [path]
  strategos doctor [--json]
  strategos run <plan.json> [--dry-run] [--max-parallel N]
  strategos status [run-id] [--json]

Core model:
  A JSON task graph assigns work to Claude Code, Codex CLI, or Copilot CLI.
  Every runnable task gets an isolated Git worktree and a durable report.
  Strategos does not merge or push generated branches automatically.
`;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function optionValue(args, flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function printDoctor(checks) {
  const width = Math.max(...checks.map((check) => check.name.length));
  for (const check of checks) {
    const marker = check.ok ? "ok" : "missing";
    console.log(`${check.name.padEnd(width)}  ${marker.padEnd(7)}  ${check.detail}`);
  }
}

function printDryRun(result) {
  console.log(`Goal: ${result.plan.goal}`);
  console.log(`Max parallel: ${result.maxParallel}`);
  result.waves.forEach((wave, index) => console.log(`Wave ${index + 1}: ${wave.join(", ")}`));
}

function printRun(manifest) {
  console.log(`Run: ${manifest.id}`);
  console.log(`Status: ${manifest.status}`);
  for (const task of Object.values(manifest.tasks)) {
    const suffix = task.error ? ` — ${task.error}` : "";
    console.log(`${task.id}: ${task.status} (${task.agent})${suffix}`);
    if (task.branch) console.log(`  branch: ${task.branch}`);
    if (task.worktree) console.log(`  worktree: ${task.worktree}`);
  }
}

export async function main(args) {
  const command = args[0];
  if (!command || command === "help" || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    console.log(help());
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    console.log(VERSION);
    return;
  }

  if (command === "init") {
    const target = path.resolve(args[1] && !args[1].startsWith("-") ? args[1] : process.cwd());
    const root = await findRepoRoot(target);
    const created = await initializeProject(root);
    console.log(created.length ? `Created: ${created.join(", ")}` : "Strategos is already initialized.");
    return;
  }

  if (command === "doctor") {
    let root = process.cwd();
    try {
      root = await findRepoRoot(root);
    } catch {
      // Doctor can still inspect globally installed commands outside a repository.
    }
    const config = await loadConfig(root);
    const checks = await runDoctor(config, root);
    if (hasFlag(args, "--json")) console.log(JSON.stringify(checks, null, 2));
    else printDoctor(checks);
    if (checks.some((check) => !check.ok)) process.exitCode = 2;
    return;
  }

  if (command === "run") {
    const planArg = args[1];
    if (!planArg || planArg.startsWith("--")) throw new Error("run requires a plan.json file");
    const root = await findRepoRoot(process.cwd());
    const config = await loadConfig(root);
    const planInput = JSON.parse(await fs.readFile(path.resolve(planArg), "utf8"));
    const parallelArg = optionValue(args, "--max-parallel");
    const result = await runPlan({
      root,
      config,
      planInput,
      dryRun: hasFlag(args, "--dry-run"),
      maxParallel: parallelArg ? parsePositiveInteger(parallelArg, "--max-parallel") : undefined,
    });
    if (result.dryRun) printDryRun(result);
    else printRun(result.manifest);
    if (!result.dryRun && result.manifest.status !== "succeeded") process.exitCode = 1;
    return;
  }

  if (command === "status") {
    const root = await findRepoRoot(process.cwd());
    const runId = args[1] && !args[1].startsWith("--") ? args[1] : undefined;
    const manifest = await loadRun(root, runId);
    if (hasFlag(args, "--json")) console.log(JSON.stringify(manifest, null, 2));
    else printRun(manifest);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}
