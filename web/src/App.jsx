import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  FolderOpen,
  GearSix,
  Paperclip,
  Play,
  PlusSquare,
  SlidersHorizontal,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { historyDate, quotaLabel, sessionTaskState } from "./model.js";

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
  if (event.type === "session_error") return `Error: ${event.error}`;
  return event.type?.replaceAll("_", " ") || "Session updated";
}

function savedProjectPath() {
  return globalThis.localStorage?.getItem(PROJECT_STORAGE_KEY) || "";
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

function ProjectPicker({ repository, projects, disabled, onSelect, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

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
    <div className="project-picker">
      <div className="project-select-row">
        <FolderOpen />
        <select
          aria-label="Current project"
          value={repository.path}
          disabled={disabled}
          onChange={(event) => void onSelect(event.target.value).catch(() => {})}
        >
          {projects.map((project) => (
            <option key={project.path} value={project.path}>
              {project.name}
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
      <span title={repository.path}>{shortPath(repository.path)}</span>
      {adding && (
        <form className="project-popover" onSubmit={addProject}>
          <label htmlFor="project-path">Local Git repository path</label>
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
    </div>
  );
}

function AgentQuota({ agent }) {
  const value = agent.remainingPercent;
  const exhausted = agent.state === "exhausted";
  const label = quotaLabel(agent);
  return (
    <div
      className={`quota ${exhausted ? "quota-off" : ""}`}
      role="progressbar"
      aria-label={`${agent.name} capacity: ${label}`}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={value ?? undefined}
    >
      <div className="quota-label">
        <span>{agent.name[0].toUpperCase() + agent.name.slice(1)}</span>
        <strong>{label}</strong>
      </div>
      <div className="quota-track">
        <span style={{ width: `${value ?? 0}%`, backgroundColor: AGENT_COLORS[agent.name] }} />
      </div>
    </div>
  );
}

function EmptyChat() {
  return (
    <div className="empty-chat">
      <img src="/strategos-icon.png" alt="Strategos" />
      <h2>What are we building?</h2>
      <p>
        Describe a goal. Strategos will plan it, preview the work, and coordinate your available
        CLIs.
      </p>
    </div>
  );
}

function SessionChat({ session, capacity, liveEvents }) {
  if (!session) return <EmptyChat />;
  const plan = session.plan;
  const participants = [...new Set((plan?.tasks || []).map((task) => task.agent))];
  const excluded = capacity
    .filter((agent) => !agent.eligible && agent.installed)
    .map((agent) => agent.name);
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
          ) : (
            <p className="muted-copy">
              {session.status === "planning"
                ? `${session.strategist} is reading the repository and preparing a plan…`
                : "This session does not have a saved plan yet."}
            </p>
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
                : "Planning in progress."}
            </p>
            {excluded.length > 0 && (
              <p className="subtle">
                {excluded.map((name) => name[0].toUpperCase() + name.slice(1)).join(", ")}{" "}
                {excluded.length > 1 ? "are" : "is"} excluded (out of quota).
              </p>
            )}
            <p className={`run-state state-${session.status}`}>
              <CheckCircle weight="fill" /> {statusLabel(session.status)}
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

function RunsView({ sessions, onSelect }) {
  return (
    <section className="center-page">
      <header>
        <p className="eyebrow">Runs</p>
        <h1>All sessions</h1>
        <p>Plans and execution history saved in this repository.</p>
      </header>
      <div className="run-list">
        {sessions.length ? (
          sessions.map((session) => (
            <button key={session.id} onClick={() => onSelect(session)}>
              <span>
                <strong>{session.goal}</strong>
                <small>{session.id}</small>
              </span>
              <span className={`status-pill status-${session.status}`}>
                {statusLabel(session.status)}
              </span>
              <time>{historyDate(session.updatedAt)}</time>
              <CaretRight />
            </button>
          ))
        ) : (
          <div className="empty-list">
            <ClockCounterClockwise />
            <strong>No sessions yet</strong>
            <span>Your first planned task will appear here.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsView({ data, onSaved }) {
  const [mode, setMode] = useState(data.executionMode);
  const [strategist, setStrategist] = useState(data.strategist);
  const [capacity, setCapacity] = useState(() => data.capacity.map((agent) => ({ ...agent })));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const payload = {
      executionMode: mode,
      strategist,
      capacity: {
        excludeExhausted: true,
        agents: Object.fromEntries(
          capacity.map((agent) => [
            agent.name,
            {
              state: agent.state,
              remainingPercent: agent.remainingPercent,
              resetsAt: agent.resetsAt || null,
            },
          ]),
        ),
      },
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
        <p className="eyebrow">Settings</p>
        <h1>Orchestration</h1>
        <p>Control the default flow and manually record provider quota.</p>
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
            {capacity.map((agent) => (
              <option key={agent.name}>{agent.name}</option>
            ))}
          </select>
        </div>
        <div className="capacity-settings">
          <h2>CLI capacity</h2>
          <p>
            CLIs do not expose one shared quota API. Record the latest known state; exhausted CLIs
            are excluded automatically.
          </p>
          {capacity.map((agent, index) => (
            <div className="capacity-setting" key={agent.name}>
              <span className="agent-dot" style={{ background: AGENT_COLORS[agent.name] }} />
              <strong>{agent.name}</strong>
              <select
                aria-label={`${agent.name} capacity state`}
                value={agent.state}
                onChange={(event) =>
                  setCapacity((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            state: event.target.value,
                            remainingPercent:
                              event.target.value === "exhausted"
                                ? 0
                                : event.target.value === "unknown"
                                  ? null
                                  : item.remainingPercent,
                          }
                        : item,
                    ),
                  )
                }
              >
                <option value="available">Available</option>
                <option value="unknown">Unknown</option>
                <option value="exhausted">Exhausted</option>
              </select>
              <input
                aria-label={`${agent.name} remaining percent`}
                type="number"
                min="0"
                max="100"
                placeholder="% left"
                value={agent.remainingPercent ?? ""}
                onChange={(event) =>
                  setCapacity((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index
                        ? {
                            ...item,
                            state: event.target.value === "" ? "unknown" : "available",
                            remainingPercent:
                              event.target.value === "" ? null : Number(event.target.value),
                          }
                        : item,
                    ),
                  )
                }
              />
            </div>
          ))}
        </div>
        <div className="settings-actions">
          <button type="submit" disabled={saving}>
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

function Inspector({ session, liveEvents, onRun, onResume }) {
  const [logsOpen, setLogsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const events = [...(session?.events || []), ...liveEvents].slice(-5);
  const { activeTasks, changedFiles: files } = sessionTaskState(session, liveEvents);
  if (!session)
    return (
      <aside className="inspector inspector-empty">
        <SlidersHorizontal />
        <p>Select a session to inspect its plan and execution.</p>
      </aside>
    );
  return (
    <aside className="inspector">
      <section className="inspector-section current-run">
        <div className="section-title">
          <h2>Current run</h2>
          <span>
            <i />
            {activeTasks.length} active
          </span>
        </div>
        {activeTasks.map((task) => (
          <div className="active-task" key={`${task.agent}-${task.id}`}>
            <span className="agent-dot" style={{ background: AGENT_COLORS[task.agent] }} />
            <strong>{task.agent}</strong>
            <span>{task.id}</span>
            <time>{clock(session.updatedAt)}</time>
          </div>
        ))}
        {!activeTasks.length && (
          <p className="quiet">
            {session.status === "running" ? "Waiting for worker updates…" : "No active workers."}
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
          {["failed", "interrupted"].includes(session.status) && (
            <button onClick={onResume}>
              <ClockCounterClockwise /> Resume
            </button>
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
  const fileInput = useRef(null);
  const bootstrapped = useRef(false);
  const selected = useMemo(
    () => data?.sessions.find((session) => session.id === selectedId) || null,
    [data, selectedId],
  );

  const refresh = async (projectPath = savedProjectPath(), resetMode = false) => {
    const next = await api("/api/bootstrap", { projectPath });
    const firstLoad = !bootstrapped.current;
    setData(next);
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
      if (parsed.type !== "connected")
        setLiveEvents((items) =>
          [...items, { ...parsed, at: new Date().toISOString() }].slice(-20),
        );
      if (["plan_ready", "session_complete", "session_error", "run_finished"].includes(parsed.type))
        refresh().catch(() => {});
    };
    return () => source.close();
  }, [data?.repository.path, selectedId]);

  const selectProject = async (projectPath) => {
    if (!projectPath || projectPath === data.repository.path || switchingProject) return;
    const previousPath = data.repository.path;
    setSwitchingProject(true);
    setError("");
    setSelectedId(null);
    setLiveEvents([]);
    globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, projectPath);
    try {
      await refresh(projectPath, true);
      setView("chat");
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
    setLiveEvents([]);
  };
  const newTask = () => {
    setSelectedId(null);
    setView("chat");
    setDraft("");
    setAttachments([]);
    setError("");
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
      }));
      setSelectedId(session.id);
      setDraft("");
      setAttachments([]);
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
  const exhausted = data.capacity.filter((agent) => agent.installed && !agent.eligible);
  return (
    <div className={`app-shell ${exhausted.length ? "has-capacity-notice" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <img src="/strategos-icon.png" alt="Strategos" />
          <ProjectPicker
            repository={data.repository}
            projects={data.projects}
            disabled={switchingProject}
            onSelect={selectProject}
            onAdd={addProject}
          />
        </div>
        <div className="quota-strip">
          {data.capacity.map((agent) => (
            <AgentQuota key={agent.name} agent={agent} />
          ))}
        </div>
      </header>
      {exhausted.length > 0 && (
        <div className="capacity-notice">
          <WarningCircle />
          {exhausted
            .map((agent) => agent.name[0].toUpperCase() + agent.name.slice(1))
            .join(", ")}{" "}
          {exhausted.length > 1 ? "are" : "is"} out of quota and will not be used.
        </div>
      )}
      <div className="workspace">
        <aside className="sidebar">
          <nav>
            <button className={view === "chat" && !selected ? "active" : ""} onClick={newTask}>
              <PlusSquare />
              New task
            </button>
            <button className={view === "runs" ? "active" : ""} onClick={() => setView("runs")}>
              <Play />
              Runs
            </button>
            <button
              className={view === "settings" ? "active" : ""}
              onClick={() => setView("settings")}
            >
              <GearSix />
              Settings
            </button>
          </nav>
          <div className="history">
            <h2>History</h2>
            <div className="history-list">
              {data.sessions.length ? (
                data.sessions.slice(0, 9).map((session) => (
                  <button
                    key={session.id}
                    className={selectedId === session.id && view === "chat" ? "selected" : ""}
                    onClick={() => selectSession(session)}
                  >
                    <span>{session.goal}</span>
                    <time>{historyDate(session.updatedAt)}</time>
                    <i className={`status-${session.status}`} />
                  </button>
                ))
              ) : (
                <p className="history-empty">No sessions yet.</p>
              )}
            </div>
            <button className="view-all" onClick={() => setView("runs")}>
              View all sessions <CaretRight />
            </button>
          </div>
        </aside>
        <main className="main-panel">
          {view === "runs" ? (
            <RunsView sessions={data.sessions} onSelect={selectSession} />
          ) : view === "settings" ? (
            <SettingsView data={data} onSaved={setData} />
          ) : (
            <SessionChat session={selected} capacity={data.capacity} liveEvents={liveEvents} />
          )}
          {view === "chat" && (
            <div className="composer-wrap">
              <div className="composer">
                <textarea
                  rows="2"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Describe what you want to build or change…"
                />
                <div className="composer-actions">
                  <div>
                    <button
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
                    <button
                      className="mode-button"
                      aria-label={`Execution mode: ${mode}`}
                      aria-pressed={mode === "manual"}
                      onClick={() => setMode((value) => (value === "auto" ? "manual" : "auto"))}
                    >
                      <Sparkle weight="fill" />
                      {mode === "auto" ? "Auto" : "Manual"}
                      <CaretDown />
                    </button>
                    {attachments.length > 0 && (
                      <span className="attachment-count">
                        {attachments.length} image{attachments.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <button
                    className="send-button"
                    onClick={send}
                    disabled={!draft.trim() || submitting}
                  >
                    {submitting ? "Sending…" : "Send"} <ArrowRight />
                  </button>
                </div>
              </div>
              {error && (
                <div className="composer-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          )}
        </main>
        <Inspector
          session={selected}
          liveEvents={liveEvents}
          onRun={runSelected}
          onResume={resumeSelected}
        />
      </div>
    </div>
  );
}
