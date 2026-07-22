export function quotaLabel(agent) {
  if (agent.state === "exhausted") return "No quota — off";
  if (agent.state === "unknown") return "Unknown";
  if (agent.remainingPercent === null || agent.remainingPercent === undefined) return "Unknown";
  return `${agent.remainingPercent}% left`;
}

export function availableAgentNames(capacity) {
  return capacity.filter((agent) => agent.installed && agent.eligible).map((agent) => agent.name);
}

export function shouldSubmitComposerKey(event, composing = false) {
  return Boolean(
    event?.key === "Enter" &&
    !event.shiftKey &&
    !composing &&
    !event.isComposing &&
    event.keyCode !== 229,
  );
}

export function sortSidebarSessions(sessions = []) {
  return [...sessions].sort((left, right) => {
    const pinned = Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    if (pinned) return pinned;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
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

export function sessionActivityState(session, liveEvents = [], isActive = false) {
  const taskState = sessionTaskState(session, liveEvents);
  const detached = Boolean(
    ["planning", "previewed", "running"].includes(session?.status) && !isActive,
  );
  const activities = (detached ? [] : taskState.activeTasks).map((task) => ({
    id: task.id,
    agent: task.agent,
    label: task.id,
    phase: task.status,
    kind: "worker",
  }));
  if (session?.status === "planning" && isActive) {
    activities.unshift({
      id: "strategist-planning",
      agent: session.strategist,
      label: "Planning task graph",
      phase: "planning",
      kind: "strategist",
    });
  }
  return {
    ...taskState,
    activities,
    detached,
  };
}

function eventKey(event) {
  return [
    event.type,
    event.at,
    event.runId,
    event.strategist,
    event.task?.id,
    event.task?.status,
  ].join("|");
}

export function mergeSessionEvents(sessionEvents = [], liveEvents = []) {
  const events = new Map();
  for (const event of [...sessionEvents, ...liveEvents]) events.set(eventKey(event), event);
  return [...events.values()];
}
