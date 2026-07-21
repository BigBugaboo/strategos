const CAPACITY_STATES = new Set(["available", "unknown", "exhausted"]);

export function normalizeCapacity(config = {}) {
  const configuredAgents = Object.keys(config.agents || {});
  const source = config.capacity || {};
  const agents = Object.fromEntries(configuredAgents.map((name) => {
    const value = source.agents?.[name] || {};
    const state = CAPACITY_STATES.has(value.state) ? value.state : "unknown";
    const hasRemaining = value.remainingPercent !== null && value.remainingPercent !== undefined;
    const numericRemaining = hasRemaining ? Number(value.remainingPercent) : Number.NaN;
    const remainingPercent = Number.isFinite(numericRemaining)
      ? Math.min(100, Math.max(0, Math.round(numericRemaining)))
      : null;
    return [name, {
      state,
      remainingPercent,
      resetsAt: typeof value.resetsAt === "string" && value.resetsAt ? value.resetsAt : null,
      source: value.source === "manual" ? "manual" : "unknown",
    }];
  }));
  return {
    excludeExhausted: source.excludeExhausted !== false,
    agents,
  };
}

export function eligibleAgents(healthyAgents, config = {}) {
  const capacity = normalizeCapacity(config);
  return healthyAgents.filter((name) => {
    if (config.agents?.[name]?.enabled === false) return false;
    if (!capacity.excludeExhausted) return true;
    return capacity.agents[name]?.state !== "exhausted";
  });
}

export function capacitySummary(config = {}, checks = []) {
  const capacity = normalizeCapacity(config);
  const health = new Map(checks.map((check) => [check.name, check]));
  return Object.entries(capacity.agents).map(([name, value]) => ({
    name,
    ...value,
    installed: health.get(name)?.ok === true,
    detail: health.get(name)?.detail || "not checked",
    eligible: health.get(name)?.ok === true &&
      config.agents?.[name]?.enabled !== false &&
      (!capacity.excludeExhausted || value.state !== "exhausted"),
  }));
}

export function mergeCapacitySettings(config, input = {}) {
  const current = normalizeCapacity(config);
  const next = {
    excludeExhausted: input.excludeExhausted !== false,
    agents: {},
  };
  for (const name of Object.keys(config.agents || {})) {
    const value = input.agents?.[name] || current.agents[name];
    if (!CAPACITY_STATES.has(value?.state)) {
      throw new Error(`invalid capacity state for ${name}`);
    }
    const remaining = value.remainingPercent;
    if (remaining !== null && remaining !== undefined &&
        (!Number.isFinite(Number(remaining)) || Number(remaining) < 0 || Number(remaining) > 100)) {
      throw new Error(`remainingPercent for ${name} must be between 0 and 100`);
    }
    next.agents[name] = {
      state: value.state,
      remainingPercent: remaining === null || remaining === undefined ? null : Math.round(Number(remaining)),
      resetsAt: typeof value.resetsAt === "string" && value.resetsAt ? value.resetsAt : null,
      source: "manual",
    };
  }
  return next;
}
