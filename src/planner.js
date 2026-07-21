import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { strategistInvocation } from "./adapters.js";
import { collectContext } from "./context.js";
import { validatePlan } from "./plan.js";
import { runCommand } from "./process.js";

const PLANNING_CONTEXT = Object.freeze([
  "AGENTS.md",
  ".strategos/context.md",
  ".strategos/memory.md",
]);

export const PLAN_JSON_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["version", "goal", "context", "tasks"],
  properties: {
    version: { type: "integer", const: 1 },
    goal: { type: "string", minLength: 1 },
    context: { type: "array", items: { type: "string" } },
    tasks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "agent", "mode", "prompt", "dependsOn", "context"],
        properties: {
          id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" },
          agent: { type: "string" },
          mode: { type: "string", enum: ["write", "read-only"] },
          prompt: { type: "string", minLength: 1 },
          dependsOn: { type: "array", items: { type: "string" } },
          context: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
});

function findBalancedObjects(text) {
  const objects = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          objects.push(text.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }
  return objects;
}

export function extractPlanJson(output) {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidates = [trimmed, fenced, ...findBalancedObjects(trimmed)].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed?.structured_output && typeof parsed.structured_output === "object") {
        return parsed.structured_output;
      }
      if (parsed?.result && typeof parsed.result === "object") return parsed.result;
      if (typeof parsed?.result === "string") {
        try {
          return JSON.parse(parsed.result);
        } catch {
          const nested = findBalancedObjects(parsed.result).at(-1);
          if (nested) return JSON.parse(nested);
        }
      }
      if (parsed?.version === 1 && Array.isArray(parsed.tasks)) return parsed;
    } catch {
      // Agent output may contain prose before or after the JSON object.
    }
  }
  throw new Error("strategist did not return a valid JSON plan");
}

export function buildStrategistPrompt({ goal, strategist, workerAgents, sharedContext, maxTasks }) {
  const capabilities = workerAgents
    .map((agent) => {
      const role = agent === strategist ? "; also the strategist for this planning call" : "";
      return agent === "copilot"
        ? `- ${agent}: read-only review and analysis tasks${role}`
        : `- ${agent}: write or read-only tasks${role}`;
    })
    .join("\n");
  const hybrid = workerAgents.includes(strategist);
  const participationPolicy = hybrid
    ? `This session uses hybrid participation. After returning the plan, ${strategist}\nmay also execute assigned worker tasks. When another worker is available, keep\nthe final independent review or audit assigned to a different agent.`
    : `This session uses separated participation. ${strategist} plans only and\nmust not receive a worker task.`;

  return `# Strategos planning assignment

You are the **${strategist}** strategist. Inspect the repository in read-only
mode and turn the user's goal into a small, executable task graph for
locally installed coding-agent CLIs.

## User goal

${goal}

## Available workers

${capabilities}

${participationPolicy}

Use only the worker names above. Create no more than ${maxTasks} tasks. Keep
write tasks independent when they can run safely in separate Git worktrees,
and make integration or review tasks depend on the work they inspect. Do not
assign overlapping write ownership to parallel tasks. Copilot must remain
read-only. Use every available worker when the goal provides enough meaningful
independent work, but do not invent artificial tasks solely to include an
agent. Include repository-relative context paths only when workers need them.

## Shared project context

${sharedContext || "No shared context files were found."}

## Required output

Return exactly one JSON object with no Markdown or commentary:

{
  "version": 1,
  "goal": "the normalized overall goal",
  "context": ["AGENTS.md"],
  "tasks": [
    {
      "id": "short-stable-id",
      "agent": "one available worker",
      "mode": "write or read-only",
      "prompt": "specific assignment with boundaries and checks",
      "dependsOn": [],
      "context": []
    }
  ]
}`;
}

export async function planWithStrategist(options) {
  const {
    root,
    config,
    goal,
    strategist,
    workerAgents,
    signal,
    runCommandFn = runCommand,
    collectContextFn = collectContext,
  } = options;
  if (typeof goal !== "string" || !goal.trim()) throw new Error("goal cannot be empty");
  if (!workerAgents.length) throw new Error("no worker agent CLI is available");

  const maxTasks = config.maxPlanningTasks || 12;
  const sharedContext = await collectContextFn(
    root,
    PLANNING_CONTEXT,
    Math.min(config.maxContextBytes || 64_000, 32_000),
  );
  const prompt = buildStrategistPrompt({
    goal: goal.trim(),
    strategist,
    workerAgents,
    sharedContext,
    maxTasks,
  });
  let schemaDirectory;
  try {
    if (strategist === "codex") {
      schemaDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-schema-"));
      await fs.writeFile(
        path.join(schemaDirectory, "plan.schema.json"),
        `${JSON.stringify(PLAN_JSON_SCHEMA, null, 2)}\n`,
        "utf8",
      );
    }
    const invocation = strategistInvocation(strategist, {
      prompt,
      workspace: root,
      config,
      jsonSchema: PLAN_JSON_SCHEMA,
      schemaPath: schemaDirectory ? path.join(schemaDirectory, "plan.schema.json") : undefined,
    });
    const result = await runCommandFn(invocation.command, invocation.args, {
      cwd: root,
      signal,
      timeoutMs: (config.planningTimeoutMinutes || 5) * 60_000,
      maxOutputBytes: 2 * 1024 * 1024,
    });

    if (result.aborted) throw new Error(`${strategist} planning cancelled`);
    if (result.timedOut) throw new Error(`${strategist} planning timed out`);
    if (result.code !== 0) {
      const failureOutput = result.stderr || result.stdout || result.error?.message || "no output";
      const detail =
        failureOutput.length > 4_000
          ? `[earlier output omitted]\n${failureOutput.slice(-4_000).trim()}`
          : failureOutput.trim();
      throw new Error(`${strategist} planning failed: ${detail}`);
    }

    const plan = validatePlan(extractPlanJson(result.stdout), workerAgents);
    if (plan.tasks.length > maxTasks) {
      throw new Error(`strategist returned ${plan.tasks.length} tasks; maximum is ${maxTasks}`);
    }
    const allowed = new Set(workerAgents);
    for (const task of plan.tasks) {
      if (!allowed.has(task.agent)) {
        throw new Error(`strategist assigned unavailable worker: ${task.agent}`);
      }
      if (task.agent === "copilot" && task.mode !== "read-only") {
        throw new Error("strategist assigned Copilot a write task");
      }
    }
    return plan;
  } finally {
    if (schemaDirectory) await fs.rm(schemaDirectory, { recursive: true, force: true });
  }
}
