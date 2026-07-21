import os from "node:os";

const ANSI = Object.freeze({
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  purple: "\u001b[38;5;141m",
  violet: "\u001b[38;5;147m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
});

export function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function shortenPath(value) {
  const home = os.homedir();
  if (value === home) return "~";
  return value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value;
}

function runtimeDetail(check, prefix) {
  if (!check) return `${prefix} unavailable`;
  if (check.name === "git") {
    const version = check.detail.match(/^git version\s+(\S+)/i)?.[1];
    return version ? `Git ${version}` : `Git ${check.detail}`;
  }
  if (check.name === "node") return `Node ${check.detail}`;
  return `${prefix} ${check.detail}`;
}

export function createTerminalUi(options = {}) {
  const interactive = Boolean(options.interactive);
  const env = options.env || process.env;
  const color =
    interactive && env.TERM !== "dumb" && !("NO_COLOR" in env) && env.FORCE_COLOR !== "0";
  const width = Math.max(56, Math.min(Number(options.columns) || 80, 120));
  const paint = (codes, value) => (color ? `${codes.join("")}${value}${ANSI.reset}` : value);

  return Object.freeze({
    interactive,
    color,
    width,
    bold: (value) => paint([ANSI.bold], value),
    brand: (value) => paint([ANSI.bold, ANSI.purple], value),
    accent: (value) => paint([ANSI.violet], value),
    info: (value) => paint([ANSI.cyan], value),
    success: (value) => paint([ANSI.green], value),
    warning: (value) => paint([ANSI.yellow], value),
    error: (value) => paint([ANSI.red], value),
    muted: (value) => paint([ANSI.gray], value),
    dim: (value) => paint([ANSI.dim], value),
    rule: () => paint([ANSI.gray], "─".repeat(width)),
    prompt: paint([ANSI.bold, ANSI.violet], "❯ "),
  });
}

export function renderWelcome(ui, { version, root, strategist, checks }) {
  const agents = checks.filter((check) => !["git", "node"].includes(check.name));
  const git = checks.find((check) => check.name === "git");
  const node = checks.find((check) => check.name === "node");
  const agentSummary = agents
    .map((check) => {
      const marker = check.ok ? ui.success("●") : ui.error("●");
      const name = check.ok ? ui.bold(check.name) : ui.error(check.name);
      return `${marker} ${name}`;
    })
    .join(`  ${ui.muted("·")}  `);
  const warnings = checks
    .filter((check) => !check.ok)
    .map((check) => ui.warning(`Warning  ${check.name} unavailable — ${check.detail}`));

  return [
    `${ui.brand("STRATEGOS")} ${ui.muted(`v${version}`)}`,
    `${ui.bold("Multi-agent strategy console")} ${ui.muted(`· ${strategist} plans`)}`,
    ui.muted(shortenPath(root)),
    "",
    `${ui.muted("Agents ")} ${agentSummary || ui.warning("none available")}`,
    `${ui.muted("Runtime")} ${runtimeDetail(node, "Node")} ${ui.muted("·")} ${runtimeDetail(git, "Git")}`,
    ...warnings,
    "",
    ui.bold("What are we building?"),
    ui.muted("Describe a goal. The strategist plans first; /run starts workers."),
  ].join("\n");
}

export function renderInputChrome(ui, strategist) {
  return [
    ui.rule(),
    `${ui.accent("/help")} ${ui.muted("commands")}  ${ui.muted("·")}  ${ui.accent(`/strategist ${strategist}`)} ${ui.muted("planner")}  ${ui.muted("·")}  ${ui.accent("/run")} ${ui.muted("after review")}`,
  ].join("\n");
}
