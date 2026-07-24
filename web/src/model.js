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

export function notificationOutcome(event) {
  if (event?.type === "session_complete") {
    return event.status === "succeeded" ? "success" : "failure";
  }
  if (["session_error", "session_interrupted"].includes(event?.type)) return "failure";
  return null;
}

export function shouldNotifyForEvent(settings, event) {
  if (!settings?.enabled) return false;
  const outcome = notificationOutcome(event);
  if (outcome === "success") return settings.onSuccess !== false;
  if (outcome === "failure") return settings.onFailure !== false;
  return false;
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

export function sessionStartedDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
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
    tasks: values,
    activeTasks: values.filter((task) => ["preparing", "running"].includes(task.status)),
    changedFiles: [...new Set(values.flatMap((task) => task.changedFiles || []))],
  };
}

export function sessionWorkflowState(session, liveEvents = []) {
  const taskState = sessionTaskState(session, liveEvents);
  const terminalStatuses = new Set(["succeeded", "failed", "interrupted", "skipped"]);
  const completedTasks = taskState.tasks.filter((task) => terminalStatuses.has(task.status));
  const failedTasks = taskState.tasks.filter((task) =>
    ["failed", "interrupted"].includes(task.status),
  );
  const status =
    session?.status === "failed" || failedTasks.some((task) => task.status === "failed")
      ? "failed"
      : session?.status === "interrupted" ||
          failedTasks.some((task) => task.status === "interrupted")
        ? "interrupted"
        : session?.status === "running" || taskState.activeTasks.length > 0
          ? "running"
          : taskState.tasks.length > 0 && completedTasks.length === taskState.tasks.length
            ? "succeeded"
            : "queued";
  return {
    ...taskState,
    status,
    completedTasks,
    completedCount: completedTasks.length,
    failedTasks,
  };
}

export function sessionFileChanges(session, liveEvents = []) {
  const changes = new Map();
  for (const task of sessionTaskState(session, liveEvents).tasks) {
    for (const file of task.changedFiles || []) {
      const taskId = task.id;
      if (!taskId || !file) continue;
      const key = `${taskId}\0${file}`;
      changes.set(key, {
        taskId,
        path: file,
        agent: task.agent,
        available: task.diff?.available === true,
        truncated: task.diff?.truncated === true,
      });
    }
  }
  return [...changes.values()];
}

function normalizedDiffPath(value) {
  return String(value || "").replace(/^(a|b)\//, "");
}

export function findDiffFile(files, targetPath) {
  const target = normalizedDiffPath(targetPath);
  return (files || []).find((file) =>
    [file.oldPath, file.newPath]
      .filter((value) => value && value !== "/dev/null")
      .some((value) => normalizedDiffPath(value) === target),
  );
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
