export function quotaLabel(agent) {
  if (agent.state === "exhausted") return "No quota — off";
  if (agent.remainingPercent === null || agent.remainingPercent === undefined) return "Unknown";
  return `${agent.remainingPercent}% left`;
}

export function availableAgentNames(capacity) {
  return capacity.filter((agent) => agent.installed && agent.eligible).map((agent) => agent.name);
}

export function historyDate(value, now = new Date()) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const delta = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (delta === 0) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  if (delta === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

export function sessionTaskState(session, liveEvents = []) {
  const tasks = new Map((session?.plan?.tasks || []).map((task) => [task.id, { ...task }]));
  for (const task of Object.values(session?.manifest?.tasks || {})) {
    tasks.set(task.id, { ...tasks.get(task.id), ...task });
  }
  for (const event of [...(session?.events || []), ...liveEvents]) {
    if (!event.task?.id) continue;
    const previous = tasks.get(event.task.id) || {};
    const status =
      event.type === "task_preparing"
        ? "preparing"
        : event.type === "task_started"
          ? "running"
          : event.type === "task_finished"
            ? event.task.status || "succeeded"
            : event.task.status;
    tasks.set(event.task.id, { ...previous, ...event.task, status: status || previous.status });
  }
  const values = [...tasks.values()];
  return {
    activeTasks: values.filter((task) => ["preparing", "running"].includes(task.status)),
    changedFiles: [...new Set(values.flatMap((task) => task.changedFiles || []))],
  };
}
