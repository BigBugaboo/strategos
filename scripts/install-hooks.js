import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runGit(root, args) {
  return spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function installGitHooks(options = {}) {
  const requestedRoot = path.resolve(options.root || packageRoot);
  const root = fs.existsSync(requestedRoot) ? fs.realpathSync(requestedRoot) : requestedRoot;
  const force = Boolean(options.force);
  const log = options.log || console.log;
  const warn = options.warn || console.warn;

  if (options.skip || process.env.STRATEGOS_SKIP_HOOKS === "1") {
    log("Skipping Git hooks because STRATEGOS_SKIP_HOOKS=1.");
    return { status: "skipped" };
  }
  if (!fs.existsSync(path.join(root, ".githooks"))) {
    log("Skipping Git hooks outside a Strategos source checkout.");
    return { status: "skipped" };
  }

  const topLevel = runGit(root, ["rev-parse", "--show-toplevel"]);
  if (topLevel.status !== 0 || path.resolve(topLevel.stdout.trim()) !== root) {
    log("Skipping Git hooks outside a Strategos source checkout.");
    return { status: "skipped" };
  }

  const configured = runGit(root, ["config", "--local", "--get", "core.hooksPath"]);
  const current = configured.status === 0 ? configured.stdout.trim() : "";
  if (current && current !== ".githooks" && !force) {
    warn(`Keeping existing core.hooksPath: ${current}`);
    warn("Run `npm run hooks:install -- --force` to replace it with .githooks.");
    return { status: "preserved", hooksPath: current };
  }

  const update = runGit(root, ["config", "--local", "core.hooksPath", ".githooks"]);
  if (update.status !== 0) {
    throw new Error(`cannot configure Git hooks: ${update.stderr.trim() || "git config failed"}`);
  }
  log(current === ".githooks" ? "Strategos Git hooks are active." : "Enabled Strategos Git hooks.");
  return { status: current === ".githooks" ? "active" : "installed", hooksPath: ".githooks" };
}

const executedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (executedDirectly) {
  installGitHooks({ force: process.argv.includes("--force") });
}
