import test from "node:test";
import assert from "node:assert/strict";
import { createTerminalUi, renderInputChrome, renderWelcome, stripAnsi } from "../src/terminal.js";

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
    version: "0.6.1",
    root: "/tmp/example-repository",
    strategist: "codex",
    checks,
  });
  const plain = stripAnsi(output);

  assert.equal(ui.color, true);
  assert.match(output, /\u001b\[/);
  assert.match(plain, /STRATEGOS v0\.6\.1/);
  assert.match(plain, /Multi-agent strategy console · codex plans/);
  assert.match(plain, /Agents\s+● claude\s+·\s+● codex\s+·\s+● copilot/);
  assert.match(plain, /Runtime Node v24\.18\.0 · Git 2\.55\.0/);
  assert.doesNotMatch(plain, /Claude Code/);
});

test("renders input guidance and respects terminal width", () => {
  const ui = createTerminalUi({ interactive: true, columns: 72, env: { TERM: "xterm" } });
  const output = stripAnsi(renderInputChrome(ui, "codex"));
  const [rule, hints] = output.split("\n");
  assert.equal(rule.length, 72);
  assert.match(hints, /\/help commands\s+·\s+\/strategist codex planner\s+·\s+\/run after review/);
});

test("disables styling when NO_COLOR is present", () => {
  const ui = createTerminalUi({
    interactive: true,
    columns: 80,
    env: { TERM: "xterm", NO_COLOR: "" },
  });
  assert.equal(ui.color, false);
  assert.doesNotMatch(renderInputChrome(ui, "claude"), /\u001b\[/);
});

test("expands unavailable tools into actionable startup warnings", () => {
  const ui = createTerminalUi({ interactive: true, columns: 80, env: { TERM: "xterm" } });
  const output = stripAnsi(
    renderWelcome(ui, {
      version: "0.6.1",
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
