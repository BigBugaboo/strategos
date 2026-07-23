import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startWebServer } from "../src/web-server.js";

function memorySessionStore(repository, initial = []) {
  let sequence = initial.length;
  const sessions = new Map(initial.map((session) => [session.id, session]));
  return {
    async list({ includeArchived = false } = {}) {
      return [...sessions.values()].filter((session) => includeArchived || !session.archivedAt);
    },
    async load(id) {
      return sessions.get(id);
    },
    async create(input) {
      sequence += 1;
      const session = {
        id: `session-${sequence}`,
        repository,
        attempts: 1,
        events: [],
        ...input,
        status: "planning",
      };
      sessions.set(session.id, session);
      return session;
    },
    async update(session, patch) {
      const updated = { ...session, ...patch };
      sessions.set(updated.id, updated);
      return updated;
    },
    async setPinned(session, pinned) {
      const updated = { ...session, pinned };
      sessions.set(updated.id, updated);
      return updated;
    },
    async setArchived(session, archived) {
      const updated = {
        ...session,
        archivedAt: archived ? "2026-07-22T00:00:00.000Z" : null,
      };
      sessions.set(updated.id, updated);
      return updated;
    },
    async remove(session) {
      sessions.delete(session.id);
      return session.id;
    },
    async appendEvent(session, event) {
      return this.update(session, { events: [...(session.events || []), event] });
    },
    async importSession({ source, descriptor }) {
      sequence += 1;
      const session = {
        id: `session-${sequence}`,
        repository,
        goal: descriptor.title,
        strategist: source,
        workerAgents: [source],
        soloAgent: source,
        status: "imported",
        attempts: 1,
        events: [],
        imported: {
          source,
          nativeSessionId: descriptor.nativeSessionId,
          cwd: descriptor.cwd || null,
          title: descriptor.title || null,
        },
      };
      sessions.set(session.id, session);
      return session;
    },
  };
}

async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-web-test-"));
  const secondRoot = path.join(root, "second-project");
  const webRoot = path.join(root, "dist");
  await fs.mkdir(webRoot, { recursive: true });
  await fs.writeFile(path.join(webRoot, "index.html"), "<main>Strategos Web</main>");
  const config = {
    executionMode: "auto",
    strategist: "codex",
    workerMode: "hybrid",
    notifications: { enabled: false, onSuccess: true, onFailure: true },
    agents: { claude: {}, codex: {}, copilot: {} },
  };
  const sessionStore = memorySessionStore(root);
  const secondSession = {
    id: "second-session",
    repository: secondRoot,
    goal: "Work in the second project",
    status: "planned",
    events: [],
  };
  const secondSessionStore = memorySessionStore(secondRoot, [secondSession]);
  const planningRoots = [];
  const projects = [
    { name: path.basename(root), path: root },
    { name: path.basename(secondRoot), path: secondRoot },
  ];
  const projectRegistry = {
    list: async () => projects,
    resolve: async (projectPath) => {
      const project = projects.find((item) => item.path === (projectPath || root));
      if (!project) throw Object.assign(new Error("project is not registered"), { status: 403 });
      return project;
    },
  };
  const result = await startWebServer({
    root,
    webRoot,
    port: 0,
    version: "test",
    loadConfigFn: async () => config,
    saveConfigFn: async (_root, next) => Object.assign(config, next),
    runDoctorFn: async () => [
      { name: "git", ok: true, detail: "git" },
      { name: "node", ok: true, detail: "node" },
      { name: "claude", ok: true, detail: "claude" },
      { name: "codex", ok: true, detail: "codex" },
      { name: "copilot", ok: true, detail: "copilot" },
    ],
    sessionStore,
    createSessionStoreFn: (projectRoot) => projectRoot === secondRoot ? secondSessionStore : sessionStore,
    currentBranchFn: async (projectRoot) => projectRoot === secondRoot ? "feature/second" : "main",
    listBranchesFn: async (projectRoot) =>
      projectRoot === secondRoot
        ? ["feature/second"]
        : ["main", "feature/review", "strategos/run/task"],
    createBranchFn: overrides.createBranchFn,
    pickDirectoryFn: overrides.pickDirectoryFn,
    projectRegistry,
    planWithStrategistFn: overrides.planWithStrategistFn || (async (input) => {
      planningRoots.push(input.root);
      return {
        version: 1,
        goal: input.goal,
        context: [],
        tasks: [{
          id: "review",
          agent: "codex",
          mode: "read-only",
          prompt: "Review the selected project.",
          dependsOn: [],
        }],
      };
    }),
    runPlanFn: overrides.runPlanFn,
    scanNativeSessionsFn: overrides.scanNativeSessionsFn,
    runCommandFn: overrides.runCommandFn,
  });
  t.after(async () => {
    result.server.closeAllConnections();
    await new Promise((resolve) => result.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { ...result, root, secondRoot, planningRoots, sessionStore };
}

test("Web bootstrap exposes repository, sessions, and configured agents", async (t) => {
  const { url, root } = await fixture(t);
  const response = await fetch(`${url}/api/bootstrap`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.repository, { name: path.basename(root), path: root, branch: "main" });
  assert.equal(body.projects.length, 2);
  assert.equal(body.projects[1].branch, "feature/second");
  assert.equal(body.sessionGroups.length, 2);
  assert.equal(body.sessionGroups[1].sessions[0].goal, "Work in the second project");
  assert.deepEqual(body.agents, ["claude", "codex", "copilot"]);
  assert.deepEqual(body.notifications, { enabled: false, onSuccess: true, onFailure: true });
  assert.deepEqual(body.sessions, []);
});

test("Web branch selection validates and persists the task base ref", async (t) => {
  const { url } = await fixture(t);
  const branches = await fetch(`${url}/api/branches`);
  assert.equal(branches.status, 200);
  assert.deepEqual(await branches.json(), {
    current: "main",
    branches: ["main", "feature/review"],
  });

  const created = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Review from the selected base",
      executionMode: "manual",
      baseRef: "feature/review",
    }),
  });
  assert.equal(created.status, 202);
  assert.equal((await created.json()).baseRef, "feature/review");

  const rejected = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Use an invalid branch", baseRef: "missing" }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /unknown branch/);
});

test("Web can create a base branch and open the local directory picker", async (t) => {
  const createdBranches = [];
  const { url, root, secondRoot } = await fixture(t, {
    createBranchFn: async (...input) => createdBranches.push(input),
    pickDirectoryFn: async () => secondRoot,
  });

  const created = await fetch(`${url}/api/branches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "feature/web-picker", from: "feature/review" }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).created, "feature/web-picker");
  assert.deepEqual(createdBranches, [[root, "feature/web-picker", "feature/review"]]);

  const invalid = await fetch(`${url}/api/branches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "invalid branch" }),
  });
  assert.equal(invalid.status, 400);

  const picked = await fetch(`${url}/api/pick-directory`, { method: "POST" });
  assert.equal(picked.status, 200);
  assert.deepEqual(await picked.json(), { path: secondRoot });
});

test("Web settings persist normalized task notification preferences", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      executionMode: "manual",
      strategist: "claude",
      notifications: { enabled: true, onSuccess: false },
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).notifications, {
    enabled: true,
    onSuccess: false,
    onFailure: true,
  });

  const bootstrap = await fetch(`${url}/api/bootstrap`);
  assert.deepEqual((await bootstrap.json()).notifications, {
    enabled: true,
    onSuccess: false,
    onFailure: true,
  });
});

test("Web sessions can be pinned without changing projects", async (t) => {
  const { url, secondRoot } = await fixture(t);
  const response = await fetch(`${url}/api/sessions/second-session/pin`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-strategos-project": secondRoot,
    },
    body: JSON.stringify({ pinned: true }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pinned, true);

  const bootstrap = await fetch(`${url}/api/bootstrap`);
  const groups = (await bootstrap.json()).sessionGroups;
  assert.equal(groups.find((group) => group.path === secondRoot).sessions[0].pinned, true);
});

test("Web sessions can be archived, restored, and deleted in batches", async (t) => {
  const { url, secondRoot } = await fixture(t);
  const headers = {
    "content-type": "application/json",
    "x-strategos-project": secondRoot,
  };
  const manage = (action) =>
    fetch(`${url}/api/sessions/batch`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action, sessionIds: ["second-session"] }),
    });

  const archived = await manage("archive");
  assert.equal(archived.status, 200);
  assert.equal((await archived.json()).sessions[0].archivedAt !== null, true);

  const visible = await fetch(`${url}/api/sessions`, { headers });
  assert.equal((await visible.json()).length, 0);
  const includingArchived = await fetch(`${url}/api/sessions?includeArchived=true`, { headers });
  assert.equal((await includingArchived.json())[0].id, "second-session");

  const restored = await manage("restore");
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).sessions[0].archivedAt, null);
  assert.equal((await (await fetch(`${url}/api/sessions`, { headers })).json()).length, 1);

  const deleted = await manage("delete");
  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).sessionIds, ["second-session"]);
  assert.equal((await fetch(`${url}/api/sessions/second-session`, { headers })).status, 404);
});

test("Web session batch management rejects active sessions", async (t) => {
  const { url } = await fixture(t, {
    planWithStrategistFn: async () => new Promise(() => {}),
  });
  const created = await (
    await fetch(`${url}/api/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "Keep this session active", executionMode: "manual" }),
    })
  ).json();

  const response = await fetch(`${url}/api/sessions/batch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", sessionIds: [created.id] }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /active session cannot be managed/);
});

test("Web sessions expose only their persisted task diff", async (t) => {
  const { url, root, sessionStore } = await fixture(t);
  const runId = "20260722T120000Z-abcd";
  const taskId = "implementation";
  const patch = [
    "diff --git a/src/example.js b/src/example.js",
    "new file mode 100644",
    "index 0000000..2e65efe",
    "--- /dev/null",
    "+++ b/src/example.js",
    "@@ -0,0 +1 @@",
    "+export const ready = true;",
    "",
  ].join("\n");
  const artifactDir = path.join(root, ".strategos", "runs", runId, taskId);
  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(path.join(artifactDir, "changes.diff"), patch, "utf8");
  const session = await sessionStore.create({ goal: "Inspect a diff" });
  await sessionStore.update(session, {
    runId,
    manifest: {
      tasks: {
        [taskId]: {
          changedFiles: ["src/example.js"],
          diff: { available: true, bytes: Buffer.byteLength(patch), truncated: false },
        },
      },
    },
  });

  const response = await fetch(`${url}/api/sessions/${session.id}/diff?task=${taskId}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    taskId,
    files: ["src/example.js"],
    patch,
    bytes: Buffer.byteLength(patch),
    truncated: false,
  });

  const traversal = await fetch(`${url}/api/sessions/${session.id}/diff?task=..%2Fevil`);
  assert.equal(traversal.status, 400);
});

test("Web APIs scope sessions to the selected registered project", async (t) => {
  const { url, secondRoot, planningRoots } = await fixture(t);
  const response = await fetch(`${url}/api/bootstrap`, {
    headers: { "x-strategos-project": secondRoot },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.repository, {
    name: "second-project",
    path: secondRoot,
    branch: "feature/second",
  });
  assert.equal(body.sessions[0].goal, "Work in the second project");

  const unregistered = await fetch(`${url}/api/bootstrap`, {
    headers: { "x-strategos-project": path.join(secondRoot, "unregistered") },
  });
  assert.equal(unregistered.status, 403);

  const goal = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-strategos-project": secondRoot,
    },
    body: JSON.stringify({ goal: "Review this repository", executionMode: "manual" }),
  });
  assert.equal(goal.status, 202);
  for (let attempt = 0; attempt < 20 && !planningRoots.length; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(planningRoots, [secondRoot]);
});

test("Web server serves the built single-page application", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/some/client/route`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Strategos Web/);
});

test("Web planning persists the headless strategist activity", async (t) => {
  const { url } = await fixture(t);
  const response = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Plan a visible CLI activity", executionMode: "manual" }),
  });
  assert.equal(response.status, 202);
  const created = await response.json();
  let session;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await fetch(`${url}/api/sessions/${created.id}`);
    session = await current.json();
    if (session.status === "planned") break;
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(session.status, "planned");
  const planning = session.events.find((event) => event.type === "planning_started");
  assert.equal(planning.strategist, "codex");
  assert.deepEqual(planning.workerAgents, ["claude", "codex", "copilot"]);
  assert.match(planning.at, /^2026-/);
});

test("Web only-one mode pins a single CLI and forces auto execution", async (t) => {
  const { url } = await fixture(t, {
    planWithStrategistFn: async (input) => ({
      version: 1,
      goal: input.goal,
      context: [],
      tasks: [{
        id: "solo",
        agent: "claude",
        mode: "read-only",
        prompt: "Plan and run alone.",
        dependsOn: [],
      }],
    }),
    runPlanFn: async () => ({ runId: "solo-run", manifest: { status: "succeeded", tasks: [] } }),
  });

  const response = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // manual is requested but must be overridden to auto for only-one mode.
    body: JSON.stringify({ goal: "Ship it alone", executionMode: "manual", soloAgent: "claude" }),
  });
  assert.equal(response.status, 202);
  const created = await response.json();
  assert.equal(created.soloAgent, "claude");
  assert.equal(created.strategist, "claude");
  assert.deepEqual(created.workerAgents, ["claude"]);
  assert.equal(created.executionMode, "auto");

  let session;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    session = await (await fetch(`${url}/api/sessions/${created.id}`)).json();
    if (["succeeded", "failed", "completed"].includes(session.status)) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const planning = session.events.find((event) => event.type === "planning_started");
  assert.equal(planning.strategist, "claude");
  assert.deepEqual(planning.workerAgents, ["claude"]);
  assert.equal(session.soloAgent, "claude");
});

test("Web rejects an only-one request for an unavailable CLI", async (t) => {
  const { url } = await fixture(t);
  const rejected = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Use a copilot solo", soloAgent: "copilot" }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /invalid soloAgent/);
});

test("Web sessions can stop an active strategist and remain resumable", async (t) => {
  let abortObserved = false;
  const { url } = await fixture(t, {
    planWithStrategistFn: async ({ signal }) => new Promise((resolve, reject) => {
      const stop = () => {
        abortObserved = true;
        reject(new Error("planner aborted"));
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    }),
  });
  const response = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Stop this planning session", executionMode: "manual" }),
  });
  const created = await response.json();
  const stopped = await fetch(`${url}/api/sessions/${created.id}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(stopped.status, 202);

  let session;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await fetch(`${url}/api/sessions/${created.id}`);
    session = await current.json();
    if (session.status === "interrupted") break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  const bootstrap = await (await fetch(`${url}/api/bootstrap`)).json();
  assert.equal(abortObserved, true);
  assert.equal(session.status, "interrupted");
  assert.equal(session.error, null);
  assert.equal(bootstrap.activeSessionIds.includes(created.id), false);
});

test("Web sessions can stop active worker execution", async (t) => {
  let workerAbortObserved = false;
  const { url } = await fixture(t, {
    runPlanFn: async ({ signal, onEvent }) => {
      await onEvent({
        type: "task_started",
        task: { id: "review", agent: "codex", mode: "read-only" },
      });
      await new Promise((resolve) => {
        const stop = () => {
          workerAbortObserved = true;
          resolve();
        };
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      });
      return {
        runId: "run-interrupted",
        manifest: { status: "interrupted", tasks: {} },
      };
    },
  });
  const response = await fetch(`${url}/api/goals`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Stop active workers", executionMode: "auto" }),
  });
  const created = await response.json();
  let running = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await (await fetch(`${url}/api/sessions/${created.id}`)).json();
    if (current.status === "running") {
      running = true;
      break;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(running, true);
  const stopped = await fetch(`${url}/api/sessions/${created.id}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(stopped.status, 202);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = await (await fetch(`${url}/api/sessions/${created.id}`)).json();
    if (current.status === "interrupted") break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(workerAbortObserved, true);
});

test("Web relays an interactive worker prompt answer back to the run", async (t) => {
  let answered;
  const { url } = await fixture(t, {
    runPlanFn: async ({ onEvent, onPrompt }) => {
      await onEvent({
        type: "task_started",
        task: { id: "review", agent: "codex", mode: "read-only" },
      });
      answered = await onPrompt({
        id: "prompt-1",
        taskId: "review",
        agent: "codex",
        question: "Apply the migration?",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ],
      });
      return { runId: "run-prompt", manifest: { status: "succeeded", tasks: {} } };
    },
  });
  const created = await (
    await fetch(`${url}/api/goals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "Ask me something", executionMode: "auto" }),
    })
  ).json();
  let running = false;
  for (let attempt = 0; attempt < 40 && !running; attempt += 1) {
    const current = await (await fetch(`${url}/api/sessions/${created.id}`)).json();
    if (current.status === "running") running = true;
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(running, true);
  let delivered = false;
  for (let attempt = 0; attempt < 60 && !delivered; attempt += 1) {
    const response = await fetch(`${url}/api/sessions/${created.id}/tasks/review/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ promptId: "prompt-1", value: "yes" }),
    });
    if (response.status === 200) delivered = true;
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(delivered, true);
  for (let attempt = 0; attempt < 60 && answered === undefined; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(answered, "yes");
});

test("lists native CLI sessions and imports the selected ones without duplicates", async (t) => {
  const descriptors = [
    {
      id: "claude-abc",
      source: "claude",
      nativeSessionId: "abc",
      title: "Login form",
      preview: "Add a login form",
      cwd: "/Users/dev/app",
      gitBranch: "feature/login",
      cliVersion: null,
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-21T00:00:00.000Z",
      matchesProject: true,
    },
    {
      id: "codex-def",
      source: "codex",
      nativeSessionId: "def",
      title: "Refactor parser",
      preview: "Refactor the parser",
      cwd: "/Users/dev/other",
      gitBranch: null,
      cliVersion: "0.98.0",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
      matchesProject: false,
    },
  ];
  const { url } = await fixture(t, {
    scanNativeSessionsFn: async () => descriptors.map((descriptor) => ({ ...descriptor })),
  });

  const listBody = await (await fetch(`${url}/api/native-sessions`)).json();
  assert.equal(listBody.sessions.length, 2);
  assert.equal(listBody.sessions.every((session) => session.alreadyImported === false), true);
  assert.equal(listBody.sessions[0].transcriptPath, undefined);

  const importResponse = await fetch(`${url}/api/native-sessions/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["claude-abc"] }),
  });
  assert.equal(importResponse.status, 200);
  const importBody = await importResponse.json();
  assert.equal(importBody.imported.length, 1);
  assert.equal(importBody.imported[0].imported.source, "claude");
  assert.equal(importBody.imported[0].imported.nativeSessionId, "abc");
  assert.equal(importBody.imported[0].status, "imported");

  const relisted = await (await fetch(`${url}/api/native-sessions`)).json();
  const claudeItem = relisted.sessions.find((session) => session.id === "claude-abc");
  assert.equal(claudeItem.alreadyImported, true);

  const reimport = await (await fetch(`${url}/api/native-sessions/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["claude-abc", "unknown-id"] }),
  })).json();
  assert.equal(reimport.imported.length, 0);
  assert.deepEqual(
    reimport.skipped.map((entry) => entry.reason).sort(),
    ["already imported", "not found"],
  );
});

test("resuming an imported session runs the native CLI resume", async (t) => {
  const descriptors = [
    {
      id: "codex-def",
      source: "codex",
      nativeSessionId: "def",
      title: "Refactor parser",
      preview: "Refactor the parser",
      cwd: null,
      gitBranch: null,
      cliVersion: "0.98.0",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
      matchesProject: false,
    },
  ];
  const commands = [];
  const { url, root } = await fixture(t, {
    scanNativeSessionsFn: async () => descriptors.map((descriptor) => ({ ...descriptor })),
    runCommandFn: async (command, args, options) => {
      commands.push({ command, args, cwd: options.cwd });
      return { stdout: "Continued the parser refactor.", stderr: "", code: 0 };
    },
  });

  const imported = await (await fetch(`${url}/api/native-sessions/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["codex-def"] }),
  })).json();
  const sessionId = imported.imported[0].id;

  const missingPrompt = await fetch(`${url}/api/sessions/${sessionId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(missingPrompt.status, 400);

  const resume = await fetch(`${url}/api/sessions/${sessionId}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Keep going" }),
  });
  assert.equal(resume.status, 202);

  let finished = null;
  for (let attempt = 0; attempt < 100 && !finished; attempt += 1) {
    const body = await (await fetch(`${url}/api/sessions/${sessionId}`)).json();
    finished = (body.events || []).find((event) => event.type === "native_resume_finished");
    if (!finished) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(finished, "native resume should record a finished event");
  assert.equal(finished.report, "Continued the parser refactor.");
  assert.equal(commands.length, 1);
  // The invoked command binary comes from config.agents; the fixture leaves it
  // unset, so assert the meaningful part: the native `exec resume <id>` shape.
  assert.deepEqual(commands[0].args.slice(0, 3), ["exec", "resume", "def"]);
  assert.equal(commands[0].args.at(-1), "Keep going");
  // With no original cwd the resume falls back to the project root.
  assert.equal(commands[0].cwd, root);
});
