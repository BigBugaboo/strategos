import os from "node:os";
import readline from "node:readline";

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

export function renderWelcome(ui, { version, root, strategist, executionMode = "auto", checks }) {
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
    ui.muted(
      executionMode === "auto"
        ? "Describe a goal. Strategos previews the plan, then runs it automatically."
        : "Describe a goal. Review the plan, then use /run to start workers.",
    ),
  ].join("\n");
}

export function renderInputChrome(ui, executionMode = "auto") {
  const behavior =
    executionMode === "auto"
      ? `${ui.muted("preview")} ${ui.muted("→")} ${ui.muted("run")}`
      : `${ui.accent("/run")} ${ui.muted("after review")}`;
  return [
    ui.rule(),
    `${ui.accent("/help")} ${ui.muted("commands")}  ${ui.muted("·")}  ${ui.accent(`/mode ${executionMode}`)}  ${ui.muted("·")}  ${behavior}`,
  ].join("\n");
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateLine(value, maxLength) {
  const text = oneLine(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function relativeSessionTime(value, now = new Date()) {
  const timestamp = new Date(value).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(timestamp) || !Number.isFinite(current)) return "time unknown";
  const seconds = Math.max(0, Math.round((current - timestamp) / 1_000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function completedTaskCount(session) {
  const manifestTasks = Object.values(session.manifest?.tasks || {});
  if (manifestTasks.length) {
    return manifestTasks.filter((task) => task.status === "succeeded").length;
  }
  return new Set(
    (session.events || [])
      .filter((event) => event.type === "task_finished" && event.task?.status === "succeeded")
      .map((event) => event.task.id),
  ).size;
}

export function formatResumeSession(ui, session, options = {}) {
  const width = Math.max(40, Number(options.width) || ui.width || 80);
  const title = truncateLine(session.title || session.goal || session.id, width - 4);
  const details = [
    oneLine(session.status || "unknown"),
    relativeSessionTime(session.updatedAt || session.createdAt, options.now),
  ];
  if (session.strategist) details.push(oneLine(session.strategist));
  const totalTasks = session.plan?.tasks?.length || 0;
  if (totalTasks) details.push(`${completedTaskCount(session)}/${totalTasks} tasks complete`);
  if (session.error) details.push(truncateLine(session.error, Math.max(16, width / 3)));
  return {
    title,
    description: truncateLine(details.join(" · "), width - 4),
  };
}

export async function selectResumeSession({ sessions, input, output, ui, now }) {
  if (!sessions.length) return undefined;
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
    return sessions[0];
  }

  const previousRawMode = Boolean(input.isRaw);
  const readlineListeners = input.listeners("keypress");
  input.removeAllListeners("keypress");
  readline.emitKeypressEvents(input);
  input.setRawMode(true);
  input.resume();

  let selectedIndex = 0;
  let renderedLines = 0;
  const clear = () => {
    if (!renderedLines) return;
    output.write(`\r\u001b[${renderedLines}A\u001b[J`);
    renderedLines = 0;
  };
  const render = () => {
    clear();
    const lines = [
      ui.bold("Resume a session"),
      ui.muted("Use ↑/↓ to select · Enter to resume · Esc to cancel"),
      "",
    ];
    sessions.forEach((session, index) => {
      const selected = index === selectedIndex;
      const item = formatResumeSession(ui, session, { now });
      lines.push(`${selected ? ui.accent("❯") : " "} ${selected ? ui.bold(item.title) : item.title}`);
      lines.push(`  ${ui.muted(item.description)}`);
    });
    renderedLines = lines.length;
    output.write(`${lines.join("\n")}\n`);
  };

  return new Promise((resolve) => {
    const restore = () => {
      input.removeListener("keypress", onKeypress);
      readline.emitKeypressEvents(input);
      readlineListeners.forEach((listener) => input.on("keypress", listener));
      input.setRawMode(previousRawMode);
    };
    const finish = (session) => {
      clear();
      restore();
      if (session) {
        const item = formatResumeSession(ui, session, { now });
        output.write(`${ui.success("Selected")}  ${item.title}\n${ui.muted(`          ${item.description}`)}\n`);
      } else {
        output.write(`${ui.muted("Resume cancelled.")}\n`);
      }
      resolve(session);
    };
    const onKeypress = (_text, key = {}) => {
      if (key.name === "up" || key.name === "k") {
        selectedIndex = (selectedIndex - 1 + sessions.length) % sessions.length;
        render();
        return;
      }
      if (key.name === "down" || key.name === "j") {
        selectedIndex = (selectedIndex + 1) % sessions.length;
        render();
        return;
      }
      if (key.name === "return" || key.name === "enter") {
        finish(sessions[selectedIndex]);
        return;
      }
      if (key.name === "escape" || (key.ctrl && key.name === "c")) finish(undefined);
    };

    input.on("keypress", onKeypress);
    render();
  });
}
