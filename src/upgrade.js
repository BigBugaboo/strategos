import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./process.js";

export const GITHUB_PACKAGE_SPEC = "github:BigBugaboo/strategos";
export const PACKAGE_NAME = "strategos-cli";
export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function isWithin(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveGlobalRoot(run) {
  const result = await run("npm", ["root", "--global"], {
    timeoutMs: 15_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.code !== 0) return undefined;
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
}

export async function detectInstallation(options = {}) {
  const run = options.run || runCommand;
  const packageRoot = await fs.realpath(options.packageRoot || PACKAGE_ROOT).catch(() =>
    path.resolve(options.packageRoot || PACKAGE_ROOT),
  );

  if (packageRoot.split(path.sep).includes("_npx")) {
    return { mode: "npx", packageRoot };
  }

  if (await exists(path.join(packageRoot, ".git"))) {
    return { mode: "source", packageRoot };
  }

  const candidateGlobalRoot = options.globalRoot || (await resolveGlobalRoot(run));
  if (candidateGlobalRoot) {
    const globalRoot = await fs.realpath(candidateGlobalRoot).catch(() => path.resolve(candidateGlobalRoot));
    if (isWithin(packageRoot, globalRoot)) {
      return { mode: "global-npm", packageRoot, globalRoot };
    }
  }

  return { mode: "local-package", packageRoot };
}

export function buildUpgradePlan(installation) {
  if (installation.mode === "global-npm") {
    return {
      installation,
      automatic: true,
      commands: [{ command: "npm", args: ["install", "--global", GITHUB_PACKAGE_SPEC] }],
    };
  }

  if (installation.mode === "source") {
    return {
      installation,
      automatic: false,
      commands: [
        { command: "git", args: ["-C", installation.packageRoot, "pull", "--ff-only"] },
        { command: "npm", args: ["ci"], cwd: installation.packageRoot },
        { command: "npm", args: ["link"], cwd: installation.packageRoot },
      ],
    };
  }

  if (installation.mode === "npx") {
    return {
      installation,
      automatic: false,
      commands: [
        {
          command: "npx",
          args: ["--yes", "--prefer-online", GITHUB_PACKAGE_SPEC, "--version"],
        },
      ],
    };
  }

  return {
    installation,
    automatic: false,
    commands: [{ command: "npm", args: ["install", GITHUB_PACKAGE_SPEC] }],
  };
}

export function buildUninstallPlan(installation) {
  if (installation.mode === "global-npm") {
    return {
      installation,
      automatic: true,
      commands: [{ command: "npm", args: ["uninstall", "--global", PACKAGE_NAME] }],
    };
  }

  if (installation.mode === "source") {
    return {
      installation,
      automatic: false,
      commands: [
        {
          command: "npm",
          args: ["unlink", "--global", PACKAGE_NAME],
          cwd: installation.packageRoot,
        },
      ],
    };
  }

  if (installation.mode === "npx") {
    return { installation, automatic: false, commands: [] };
  }

  return {
    installation,
    automatic: false,
    commands: [{ command: "npm", args: ["uninstall", PACKAGE_NAME] }],
  };
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function displayCommand(invocation) {
  const command = [invocation.command, ...invocation.args].map(shellQuote).join(" ");
  if (!invocation.cwd) return command;
  return `(cd ${shellQuote(invocation.cwd)} && ${command})`;
}

export function formatUpgradeResult(result) {
  const labels = {
    "global-npm": "global npm package",
    source: "source checkout or npm link",
    npx: "temporary npx package",
    "local-package": "project-local package",
  };
  const lines = [`Installation: ${labels[result.plan.installation.mode]}`];

  if (result.updated) {
    lines.push(`Updated Strategos${result.version ? ` to ${result.version}` : ""}.`);
  } else if (result.dryRun) {
    lines.push("Dry run: no changes were made.");
  } else {
    lines.push("Automatic upgrade is not used for this installation mode.");
  }

  if (!result.updated) {
    lines.push("Run:", ...result.plan.commands.map((command) => `  ${displayCommand(command)}`));
  }

  return lines.join("\n");
}

export function formatUninstallResult(result) {
  const labels = {
    "global-npm": "global npm package",
    source: "source checkout or npm link",
    npx: "temporary npx package",
    "local-package": "project-local package",
  };
  const lines = [`Installation: ${labels[result.plan.installation.mode]}`];

  if (result.uninstalled) {
    lines.push("Uninstalled the Strategos CLI.");
  } else if (result.dryRun) {
    lines.push("Dry run: no changes were made.");
  } else if (result.plan.installation.mode === "npx") {
    lines.push("No persistent Strategos installation was found; npx uses a temporary package cache.");
  } else {
    lines.push("Automatic uninstall is not used for this installation mode.");
  }

  if (!result.uninstalled && result.plan.commands.length) {
    lines.push("Run:", ...result.plan.commands.map((command) => `  ${displayCommand(command)}`));
  }
  lines.push("Project configuration, sessions, attachments, and run history were preserved.");
  return lines.join("\n");
}

export async function upgradeStrategos(options = {}) {
  const run = options.run || runCommand;
  const installation = await detectInstallation({ ...options, run });
  const plan = buildUpgradePlan(installation);

  if (options.dryRun || !plan.automatic) {
    return { plan, dryRun: Boolean(options.dryRun), updated: false };
  }

  const invocation = plan.commands[0];
  const update = await run(invocation.command, invocation.args, {
    timeoutMs: 120_000,
    maxOutputBytes: 16 * 1024 * 1024,
  });
  if (update.code !== 0) {
    const detail = (update.stderr || update.stdout).trim();
    throw new Error(`upgrade failed${detail ? `: ${detail}` : ""}`);
  }

  const nodeExecutable = options.nodeExecutable || process.execPath;
  const entrypoint = options.entrypoint || process.argv[1];
  const verification = await run(nodeExecutable, [entrypoint, "--version"], {
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });
  const version = verification.code === 0 ? verification.stdout.trim() : undefined;
  return { plan, dryRun: false, updated: true, version };
}

export async function uninstallStrategos(options = {}) {
  const run = options.run || runCommand;
  const installation = await detectInstallation({ ...options, run });
  const plan = buildUninstallPlan(installation);

  if (options.dryRun || !plan.automatic) {
    return { plan, dryRun: Boolean(options.dryRun), uninstalled: false };
  }

  const invocation = plan.commands[0];
  const removal = await run(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    timeoutMs: 120_000,
    maxOutputBytes: 16 * 1024 * 1024,
  });
  if (removal.code !== 0) {
    const detail = (removal.stderr || removal.stdout).trim();
    throw new Error(`uninstall failed${detail ? `: ${detail}` : ""}`);
  }

  return { plan, dryRun: false, uninstalled: true };
}
