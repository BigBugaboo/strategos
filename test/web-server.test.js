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
    async list() {
      return [...sessions.values()];
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
    async appendEvent(session, event) {
      return this.update(session, { events: [...(session.events || []), event] });
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
    agents: { claude: {}, codex: {}, copilot: {} },
    capacity: {
      excludeExhausted: true,
      agents: {
        claude: { state: "available", remainingPercent: 72 },
        codex: { state: "available", remainingPercent: 18 },
        copilot: { state: "exhausted", remainingPercent: 0 },
      },
    },
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
    runDoctorFn: async () => [
      { name: "git", ok: true, detail: "git" },
      { name: "node", ok: true, detail: "node" },
      { name: "claude", ok: true, detail: "claude" },
      { name: "codex", ok: true, detail: "codex" },
      { name: "copilot", ok: true, detail: "copilot" },
    ],
    sessionStore,
    createSessionStoreFn: (projectRoot) => projectRoot === secondRoot ? secondSessionStore : sessionStore,
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
  });
  t.after(async () => {
    result.server.closeAllConnections();
    await new Promise((resolve) => result.server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  return { ...result, root, secondRoot, planningRoots };
}

test("Web bootstrap exposes repository, sessions, and eligible capacity", async (t) => {
  const { url, root } = await fixture(t);
  const response = await fetch(`${url}/api/bootstrap`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.repository, { name: path.basename(root), path: root });
  assert.equal(body.projects.length, 2);
  assert.equal(body.sessionGroups.length, 2);
  assert.equal(body.sessionGroups[1].sessions[0].goal, "Work in the second project");
  assert.equal(body.capacity.find((agent) => agent.name === "copilot").eligible, false);
  assert.deepEqual(body.sessions, []);
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

test("Web APIs scope sessions to the selected registered project", async (t) => {
  const { url, secondRoot, planningRoots } = await fixture(t);
  const response = await fetch(`${url}/api/bootstrap`, {
    headers: { "x-strategos-project": secondRoot },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.repository, { name: "second-project", path: secondRoot });
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
  assert.deepEqual(planning.workerAgents, ["claude", "codex"]);
  assert.match(planning.at, /^2026-/);
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
