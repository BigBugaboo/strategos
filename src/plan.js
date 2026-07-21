const BUILTIN_AGENTS = new Set(["claude", "codex", "copilot"]);
const MODES = new Set(["read-only", "write"]);

export function validatePlan(input, configuredAgents = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("plan must be a JSON object");
  }
  if (input.version !== 1) throw new Error("plan.version must be 1");
  if (typeof input.goal !== "string" || !input.goal.trim()) {
    throw new Error("plan.goal must be a non-empty string");
  }
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) {
    throw new Error("plan.tasks must contain at least one task");
  }
  if (
    input.context !== undefined &&
    (!Array.isArray(input.context) || input.context.some((item) => typeof item !== "string"))
  ) {
    throw new Error("plan.context must be an array of repository-relative paths");
  }
  if (
    input.attachments !== undefined &&
    (!Array.isArray(input.attachments) || input.attachments.some((item) => typeof item !== "string"))
  ) {
    throw new Error("plan.attachments must be an array of repository-relative image paths");
  }

  const allowedAgents = new Set([...BUILTIN_AGENTS, ...configuredAgents]);
  const ids = new Set();
  const tasks = input.tasks.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`task ${index + 1} must be an object`);
    const id = String(raw.id || "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
      throw new Error(`task ${index + 1} has an invalid id`);
    }
    if (ids.has(id)) throw new Error(`duplicate task id: ${id}`);
    ids.add(id);

    const agent = String(raw.agent || "").trim();
    if (!allowedAgents.has(agent)) throw new Error(`task ${id} uses unknown agent: ${agent}`);
    const mode = raw.mode || "write";
    if (!MODES.has(mode)) throw new Error(`task ${id} has invalid mode: ${mode}`);
    if (typeof raw.prompt !== "string" || !raw.prompt.trim()) {
      throw new Error(`task ${id} must have a non-empty prompt`);
    }
    const dependsOn = raw.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((dep) => typeof dep !== "string")) {
      throw new Error(`task ${id}.dependsOn must be an array of task ids`);
    }
    const context = raw.context ?? [];
    if (!Array.isArray(context) || context.some((item) => typeof item !== "string")) {
      throw new Error(`task ${id}.context must be an array of repository-relative paths`);
    }
    return { ...raw, id, agent, mode, dependsOn: [...dependsOn], context: [...context] };
  });

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`task ${task.id} depends on missing task: ${dependency}`);
      if (dependency === task.id) throw new Error(`task ${task.id} cannot depend on itself`);
    }
  }

  const normalized = {
    version: 1,
    goal: input.goal.trim(),
    context: input.context || [],
    attachments: input.attachments || [],
    tasks,
  };
  buildWaves(normalized);
  return normalized;
}

export function buildWaves(plan) {
  const remaining = new Map(plan.tasks.map((task) => [task.id, task]));
  const completed = new Set();
  const waves = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((task) =>
      task.dependsOn.every((dependency) => completed.has(dependency)),
    );
    if (ready.length === 0) {
      throw new Error("task dependency graph contains a cycle");
    }
    waves.push(ready);
    for (const task of ready) {
      completed.add(task.id);
      remaining.delete(task.id);
    }
  }
  return waves;
}
