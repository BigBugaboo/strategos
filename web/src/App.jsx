import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  GearSix,
  Paperclip,
  Play,
  PlusSquare,
  SlidersHorizontal,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { quotaLabel } from "./model.js";

const AGENT_COLORS = { claude: "#39d5df", codex: "#9b5cff", copilot: "#a3aab6" };
const DEMO_SESSIONS = [
  ["fs_20260721_1024_e7b1", "Add a simple local Web UI", "running", "2026-07-21T10:24:00+08:00"],
  ["fs_20260720_1642_a910", "Refactor orchestrator", "succeeded", "2026-07-20T16:42:00+08:00"],
  ["fs_20260719_1120_b322", "Add test coverage", "succeeded", "2026-07-19T11:20:00+08:00"],
  ["fs_20260718_1738_c105", "Fix CLI parsing bug", "succeeded", "2026-07-18T17:38:00+08:00"],
  ["fs_20260717_0934_d814", "Improve logging", "succeeded", "2026-07-17T09:34:00+08:00"],
  ["fs_20260716_1441_e201", "Update docs", "succeeded", "2026-07-16T14:41:00+08:00"],
  ["fs_20260714_1059_f672", "Bump dependencies", "succeeded", "2026-07-14T10:59:00+08:00"],
  ["fs_20260712_1815_f832", "Add export command", "succeeded", "2026-07-12T18:15:00+08:00"],
].map(([id, goal, status, createdAt]) => ({
  id,
  goal,
  status,
  createdAt,
  updatedAt: createdAt,
  executionMode: "auto",
  strategist: "codex",
  workerAgents: status === "running" ? ["claude", "codex"] : ["claude", "codex", "copilot"],
  plan:
    id === "fs_20260721_1024_e7b1"
      ? {
          goal,
          tasks: [
            {
              id: "ui-shell",
              agent: "claude",
              mode: "write",
              prompt: "Implement the Web UI shell.",
              dependsOn: [],
            },
            {
              id: "project-setup",
              agent: "codex",
              mode: "write",
              prompt: "Scaffold the Vite+ project.",
              dependsOn: [],
            },
            {
              id: "validation",
              agent: "claude",
              mode: "read-only",
              prompt: "Validate the local integration.",
              dependsOn: ["ui-shell", "project-setup"],
            },
          ],
        }
      : null,
  events:
    id === "fs_20260721_1024_e7b1"
      ? [
          {
            type: "task_started",
            at: "2026-07-21T10:25:12+08:00",
            task: { id: "ui-shell", agent: "claude", status: "running" },
          },
          {
            type: "task_started",
            at: "2026-07-21T10:25:12+08:00",
            task: { id: "project-setup", agent: "codex", status: "running" },
          },
          {
            type: "task_finished",
            at: "2026-07-21T10:25:18+08:00",
            task: {
              id: "ui-shell",
              agent: "claude",
              status: "succeeded",
              changedFiles: ["web/src/App.jsx"],
            },
          },
        ]
      : [],
}));

const DEMO_BOOTSTRAP = {
  version: "0.11.0",
  repository: { name: "Focused Strategos", path: "~/projects/focused-strategos" },
  executionMode: "auto",
  strategist: "codex",
  workerMode: "hybrid",
  excludeExhausted: true,
  capacity: [
    { name: "claude", state: "available", remainingPercent: 72, installed: true, eligible: true },
    { name: "codex", state: "available", remainingPercent: 18, installed: true, eligible: true },
    { name: "copilot", state: "exhausted", remainingPercent: 0, installed: true, eligible: false },
  ],
  sessions: DEMO_SESSIONS,
  activeSessionIds: [DEMO_SESSIONS[0].id],
};

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

function historyDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date("2026-07-21T12:00:00+08:00");
  const delta = Math.floor((now - date) / 86_400_000);
  if (delta === 0) return clock(value);
  if (delta === 1) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
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

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...options?.headers },
    ...options,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function AgentQuota({ agent }) {
  const value = agent.remainingPercent;
  const exhausted = agent.state === "exhausted";
  const label = quotaLabel(agent);
  return (
    <div className={`quota ${exhausted ? "quota-off" : ""}`}>
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
        {sessions.map((session) => (
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
        ))}
      </div>
    </section>
  );
}

function SettingsView({ data, onSaved, demo }) {
  const [mode, setMode] = useState(data.executionMode);
  const [strategist, setStrategist] = useState(data.strategist);
  const [capacity, setCapacity] = useState(() => data.capacity.map((agent) => ({ ...agent })));
  const [message, setMessage] = useState("");
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
    if (demo) {
      onSaved({
        ...data,
        executionMode: mode,
        strategist,
        capacity: capacity.map((agent) => ({
          ...agent,
          eligible: agent.installed && agent.state !== "exhausted",
        })),
      });
    } else {
      const result = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      onSaved({ ...data, ...result });
    }
    setMessage("Settings saved");
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
                              event.target.value === "exhausted" ? 0 : item.remainingPercent,
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
          <button type="submit">Save settings</button>
          <span>{message}</span>
        </div>
      </form>
    </section>
  );
}

function Inspector({ session, liveEvents, onRun, onResume }) {
  const [logsOpen, setLogsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const events = [...(session?.events || []), ...liveEvents].slice(-5);
  const tasks = Object.values(session?.manifest?.tasks || {});
  const activeTasks = tasks.filter((task) => ["preparing", "running"].includes(task.status));
  const files = [...new Set(tasks.flatMap((task) => task.changedFiles || []))];
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
            {activeTasks.length ||
              (session.status === "running" ? session.workerAgents.length : 0)}{" "}
            active
          </span>
        </div>
        {(activeTasks.length
          ? activeTasks
          : session.status === "running"
            ? session.workerAgents.map((agent, index) => ({
                agent,
                id: index ? "Scaffolding project" : "Implementing UI shell",
              }))
            : []
        ).map((task) => (
          <div className="active-task" key={`${task.agent}-${task.id}`}>
            <span className="agent-dot" style={{ background: AGENT_COLORS[task.agent] }} />
            <strong>{task.agent}</strong>
            <span>{task.id}</span>
            <time>{clock(session.updatedAt)}</time>
          </div>
        ))}
        {!activeTasks.length && session.status !== "running" && (
          <p className="quiet">No active workers.</p>
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
        <button onClick={() => setLogsOpen(!logsOpen)}>
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
        <button onClick={() => setFilesOpen(!filesOpen)}>
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
  const demo = new URLSearchParams(window.location.search).has("demo");
  const [data, setData] = useState(demo ? DEMO_BOOTSTRAP : null);
  const [view, setView] = useState("chat");
  const [selectedId, setSelectedId] = useState(demo ? DEMO_SESSIONS[0].id : null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("auto");
  const [attachments, setAttachments] = useState([]);
  const [liveEvents, setLiveEvents] = useState([]);
  const [error, setError] = useState("");
  const fileInput = useRef(null);
  const selected = useMemo(
    () => data?.sessions.find((session) => session.id === selectedId) || null,
    [data, selectedId],
  );

  const refresh = async () => {
    if (demo) return;
    const next = await api("/api/bootstrap");
    setData(next);
    setMode(next.executionMode || "auto");
    setSelectedId((current) => current || next.sessions[0]?.id || null);
  };

  useEffect(() => {
    if (demo) return;
    refresh().catch((requestError) => setError(requestError.message));
  }, []);

  useEffect(() => {
    if (demo || !selectedId) return undefined;
    const source = new EventSource(`/api/events/${selectedId}`);
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
  }, [demo, selectedId]);

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
  };
  const send = async () => {
    const goal = draft.trim();
    if (!goal) return;
    setError("");
    if (demo) {
      const now = new Date().toISOString();
      const session = {
        ...DEMO_SESSIONS[0],
        id: `demo-${Date.now()}`,
        goal,
        createdAt: now,
        updatedAt: now,
        status: "planning",
        executionMode: mode,
        plan: null,
        events: [],
      };
      setData((current) => ({ ...current, sessions: [session, ...current.sessions] }));
      setSelectedId(session.id);
      setDraft("");
      setAttachments([]);
      window.setTimeout(
        () =>
          setData((current) => ({
            ...current,
            sessions: current.sessions.map((item) =>
              item.id === session.id
                ? {
                    ...item,
                    status: mode === "auto" ? "running" : "planned",
                    plan: {
                      goal,
                      tasks: [
                        {
                          id: "implementation",
                          agent: "claude",
                          mode: "write",
                          prompt: "Implement the requested change",
                          dependsOn: [],
                        },
                        {
                          id: "validation",
                          agent: "codex",
                          mode: "read-only",
                          prompt: "Validate behavior and tests",
                          dependsOn: ["implementation"],
                        },
                      ],
                    },
                  }
                : item,
            ),
          })),
        700,
      );
      return;
    }
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
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const runSelected = async () => {
    if (!demo) await api(`/api/sessions/${selected.id}/run`, { method: "POST", body: "{}" });
    refresh().catch(() => {});
  };
  const resumeSelected = async () => {
    if (!demo)
      await api(`/api/sessions/${selected.id}/resume`, {
        method: "POST",
        body: JSON.stringify({ executionMode: mode }),
      });
    refresh().catch(() => {});
  };

  if (!data)
    return (
      <div className="loading-screen">
        <img src="/strategos-icon.png" alt="" />
        <p>{error || "Starting Strategos…"}</p>
      </div>
    );
  const exhausted = data.capacity.filter((agent) => agent.installed && !agent.eligible);
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img src="/strategos-icon.png" alt="Strategos" />
          <strong>{data.repository.name}</strong>
          <span>{shortPath(data.repository.path)}</span>
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
              {data.sessions.slice(0, 9).map((session) => (
                <button
                  key={session.id}
                  className={selectedId === session.id && view === "chat" ? "selected" : ""}
                  onClick={() => selectSession(session)}
                >
                  <span>{session.goal}</span>
                  <time>{historyDate(session.updatedAt)}</time>
                  <i className={`status-${session.status}`} />
                </button>
              ))}
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
            <SettingsView data={data} demo={demo} onSaved={setData} />
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
                  <button className="send-button" onClick={send} disabled={!draft.trim()}>
                    Send <ArrowRight />
                  </button>
                </div>
              </div>
              {error && <div className="composer-error">{error}</div>}
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
