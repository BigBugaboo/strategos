import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import { DEFAULT_CONFIG } from "../src/config.js";
import { normalizeExecutionMode, selectWorkerAgents, startConsole } from "../src/console.js";
import { stripAnsi } from "../src/terminal.js";

const healthyChecks = [
  { name: "git", ok: true, detail: "git version test" },
  { name: "node", ok: true, detail: "v24.0.0" },
  { name: "claude", ok: true, detail: "Claude Code test" },
  { name: "codex", ok: true, detail: "codex-cli test" },
  { name: "copilot", ok: true, detail: "Copilot CLI test" },
];

function captureOutput() {
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => {
    text += chunk.toString();
  });
  return { output, read: () => text };
}

async function waitForOutput(read, pattern) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (pattern.test(stripAnsi(read()))) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for output: ${pattern}`);
}

function memorySessionStore(initial = []) {
  let sequence = initial.length;
  const sessions = new Map(initial.map((session) => [session.id, { ...session }]));
  const resumable = new Set(["planning", "planned", "previewed", "running", "failed", "interrupted"]);
  const save = async (session) => {
    const next = { ...session, updatedAt: new Date().toISOString() };
    sessions.set(next.id, next);
    return next;
  };
  const list = async ({ resumableOnly = false, limit = 20 } = {}) =>
    [...sessions.values()]
      .filter((session) => !resumableOnly || resumable.has(session.status))
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, limit);
  return {
    async create(input) {
      sequence += 1;
      return save({
        version: 1,
        id: `session-${sequence}`,
        ...input,
        status: "planning",
        attempts: 1,
        events: [],
        error: null,
      });
    },
    async update(session, patch) {
      return save({ ...session, ...patch });
    },
    async appendEvent(session, event) {
      return save({
        ...session,
        runId: event.runId || session.runId,
        events: [...(session.events || []), event],
      });
    },
    async load(id) {
      return sessions.get(id);
    },
    list,
    async latestResumable() {
      return (await list({ resumableOnly: true, limit: 1 }))[0];
    },
  };
}

function consoleOptions(input, output, overrides = {}) {
  return {
    root: "/tmp/example-repository",
    version: "0.9.0-test",
    input: typeof input === "string" ? Readable.from([input]) : input,
    output,
    loadConfigFn: async () => ({ ...DEFAULT_CONFIG, executionMode: "manual" }),
    runDoctorFn: async () => healthyChecks,
    initializeProjectFn: async () => [],
    sessionStore: memorySessionStore(),
    planWithStrategistFn: async ({ goal }) => ({
      version: 1,
      goal,
      context: [],
      tasks: [
        {
          id: "implementation",
          agent: "claude",
          mode: "write",
          prompt: "Implement the requested goal.",
          dependsOn: [],
        },
      ],
    }),
    ...overrides,
  };
}

test("ordinary console input proposes a plan and previews its waves", async () => {
  const captured = captureOutput();
  let planningInput;
  await startConsole(
    consoleOptions("Add CSV export\n/preview\n/exit\n", captured.output, {
      planWithStrategistFn: async (input) => {
        planningInput = input;
        return {
          version: 1,
          goal: input.goal,
          context: [],
          tasks: [
            {
              id: "implementation",
              agent: "claude",
              mode: "write",
              prompt: "Implement CSV export.",
              dependsOn: [],
            },
            {
              id: "review",
              agent: "copilot",
              mode: "read-only",
              prompt: "Review CSV export.",
              dependsOn: ["implementation"],
            },
          ],
        };
      },
      runPlanFn: async ({ planInput, dryRun }) => {
        assert.equal(dryRun, true);
        assert.equal(planInput.goal, "Add CSV export");
        return {
          dryRun: true,
          maxParallel: 3,
          waves: [["implementation"], ["review"]],
        };
      },
    }),
  );
  const output = captured.read();
  assert.equal(planningInput.strategist, "codex");
  assert.deepEqual(planningInput.workerAgents, ["claude", "codex", "copilot"]);
  assert.match(output, /What do you want to accomplish/);
  assert.match(output, /Planning  codex is reading the repository/);
  assert.match(output, /Plan ready  proposed by codex/);
  assert.match(output, /Max parallel: 3/);
});

test("console starts one background Web UI daemon and leaves it running on exit", async () => {
  const captured = captureOutput();
  let starts = 0;

  await startConsole(
    consoleOptions("/web\n/web\n/exit\n", captured.output, {
      startWebDaemonFn: async (options) => {
        starts += 1;
        assert.deepEqual(options, {
          root: "/tmp/example-repository",
          host: "127.0.0.1",
          port: 4310,
          version: "0.9.0-test",
        });
        return {
          url: "http://127.0.0.1:4310",
        };
      },
    }),
  );

  assert.equal(starts, 1);
  assert.match(captured.read(), /Web UI running in background  http:\/\/127\.0\.0\.1:4310/);
  assert.match(captured.read(), /Already running at http:\/\/127\.0\.0\.1:4310/);
});

test("console stops the background Web UI only on an explicit command", async () => {
  const captured = captureOutput();
  let stops = 0;

  await startConsole(
    consoleOptions("/web stop\n/exit\n", captured.output, {
      stopWebDaemonFn: async (options) => {
        stops += 1;
        assert.deepEqual(options, { root: "/tmp/example-repository" });
        return { alreadyStopped: false };
      },
    }),
  );

  assert.equal(stops, 1);
  assert.match(captured.read(), /Web UI stopped/);
});

test("console restarts the background Web UI on an explicit command", async () => {
  const captured = captureOutput();
  let restarts = 0;

  await startConsole(
    consoleOptions("/web restart\n/exit\n", captured.output, {
      restartWebDaemonFn: async (options) => {
        restarts += 1;
        assert.deepEqual(options, {
          root: "/tmp/example-repository",
          version: "0.9.0-test",
        });
        return { url: "http://127.0.0.1:4310", restarted: true };
      },
    }),
  );

  assert.equal(restarts, 1);
  assert.match(captured.read(), /Web UI restarted  http:\/\/127\.0\.0\.1:4310/);
});

test("attaches image context to planning, plans, and durable sessions", async () => {
  const captured = captureOutput();
  const sessionStore = memorySessionStore();
  let planningInput;
  const attachment = {
    id: "image-1",
    name: "design.png",
    mimeType: "image/png",
    size: 128,
    sha256: "abc",
    relativePath: ".strategos/attachments/image-1-design.png",
    path: "/tmp/example-repository/.strategos/attachments/image-1-design.png",
  };

  await startConsole(
    consoleOptions(
      "/attach /tmp/design.png\nImplement the attached design\n/attachments\n/exit\n",
      captured.output,
      {
        sessionStore,
        attachImageFn: async () => attachment,
        resolveAttachmentsFn: async (_root, attachments) =>
          attachments.length ? [{ ...attachment, ...attachments[0] }] : [],
        planWithStrategistFn: async (input) => {
          planningInput = input;
          return {
            version: 1,
            goal: input.goal,
            context: [],
            tasks: [{
              id: "implementation",
              agent: "codex",
              mode: "write",
              prompt: "Implement the design.",
              dependsOn: [],
            }],
          };
        },
      },
    ),
  );

  assert.equal(planningInput.attachments[0].path, attachment.path);
  const saved = (await sessionStore.list())[0];
  assert.equal(saved.attachments[0].relativePath, attachment.relativePath);
  assert.deepEqual(saved.plan.attachments, [attachment.relativePath]);
  assert.match(captured.read(), /Attached  design\.png/);
  assert.match(captured.read(), /Image attachments/);
});

test("strategist can be changed for the current console session", async () => {
  const captured = captureOutput();
  let planningInput;
  await startConsole(
    consoleOptions("/strategist claude\nPlan a release\n/exit\n", captured.output, {
      planWithStrategistFn: async (input) => {
        planningInput = input;
        return {
          version: 1,
          goal: input.goal,
          context: [],
          tasks: [
            {
              id: "release",
              agent: "codex",
              mode: "write",
              prompt: "Prepare the release.",
              dependsOn: [],
            },
          ],
        };
      },
    }),
  );
  assert.equal(planningInput.strategist, "claude");
  assert.deepEqual(planningInput.workerAgents, ["claude", "codex", "copilot"]);
  assert.match(captured.read(), /Strategist changed  claude/);
});

test("separated mode excludes the strategist from the worker pool", () => {
  assert.deepEqual(
    selectWorkerAgents(["claude", "codex", "copilot"], "codex", "separated"),
    ["claude", "copilot"],
  );
  assert.throws(
    () => selectWorkerAgents(["codex"], "codex", "separated"),
    /requires a healthy CLI besides the strategist/,
  );
});

test("worker mode rejects unsupported values", () => {
  assert.throws(
    () => selectWorkerAgents(["claude", "codex"], "codex", "automatic"),
    /invalid workerMode: automatic/,
  );
});

test("execution mode defaults to auto and rejects unsupported values", () => {
  assert.equal(normalizeExecutionMode(), "auto");
  assert.equal(normalizeExecutionMode("manual"), "manual");
  assert.throws(
    () => normalizeExecutionMode("automatic"),
    /invalid executionMode: automatic/,
  );
});

test("auto mode previews and then executes a generated plan", async () => {
  const captured = captureOutput();
  const calls = [];
  const manifest = { id: "run-auto", status: "succeeded", tasks: {} };

  await startConsole(
    consoleOptions("Ship the feature\n/exit\n", captured.output, {
      loadConfigFn: async () => DEFAULT_CONFIG,
      runPlanFn: async ({ dryRun, onEvent }) => {
        calls.push(dryRun === true ? "preview" : "run");
        if (dryRun) {
          return { dryRun: true, maxParallel: 3, waves: [["implementation"]] };
        }
        onEvent({ type: "run_started", runId: "run-auto", goal: "Ship the feature" });
        onEvent({ type: "run_finished", runId: "run-auto", manifest });
        return { dryRun: false, runId: "run-auto", manifest };
      },
    }),
  );

  const output = captured.read();
  assert.deepEqual(calls, ["preview", "run"]);
  assert.match(output, /Auto mode  Previewing before execution/);
  assert.ok(output.indexOf("Preview  Max parallel") < output.indexOf("Executing  Starting"));
  assert.match(output, /Run finished: succeeded/);
});

test("auto mode never executes when preview fails", async () => {
  const captured = captureOutput();
  const calls = [];

  await startConsole(
    consoleOptions("Ship the feature\n/exit\n", captured.output, {
      loadConfigFn: async () => DEFAULT_CONFIG,
      runPlanFn: async ({ dryRun }) => {
        calls.push(dryRun === true ? "preview" : "run");
        if (dryRun) throw new Error("preview failed");
        throw new Error("execution should not start");
      },
    }),
  );

  assert.deepEqual(calls, ["preview"]);
  assert.match(captured.read(), /Error  preview failed/);
});

test("reload refreshes project configuration and CLI availability", async () => {
  const captured = captureOutput();
  let configLoads = 0;
  let doctorRuns = 0;
  await startConsole(
    consoleOptions("/reload\n/exit\n", captured.output, {
      loadConfigFn: async () => {
        configLoads += 1;
        return { ...DEFAULT_CONFIG, executionMode: "manual" };
      },
      runDoctorFn: async () => {
        doctorRuns += 1;
        return healthyChecks;
      },
    }),
  );
  assert.equal(configLoads, 2);
  assert.equal(doctorRuns, 2);
  assert.match(captured.read(), /Reloaded.*Project configuration and CLI availability/s);
});

test("failed planning can be resumed with durable AI context", async () => {
  const sessionStore = memorySessionStore();
  const attachment = {
    id: "resume-image",
    name: "network.png",
    mimeType: "image/png",
    size: 64,
    relativePath: ".strategos/attachments/resume-image-network.png",
    path: "/tmp/example-repository/.strategos/attachments/resume-image-network.png",
  };
  const resolveAttachmentsFn = async (_root, attachments) =>
    attachments.length ? [{ ...attachment, ...attachments[0], path: attachment.path }] : [];
  const firstOutput = captureOutput();
  await startConsole(
    consoleOptions("/attach /tmp/network.png\nShip the release\n/exit\n", firstOutput.output, {
      sessionStore,
      attachImageFn: async () => attachment,
      resolveAttachmentsFn,
      planWithStrategistFn: async () => {
        throw new Error("codex planning failed: network unavailable");
      },
    }),
  );

  const failed = (await sessionStore.list())[0];
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /network unavailable/);

  let recoveredInput;
  const secondOutput = captureOutput();
  await startConsole(
    consoleOptions("/resume\n/exit\n", secondOutput.output, {
      sessionStore,
      resolveAttachmentsFn,
      planWithStrategistFn: async (input) => {
        recoveredInput = input;
        return {
          version: 1,
          goal: input.goal,
          context: [],
          tasks: [
            {
              id: "recovery",
              agent: "codex",
              mode: "write",
              prompt: "Inspect current state and finish the release.",
              dependsOn: [],
            },
          ],
        };
      },
    }),
  );

  assert.match(secondOutput.read(), /Recovery.*can be continued with \/resume/s);
  assert.match(secondOutput.read(), /Resuming.*from failed/s);
  assert.match(recoveredInput.resumeContext, /network unavailable/);
  assert.match(recoveredInput.resumeContext, /Ship the release/);
  assert.match(recoveredInput.resumeContext, /resume-image-network\.png/);
  assert.equal(recoveredInput.attachments[0].path, attachment.path);
  assert.equal((await sessionStore.load(failed.id)).status, "planned");
});

test("interactive resume opens a selector and continues the chosen session", async () => {
  const sessionStore = memorySessionStore([
    {
      id: "session-1",
      goal: "Older recovery",
      strategist: "claude",
      status: "failed",
      attempts: 1,
      updatedAt: "2026-07-21T08:00:00.000Z",
      events: [],
      error: "first failure",
    },
    {
      id: "session-2",
      goal: "Selected recovery",
      strategist: "codex",
      status: "interrupted",
      attempts: 1,
      updatedAt: "2026-07-21T09:00:00.000Z",
      events: [],
      error: "cancelled while planning",
    },
  ]);
  const input = Readable.from(["/resume\n/exit\n"]);
  const captured = captureOutput();
  input.isTTY = true;
  captured.output.isTTY = true;
  let offeredSessions;
  let planningInput;

  await startConsole(
    consoleOptions(input, captured.output, {
      sessionStore,
      selectResumeSessionFn: async ({ sessions }) => {
        offeredSessions = sessions;
        return sessions.find((session) => session.id === "session-2");
      },
      planWithStrategistFn: async (value) => {
        planningInput = value;
        return {
          version: 1,
          goal: value.goal,
          context: [],
          tasks: [
            {
              id: "recovery",
              agent: "codex",
              mode: "write",
              prompt: "Continue the selected recovery.",
              dependsOn: [],
            },
          ],
        };
      },
    }),
  );

  assert.deepEqual(offeredSessions.map((session) => session.id), ["session-2", "session-1"]);
  assert.equal(planningInput.goal, "Selected recovery");
  assert.match(planningInput.resumeContext, /cancelled while planning/);
  assert.match(captured.read(), /Resuming.*session-2 from interrupted/s);
});

test("resume selector cooperates with the active console readline interface", async () => {
  const sessionStore = memorySessionStore([
    {
      id: "session-1",
      goal: "Choose this session",
      strategist: "codex",
      status: "failed",
      attempts: 1,
      updatedAt: "2026-07-21T08:00:00.000Z",
      events: [],
      error: "network unavailable",
    },
    {
      id: "session-2",
      goal: "Initially highlighted session",
      strategist: "codex",
      status: "interrupted",
      attempts: 1,
      updatedAt: "2026-07-21T09:00:00.000Z",
      events: [],
      error: "planning cancelled",
    },
  ]);
  const input = new PassThrough();
  const captured = captureOutput();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  captured.output.isTTY = true;
  captured.output.columns = 80;
  let planningInput;

  const running = startConsole(
    consoleOptions(input, captured.output, {
      sessionStore,
      env: { TERM: "xterm" },
      planWithStrategistFn: async (value) => {
        planningInput = value;
        return {
          version: 1,
          goal: value.goal,
          context: [],
          tasks: [
            {
              id: "recovery",
              agent: "codex",
              mode: "write",
              prompt: "Continue recovery.",
              dependsOn: [],
            },
          ],
        };
      },
    }),
  );
  await waitForOutput(captured.read, /What are we building/);
  input.write("/resume\n");
  await waitForOutput(captured.read, /Resume a session/);
  input.write("\u001b[B");
  input.write("\r");
  await waitForOutput(captured.read, /Resuming.*session-1 from failed/s);
  input.end("/exit\n");
  await running;

  assert.equal(planningInput.goal, "Choose this session");
  assert.match(planningInput.resumeContext, /network unavailable/);
  assert.equal(input.isRaw, false);
});

test("a new goal abandons the previously offered recovery session", async () => {
  const sessionStore = memorySessionStore([
    {
      id: "session-1",
      goal: "Old interrupted goal",
      strategist: "codex",
      status: "failed",
      attempts: 1,
      events: [],
      error: "network unavailable",
    },
  ]);
  const captured = captureOutput();

  await startConsole(
    consoleOptions("Start a different goal\n/exit\n", captured.output, { sessionStore }),
  );

  assert.equal((await sessionStore.load("session-1")).status, "abandoned");
  assert.equal((await sessionStore.latestResumable()).goal, "Start a different goal");
});

test("mode command changes execution behavior for the current session", async () => {
  const captured = captureOutput();
  const calls = [];
  const manifest = { id: "run-mode", status: "succeeded", tasks: {} };

  await startConsole(
    consoleOptions("/mode auto\nShip the feature\n/exit\n", captured.output, {
      runPlanFn: async ({ dryRun }) => {
        calls.push(dryRun === true ? "preview" : "run");
        return dryRun
          ? { dryRun: true, maxParallel: 3, waves: [["implementation"]] }
          : { dryRun: false, runId: "run-mode", manifest };
      },
    }),
  );

  assert.deepEqual(calls, ["preview", "run"]);
  assert.match(captured.read(), /Execution mode changed  auto/);
});

test("mode command can pause the default auto flow", async () => {
  const captured = captureOutput();
  let runCalls = 0;

  await startConsole(
    consoleOptions("/mode manual\nShip the feature\n/exit\n", captured.output, {
      loadConfigFn: async () => DEFAULT_CONFIG,
      runPlanFn: async () => {
        runCalls += 1;
        throw new Error("manual mode should not run automatically");
      },
    }),
  );

  const output = captured.read();
  assert.equal(runCalls, 0);
  assert.match(output, /Execution mode changed  manual/);
  assert.match(output, /Next  \/preview  \/run  \/save/);
});

test("run command renders live orchestration events", async () => {
  const captured = captureOutput();
  const manifest = {
    id: "run-test",
    status: "succeeded",
    tasks: {
      implementation: {
        id: "implementation",
        agent: "claude",
        status: "succeeded",
        branch: "strategos/run-test/implementation",
      },
    },
  };
  await startConsole(
    consoleOptions("Ship the feature\n/run\n/exit\n", captured.output, {
      runPlanFn: async ({ onEvent }) => {
        onEvent({ type: "run_started", runId: "run-test", goal: "Ship the feature" });
        onEvent({
          type: "task_started",
          task: { id: "implementation", agent: "claude", status: "running" },
        });
        onEvent({
          type: "task_finished",
          task: { id: "implementation", agent: "claude", status: "succeeded" },
        });
        onEvent({ type: "run_finished", runId: "run-test", manifest });
        return { dryRun: false, runId: "run-test", manifest };
      },
    }),
  );
  const output = captured.read();
  assert.match(output, /Run run-test started/);
  assert.match(output, /implementation  claude  running/);
  assert.match(output, /Run finished: succeeded/);
  assert.match(output, /branch strategos\/run-test\/implementation/);
});

test("interactive console renders compact startup chrome", async () => {
  const captured = captureOutput();
  const options = consoleOptions("/exit\n", captured.output, {
    env: { TERM: "xterm-256color" },
  });
  options.input.isTTY = true;
  captured.output.isTTY = true;
  captured.output.columns = 72;

  await startConsole(options);
  const output = captured.read();
  const plain = stripAnsi(output);
  assert.match(output, /\u001b\[/);
  assert.match(plain, /STRATEGOS v0\.9\.0-test/);
  assert.match(plain, /Agents\s+● claude\s+·\s+● codex\s+·\s+● copilot/);
  assert.match(plain, /\/help commands\s+·\s+\/mode manual\s+·\s+\/run after review/);
  assert.doesNotMatch(plain, /Claude Code test/);
});

test("interactive console restores the prompt after an empty line", async () => {
  const input = new PassThrough();
  const captured = captureOutput();
  const options = consoleOptions(input, captured.output, {
    env: { TERM: "xterm-256color" },
  });
  input.isTTY = true;
  captured.output.isTTY = true;
  captured.output.columns = 72;

  const session = startConsole(options);
  await new Promise((resolve) => setImmediate(resolve));
  input.write("\n");
  await new Promise((resolve) => setImmediate(resolve));
  input.end("/exit\n");
  await session;

  const output = stripAnsi(captured.read());
  assert.equal(output.split("─".repeat(72)).length - 1, 2);
});

test("Ctrl+C exits an idle interactive console", async () => {
  const input = new PassThrough();
  const captured = captureOutput();
  const options = consoleOptions(input, captured.output, {
    env: { TERM: "xterm-256color" },
  });
  input.isTTY = true;
  captured.output.isTTY = true;
  captured.output.columns = 72;

  const session = startConsole(options);
  await new Promise((resolve) => setImmediate(resolve));
  input.write("\u0003");
  await session;

  const output = stripAnsi(captured.read());
  assert.match(output, /Goodbye\./);
  assert.doesNotMatch(output, /Use \/exit to leave Strategos/);
});

test("Ctrl+C requires confirmation before cancelling active planning", async () => {
  const input = new PassThrough();
  const captured = captureOutput();
  let planningSignal;
  let planningStarted;
  const started = new Promise((resolve) => {
    planningStarted = resolve;
  });
  const options = consoleOptions(input, captured.output, {
    env: { TERM: "xterm-256color" },
    planWithStrategistFn: async ({ signal }) => {
      planningSignal = signal;
      return new Promise((resolve, reject) => {
        planningStarted();
        signal.addEventListener(
          "abort",
          () => reject(new Error("codex planning cancelled")),
          { once: true },
        );
      });
    },
  });
  input.isTTY = true;
  captured.output.isTTY = true;
  captured.output.columns = 72;

  const session = startConsole(options);
  input.write("Plan a release\n");
  await started;
  input.write("\u0003");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(planningSignal.aborted, false);
  assert.match(
    stripAnsi(captured.read()),
    /Press Ctrl\+C again within 3 seconds to interrupt planning/,
  );
  input.write("\u0003");
  await new Promise((resolve) => setImmediate(resolve));
  input.end("/exit\n");
  await session;

  const output = stripAnsi(captured.read());
  assert.match(output, /Cancelling strategist/);
  assert.match(output, /planning cancelled/);
  assert.doesNotMatch(output, /Goodbye\./);
});

test("Ctrl+C does not hide an active worker execution", async () => {
  const input = new PassThrough();
  const captured = captureOutput();
  let executionStarted;
  let finishExecution;
  const started = new Promise((resolve) => {
    executionStarted = resolve;
  });
  const execution = new Promise((resolve) => {
    finishExecution = resolve;
  });
  const options = consoleOptions(input, captured.output, {
    env: { TERM: "xterm-256color" },
    runPlanFn: async () => {
      executionStarted();
      return execution;
    },
  });
  input.isTTY = true;
  captured.output.isTTY = true;
  captured.output.columns = 72;

  const session = startConsole(options);
  input.write("Ship the feature\n/run\n");
  await started;
  input.write("\u0003");
  await new Promise((resolve) => setImmediate(resolve));
  finishExecution({
    dryRun: false,
    runId: "run-active",
    manifest: { id: "run-active", status: "succeeded", tasks: {} },
  });
  await new Promise((resolve) => setImmediate(resolve));
  input.end("/exit\n");
  await session;

  const output = stripAnsi(captured.read());
  assert.match(output, /Worker execution is still running/);
  assert.match(output, /Status succeeded/);
  assert.doesNotMatch(output, /Goodbye\./);
});
