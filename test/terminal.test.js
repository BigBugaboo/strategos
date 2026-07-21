import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  createTerminalUi,
  formatResumeSession,
  renderInputChrome,
  renderWelcome,
  selectResumeSession,
  stripAnsi,
} from "../src/terminal.js";

const checks = [
  { name: "git", ok: true, detail: "git version 2.55.0" },
  { name: "node", ok: true, detail: "v24.18.0" },
  { name: "claude", ok: true, detail: "2.1.215 (Claude Code)" },
  { name: "codex", ok: true, detail: "codex-cli 0.144.6" },
  { name: "copilot", ok: true, detail: "GitHub Copilot CLI 1.0.71" },
];

test("renders a compact colored welcome surface for interactive terminals", () => {
  const ui = createTerminalUi({ interactive: true, columns: 96, env: { TERM: "xterm-256color" } });
  const output = renderWelcome(ui, {
    version: "0.7.0",
    root: "/tmp/example-repository",
    strategist: "codex",
    checks,
  });
  const plain = stripAnsi(output);

  assert.equal(ui.color, true);
  assert.match(output, /\u001b\[/);
  assert.match(plain, /STRATEGOS v0\.7\.0/);
  assert.match(plain, /Multi-agent strategy console · codex plans/);
  assert.match(plain, /Agents\s+● claude\s+·\s+● codex\s+·\s+● copilot/);
  assert.match(plain, /Runtime Node v24\.18\.0 · Git 2\.55\.0/);
  assert.match(plain, /previews the plan, then runs it automatically/);
  assert.doesNotMatch(plain, /Claude Code/);
});

test("renders input guidance and respects terminal width", () => {
  const ui = createTerminalUi({ interactive: true, columns: 72, env: { TERM: "xterm" } });
  const output = stripAnsi(renderInputChrome(ui, "auto"));
  const [rule, hints] = output.split("\n");
  assert.equal(rule.length, 72);
  assert.match(hints, /\/help commands\s+·\s+\/mode auto\s+·\s+preview → run/);
});

test("surfaces single-CLI parallel sessions and selected images", () => {
  const ui = createTerminalUi({ interactive: false, columns: 80 });
  const welcome = renderWelcome(ui, {
    version: "0.10.0",
    root: "/tmp/example-repository",
    strategist: "codex",
    checks: checks.map((check) =>
      ["claude", "copilot"].includes(check.name) ? { ...check, ok: false } : check,
    ),
  });
  assert.match(welcome, /Sessions parallel codex workers · isolated worktrees/);
  assert.match(renderInputChrome(ui, "auto", 2), /2 images/);
});

test("disables styling when NO_COLOR is present", () => {
  const ui = createTerminalUi({
    interactive: true,
    columns: 80,
    env: { TERM: "xterm", NO_COLOR: "" },
  });
  assert.equal(ui.color, false);
  assert.doesNotMatch(renderInputChrome(ui, "manual"), /\u001b\[/);
});

test("expands unavailable tools into actionable startup warnings", () => {
  const ui = createTerminalUi({ interactive: true, columns: 80, env: { TERM: "xterm" } });
  const output = stripAnsi(
    renderWelcome(ui, {
      version: "0.7.0",
      root: "/tmp/example-repository",
      strategist: "codex",
      checks: checks.map((check) =>
        check.name === "copilot"
          ? { ...check, ok: false, detail: "command not found" }
          : check,
      ),
    }),
  );

  assert.match(output, /● claude\s+·\s+● codex\s+·\s+● copilot/);
  assert.match(output, /Warning  copilot unavailable — command not found/);
});

test("formats resume choices with a title and useful session details", () => {
  const ui = createTerminalUi({ columns: 80 });
  const item = formatResumeSession(
    ui,
    {
      id: "session-release",
      goal: "Ship the checkout release with focused regression tests",
      strategist: "codex",
      status: "failed",
      updatedAt: "2026-07-21T09:50:00.000Z",
      plan: { tasks: [{ id: "implementation" }, { id: "review" }] },
      events: [
        { type: "task_finished", task: { id: "implementation", status: "succeeded" } },
      ],
      error: "network unavailable",
    },
    { now: new Date("2026-07-21T10:00:00.000Z") },
  );

  assert.equal(item.title, "Ship the checkout release with focused regression tests");
  assert.match(item.description, /failed · 10m ago · codex · 1\/2 tasks complete/);
  assert.match(item.description, /network unavailable/);
});

test("interactive resume selector moves with arrow keys and returns the highlighted session", async () => {
  const input = new PassThrough();
  const captured = new PassThrough();
  let output = "";
  captured.on("data", (chunk) => {
    output += chunk.toString();
  });
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => {
    input.isRaw = value;
  };
  captured.isTTY = true;
  const ui = createTerminalUi({ interactive: true, columns: 80, env: { TERM: "xterm" } });
  const sessions = [
    { id: "session-1", goal: "First task", status: "failed", updatedAt: "2026-07-21T09:00:00Z" },
    { id: "session-2", goal: "Second task", status: "interrupted", updatedAt: "2026-07-21T09:30:00Z" },
  ];

  const selection = selectResumeSession({
    sessions,
    input,
    output: captured,
    ui,
    now: new Date("2026-07-21T10:00:00Z"),
  });
  await new Promise((resolve) => setImmediate(resolve));
  input.write("\u001b[B");
  input.write("\r");

  assert.equal((await selection).id, "session-2");
  const plain = stripAnsi(output);
  assert.match(plain, /Resume a session/);
  assert.match(plain, /Use ↑\/↓ to select · Enter to resume · Esc to cancel/);
  assert.match(plain, /Selected  Second task/);
  assert.equal(input.isRaw, false);
});
