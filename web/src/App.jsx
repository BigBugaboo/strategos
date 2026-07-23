import { useEffect, useMemo, useRef, useState } from "react";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import {
  Archive,
  ArrowUp,
  ArrowCounterClockwise,
  CaretDown,
  CaretRight,
  CheckCircle,
  ClockCounterClockwise,
  Cpu,
  DownloadSimple,
  FileCode,
  FolderOpen,
  GearSix,
  GitBranch,
  Info,
  Laptop,
  Paperclip,
  Play,
  PlusSquare,
  PushPin,
  SidebarSimple,
  SlidersHorizontal,
  Sparkle,
  StopCircle,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  findDiffFile,
  historyDate,
  mergeSessionEvents,
  notificationOutcome,
  sessionActivityState,
  sessionFileChanges,
  sessionStartedDate,
  sessionTaskState,
  shouldSubmitComposerKey,
  shouldNotifyForEvent,
  sortSidebarSessions,
} from "./model.js";

const AGENT_COLORS = { claude: "#39d5df", codex: "#9b5cff", copilot: "#a3aab6" };
const PROJECT_STORAGE_KEY = "strategos.selectedProject";
const SOLO_AGENT_STORAGE_KEY = "strategos.soloAgent";
// Only-one mode lets the user pin a single CLI to plan and execute a task alone.
const SOLO_AGENTS = [
  { name: "claude", label: "Claude Code" },
  { name: "codex", label: "Codex CLI" },
];
const SOLO_AGENT_LABELS = Object.fromEntries(SOLO_AGENTS.map((item) => [item.name, item.label]));
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const QUEUE_STORAGE_KEY = "strategos.queue";

function loadQueue() {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(QUEUE_STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
const CLI_GUIDES = [
  { name: "claude", label: "Claude Code", install: "npm install -g @anthropic-ai/claude-code" },
  { name: "codex", label: "Codex CLI", install: "npm install -g @openai/codex" },
  { name: "copilot", label: "GitHub Copilot CLI", install: "npm install -g @github/copilot" },
];

function ConnectionsPanel({ checks, onRecheck, rechecking }) {
  const agents = CLI_GUIDES.map((guide) => {
    const check = (checks || []).find((item) => item.name === guide.name);
    return { ...guide, ok: Boolean(check?.ok), detail: check?.detail };
  });
  return (
    <div className="connections">
      <ul className="connection-list">
        {agents.map((agent) => (
          <li key={agent.name} className={`connection ${agent.ok ? "connected" : ""}`}>
            <span className={`connection-dot ${agent.ok ? "on" : "off"}`} aria-hidden="true" />
            <span className="connection-copy">
              <strong>{agent.label}</strong>
              <small>
                {agent.ok
                  ? agent.detail || "Connected"
                  : `Install and sign in, then re-check · ${agent.install}`}
              </small>
            </span>
            <span className={`connection-status ${agent.ok ? "on" : "off"}`}>
              {agent.ok ? "Connected" : "Not linked"}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="connection-recheck"
        disabled={rechecking}
        onClick={() => void onRecheck()}
      >
        <ArrowCounterClockwise />
        {rechecking ? "Checking…" : "Re-check connections"}
      </button>
    </div>
  );
}

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
      imported: "Imported",
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
  if (event.type === "run_finished") {
    return `Strategos: Run ${event.manifest?.status || event.status || "finished"}`;
  }
  if (event.type === "guidance_added") return `You (guidance): ${event.text}`;
  if (event.type === "native_imported") {
    return `Strategos: Imported ${event.source || "native"} session`;
  }
  if (event.type === "native_resume_started") return `${event.source}: Continuing conversation`;
  if (event.type === "native_resume_finished") {
    if (event.error) return `${event.source}: ${event.error}`;
    return event.report ? `${event.source}: ${event.report}` : `${event.source}: Done`;
  }
  if (event.type === "session_stopping") return "Strategos: Stopping active CLI processes";
  if (event.type === "session_interrupted") return "Strategos: Session stopped";
  if (event.type === "session_error") return `Error: ${event.error}`;
  return event.type?.replaceAll("_", " ") || "Session updated";
}

function savedProjectPath() {
  return globalThis.localStorage?.getItem(PROJECT_STORAGE_KEY) || "";
}

function savedSoloAgent() {
  const value = globalThis.localStorage?.getItem(SOLO_AGENT_STORAGE_KEY) || "";
  return SOLO_AGENT_LABELS[value] ? value : "";
}

// Which CLIs are installed, enabled, and healthy enough to run solo right now.
function healthySoloAgents(data) {
  const enabled = new Set(data?.agents || []);
  const healthy = new Set(
    (data?.checks || []).filter((check) => check.ok).map((check) => check.name),
  );
  return SOLO_AGENTS.filter((item) => enabled.has(item.name) && healthy.has(item.name));
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
  onToggleProject,
  onSelectProject,
  onSelectSession,
  onTogglePin,
  onManage,
}) {
  return (
    <section className="session-browser">
      <div className="sidebar-section-heading">
        <h2>Sessions</h2>
        <button
          type="button"
          className="session-manage-trigger"
          aria-label="Manage sessions"
          title="Manage sessions"
          onClick={onManage}
        >
          <GearSix />
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
                disabled={group.unavailable}
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
          onChange={(event) => void onSelectProject(event.target.value).catch(() => {})}
        >
          {groups.map((group) => (
            <option key={group.path} value={group.path}>
              {group.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

function SessionManager({ groups, onClose, onChanged }) {
  const sourceGroups = useRef(groups);
  const [managedGroups, setManagedGroups] = useState([]);
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState("");
  const [message, setMessage] = useState("");
  const [messageError, setMessageError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dialog = useRef(null);
  const closeButton = useRef(null);
  const previousFocus = useRef(globalThis.document?.activeElement);
  const applyingRef = useRef(applying);
  const onCloseRef = useRef(onClose);
  applyingRef.current = applying;
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      sourceGroups.current
        .filter((group) => !group.unavailable)
        .map(async (group) => ({
          ...group,
          sessions: await api("/api/sessions?includeArchived=true", {
            projectPath: group.path,
          }),
        })),
    )
      .then((nextGroups) => {
        if (!cancelled) setManagedGroups(nextGroups);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setMessage(requestError.message);
          setMessageError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
    const close = (event) => {
      if (event.key === "Escape" && !applyingRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialog.current?.querySelectorAll(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
        ) || []),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && globalThis.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && globalThis.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener("keydown", close);
    return () => {
      globalThis.removeEventListener("keydown", close);
      previousFocus.current?.focus?.();
    };
  }, []);

  const keyFor = (projectPath, sessionId) => `${projectPath}\u0000${sessionId}`;
  const allSessions = managedGroups.flatMap((group) =>
    group.sessions.map((session) => ({
      group,
      session,
      key: keyFor(group.path, session.id),
      active: (group.activeSessionIds || []).includes(session.id),
    })),
  );
  const manageableSessions = allSessions.filter((item) => !item.active);
  const selectedSessions = allSessions.filter((item) => selectedKeys.has(item.key));
  const archiveCount = selectedSessions.filter((item) => !item.session.archivedAt).length;
  const restoreCount = selectedSessions.filter((item) => item.session.archivedAt).length;
  const allSelected =
    manageableSessions.length > 0 && manageableSessions.every((item) => selectedKeys.has(item.key));

  const toggleSession = (key) => {
    setConfirmDelete(false);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setConfirmDelete(false);
    setSelectedKeys(allSelected ? new Set() : new Set(manageableSessions.map((item) => item.key)));
  };

  const applyAction = async (action) => {
    const targets = selectedSessions.filter((item) => {
      if (action === "archive") return !item.session.archivedAt;
      if (action === "restore") return Boolean(item.session.archivedAt);
      return true;
    });
    if (!targets.length || applying) return;
    const byProject = new Map();
    for (const item of targets) {
      const ids = byProject.get(item.group.path) || [];
      ids.push(item.session.id);
      byProject.set(item.group.path, ids);
    }
    setApplying(action);
    setMessage("");
    setMessageError(false);
    try {
      const results = await Promise.all(
        [...byProject].map(async ([projectPath, sessionIds]) => ({
          projectPath,
          response: await api("/api/sessions/batch", {
            projectPath,
            method: "POST",
            body: JSON.stringify({ action, sessionIds }),
          }),
        })),
      );
      setManagedGroups((current) =>
        current.map((group) => {
          const result = results.find((item) => item.projectPath === group.path)?.response;
          if (!result) return group;
          const affected = new Set(result.sessionIds);
          if (action === "delete") {
            return {
              ...group,
              sessions: group.sessions.filter((session) => !affected.has(session.id)),
            };
          }
          const updated = new Map(result.sessions.map((session) => [session.id, session]));
          return {
            ...group,
            sessions: group.sessions.map((session) => updated.get(session.id) || session),
          };
        }),
      );
      onChanged({ action, results });
      setSelectedKeys(new Set());
      setConfirmDelete(false);
      setMessage(
        action === "delete"
          ? `${targets.length} session${targets.length === 1 ? "" : "s"} deleted.`
          : `${targets.length} session${targets.length === 1 ? "" : "s"} ${action === "archive" ? "archived" : "restored"}.`,
      );
    } catch (requestError) {
      setMessage(requestError.message);
      setMessageError(true);
    } finally {
      setApplying("");
    }
  };

  return (
    <div
      className="session-manager-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !applying) onClose();
      }}
    >
      <section
        ref={dialog}
        className="session-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-manager-title"
      >
        <header>
          <span>
            <h2 id="session-manager-title">Manage sessions</h2>
            <p>Archive or remove session history across local projects.</p>
          </span>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close session manager"
            onClick={onClose}
            disabled={Boolean(applying)}
          >
            <X />
          </button>
        </header>
        <div className="session-manager-toolbar">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={!manageableSessions.length || Boolean(applying)}
            />
            <span>
              {selectedSessions.length ? `${selectedSessions.length} selected` : "Select all"}
            </span>
          </label>
          <div>
            <button
              type="button"
              disabled={!archiveCount || Boolean(applying)}
              onClick={() => void applyAction("archive")}
            >
              <Archive /> {applying === "archive" ? "Archiving…" : "Archive"}
            </button>
            <button
              type="button"
              disabled={!restoreCount || Boolean(applying)}
              onClick={() => void applyAction("restore")}
            >
              <ArrowCounterClockwise /> {applying === "restore" ? "Restoring…" : "Restore"}
            </button>
            <button
              type="button"
              className="danger"
              disabled={!selectedSessions.length || Boolean(applying)}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash /> Delete
            </button>
          </div>
        </div>
        <div className="session-manager-list">
          {loading && <p className="session-manager-empty">Loading sessions…</p>}
          {!loading && !allSessions.length && (
            <p className="session-manager-empty">No saved sessions yet.</p>
          )}
          {!loading &&
            managedGroups.map((group) =>
              group.sessions.length ? (
                <section className="session-manager-group" key={group.path}>
                  <h3>
                    {group.name}
                    <small>{shortPath(group.path)}</small>
                  </h3>
                  {sortSidebarSessions(group.sessions).map((session) => {
                    const key = keyFor(group.path, session.id);
                    const active = (group.activeSessionIds || []).includes(session.id);
                    return (
                      <label
                        className={`session-manager-row${active ? " is-active" : ""}`}
                        key={session.id}
                      >
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          disabled={active || Boolean(applying)}
                          onChange={() => toggleSession(key)}
                        />
                        <span>
                          <strong>{session.goal}</strong>
                          <small>
                            {historyDate(session.updatedAt)} · {statusLabel(session.status)}
                          </small>
                        </span>
                        {session.archivedAt && <em>Archived</em>}
                        {active && <em>Active</em>}
                      </label>
                    );
                  })}
                </section>
              ) : null,
            )}
        </div>
        {confirmDelete && (
          <div className="session-delete-confirmation" role="alert">
            <span>
              <strong>
                Delete {selectedSessions.length} session{selectedSessions.length === 1 ? "" : "s"}?
              </strong>
              <small>Session history will be removed. Saved run artifacts stay on disk.</small>
            </span>
            <div>
              <button type="button" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button type="button" className="danger" onClick={() => void applyAction("delete")}>
                Delete permanently
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className={`session-manager-message${messageError ? " is-error" : ""}`} role="status">
            {message}
          </p>
        )}
      </section>
    </div>
  );
}

function ProjectContextBar({
  repository,
  projects,
  disabled,
  selectedBranch,
  onSelectProject,
  onSelectBranch,
  onAdd,
}) {
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false);
  const [projectPath, setProjectPath] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [branches, setBranches] = useState(null);
  const [branchError, setBranchError] = useState("");
  const [branchQuery, setBranchQuery] = useState("");
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const control = useRef(null);
  const branch = selectedBranch || repository.branch || "Branch unavailable";
  const query = branchQuery.trim();
  const filteredBranches = (branches || []).filter((name) =>
    name.toLowerCase().includes(query.toLowerCase()),
  );
  const canCreateBranch = Boolean(query) && !(branches || []).includes(query);

  useEffect(() => {
    if (!menu) return undefined;
    const closeMenu = (event) => {
      if (event.key === "Escape") setMenu(null);
      if (event.type === "pointerdown" && !control.current?.contains(event.target)) setMenu(null);
    };
    globalThis.addEventListener("keydown", closeMenu);
    globalThis.addEventListener("pointerdown", closeMenu);
    return () => {
      globalThis.removeEventListener("keydown", closeMenu);
      globalThis.removeEventListener("pointerdown", closeMenu);
    };
  }, [menu]);

  // A project switch invalidates the cached branch list.
  useEffect(() => {
    setBranches(null);
  }, [repository.path]);

  // Load branches lazily the first time the branch menu opens.
  useEffect(() => {
    if (menu !== "branch" || branches) return undefined;
    let active = true;
    setBranchError("");
    api("/api/branches")
      .then((result) => active && setBranches(result.branches || []))
      .catch((requestError) => active && setBranchError(requestError.message));
    return () => {
      active = false;
    };
  }, [menu, branches]);

  const chooseProject = async (project) => {
    if (project.path !== repository.path) await onSelectProject(project.path);
    setMenu(null);
    setAdding(false);
    setMessage("");
  };

  // Reset the branch search whenever the branch menu is not open.
  useEffect(() => {
    if (menu !== "branch") {
      setBranchQuery("");
      setBranchError("");
    }
  }, [menu]);

  const chooseBranch = (name) => {
    onSelectBranch(name);
    setMenu(null);
  };

  const createBranchHandler = async () => {
    if (!canCreateBranch || creatingBranch) return;
    setCreatingBranch(true);
    setBranchError("");
    try {
      const result = await api("/api/branches", {
        method: "POST",
        body: JSON.stringify({ name: query, from: selectedBranch || undefined }),
      });
      setBranches(result.branches || []);
      onSelectBranch(result.created || query);
      setMenu(null);
    } catch (requestError) {
      setBranchError(requestError.message);
    } finally {
      setCreatingBranch(false);
    }
  };

  const browseDirectory = async () => {
    if (browsing) return;
    setBrowsing(true);
    setMessage("");
    try {
      const result = await api("/api/pick-directory", { method: "POST", body: "{}" });
      if (result.path) setProjectPath(result.path);
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBrowsing(false);
    }
  };

  const addProject = async (event) => {
    event.preventDefault();
    if (!projectPath.trim() || saving) return;
    setSaving(true);
    setMessage("");
    try {
      await onAdd(projectPath.trim());
      setProjectPath("");
      setAdding(false);
      setMenu(null);
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={control} className="project-context-bar">
      <button
        type="button"
        className="project-context-trigger"
        aria-label={`Current project: ${repository.name}`}
        aria-haspopup="menu"
        aria-expanded={menu === "project"}
        disabled={disabled}
        onClick={() => {
          setMenu((value) => (value === "project" ? null : "project"));
          setAdding(false);
          setMessage("");
        }}
      >
        <FolderOpen />
        <span>{repository.name}</span>
        <CaretDown />
      </button>
      <span className="project-context-divider" aria-hidden="true" />
      <span className="project-context-meta" title="Execution environment">
        <Laptop />
        <span>Local</span>
      </span>
      <span className="project-context-divider" aria-hidden="true" />
      <button
        type="button"
        className="project-context-trigger branch"
        aria-label={`Base branch: ${branch}`}
        aria-haspopup="menu"
        aria-expanded={menu === "branch"}
        disabled={disabled}
        title={`Agents branch new work from ${branch}`}
        onClick={() => setMenu((value) => (value === "branch" ? null : "branch"))}
      >
        <GitBranch />
        <span>{branch}</span>
        <CaretDown />
      </button>
      {menu === "project" && (
        <div className="project-context-menu">
          <div className="project-context-menu-heading">Projects</div>
          <div className="project-context-options" role="menu" aria-label="Select project">
            {projects.map((project) => {
              const current = project.path === repository.path;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  disabled={disabled || project.unavailable}
                  key={project.path}
                  onClick={() => void chooseProject(project).catch(() => {})}
                >
                  <FolderOpen weight={current ? "fill" : "regular"} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.unavailable ? "Unavailable" : shortPath(project.path)}</small>
                  </span>
                  {current && <CheckCircle weight="fill" />}
                </button>
              );
            })}
          </div>
          <div className="project-context-menu-footer">
            {adding ? (
              <form onSubmit={addProject}>
                <label htmlFor="composer-project-path">Local repository path</label>
                <div className="project-context-browse-row">
                  <input
                    id="composer-project-path"
                    value={projectPath}
                    disabled={saving}
                    placeholder="/Users/you/projects/repository"
                    onChange={(event) => setProjectPath(event.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="project-context-browse"
                    disabled={saving || browsing}
                    onClick={() => void browseDirectory()}
                  >
                    <FolderOpen />
                    {browsing ? "Opening…" : "Browse"}
                  </button>
                </div>
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
            ) : (
              <button type="button" onClick={() => setAdding(true)}>
                <PlusSquare />
                Add local project
              </button>
            )}
          </div>
        </div>
      )}
      {menu === "branch" && (
        <div className="project-context-menu branch-menu">
          <div className="project-context-menu-heading">Base branch</div>
          <p className="project-context-menu-note">
            Agents create their isolated worktrees from this branch.
          </p>
          <input
            className="project-context-search"
            type="text"
            value={branchQuery}
            placeholder="Search or create a branch…"
            aria-label="Search or create a branch"
            autoFocus
            onChange={(event) => setBranchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canCreateBranch) {
                event.preventDefault();
                void createBranchHandler();
              }
            }}
          />
          <div className="project-context-options" role="menu" aria-label="Select base branch">
            {branchError && (
              <p className="project-context-empty" role="alert">
                {branchError}
              </p>
            )}
            {!branches && !branchError && (
              <p className="project-context-empty">Loading branches…</p>
            )}
            {filteredBranches.map((name) => {
              const current = name === branch;
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  key={name}
                  onClick={() => chooseBranch(name)}
                >
                  <GitBranch weight={current ? "fill" : "regular"} />
                  <span>
                    <strong>{name}</strong>
                  </span>
                  {current && <CheckCircle weight="fill" />}
                </button>
              );
            })}
            {branches && !filteredBranches.length && (
              <p className="project-context-empty">No matching branches.</p>
            )}
          </div>
          <div className="project-context-menu-footer">
            <button
              type="button"
              className="project-context-create"
              disabled={!canCreateBranch || creatingBranch}
              onClick={() => void createBranchHandler()}
            >
              <PlusSquare />
              <span>
                {creatingBranch
                  ? "Creating…"
                  : query
                    ? `Create branch “${query}”`
                    : "Create a new branch"}
                {canCreateBranch && !creatingBranch && <small>Branch from {branch}</small>}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
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

function workerStepLabel(status) {
  if (status === "preparing") return "Preparing an isolated workspace…";
  if (status === "running") return "Working through the task…";
  return "Queued";
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : "Worker";
}

function PromptCard({ prompt, onAnswer }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (value) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(value);
    } finally {
      setSubmitting(false);
    }
  };
  const isText = prompt.kind === "text" || !(prompt.options || []).length;
  return (
    <div className="prompt-card" role="group" aria-label="Agent needs your input">
      <p className="prompt-question">{prompt.question || "The agent needs your input."}</p>
      {isText ? (
        <form
          className="prompt-text"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void submit(text.trim());
          }}
        >
          <input
            value={text}
            autoFocus
            disabled={submitting}
            placeholder={prompt.defaultValue || "Type a response…"}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="submit" disabled={submitting || !text.trim()}>
            Send
          </button>
        </form>
      ) : (
        <div className="prompt-options">
          {(prompt.options || []).map((option) => {
            const value = typeof option === "string" ? option : option.value;
            const label = typeof option === "string" ? option : option.label || option.value;
            return (
              <button
                key={value}
                type="button"
                disabled={submitting}
                onClick={() => void submit(value)}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkerMessage({ task, updatedAt, prompt, onAnswer }) {
  const active = ["preparing", "running"].includes(task.status);
  const done = ["succeeded", "failed", "interrupted", "skipped"].includes(task.status);
  const color = AGENT_COLORS[task.agent] || "#57626f";
  const fileCount = task.changedFiles?.length || 0;
  return (
    <article className={`message worker-message state-${task.status || "queued"}`}>
      <span className="avatar worker-avatar" style={{ background: color }}>
        {capitalize(task.agent)[0]}
      </span>
      <div>
        <div className="message-meta">
          <strong>{capitalize(task.agent)}</strong>
          <small className="worker-task-id">
            {task.mode ? `${task.id} · ${task.mode}` : task.id}
          </small>
          {done && <time>{clock(updatedAt)}</time>}
        </div>
        {done ? (
          <>
            <p className={`run-state state-${task.status}`}>
              {task.status === "succeeded" ? (
                <CheckCircle weight="fill" />
              ) : task.status === "interrupted" ? (
                <StopCircle weight="fill" />
              ) : task.status === "skipped" ? (
                <Info />
              ) : (
                <WarningCircle weight="fill" />
              )}{" "}
              {statusLabel(task.status)}
              {fileCount > 0 && ` · ${fileCount} file${fileCount === 1 ? "" : "s"} changed`}
            </p>
            {task.report ? (
              <div className="worker-report">{task.report}</div>
            ) : task.error ? (
              <p className="worker-error">{task.error}</p>
            ) : (
              <p className="muted-copy">No conclusion was returned.</p>
            )}
          </>
        ) : (
          <>
            <p className="worker-step">
              <span
                className={`worker-step-dot ${active ? "activity-pulse" : ""}`}
                style={{ background: color }}
              />
              {prompt ? "Waiting for your input…" : workerStepLabel(task.status)}
            </p>
            {prompt && (
              <PromptCard
                prompt={prompt}
                onAnswer={(value) => onAnswer(task.id, prompt.id, value)}
              />
            )}
          </>
        )}
      </div>
    </article>
  );
}

function SessionChat({ session, liveEvents, pendingPrompts = {}, onAnswer }) {
  if (!session) return <EmptyChat />;
  const plan = session.plan;
  const { tasks } = sessionTaskState(session, liveEvents);
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
      {tasks.length > 0 && (
        <div className="worker-stream" aria-label="Worker activity">
          {tasks.map((task) => (
            <WorkerMessage
              key={task.id}
              task={task}
              updatedAt={session.updatedAt}
              prompt={pendingPrompts[task.id]}
              onAnswer={onAnswer}
            />
          ))}
        </div>
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

function InteractivePanel({ enabled, onToggle }) {
  const [available, setAvailable] = useState(null);
  const [building, setBuilding] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api("/api/interactive")
      .then((result) => active && setAvailable(Boolean(result.available)))
      .catch(() => active && setAvailable(false));
    return () => {
      active = false;
    };
  }, []);
  const buildHelper = async () => {
    setBuilding(true);
    setMessage("");
    try {
      const result = await api("/api/interactive/enable", { method: "POST", body: "{}" });
      setAvailable(Boolean(result.available));
      setMessage(
        result.ok
          ? "Built. Restart Strategos Web (strategos web restart) to activate, then re-open Settings."
          : `Build failed. ${result.log || ""}`,
      );
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setBuilding(false);
    }
  };
  return (
    <>
      <div className="settings-group-heading">
        <h2>Interactive prompts</h2>
        <p>
          Let worker CLIs (e.g. Codex) pause to ask you for input mid-task. Needs the optional
          native helper <code>node-pty</code> built once.
        </p>
      </div>
      <div className="connection">
        <span className={`connection-dot ${available ? "on" : "off"}`} aria-hidden="true" />
        <span className="connection-copy">
          <strong>Native helper (node-pty)</strong>
          <small>
            {available === null
              ? "Checking…"
              : available
                ? "Built and ready."
                : "Not built. Run npm rebuild node-pty then restart — or let Strategos build it."}
          </small>
        </span>
        {available === false && (
          <button
            type="button"
            className="connection-recheck"
            disabled={building}
            onClick={() => void buildHelper()}
          >
            {building ? "Building…" : "Enable for me"}
          </button>
        )}
        {available && <span className="connection-status on">Ready</span>}
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          Forward interactive prompts
          <small>Route worker questions into this chat and answer them here.</small>
        </span>
        <label className="toggle-control">
          <input
            type="checkbox"
            aria-label="Forward interactive prompts"
            checked={Boolean(enabled)}
            disabled={!available}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span aria-hidden="true" />
          <em>{enabled ? "On" : "Off"}</em>
        </label>
      </div>
      {message && <p className="interactive-message">{message}</p>}
    </>
  );
}

const NATIVE_SOURCE_LABELS = { claude: "Claude Code", codex: "Codex CLI" };

function nativeSessionDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupNativeSessions(sessions) {
  const mine = [];
  const others = new Map();
  for (const session of sessions) {
    if (session.matchesProject) {
      mine.push(session);
      continue;
    }
    const key = session.cwd || "(unknown location)";
    if (!others.has(key)) others.set(key, []);
    others.get(key).push(session);
  }
  return {
    mine,
    others: [...others.entries()].map(([cwd, items]) => ({ cwd, items })),
  };
}

// Discover the user's existing Claude/Codex transcripts and let them adopt any
// as resumable Strategos sessions. Scanning is deferred until the panel opens.
function ImportSessionsPanel({ onImported }) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const load = async () => {
    setLoadError("");
    setSessions(null);
    try {
      const result = await api("/api/native-sessions");
      setSessions(result.sessions || []);
    } catch (requestError) {
      setLoadError(requestError.message);
      setSessions([]);
    }
  };
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && sessions === null) void load();
  };
  const toggleSelected = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const importSelected = async () => {
    if (!selected.size) return;
    setImporting(true);
    setMessage("");
    try {
      const result = await api("/api/native-sessions/import", {
        method: "POST",
        body: JSON.stringify({ ids: [...selected] }),
      });
      const count = result.imported.length;
      setSelected(new Set());
      setMessage(`Imported ${count} session${count === 1 ? "" : "s"}.`);
      await load();
      onImported?.();
    } catch (requestError) {
      setMessage(requestError.message);
    } finally {
      setImporting(false);
    }
  };
  const groups = useMemo(() => groupNativeSessions(sessions || []), [sessions]);
  const renderItem = (session) => (
    <label
      key={session.id}
      className={`native-session ${session.alreadyImported ? "is-imported" : ""}`}
    >
      <input
        type="checkbox"
        disabled={session.alreadyImported || importing}
        checked={selected.has(session.id)}
        onChange={() => toggleSelected(session.id)}
      />
      <span className={`agent-dot`} style={{ background: AGENT_COLORS[session.source] }} />
      <span className="native-session-body">
        <strong>{session.title}</strong>
        <small>
          {NATIVE_SOURCE_LABELS[session.source] || session.source}
          {session.gitBranch ? ` · ${session.gitBranch}` : ""}
          {session.updatedAt ? ` · ${nativeSessionDate(session.updatedAt)}` : ""}
          {session.alreadyImported ? " · Imported" : ""}
        </small>
      </span>
    </label>
  );
  return (
    <>
      <div className="settings-group-heading">
        <h2>Import history</h2>
        <p>
          Bring your existing Claude Code and Codex CLI sessions into Strategos. Importing only
          reads local history; resuming an imported session continues that CLI's own conversation.
        </p>
      </div>
      <div className="settings-row">
        <span className="settings-copy">
          Local CLI sessions
          <small>Scan this machine for Claude and Codex transcripts you can adopt.</small>
        </span>
        <button type="button" className="connection-recheck" onClick={toggleOpen}>
          {open ? "Hide" : "Scan sessions"}
        </button>
      </div>
      {open && (
        <div className="native-sessions">
          {loadError && <p className="settings-status is-error">{loadError}</p>}
          {sessions === null && !loadError && <p className="quiet">Scanning local history…</p>}
          {sessions && sessions.length === 0 && !loadError && (
            <p className="quiet">No Claude or Codex sessions were found on this machine.</p>
          )}
          {groups.mine.length > 0 && (
            <div className="native-session-group">
              <h3>This project</h3>
              {groups.mine.map(renderItem)}
            </div>
          )}
          {groups.others.map((group) => (
            <div className="native-session-group" key={group.cwd}>
              <h3 title={group.cwd}>{shortPath(group.cwd)}</h3>
              {group.items.map(renderItem)}
            </div>
          ))}
          {sessions && sessions.length > 0 && (
            <div className="native-sessions-actions">
              <button
                type="button"
                className="native-import"
                disabled={!selected.size || importing}
                onClick={() => void importSelected()}
              >
                <DownloadSimple />
                {importing ? "Importing…" : `Import selected (${selected.size})`}
              </button>
              {message && (
                <span
                  className={`settings-status${message.startsWith("Imported") ? "" : " is-error"}`}
                  role="status"
                >
                  {message}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function SettingsView({ data, onSaved }) {
  const [mode, setMode] = useState(data.executionMode);
  const [strategist, setStrategist] = useState(data.strategist);
  const [notifications, setNotifications] = useState(() => ({
    enabled: false,
    onSuccess: true,
    onFailure: true,
    ...data.notifications,
  }));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [interactive, setInteractive] = useState(Boolean(data.interactive));
  const [rechecking, setRechecking] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const latestSave = useRef(0);
  const statusTimer = useRef(null);
  const recheckConnections = async () => {
    setRechecking(true);
    try {
      onSaved(await api("/api/bootstrap"));
    } catch {
      // A failed re-check leaves the current status in place.
    } finally {
      setRechecking(false);
    }
  };
  const notificationSupported = "Notification" in globalThis;
  const notificationPermission = notificationSupported
    ? globalThis.Notification.permission
    : "unsupported";
  const desktopNotificationsActive = notifications.enabled && notificationPermission === "granted";
  const persistSettings = (payload) => {
    const saveId = latestSave.current + 1;
    latestSave.current = saveId;
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setSaving(true);
    setMessage("Saving…");
    const request = saveQueue.current.then(() =>
      api("/api/settings", { method: "PUT", body: JSON.stringify(payload) }),
    );
    saveQueue.current = request.catch(() => {});
    request
      .then((result) => {
        onSaved((current) => ({ ...current, ...result }));
        if (saveId !== latestSave.current) return;
        setSaving(false);
        setMessage("Saved");
        statusTimer.current = setTimeout(() => setMessage(""), 1600);
      })
      .catch((requestError) => {
        if (saveId !== latestSave.current) return;
        setSaving(false);
        setMessage(requestError.message);
      });
  };
  const updateNotifications = (patch) => {
    const nextNotifications = { ...notifications, ...patch };
    setNotifications(nextNotifications);
    persistSettings({ executionMode: mode, strategist, notifications: nextNotifications });
  };
  const toggleNotifications = async (enabled) => {
    if (!enabled) {
      updateNotifications({ enabled: false });
      return;
    }
    if (!notificationSupported) {
      setMessage("Desktop notifications are not supported by this browser.");
      return;
    }
    const permission =
      globalThis.Notification.permission === "default"
        ? await globalThis.Notification.requestPermission()
        : globalThis.Notification.permission;
    if (permission !== "granted") {
      setMessage("Notification permission was not granted.");
      return;
    }
    setMessage("");
    updateNotifications({ enabled: true });
  };
  return (
    <section className="center-page settings-page">
      <header>
        <p className="eyebrow">Preferences</p>
        <h1>Orchestration</h1>
        <p>Choose how Strategos plans work and which local CLI leads planning.</p>
      </header>
      <form onSubmit={(event) => event.preventDefault()}>
        <div className="settings-row">
          <label>
            Default mode<small>Auto previews and starts workers immediately.</small>
          </label>
          <select
            aria-label="Default mode"
            value={mode}
            onChange={(event) => {
              const nextMode = event.target.value;
              setMode(nextMode);
              persistSettings({ executionMode: nextMode, strategist, notifications });
            }}
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
            onChange={(event) => {
              const nextStrategist = event.target.value;
              setStrategist(nextStrategist);
              persistSettings({ executionMode: mode, strategist: nextStrategist, notifications });
            }}
          >
            {data.agents.map((agent) => (
              <option key={agent}>{agent}</option>
            ))}
          </select>
        </div>
        <div className="settings-group-heading">
          <h2>Connections</h2>
          <p>Install the coding CLIs you want Strategos to orchestrate, then re-check.</p>
        </div>
        <ConnectionsPanel
          checks={data.checks}
          rechecking={rechecking}
          onRecheck={recheckConnections}
        />
        <InteractivePanel
          enabled={interactive}
          onToggle={(next) => {
            setInteractive(next);
            persistSettings({ executionMode: mode, strategist, notifications, interactive: next });
          }}
        />
        <ImportSessionsPanel onImported={recheckConnections} />
        <div className="settings-group-heading">
          <h2>Notifications</h2>
          <p>Desktop notifications are delivered while this Web UI remains open.</p>
        </div>
        <div className="settings-row">
          <span className="settings-copy">
            Desktop notifications
            <small>
              {notificationPermission === "denied"
                ? "Blocked by the browser. Update the site permission to enable notifications."
                : "Ask the browser to notify you when a task reaches a terminal state."}
            </small>
          </span>
          <label className="toggle-control">
            <input
              type="checkbox"
              aria-label="Desktop notifications"
              checked={desktopNotificationsActive}
              disabled={!notificationSupported || notificationPermission === "denied"}
              onChange={(event) => void toggleNotifications(event.target.checked)}
            />
            <span aria-hidden="true" />
            <em>{desktopNotificationsActive ? "On" : "Off"}</em>
          </label>
        </div>
        <div className="settings-row">
          <span className="settings-copy">
            Successful tasks<small>Notify after all workers finish successfully.</small>
          </span>
          <label className="toggle-control">
            <input
              type="checkbox"
              aria-label="Successful task notifications"
              checked={notifications.onSuccess}
              disabled={!desktopNotificationsActive}
              onChange={(event) => updateNotifications({ onSuccess: event.target.checked })}
            />
            <span aria-hidden="true" />
            <em>{notifications.onSuccess ? "On" : "Off"}</em>
          </label>
        </div>
        <div className="settings-row">
          <span className="settings-copy">
            Failed or interrupted tasks
            <small>Notify when planning or worker execution cannot finish.</small>
          </span>
          <label className="toggle-control">
            <input
              type="checkbox"
              aria-label="Failed or interrupted task notifications"
              checked={notifications.onFailure}
              disabled={!desktopNotificationsActive}
              onChange={(event) => updateNotifications({ onFailure: event.target.checked })}
            />
            <span aria-hidden="true" />
            <em>{notifications.onFailure ? "On" : "Off"}</em>
          </label>
        </div>
        {message && (
          <p
            className={`settings-status${saving || message === "Saved" ? "" : " is-error"}`}
            role="status"
            aria-live="polite"
          >
            {message}
          </p>
        )}
      </form>
    </section>
  );
}

function DiffViewer({ session, change, onClose }) {
  const [viewType, setViewType] = useState("unified");
  const [payload, setPayload] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setPayload(null);
    setRequestError("");
    setLoading(true);
    api(`/api/sessions/${session.id}/diff?task=${encodeURIComponent(change.taskId)}`, {
      projectPath: session.repository,
      signal: controller.signal,
    })
      .then(setPayload)
      .catch((error) => {
        if (error.name !== "AbortError") setRequestError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [change.taskId, session.id, session.repository]);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => globalThis.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const parsed = useMemo(() => {
    if (!payload?.patch) return { file: null, error: "" };
    try {
      const files = parseDiff(payload.patch);
      const file = findDiffFile(files, change.path) || null;
      return {
        file,
        error: !file && files.length ? "This file is not present in the saved patch." : "",
      };
    } catch {
      return { file: null, error: "The saved patch could not be parsed." };
    }
  }, [change.path, payload?.patch]);

  return (
    <section className="diff-workspace" role="dialog" aria-modal="true" aria-label="File diff">
      <header className="diff-toolbar">
        <div>
          <span>Files changed</span>
          <strong>{change.path}</strong>
          <small>
            {change.taskId}
            {change.agent ? ` · ${change.agent}` : ""}
          </small>
        </div>
        <div className="diff-toolbar-actions">
          <div className="diff-view-toggle" aria-label="Diff layout">
            <button
              type="button"
              aria-pressed={viewType === "unified"}
              onClick={() => setViewType("unified")}
            >
              Unified
            </button>
            <button
              type="button"
              aria-pressed={viewType === "split"}
              onClick={() => setViewType("split")}
            >
              Split
            </button>
          </div>
          <button type="button" className="diff-close" aria-label="Close diff" onClick={onClose}>
            <X />
          </button>
        </div>
      </header>
      <div className="diff-content">
        {payload?.truncated && (
          <div className="diff-warning" role="status">
            <WarningCircle /> This large patch was truncated at a complete file boundary.
          </div>
        )}
        {loading && <p className="diff-state">Loading saved diff…</p>}
        {requestError && (
          <p className="diff-state is-error" role="alert">
            {requestError}
          </p>
        )}
        {!loading && !requestError && parsed.error && (
          <p className="diff-state is-error" role="alert">
            {parsed.error}
          </p>
        )}
        {!loading && !requestError && !parsed.file && !parsed.error && (
          <p className="diff-state">
            {payload?.truncated
              ? "This file exceeded the safe preview limit. Its path is still recorded."
              : "No textual diff is available for this file."}
          </p>
        )}
        {parsed.file?.isBinary && (
          <p className="diff-state">Binary file changed. Inline text preview is unavailable.</p>
        )}
        {parsed.file && !parsed.file.isBinary && parsed.file.hunks.length > 0 && (
          <div className="diff-renderer">
            <Diff viewType={viewType} diffType={parsed.file.type} hunks={parsed.file.hunks}>
              {(hunks) =>
                hunks.map((hunk) => <Hunk key={`${hunk.oldStart}-${hunk.newStart}`} hunk={hunk} />)
              }
            </Diff>
          </div>
        )}
      </div>
    </section>
  );
}

function Inspector({
  session,
  liveEvents,
  isActive,
  stopping,
  onRun,
  onResume,
  onStop,
  onOpenDiff,
  onClose,
}) {
  const [logsOpen, setLogsOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => setConfirmStop(false), [session?.id]);
  const events = mergeSessionEvents(session?.events, liveEvents).slice(-5);
  const { activities, detached } = sessionActivityState(session, liveEvents, isActive);
  const files = sessionFileChanges(session, liveEvents);
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
          <dd>{sessionStartedDate(session.createdAt)}</dd>
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
          {session.imported && (
            <>
              <dt>Imported from</dt>
              <dd>
                {NATIVE_SOURCE_LABELS[session.imported.source] || session.imported.source}
                {session.imported.cliVersion ? ` ${session.imported.cliVersion}` : ""}
              </dd>
            </>
          )}
        </dl>
        {session.imported && !isActive && (
          <p className="headless-note">
            Type a follow-up in the message box, then Continue to resume this{" "}
            {NATIVE_SOURCE_LABELS[session.imported.source] || session.imported.source} conversation.
          </p>
        )}
        <div className="session-actions">
          {["planned", "previewed"].includes(session.status) && (
            <button onClick={onRun}>
              <Play weight="fill" /> Run plan
            </button>
          )}
          {session.imported
            ? !isActive && (
                <button onClick={onResume}>
                  <ClockCounterClockwise /> Continue
                </button>
              )
            : (["failed", "interrupted"].includes(session.status) || detached) && (
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
              files.map((file) => (
                <button
                  type="button"
                  className="file-change"
                  key={`${file.taskId}-${file.path}`}
                  disabled={!file.available}
                  title={file.available ? `Open ${file.path} diff` : "Saved diff unavailable"}
                  onClick={() => onOpenDiff(file)}
                >
                  <FileCode />
                  <span>
                    <code>{file.path}</code>
                    <small>
                      {file.taskId}
                      {file.available ? "" : " · Diff unavailable"}
                    </small>
                  </span>
                  <CaretRight />
                </button>
              ))
            ) : (
              <p className="quiet">No saved file changes.</p>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}

function LoadingScreen({ error, leaving = false, onRetry }) {
  return (
    <div
      className={`loading-screen ${leaving ? "is-leaving" : ""}`}
      aria-hidden={leaving || undefined}
    >
      <img src="/strategos-icon.png" alt="" />
      <p className={error ? "loading-error" : "loading-title"}>{error || "Starting Strategos…"}</p>
      {error && !leaving && <button onClick={onRetry}>Retry</button>}
    </div>
  );
}

export function App() {
  const [data, setData] = useState(null);
  const [view, setView] = useState("chat");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("auto");
  const [soloAgent, setSoloAgent] = useState(() => savedSoloAgent());
  const [attachments, setAttachments] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [queue, setQueue] = useState(() => loadQueue());
  const [loaderVisible, setLoaderVisible] = useState(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [recheckingConnections, setRecheckingConnections] = useState(false);
  const [liveEvents, setLiveEvents] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [switchingProject, setSwitchingProject] = useState(false);
  const [stoppingIds, setStoppingIds] = useState([]);
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [diffSelection, setDiffSelection] = useState(null);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const fileInput = useRef(null);
  const composerInput = useRef(null);
  const composerIsComposing = useRef(false);
  const attachmentSeq = useRef(0);
  const queueSeq = useRef(0);
  const draining = useRef(false);
  const modeControl = useRef(null);
  const bootstrapped = useRef(false);
  const notifiedSessions = useRef(new Set());
  const projectSwitch = useRef(null);
  const selected = useMemo(
    () => data?.sessions.find((session) => session.id === selectedId) || null,
    [data, selectedId],
  );
  const projectPath = data?.repository.path;
  // The queue is per project; persist it so a refresh keeps pending items.
  useEffect(() => {
    globalThis.localStorage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);
  const projectQueue = useMemo(
    () => queue.filter((item) => item.projectPath === projectPath),
    [queue, projectPath],
  );
  const hasActiveSessions = (data?.activeSessionIds || []).length > 0;
  // Once every active task finishes, launch the next queued item in order.
  useEffect(() => {
    if (!data || hasActiveSessions || submitting || draining.current) return;
    const next = projectQueue[0];
    if (!next) return;
    draining.current = true;
    setSubmitting(true);
    setQueue((items) => items.filter((item) => item.id !== next.id));
    launchGoal({
      goal: next.text,
      mode: next.mode,
      soloAgent: next.soloAgent,
      baseRef: next.baseRef,
    })
      .catch((requestError) => setError(requestError.message))
      .finally(() => {
        draining.current = false;
        setSubmitting(false);
      });
  }, [data, hasActiveSessions, submitting, projectQueue]);
  // Derive the still-unanswered interactive prompt per task from the live stream.
  const pendingPrompts = useMemo(() => {
    const open = new Map();
    for (const event of liveEvents) {
      if (event.type === "prompt_requested" && event.prompt?.id) {
        open.set(event.prompt.id, {
          ...event.prompt,
          taskId: event.task?.id,
          agent: event.task?.agent,
        });
      } else if (event.type === "prompt_answered" && event.prompt?.id) {
        open.delete(event.prompt.id);
      }
    }
    const byTask = {};
    for (const prompt of open.values()) {
      if (prompt.taskId) byTask[prompt.taskId] = prompt;
    }
    return byTask;
  }, [liveEvents]);
  const answerPrompt = async (taskId, promptId, value) => {
    if (!selectedId) return;
    try {
      await api(`/api/sessions/${selectedId}/tasks/${taskId}/answer`, {
        method: "POST",
        body: JSON.stringify({ promptId, value }),
      });
      setLiveEvents((items) => [
        ...items,
        {
          at: new Date().toISOString(),
          type: "prompt_answered",
          task: { id: taskId },
          prompt: { id: promptId, value },
        },
      ]);
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  useEffect(() => setDiffSelection(null), [data?.repository.path, selectedId, view]);

  useEffect(() => {
    if (!data?.repository.path) return;
    setExpandedProjects((current) => {
      if (current.size) return current;
      return new Set([data.repository.path]);
    });
  }, [data?.repository.path]);

  // The base-branch selection is per project; clear it when the project changes.
  useEffect(() => {
    setSelectedBranch(null);
  }, [data?.repository.path]);

  // Once the first data arrives, let the loading overlay cross-fade out.
  useEffect(() => {
    if (!data) return undefined;
    const timer = globalThis.setTimeout(() => setLoaderVisible(false), 520);
    return () => globalThis.clearTimeout(timer);
  }, [data]);

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

  useEffect(() => {
    if (
      !data?.notifications?.enabled ||
      !("Notification" in globalThis) ||
      globalThis.Notification.permission !== "granted"
    )
      return undefined;
    const projectPath = data.repository.path;
    const project = encodeURIComponent(projectPath);
    const sessions = new Map(data.sessions.map((session) => [session.id, session]));
    const sources = (data.activeSessionIds || []).map((sessionId) => {
      const source = new EventSource(`/api/events/${sessionId}?project=${project}`);
      source.onmessage = (event) => {
        const parsed = JSON.parse(event.data);
        if (!shouldNotifyForEvent(data.notifications, parsed)) return;
        const notificationKey = `${projectPath}:${sessionId}`;
        if (notifiedSessions.current.has(notificationKey)) return;
        const outcome = notificationOutcome(parsed);
        const session = sessions.get(sessionId);
        const title =
          outcome === "success"
            ? "Task completed"
            : parsed.type === "session_interrupted"
              ? "Task interrupted"
              : "Task failed";
        try {
          const notification = new globalThis.Notification(`Strategos · ${title}`, {
            body: session?.goal || `A task in ${data.repository.name} reached a terminal state.`,
            icon: "/strategos-icon.png",
            tag: `strategos-${sessionId}`,
          });
          if (notifiedSessions.current.size >= 200) notifiedSessions.current.clear();
          notifiedSessions.current.add(notificationKey);
          notification.onclick = () => {
            globalThis.focus?.();
            notification.close();
          };
        } catch {
          // Browser notification delivery is best effort.
        }
      };
      return source;
    });
    return () => sources.forEach((source) => source.close());
  }, [
    data?.repository.path,
    data?.repository.name,
    data?.activeSessionIds,
    data?.sessions,
    data?.notifications,
  ]);

  const selectProject = async (projectPath, nextSelectedId = null) => {
    if (!projectPath) return;
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
    const cached = sidebarGroupsFor(data).find((group) => group.path === projectPath);
    projectSwitch.current = projectPath;
    setSwitchingProject(!cached || cached.unavailable);
    setError("");
    setLiveEvents([]);
    setModeMenuOpen(false);
    setDraft("");
    setAttachments([]);
    setView("chat");
    globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, projectPath);
    // Switch instantly using the already-loaded project group so the click
    // never waits on the bootstrap round-trip (and its CLI health checks).
    if (cached && !cached.unavailable) {
      const { sessions: cachedSessions, activeSessionIds: cachedActive, ...project } = cached;
      setData((current) => ({
        ...current,
        repository: project,
        sessions: cachedSessions || [],
        activeSessionIds: cachedActive || [],
      }));
      setSelectedId(nextSelectedId);
    } else {
      setSelectedId(null);
    }
    // Reconcile with the server in the background, ignoring the response when a
    // newer switch has already superseded this one.
    try {
      const next = await api("/api/bootstrap", { projectPath });
      if (projectSwitch.current !== projectPath) return;
      setData(next);
      setMode(next.executionMode || "auto");
      setStoppingIds((items) => items.filter((id) => (next.activeSessionIds || []).includes(id)));
      setSelectedId((current) =>
        current && next.sessions.some((session) => session.id === current) ? current : null,
      );
    } catch (requestError) {
      if (projectSwitch.current !== projectPath) return;
      projectSwitch.current = previousPath;
      globalThis.localStorage?.setItem(PROJECT_STORAGE_KEY, previousPath);
      setError(requestError.message);
      await refresh(previousPath, true).catch(() => {});
      throw requestError;
    } finally {
      if (projectSwitch.current === projectPath) setSwitchingProject(false);
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
  const applyManagedChanges = ({ action, results }) => {
    setData((current) => {
      const nextGroups = sidebarGroupsFor(current).map((group) => {
        const result = results.find((item) => item.projectPath === group.path)?.response;
        if (!result) return group;
        const affected = new Set(result.sessionIds);
        const remaining = group.sessions.filter((session) => !affected.has(session.id));
        return {
          ...group,
          sessions: action === "restore" ? [...result.sessions, ...remaining] : remaining,
        };
      });
      const currentGroup = nextGroups.find((group) => group.path === current.repository.path);
      return {
        ...current,
        sessionGroups: nextGroups,
        sessions: currentGroup?.sessions || [],
      };
    });
    if (action !== "restore") {
      const currentResult = results.find((item) => item.projectPath === data.repository.path);
      if (selectedId && currentResult?.response.sessionIds.includes(selectedId)) {
        setSelectedId(null);
        setLiveEvents([]);
        setDiffSelection(null);
      }
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
  const soloOptions = healthySoloAgents(data);
  // Drop a remembered pin if that CLI is no longer available.
  const activeSolo =
    soloAgent && soloOptions.some((item) => item.name === soloAgent) ? soloAgent : "";
  const chooseExecutionMode = (nextMode) => {
    setMode(nextMode);
    setSoloAgent("");
    globalThis.localStorage?.removeItem(SOLO_AGENT_STORAGE_KEY);
    setModeMenuOpen(false);
  };
  const chooseSoloAgent = (name) => {
    setSoloAgent(name);
    globalThis.localStorage?.setItem(SOLO_AGENT_STORAGE_KEY, name);
    setModeMenuOpen(false);
  };
  const uploadAttachments = async (files) => {
    const attachmentPaths = [];
    for (const file of files) {
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
    return attachmentPaths;
  };
  const launchGoal = async ({
    goal,
    mode: goalMode,
    soloAgent: goalSolo,
    baseRef,
    attachmentPaths = [],
  }) => {
    const session = await api("/api/goals", {
      method: "POST",
      body: JSON.stringify({
        goal,
        executionMode: goalSolo ? "auto" : goalMode,
        soloAgent: goalSolo || undefined,
        attachmentPaths,
        baseRef: baseRef || undefined,
      }),
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
    return session;
  };
  const send = async () => {
    const goal = draft.trim();
    if (!goal || submitting) return;
    setError("");
    // While tasks are running, hold new input in the queue instead of launching
    // it immediately; it runs after the active tasks finish (or can be used as
    // guidance / edited from the queue).
    if (hasActiveSessions) {
      queueSeq.current += 1;
      const item = {
        id: `q-${Date.now()}-${queueSeq.current}`,
        projectPath,
        text: goal,
        mode,
        soloAgent: activeSolo || null,
        baseRef: selectedBranch || null,
      };
      setQueue((items) => [...items, item]);
      setDraft("");
      setModeMenuOpen(false);
      if (attachments.length) {
        setError("Queued the text; re-attach images when it runs (attachments aren't queued).");
      }
      setAttachments([]);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setSubmitting(true);
    try {
      const attachmentPaths = await uploadAttachments(attachments);
      await launchGoal({
        goal,
        mode,
        soloAgent: activeSolo,
        baseRef: selectedBranch,
        attachmentPaths,
      });
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
  const removeQueued = (id) => setQueue((items) => items.filter((item) => item.id !== id));
  const editQueued = (item) => {
    setDraft(item.text);
    setMode(item.mode || "auto");
    setSoloAgent(item.soloAgent || "");
    setSelectedBranch(item.baseRef || null);
    removeQueued(item.id);
    globalThis.setTimeout(() => composerInput.current?.focus(), 0);
  };
  const guideQueued = async (item) => {
    setError("");
    try {
      const result = await api("/api/guidance", {
        method: "POST",
        body: JSON.stringify({ text: item.text }),
      });
      removeQueued(item.id);
      if (!result.delivered) {
        setError("No active tasks to guide right now.");
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const addImageFiles = (files) => {
    const images = [...files].filter((file) => file && file.type.startsWith("image/"));
    if (!images.length) return;
    const supported = images.filter((file) => IMAGE_MIME_TYPES.includes(file.type));
    if (!supported.length) {
      setError("Images must be PNG, JPEG, GIF, or WebP.");
      return;
    }
    const named = supported.map((file) => {
      if (file.name) return file;
      attachmentSeq.current += 1;
      const extension = file.type.slice("image/".length);
      return new File([file], `pasted-image-${attachmentSeq.current}.${extension}`, {
        type: file.type,
      });
    });
    setError("");
    setAttachments((current) => [...current, ...named]);
  };
  const pasteComposer = (event) => {
    const items = [...(event.clipboardData?.items || [])];
    const files = items
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile());
    if (!files.length) return;
    event.preventDefault();
    addImageFiles(files);
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
    // Imported native sessions continue their original CLI conversation, so they
    // need a follow-up instruction. Reuse whatever is typed in the composer.
    if (selected.imported) {
      const followUp = draft.trim();
      if (!followUp) {
        setError(
          "Type a follow-up instruction in the message box, then Resume to continue this imported session.",
        );
        return;
      }
      try {
        await api(`/api/sessions/${selected.id}/resume`, {
          method: "POST",
          body: JSON.stringify({ goal: followUp }),
        });
        setDraft("");
        await refresh();
      } catch (requestError) {
        setError(requestError.message);
      }
      return;
    }
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
      <LoadingScreen
        error={error}
        onRetry={() => refresh().catch((requestError) => setError(requestError.message))}
      />
    );
  const showInspector = inspectorOpen && selected && view === "chat";
  const connectedCount = (data.checks || []).filter(
    (check) => CLI_GUIDES.some((guide) => guide.name === check.name) && check.ok,
  ).length;
  const showOnboarding = connectedCount === 0 && !onboardingDismissed;
  const recheckConnections = async () => {
    setRecheckingConnections(true);
    try {
      await refresh();
    } catch {
      // Keep the current status if the re-check request fails.
    } finally {
      setRecheckingConnections(false);
    }
  };
  return (
    <div className={`app-shell ${showInspector ? "" : "inspector-closed"}`}>
      {loaderVisible && <LoadingScreen leaving />}
      {showOnboarding && (
        <div
          className="onboarding-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Connect a coding CLI"
        >
          <div className="onboarding-modal">
            <img src="/strategos-icon.png" alt="" />
            <h2>Connect a coding CLI</h2>
            <p>
              Strategos orchestrates the agent CLIs already installed on your machine. Install at
              least one, sign in, then re-check to get started.
            </p>
            <ConnectionsPanel
              checks={data.checks}
              rechecking={recheckingConnections}
              onRecheck={recheckConnections}
            />
            <button
              type="button"
              className="onboarding-dismiss"
              onClick={() => setOnboardingDismissed(true)}
            >
              I’ll do this later
            </button>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="brand">
          <img src="/strategos-icon.png" alt="Strategos" />
          <div>
            <strong>Strategos</strong>
            <span>One plan. Every agent aligned.</span>
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
            onToggleProject={toggleProject}
            onSelectProject={selectProject}
            onSelectSession={selectGroupedSession}
            onTogglePin={togglePin}
            onManage={() => {
              setSessionManagerOpen(true);
              setModeMenuOpen(false);
            }}
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
            <SettingsView key={data.repository.path} data={data} onSaved={setData} />
          ) : (
            <SessionChat
              session={selected}
              liveEvents={liveEvents}
              pendingPrompts={pendingPrompts}
              onAnswer={answerPrompt}
            />
          )}
          {view === "chat" && (
            <div className={`composer-wrap ${selected ? "" : "with-project-context"}`}>
              {!selected && (
                <ProjectContextBar
                  repository={data.repository}
                  projects={sidebarGroupsFor(data)}
                  disabled={switchingProject}
                  selectedBranch={selectedBranch}
                  onSelectProject={selectProject}
                  onSelectBranch={setSelectedBranch}
                  onAdd={addProject}
                />
              )}
              <div className="composer-row">
                {projectQueue.length > 0 && (
                  <aside className="queue-rail" aria-label="Queued messages">
                    <div className="queue-rail-heading">
                      <ClockCounterClockwise />
                      <span>Queued · {projectQueue.length}</span>
                    </div>
                    <ol className="queue-list">
                      {projectQueue.map((item, index) => (
                        <li key={item.id} className="queue-item">
                          <span className="queue-index">{index + 1}</span>
                          <p className="queue-text" title={item.text}>
                            {item.text}
                          </p>
                          <div className="queue-actions">
                            <button
                              type="button"
                              title="Send now as guidance to running tasks"
                              aria-label="Guide running tasks with this"
                              onClick={() => void guideQueued(item)}
                            >
                              <Sparkle weight="fill" />
                            </button>
                            <button
                              type="button"
                              title="Edit in the composer"
                              aria-label="Edit this queued message"
                              onClick={() => editQueued(item)}
                            >
                              <Info />
                            </button>
                            <button
                              type="button"
                              title="Remove from queue"
                              aria-label="Remove this queued message"
                              onClick={() => removeQueued(item.id)}
                            >
                              <X />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </aside>
                )}
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
                        <span key={`${file.name}-${file.lastModified}-${index}`}>
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
                    onPaste={pasteComposer}
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
                    placeholder={
                      hasActiveSessions
                        ? "A task is running — this will be queued for when it finishes…"
                        : "Describe what you want to build or change…"
                    }
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
                        accept={IMAGE_MIME_TYPES.join(",")}
                        multiple
                        onChange={(event) => {
                          addImageFiles(event.target.files);
                          event.target.value = "";
                        }}
                      />
                      <div ref={modeControl} className="mode-control">
                        <button
                          type="button"
                          className="mode-button"
                          aria-label={`Execution mode: ${activeSolo ? `only ${activeSolo}` : mode}`}
                          aria-haspopup="menu"
                          aria-expanded={modeMenuOpen}
                          onClick={() => setModeMenuOpen((value) => !value)}
                        >
                          {activeSolo ? <Cpu weight="fill" /> : <Sparkle weight="fill" />}
                          {activeSolo
                            ? `Only One · ${SOLO_AGENT_LABELS[activeSolo]}`
                            : mode === "auto"
                              ? "Auto"
                              : "Manual"}
                          <CaretDown />
                        </button>
                        {modeMenuOpen && (
                          <div className="mode-menu" role="menu" aria-label="Execution mode">
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={!activeSolo && mode === "auto"}
                              onClick={() => chooseExecutionMode("auto")}
                            >
                              <Sparkle weight="fill" />
                              <span>
                                <strong>Auto</strong>
                                <small>Preview, then start workers.</small>
                              </span>
                              {!activeSolo && mode === "auto" && <CheckCircle weight="fill" />}
                            </button>
                            <button
                              type="button"
                              role="menuitemradio"
                              aria-checked={!activeSolo && mode === "manual"}
                              onClick={() => chooseExecutionMode("manual")}
                            >
                              <Info />
                              <span>
                                <strong>Manual</strong>
                                <small>Wait for approval after preview.</small>
                              </span>
                              {!activeSolo && mode === "manual" && <CheckCircle weight="fill" />}
                            </button>
                            {soloOptions.length > 0 && (
                              <div className="mode-menu-group" role="group" aria-label="Only One">
                                <span className="mode-menu-label">
                                  <Cpu weight="fill" />
                                  <span>
                                    <strong>Only One</strong>
                                    <small>Pin one CLI to plan and run alone.</small>
                                  </span>
                                </span>
                                {soloOptions.map((option) => (
                                  <button
                                    key={option.name}
                                    type="button"
                                    role="menuitemradio"
                                    className="mode-menu-nested"
                                    aria-checked={activeSolo === option.name}
                                    onClick={() => chooseSoloAgent(option.name)}
                                  >
                                    <span
                                      className="agent-dot"
                                      style={{ background: AGENT_COLORS[option.name] }}
                                      aria-hidden="true"
                                    />
                                    <span>
                                      <strong>{option.label}</strong>
                                    </span>
                                    {activeSolo === option.name && <CheckCircle weight="fill" />}
                                  </button>
                                ))}
                              </div>
                            )}
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
                    <span>
                      <kbd>Enter</kbd> send · <kbd>Shift Enter</kbd> new line · <kbd>⌘ V</kbd> paste
                      image
                    </span>
                  </div>
                </form>
              </div>
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
            onOpenDiff={setDiffSelection}
            onClose={() => setInspectorOpen(false)}
          />
        )}
        {selected && diffSelection && (
          <DiffViewer
            session={selected}
            change={diffSelection}
            onClose={() => setDiffSelection(null)}
          />
        )}
      </div>
      {sessionManagerOpen && (
        <SessionManager
          groups={sidebarGroupsFor(data)}
          onClose={() => setSessionManagerOpen(false)}
          onChanged={applyManagedChanges}
        />
      )}
    </div>
  );
}
