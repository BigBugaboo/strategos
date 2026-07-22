import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  FolderOpen,
  GearSix,
  Info,
  Paperclip,
  PlusSquare,
  PushPin,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  StopCircle,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  historyDate,
  mergeSessionEvents,
  sessionActivityState,
  shouldSubmitComposerKey,
  sortSidebarSessions,
} from "./model.js";

const AGENT_COLORS = { claude: "#39d5df", codex: "#9b5cff", copilot: "#a3aab6" };
const PROJECT_STORAGE_KEY = "strategos.selectedProject";

function shortPath(value) {
  if (!value) return "";
  const home = value.match(/^\/Users\/[^/]+/i)?.[0];
  return home ? value.replace(home, "~") : value;
}

function clock(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function statusLabel(status) {
  return (
    {
      planning: "Planning",
      planned: "Ready",
      previewed: "Ready",
      running: "In progress",
      succeeded: "Complete",
      failed: "Failed",
      interrupted: "Interrupted",
    }[status] ||
    status ||
    "Ready"
  );
}

function eventText(event) {
  if (event.type === "planning_started") return `${event.strategist}: Reading repository context`;
  if (event.type === "plan_ready") return "Strategos: Plan ready";
  if (event.type === "run_started") return `Strategos: Started run ${event.runId}`;
  if (event.type === "task_preparing") return `${event.task.agent}: Preparing ${event.task.id}`;
  if (event.type === "task_started") return `${event.task.agent}: Started ${event.task.id}`;
  if (event.type === "task_finished")
    return `${event.task.agent}: ${event.task.status} ${event.task.id}`;
  if (event.type === "run_finished") return `Strategos: Run ${event.manifest.status}`;
  if (event.type === "session_stopping") return "Strategos: Stopping active CLI processes";
  if (event.type === "session_interrupted") return "Strategos: Session stopped";
  if (event.type === "session_error") return `Error: ${event.error}`;
  return event.type?.replaceAll("_", " ") || "Session updated";
}

function savedProjectPath() {
  return globalThis.localStorage?.getItem(PROJECT_STORAGE_KEY) || "";
}

function sidebarGroupsFor(data) {
  if (data.sessionGroups) return data.sessionGroups;
  return (data.projects || []).map((project) => ({
    ...project,
    sessions: project.path === data.repository.path ? data.sessions || [] : [],
    activeSessionIds: project.path === data.repository.path ? data.activeSessionIds || [] : [],
  }));
}

async function api(path, options = {}) {
  const { projectPath = savedProjectPath(), headers, ...requestOptions } = options;
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(projectPath ? { "x-strategos-project": encodeURIComponent(projectPath) } : {}),
      ...headers,
    },
    ...requestOptions,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function SessionSidebar({
  repository,
  groups,
  selectedId,
  view,
  expandedProjects,
  disabled,
  onToggleProject,
  onSelectProject,
  onSelectSession,
  onTogglePin,
  onAdd,
}) {
  const [adding, setAdding] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const section = useRef(null);

  useEffect(() => {
    if (!adding) return undefined;
    const closePopover = (event) => {
      if (event.key === "Escape") setAdding(false);
      if (event.type === "pointerdown" && !section.current?.contains(event.target))
        setAdding(false);
    };
    globalThis.addEventListener("keydown", closePopover);
    globalThis.addEventListener("pointerdown", closePopover);
    return () => {
      globalThis.removeEventListener("keydown", closePopover);
      globalThis.removeEventListener("pointerdown", closePopover);
    };
  }, [adding]);

  const addProject = async (event) => {
    event.preventDefault();
    if (!projectPath.trim() || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await onAdd(projectPath.trim());
      setProjectPath("");
      setAdding(false);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section ref={section} className="session-browser">
      <div className="sidebar-section-heading">
        <h2>Sessions</h2>
        <button
          className="project-add"
          type="button"
          aria-label="Add local project"
          title="Add local project"
          onClick={() => {
            setAdding((value) => !value);
            setMessage("");
          }}
        >
          <PlusSquare />
        </button>
      </div>
      <div className="session-groups" aria-label="Sessions by project">
        {groups.map((group) => {
          const expanded = expandedProjects.has(group.path);
          const current = group.path === repository.path;
          const sessions = sortSidebarSessions(group.sessions);
          return (
            <section className={`project-group ${current ? "current" : ""}`} key={group.path}>
              <button
                type="button"
                className="project-group-toggle"
                aria-expanded={expanded}
                aria-current={current ? "true" : undefined}
                disabled={disabled || group.unavailable}
                onClick={() => void onToggleProject(group).catch(() => {})}
                title={group.path}
              >
                {expanded ? <CaretDown /> : <CaretRight />}
                <FolderOpen weight={current ? "fill" : "regular"} />
                <span>
                  <strong>{group.name}</strong>
                  <small>{group.unavailable ? "Unavailable" : shortPath(group.path)}</small>
                </span>
                <em>{sessions.length}</em>
              </button>
              {expanded && (
                <div className="group-session-list">
                  {sessions.length ? (
                    sessions.map((session) => (
                      <div
                        className={`session-row ${selectedId === session.id && current && view === "chat" ? "selected" : ""}`}
                        key={session.id}
                      >
                        <button
                          type="button"
                          className="session-select"
                          onClick={() => void onSelectSession(group, session).catch(() => {})}
                        >
                          <span>{session.goal}</span>
                          <span className="session-meta">
                            <time>{historyDate(session.updatedAt)}</time>
                            <i className={`status-${session.status}`} />
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`session-pin ${session.pinned ? "pinned" : ""}`}
                          aria-label={`${session.pinned ? "Unpin" : "Pin"} ${session.goal}`}
                          aria-pressed={Boolean(session.pinned)}
                          title={session.pinned ? "Unpin session" : "Pin session"}
                          onClick={() => void onTogglePin(group, session).catch(() => {})}
                        >
                          <PushPin weight={session.pinned ? "fill" : "regular"} />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="history-empty">No sessions yet.</p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="project-compact">
        <FolderOpen />
        <select
          aria-label="Current project"
          value={repository.path}
          disabled={disabled}
          onChange={(event) => void onSelectProject(event.target.value).catch(() => {})}
        >
          {groups.map((group) => (
            <option key={group.path} value={group.path}>
              {group.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Add local project"
          title="Add local project"
          onClick={() => {
            setAdding((value) => !value);
            setMessage("");
          }}
        >
          <PlusSquare />
        </button>
      </div>
      {adding && (
        <form className="project-popover" onSubmit={addProject}>
          <div className="popover-heading">
            <span>
              <strong>Open local project</strong>
              <small>Add a Git repository to this workspace.</small>
            </span>
            <button
              type="button"
              aria-label="Close project picker"
              onClick={() => setAdding(false)}
            >
              <X />
            </button>
          </div>
          <label htmlFor="project-path">Repository path</label>
          <input
            id="project-path"
            autoFocus
            placeholder="/Users/you/projects/example"
            value={projectPath}
            onChange={(event) => setProjectPath(event.target.value)}
          />
          {message && <p role="alert">{message}</p>}
          <div>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button type="submit" disabled={!projectPath.trim() || saving}>
              {saving ? "Adding…" : "Add project"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function EmptyChat() {
  return (
    <div className="empty-chat">
      <img src="/strategos-icon.png" alt="" />
      <h2>Start a task</h2>
      <p>Describe a goal, attach visual context, or ask Strategos to inspect this project.</p>
    </div>
  );
}

function PlanningIndicator({ strategist }) {
  const agent = strategist || "Strategos";
  return (
    <div className="planning-indicator" role="status" aria-live="polite">
      <span className="planning-mark" aria-hidden="true">
        <Sparkle weight="fill" />
        <i />
        <i />
      </span>
      <span className="planning-copy">
        <strong>
          {agent[0].toUpperCase() + agent.slice(1)} is planning
          <span className="planning-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </strong>
        <small>Reading repository context and preparing the task graph</small>
      </span>
      <span className="planning-track" aria-hidden="true">
        <i />
      </span>
    </div>
  );
}

function SessionChat({ session, liveEvents }) {
  if (!session) return <EmptyChat />;
  const plan = session.plan;
  const participants = [...new Set((plan?.tasks || []).map((task) => task.agent))];
  return (
    <div className="conversation">
      <article className="message user-message">
        <div className="avatar user-avatar">U</div>
        <div>
          <div className="message-meta">
            <strong>You</strong>
            <time>{clock(session.createdAt)}</time>
          </div>
          <p>{session.goal}</p>
        </div>
      </article>
      <article className="message assistant-message">
        <img className="avatar logo-avatar" src="/strategos-icon.png" alt="" />
        <div>
          <div className="message-meta">
            <strong>Strategos</strong>
            <time>{clock(session.createdAt)}</time>
          </div>
          {plan ? (
            <>
              <p>
                Here’s a short plan to {plan.goal.charAt(0).toLowerCase() + plan.goal.slice(1)}.
              </p>
              <ol>
                {plan.tasks.map((task) => (
                  <li key={task.id}>
                    <span>{task.prompt || task.id}</span>
                    <small>
                      {task.agent} · {task.mode}
                    </small>
                  </li>
                ))}
              </ol>
            </>
          ) : session.status === "planning" ? (
            <PlanningIndicator strategist={session.strategist} />
          ) : (
            <p className="muted-copy">This session does not have a saved plan yet.</p>
          )}
        </div>
      </article>
      {(participants.length > 0 || liveEvents.length > 0) && (
        <article className="execution-message">
          <div className="agent-pair">
            {participants.slice(0, 3).map((name) => (
              <span key={name} style={{ background: AGENT_COLORS[name] }} />
            ))}
          </div>
          <div>
            <p>
              <time>{clock(session.updatedAt)}</time>{" "}
              {participants.length
                ? `${participants.map((name) => name[0].toUpperCase() + name.slice(1)).join(" and ")} ${session.status === "running" ? "are running in parallel." : "were assigned to this session."}`
                : session.status === "planning"
                  ? "Planning in progress."
                  : session.status === "interrupted"
                    ? "Session stopped before planning completed."
                    : "Session updated."}
            </p>
            <p className={`run-state state-${session.status}`}>
              {session.status === "interrupted" ? (
                <StopCircle weight="fill" />
              ) : (
                <CheckCircle weight="fill" />
              )}{" "}
              {statusLabel(session.status)}
            </p>
          </div>
        </article>
      )}
      {session.error && (
        <div className="error-banner">
          <WarningCircle />
          {session.error}
        </div>
      )}
    </div>
  );
}

function SettingsView({ data, onSaved }) {
  const [mode, setMode] = useState(data.executionMode);
  const [strategist, setStrategist] = useState(data.strategist);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const dirty = mode !== data.executionMode || strategist !== data.strategist;
  const save = async (event) => {
    event.preventDefault();
    const payload = {
      executionMode: mode,
      strategist,
    };
    setSaving(true);
    setMessage("Saving…");
    try {
      const result = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      onSaved({ ...data, ...result });
      setMessage("Settings saved");
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="center-page settings-page">
      <header>
        <p className="eyebrow">Preferences</p>
        <h1>Orchestration</h1>
        <p>Choose how Strategos plans work and which local CLI leads planning.</p>
      </header>
      <form onSubmit={save}>
        <div className="settings-row">
          <label>
            Default mode<small>Auto previews and starts workers immediately.</small>
          </label>
          <select
            aria-label="Default mode"
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            <option value="auto">Auto</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="settings-row">
          <label>
            Strategist<small>Falls back to another eligible CLI if unavailable.</small>
          </label>
          <select
            aria-label="Strategist"
            value={strategist}
            onChange={(event) => setStrategist(event.target.value)}
          >
            {data.agents.map((agent) => (
              <option key={agent}>{agent}</option>
            ))}
          </select>
        </div>
        <div className="settings-actions">
          <button type="submit" disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <span role="status" aria-live="polite">
            {message}
          </span>
        </div>
      </form>
    </section>
  );
}

function Inspector({ session, liveEvents, isActive, stopping, onRun, onResume, onStop, onClose }) {
  const [logsOpen, setLogsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => setConfirmStop(false), [session?.id]);
  const events = mergeSessionEvents(session?.events, liveEvents).slice(-5);
  const {
    activities,
    changedFiles: files,
    detached,
  } = sessionActivityState(session, liveEvents, isActive);
  if (!session)
    return (
      <aside className="inspector inspector-empty" aria-label="Session details">
        <SlidersHorizontal />
        <p>Select a session to inspect its plan, workers, and changed files.</p>
      </aside>
    );
  return (
    <aside className="inspector" aria-label="Session details">
      <div className="inspector-toolbar">
        <span>Details</span>
        <button
          type="button"
          aria-label="Close session details"
          title="Close details"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <section className="inspector-section current-run">
        <div className="section-title">
          <h2>Current activity</h2>
          <span>
            <i />
            {activities.length} active
          </span>
        </div>
        {activities.map((activity) => (
          <div className="active-task" key={`${activity.agent}-${activity.id}`}>
            <span
              className="agent-dot activity-pulse"
              style={{ background: AGENT_COLORS[activity.agent] }}
            />
            <strong>{activity.agent}</strong>
            <span>{activity.label}</span>
            <time>{clock(session.updatedAt)}</time>
          </div>
        ))}
        {activities.length > 0 && (
          <p className="headless-note">
            {stopping
              ? "Stopping active CLI processes…"
              : "The CLI is running in the background. No separate terminal window will open."}
          </p>
        )}
        {!activities.length && (
          <p className="quiet">
            {detached
              ? "The planner is no longer attached. Resume this session to continue."
              : session.status === "running"
                ? "Waiting for worker updates…"
                : "No active CLI processes."}
          </p>
        )}
      </section>
      <section className="inspector-section metadata">
        <h2>Selected session</h2>
        <dl>
          <dt>Title</dt>
          <dd>{session.goal}</dd>
          <dt>Started</dt>
          <dd>
            {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(session.createdAt),
            )}
          </dd>
          <dt>Repository</dt>
          <dd>{shortPath(session.repository)}</dd>
          <dt>Session ID</dt>
          <dd>{session.id}</dd>
          <dt>Status</dt>
          <dd>
            <span className={`status-dot status-${session.status}`} />
            {statusLabel(session.status)}
          </dd>
          <dt>Mode</dt>
          <dd>{session.executionMode === "manual" ? "Manual" : "Auto"}</dd>
        </dl>
        <div className="session-actions">
          {["planned", "previewed"].includes(session.status) && (
            <button onClick={onRun}>
              <Play weight="fill" /> Run plan
            </button>
          )}
          {(["failed", "interrupted"].includes(session.status) || detached) && (
            <button onClick={onResume}>
              <ClockCounterClockwise /> Resume
            </button>
          )}
          {isActive && ["planning", "previewed", "running"].includes(session.status) && (
            <button
              className="stop-session"
              disabled={stopping}
              onClick={() => setConfirmStop(true)}
            >
              <StopCircle weight="fill" /> {stopping ? "Stopping…" : "Stop session"}
            </button>
          )}
          {confirmStop && !stopping && (
            <div className="stop-confirmation" role="alert">
              <p>Stop all active CLI processes? You can resume this session later.</p>
              <div>
                <button type="button" onClick={() => setConfirmStop(false)}>
                  Keep running
                </button>
                <button
                  type="button"
                  className="confirm-stop"
                  onClick={() => {
                    setConfirmStop(false);
                    onStop();
                  }}
                >
                  Stop now
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
      <section className="inspector-section disclosure">
        <button aria-expanded={logsOpen} onClick={() => setLogsOpen(!logsOpen)}>
          <span>Recent output</span>
          {logsOpen ? <CaretDown /> : <CaretRight />}
        </button>
        {logsOpen && (
          <div className="event-list">
            {events.length ? (
              events.map((event, index) => (
                <p key={`${event.at || "live"}-${index}`}>
                  <time>{clock(event.at || new Date())}</time>
                  <span>{eventText(event)}</span>
                </p>
              ))
            ) : (
              <p className="quiet">No output yet.</p>
            )}
          </div>
        )}
      </section>
      <section className="inspector-section disclosure">
        <button aria-expanded={filesOpen} onClick={() => setFilesOpen(!filesOpen)}>
          <span>Files changed</span>
          {filesOpen ? <CaretDown /> : <CaretRight />}
        </button>
        {filesOpen && (
          <div className="file-list">
            {files.length ? (
              files.map((file) => <code key={file}>{file}</code>)
            ) : (
              <p className="quiet">No saved file changes.</p>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

export function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("chat");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("auto");
  const [attachments, setAttachments] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [stoppingIds, setStoppingIds] = useState([]);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const fileInput = useRef(null);
  const composerInput = useRef(null);
  const composerIsComposing = useRef(false);
  const modeControl = useRef(null);
  const bootstrapped = useRef(false);
  const selected = useMemo(
    () => data?.sessions.find((session) => session.id === selectedId) || null,
    [data, selectedId],
  );

  useEffect(() => {
    if (!data?.repository.path) return;
    setExpandedProjects((current) => {
      if (current.size) return current;
      return new Set([data.repository.path]);
    });
  }, [data?.repository.path]);

  const refresh = async (projectPath = savedProjectPath(), resetMode = false) => {
    const next = await api("/api/bootstrap", { projectPath });
    const firstLoad = !bootstrapped.current;
    setData(next);
    setStoppingIds((items) => items.filter((id) => (next.activeSessionIds || []).includes(id)));
    if (firstLoad || resetMode) {
      setMode(next.executionMode || "auto");
      bootstrapped.current = true;
    }
    setSelectedId((current) =>
      current && next.sessions.some((session) => session.id === current)
        ? current
        : firstLoad
          ? next.sessions[0]?.id || null
          : null,
    );
    setError("");
  };

  useEffect(() => {
    const storedProject = savedProjectPath();
    refresh(storedProject).catch((requestError) => {
      if (!storedProject) {
        setError(requestError.message);
        return;
      }
      globalThis.localStorage?.removeItem(PROJECT_STORAGE_KEY);
      refresh("").catch((fallbackError) => setError(fallbackError.message));
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return undefined;
    const project = encodeURIComponent(data.repository.path);
    const source = new EventSource(`/api/events/${selectedId}?project=${project}`);
    source.onmessage = (event) => {
      const parsed = JSON.parse(event.data);
      if (!["connected", "session_inactive"].includes(parsed.type))
        setLiveEvents((items) =>
          [...items, { at: new Date().toISOString(), ...parsed }].slice(-20),
        );
      if (
        [
          "plan_ready",
          "session_complete",
          "session_error",
          "session_interrupted",
          "session_inactive",
          "run_finished",
        ].includes(parsed.type)
      )
        refresh().catch(() => {});
    };
    return () => source.close();
  }, [data?.repository.path, selectedId]);

  const selectProject = async (projectPath, nextSelectedId = null) => {
    if (!projectPath || switchingProject) return;
    setExpandedProjects((current) => new Set([...current, projectPath]));
    if (projectPath === data.repository.path) {
      if (nextSelectedId) {
        setSelectedId(nextSelectedId);
        setView("chat");
        setModeMenuOpen(false);
        setLiveEvents([]);
      }
      return;
    }
    const previousPath = data.repository.path;
    setSwitchingProject(true);
    setError("");
    setSelectedId(null);
    setLiveEvents([]);
    globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, projectPath);
    try {
      await refresh(projectPath, true);
      setSelectedId(nextSelectedId);
      setView("chat");
      setModeMenuOpen(false);
      setDraft("");
      setAttachments([]);
    } catch (requestError) {
      globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, previousPath);
      setError(requestError.message);
      throw requestError;
    } finally {
      setSwitchingProject(false);
    }
  };

  const addProject = async (projectPath) => {
    const result = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ path: projectPath }),
    });
    await selectProject(result.project.path);
  };

  const selectSession = (session) => {
    setSelectedId(session.id);
    setView("chat");
    setModeMenuOpen(false);
    setLiveEvents([]);
  };
  const toggleProject = async (project) => {
    const current = project.path === data.repository.path;
    setExpandedProjects((items) => {
      const next = new Set(items);
      if (current && next.has(project.path)) next.delete(project.path);
      else next.add(project.path);
      return next;
    });
    if (!current) await selectProject(project.path);
  };
  const selectGroupedSession = async (project, session) => {
    if (project.path !== data.repository.path) {
      await selectProject(project.path, session.id);
      return;
    }
    selectSession(session);
  };
  const togglePin = async (project, session) => {
    setError("");
    try {
      const updated = await api(`/api/sessions/${session.id}/pin`, {
        projectPath: project.path,
        method: "PUT",
        body: JSON.stringify({ pinned: !session.pinned }),
      });
      setData((current) => ({
        ...current,
        sessions:
          project.path === current.repository.path
            ? current.sessions.map((item) => (item.id === updated.id ? updated : item))
            : current.sessions,
        sessionGroups: sidebarGroupsFor(current).map((group) =>
          group.path === project.path
            ? {
                ...group,
                sessions: group.sessions.map((item) => (item.id === updated.id ? updated : item)),
              }
            : group,
        ),
      }));
    } catch (requestError) {
      setError(requestError.message);
      throw requestError;
    }
  };
  const newTask = () => {
    setSelectedId(null);
    setView("chat");
    setDraft("");
    setAttachments([]);
    setError("");
    setModeMenuOpen(false);
    globalThis.setTimeout(() => composerInput.current?.focus(), 0);
  };
  const send = async () => {
    const goal = draft.trim();
    if (!goal || submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const attachmentPaths = [];
      for (const file of attachments) {
        const dataBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(typeof reader.result === "string" ? reader.result.split(",")[1] : "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const saved = await api("/api/attachments", {
          method: "POST",
          body: JSON.stringify({ name: file.name, mimeType: file.type, dataBase64 }),
        });
        attachmentPaths.push(saved.relativePath);
      }
      const session = await api("/api/goals", {
        method: "POST",
        body: JSON.stringify({ goal, executionMode: mode, attachmentPaths }),
      });
      setData((current) => ({
        ...current,
        sessions: [session, ...current.sessions.filter((item) => item.id !== session.id)],
        sessionGroups: sidebarGroupsFor(current).map((group) =>
          group.path === current.repository.path
            ? {
                ...group,
                sessions: [session, ...group.sessions.filter((item) => item.id !== session.id)],
              }
            : group,
        ),
        activeSessionIds: [...new Set([...(current.activeSessionIds || []), session.id])],
      }));
      setSelectedId(session.id);
      setDraft("");
      setAttachments([]);
      setModeMenuOpen(false);
      if (fileInput.current) fileInput.current.value = "";
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };
  const runSelected = async () => {
    if (!selected) return;
    setError("");
    try {
      await api(`/api/sessions/${selected.id}/run`, { method: "POST", body: "{}" });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const resumeSelected = async () => {
    if (!selected) return;
    setError("");
    try {
      await api(`/api/sessions/${selected.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ executionMode: mode }),
      });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const stopSelected = async () => {
    if (!selected || stoppingIds.includes(selected.id)) return;
    setError("");
    setStoppingIds((items) => [...new Set([...items, selected.id])]);
    try {
      await api(`/api/sessions/${selected.id}/stop`, { method: "POST", body: "{}" });
    } catch (requestError) {
      setStoppingIds((items) => items.filter((id) => id !== selected.id));
      setError(requestError.message);
    }
  };

  useEffect(() => {
    const onShortcut = (event) => {
      if (!(event.metaKey || event.ctrlKey)) {
        if (event.key === "Escape") setModeMenuOpen(false);
        return;
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("chat");
        globalThis.setTimeout(() => composerInput.current?.focus(), 0);
      }
      if (event.key === ",") {
        event.preventDefault();
        setView("settings");
        setModeMenuOpen(false);
      }
    };
    globalThis.addEventListener("keydown", onShortcut);
    return () => globalThis.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    if (!modeMenuOpen) return undefined;
    const closeModeMenu = (event) => {
      if (!modeControl.current?.contains(event.target)) setModeMenuOpen(false);
    };
    globalThis.addEventListener("pointerdown", closeModeMenu);
    return () => globalThis.removeEventListener("pointerdown", closeModeMenu);
  }, [modeMenuOpen]);

  useEffect(() => {
    if (data && view === "chat" && !selectedId)
      globalThis.setTimeout(() => composerInput.current?.focus(), 0);
  }, [data?.repository.path, selectedId, view]);

  if (!data)
    return (
      <div className="loading-screen">
        <img src="/strategos-icon.png" alt="" />
        <p>{error || "Starting Strategos…"}</p>
        {error && (
          <button onClick={() => refresh().catch((requestError) => setError(requestError.message))}>
            Retry
          </button>
        )}
      </div>
    );
  const showInspector = inspectorOpen && selected && view === "chat";
  return (
    <div className={`app-shell ${showInspector ? "" : "inspector-closed"}`}>
      <header className="topbar">
        <div className="brand">
          <img src="/strategos-icon.png" alt="Strategos" />
          <div>
            <strong>{selected?.goal || data.repository.name}</strong>
            <span title={data.repository.path}>{shortPath(data.repository.path)}</span>
          </div>
          <small>v{data.version}</small>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <nav className="sidebar-primary-nav">
            <button
              type="button"
              className={view === "chat" && !selected ? "active" : ""}
              aria-current={view === "chat" && !selected ? "page" : undefined}
              onClick={newTask}
            >
              <PlusSquare />
              New task
            </button>
          </nav>
          <SessionSidebar
            repository={data.repository}
            groups={sidebarGroupsFor(data)}
            selectedId={selectedId}
            view={view}
            expandedProjects={expandedProjects}
            disabled={switchingProject}
            onToggleProject={toggleProject}
            onSelectProject={selectProject}
            onSelectSession={selectGroupedSession}
            onTogglePin={togglePin}
            onAdd={addProject}
          />
          <nav className="sidebar-footer-nav">
            <button
              type="button"
              className={view === "settings" ? "active" : ""}
              aria-current={view === "settings" ? "page" : undefined}
              onClick={() => {
                setView("settings");
                setModeMenuOpen(false);
              }}
            >
              <GearSix />
              Settings
            </button>
          </nav>
        </aside>
        <main className="main-panel">
          {selected && view === "chat" && !showInspector && (
            <button
              type="button"
              className="details-toggle"
              aria-label="Open session details"
              title="Open details"
              onClick={() => setInspectorOpen(true)}
            >
              <SidebarSimple />
            </button>
          )}
          {view === "settings" ? (
            <SettingsView data={data} onSaved={setData} />
          ) : (
            <SessionChat session={selected} liveEvents={liveEvents} />
          )}
          {view === "chat" && (
            <div className="composer-wrap">
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {attachments.length > 0 && (
                  <div className="attachment-list" aria-label="Attached images">
                    {attachments.map((file, index) => (
                      <span key={`${file.name}-${file.lastModified}`}>
                        <Paperclip />
                        <span>{file.name}</span>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setAttachments((items) =>
                              items.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <X />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  ref={composerInput}
                  rows="2"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onCompositionStart={() => {
                    composerIsComposing.current = true;
                  }}
                  onCompositionEnd={() => {
                    composerIsComposing.current = false;
                  }}
                  onKeyDown={(event) => {
                    if (
                      shouldSubmitComposerKey(
                        event.nativeEvent || event,
                        composerIsComposing.current,
                      )
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Describe what you want to build or change…"
                />
                <div className="composer-actions">
                  <div>
                    <button
                      type="button"
                      className="icon-button"
                      title="Attach an image"
                      aria-label="Attach an image"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip />
                    </button>
                    <input
                      ref={fileInput}
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      multiple
                      onChange={(event) => setAttachments([...event.target.files])}
                    />
                    <div ref={modeControl} className="mode-control">
                      <button
                        type="button"
                        className="mode-button"
                        aria-label={`Execution mode: ${mode}`}
                        aria-haspopup="menu"
                        aria-expanded={modeMenuOpen}
                        onClick={() => setModeMenuOpen((value) => !value)}
                      >
                        <Sparkle weight="fill" />
                        {mode === "auto" ? "Auto" : "Manual"}
                        <CaretDown />
                      </button>
                      {modeMenuOpen && (
                        <div className="mode-menu" role="menu" aria-label="Execution mode">
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={mode === "auto"}
                            onClick={() => {
                              setMode("auto");
                              setModeMenuOpen(false);
                            }}
                          >
                            <Sparkle weight="fill" />
                            <span>
                              <strong>Auto</strong>
                              <small>Preview, then start workers.</small>
                            </span>
                            {mode === "auto" && <CheckCircle weight="fill" />}
                          </button>
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={mode === "manual"}
                            onClick={() => {
                              setMode("manual");
                              setModeMenuOpen(false);
                            }}
                          >
                            <Info />
                            <span>
                              <strong>Manual</strong>
                              <small>Wait for approval after preview.</small>
                            </span>
                            {mode === "manual" && <CheckCircle weight="fill" />}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="send-button"
                    disabled={!draft.trim() || submitting}
                    aria-label={submitting ? "Creating session" : "Send task"}
                  >
                    <span>{submitting ? "Creating…" : "Send"}</span>
                    {submitting ? <ClockCounterClockwise /> : <ArrowUp weight="bold" />}
                  </button>
                </div>
                <div className="composer-hint">
                  <span>{shortPath(data.repository.path)}</span>
                  <span>
                    <kbd>Enter</kbd> send · <kbd>Shift Enter</kbd> new line · <kbd>⌘ K</kbd> focus
                  </span>
                </div>
              </form>
              {error && (
                <div className="composer-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          )}
        </main>
        {showInspector && (
          <Inspector
            session={selected}
            liveEvents={liveEvents}
            isActive={data.activeSessionIds?.includes(selected.id)}
            stopping={stoppingIds.includes(selected.id)}
            onRun={runSelected}
            onResume={resumeSelected}
            onStop={stopSelected}
            onClose={() => setInspectorOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
