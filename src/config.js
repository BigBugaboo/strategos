import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, readJson, writeJson } from "./utils.js";

const DEFAULT_NOTIFICATION_SETTINGS = Object.freeze({
  enabled: false,
  onSuccess: true,
  onFailure: true,
});

export function normalizeNotificationSettings(value, fallback = DEFAULT_NOTIFICATION_SETTINGS) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    onSuccess: typeof source.onSuccess === "boolean" ? source.onSuccess : fallback.onSuccess,
    onFailure: typeof source.onFailure === "boolean" ? source.onFailure : fallback.onFailure,
  };
}

export const DEFAULT_CONFIG = Object.freeze({
  maxParallel: 3,
  strategist: "codex",
  workerMode: "hybrid",
  executionMode: "auto",
  planningTimeoutMinutes: 5,
  maxPlanningTasks: 12,
  baseRef: "HEAD",
  interactive: false,
  worktreeRoot: "../.strategos-worktrees",
  maxContextBytes: 64_000,
  taskTimeoutMinutes: 45,
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  agents: {
    claude: { command: "claude", extraArgs: [] },
    codex: { command: "codex", extraArgs: [] },
    copilot: { command: "copilot", extraArgs: [] },
  },
});

export async function loadConfig(root) {
  const file = path.join(root, ".strategos", "config.json");
  let user = {};
  try {
    user = await readJson(file);
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`cannot read ${file}: ${error.message}`);
  }
  const userConfig = { ...user };
  delete userConfig.capacity;
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    notifications: normalizeNotificationSettings(userConfig.notifications),
    agents: Object.fromEntries(Object.entries({ ...DEFAULT_CONFIG.agents, ...(userConfig.agents || {}) })
      .map(([name, value]) => [name, { ...DEFAULT_CONFIG.agents[name], ...value }])),
  };
}

async function writeIfMissing(file, content) {
  try {
    await fs.writeFile(file, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}

async function ensureGitignore(root) {
  const file = path.join(root, ".gitignore");
  let current = "";
  try {
    current = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const rules = [".strategos/runs/", ".strategos/attachments/", ".strategos/memory.local.md"];
  const missing = rules.filter((rule) => !current.split(/\r?\n/).includes(rule));
  if (missing.length === 0) return false;
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await fs.writeFile(file, `${current}${prefix}${missing.join("\n")}\n`, "utf8");
  return true;
}

export async function initializeProject(root) {
  const directory = path.join(root, ".strategos");
  await ensureDir(directory);
  const created = [];

  const files = [
    [
      path.join(directory, "config.json"),
      `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`,
    ],
    [
      path.join(directory, "context.md"),
      "# Shared project context\n\nDescribe architecture, constraints, commands, and current priorities here.\n",
    ],
    [
      path.join(directory, "memory.md"),
      "# Team memory\n\nRecord durable decisions and lessons that future agent tasks should receive.\n",
    ],
    [
      path.join(directory, "example-plan.json"),
      `${JSON.stringify(examplePlan(), null, 2)}\n`,
    ],
    [
      path.join(root, "AGENTS.md"),
      "# Agent guidance\n\n## Build and test\n\nDocument exact commands here.\n\n## Constraints\n\nDocument repository rules here.\n",
    ],
  ];

  for (const [file, content] of files) {
    if (await writeIfMissing(file, content)) created.push(path.relative(root, file));
  }
  if (await ensureGitignore(root)) created.push(".gitignore");
  return created;
}

export function examplePlan() {
  return {
    version: 1,
    goal: "Implement a small feature with independent implementation, tests, and review.",
    context: ["AGENTS.md", ".strategos/context.md"],
    tasks: [
      {
        id: "implementation",
        agent: "claude",
        mode: "write",
        prompt: "Implement the feature. Keep the change focused and run relevant checks.",
        dependsOn: [],
      },
      {
        id: "test-design",
        agent: "codex",
        mode: "write",
        prompt: "Add focused tests for the requested behavior and important edge cases.",
        dependsOn: [],
      },
      {
        id: "review",
        agent: "copilot",
        mode: "read-only",
        prompt: "Review the completed reports and identify correctness or integration risks.",
        dependsOn: ["implementation", "test-design"],
      },
    ],
  };
}

export async function saveConfig(root, config) {
  await writeJson(path.join(root, ".strategos", "config.json"), config);
}
