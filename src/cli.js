import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { clearStrategosCache, formatCacheClearResult } from "./cache.js";
import { initializeProject, loadConfig } from "./config.js";
import { startConsole } from "./console.js";
import { runDoctor } from "./doctor.js";
import { findRepoRoot } from "./git.js";
import { loadRun, runPlan } from "./orchestrator.js";
import {
  formatUninstallResult,
  formatUpgradeResult,
  uninstallStrategos,
  upgradeStrategos,
} from "./upgrade.js";
import { parsePositiveInteger } from "./utils.js";
import {
  restartWebDaemon,
  runWebDaemon,
  startWebDaemon,
  stopWebDaemon,
} from "./web-daemon.js";

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const VERSION = JSON.parse(readFileSync(packagePath, "utf8")).version;

function help() {
  return `Strategos ${VERSION} — local-first coding-agent orchestration

Usage:
  strategos
  strategos init [path]
  strategos doctor [--json]
  strategos reload [--json]
  strategos web [--host HOST] [--port PORT]
  strategos web restart [--host HOST] [--port PORT]
  strategos web stop
  strategos update [--dry-run]
  strategos upgrade [--dry-run]
  strategos uninstall [--dry-run]
  strategos cache clear [--dry-run]
  strategos run <plan.json> [--dry-run] [--max-parallel N]
  strategos status [run-id] [--json]

Interactive mode:
  Run strategos without a subcommand. A selected agent CLI plans in read-only
  mode. Auto mode previews and runs the plan; use /mode manual to pause before
  worker execution. Interrupted work is journaled locally; use /resume in the
  console to continue with the saved context. Use /attach <path> to add image
  context before a goal.

Core model:
  Strategos has no model API. One installed CLI produces a JSON task graph for
  the available installed CLIs through the local adapter and authentication boundary.
  Every runnable task gets an isolated Git worktree and a durable report.
  With one healthy CLI, independent tasks run as separate parallel sessions.
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
    if (task.sessionId) console.log(`  session: ${task.sessionId}`);
    if (task.branch) console.log(`  branch: ${task.branch}`);
    if (task.worktree) console.log(`  worktree: ${task.worktree}`);
  }
}

export async function main(args) {
  const command = args[0];
  if (!command) {
    const root = await findRepoRoot(process.cwd());
    await startConsole({
      root,
      version: VERSION,
      restartWebDaemonFn: restartWebDaemon,
      startWebDaemonFn: startWebDaemon,
      stopWebDaemonFn: stopWebDaemon,
    });
    return;
  }
  if (command === "help" || hasFlag(args, "--help") || hasFlag(args, "-h")) {
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

  if (command === "doctor" || command === "reload") {
    let root = process.cwd();
    try {
      root = await findRepoRoot(root);
    } catch {
      // Doctor can still inspect globally installed commands outside a repository.
    }
    const config = await loadConfig(root);
    const checks = await runDoctor(config, root);
    if (hasFlag(args, "--json")) {
      const result = command === "reload" ? { reloaded: true, root, checks } : checks;
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (command === "reload") console.log(`Reloaded configuration and CLI availability for ${root}.`);
      printDoctor(checks);
    }
    if (checks.some((check) => !check.ok)) process.exitCode = 2;
    return;
  }

  if (command === "web") {
    const root = await findRepoRoot(process.cwd());
    const subcommand = args[1];
    if (subcommand === "stop") {
      const result = await stopWebDaemon({ root });
      console.log(result.alreadyStopped ? "Strategos Web is not running." : "Strategos Web stopped.");
      return;
    }
    const hostValue = optionValue(args, "--host");
    const portValue = optionValue(args, "--port");
    if (subcommand === "restart") {
      const result = await restartWebDaemon({
        root,
        host: hostValue,
        port: portValue === undefined ? undefined : Number(portValue),
        version: VERSION,
      });
      console.log(`Strategos Web ${result.restarted ? "restarted" : "was not running and started"} at ${result.url}`);
      console.log(`Log: ${result.log}`);
      return;
    }
    const host = hostValue || "127.0.0.1";
    const port = portValue === undefined ? 4310 : Number(portValue);
    if (subcommand === "__serve") {
      await runWebDaemon({
        root,
        host,
        port,
        version: VERSION,
        instanceId: process.env.STRATEGOS_WEB_INSTANCE_ID,
        token: process.env.STRATEGOS_WEB_TOKEN,
      });
      return;
    }
    if (subcommand && !subcommand.startsWith("--")) throw new Error(`unknown web command: ${subcommand}`);
    const result = await startWebDaemon({ root, host, port, version: VERSION });
    console.log(`Strategos Web ${result.alreadyRunning ? "is already running" : "started in the background"} at ${result.url}`);
    console.log(`Log: ${result.log}`);
    console.log("Stop it with: strategos web stop");
    return;
  }

  if (command === "upgrade" || command === "update") {
    const result = await upgradeStrategos({
      dryRun: hasFlag(args, "--dry-run"),
      entrypoint: process.argv[1],
    });
    console.log(formatUpgradeResult(result));
    return;
  }

  if (command === "uninstall") {
    const result = await uninstallStrategos({
      dryRun: hasFlag(args, "--dry-run"),
      entrypoint: process.argv[1],
    });
    console.log(formatUninstallResult(result));
    return;
  }

  if (command === "cache" || command === "clear-cache") {
    const subcommand = command === "clear-cache" ? "clear" : args[1];
    if (subcommand !== "clear") throw new Error("cache requires the clear subcommand");
    const result = await clearStrategosCache({ dryRun: hasFlag(args, "--dry-run") });
    console.log(formatCacheClearResult(result));
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
