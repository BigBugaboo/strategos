export function quotaLabel(agent) {
  if (agent.state === "exhausted") return "No quota — off";
  if (agent.remainingPercent === null || agent.remainingPercent === undefined) return "Unknown";
  return `${agent.remainingPercent}% left`;
}

export function availableAgentNames(capacity) {
  return capacity.filter((agent) => agent.installed && agent.eligible).map((agent) => agent.name);
}
