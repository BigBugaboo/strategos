import assert from "node:assert/strict";
import test from "node:test";
import { detectPrompt, runInteractiveTask } from "../src/interactive.js";
import { ptyAvailable } from "../src/process.js";

test("detectPrompt recognizes yes/no confirmations", () => {
  const prompt = detectPrompt("Applying migration.\nProceed with deploy? (y/n) ");
  assert.equal(prompt.kind, "select");
  assert.deepEqual(
    prompt.options.map((option) => option.value),
    ["y", "n"],
  );
  assert.match(prompt.question, /Proceed with deploy\?/);
});

test("detectPrompt recognizes numbered menus", () => {
  const prompt = detectPrompt("Select a strategy:\n1. Rebase\n2. Merge\n3. Squash");
  assert.equal(prompt.kind, "select");
  assert.equal(prompt.options.length, 3);
  assert.equal(prompt.options[2].label, "Squash");
});

test("detectPrompt recognizes trailing text prompts and ignores plain output", () => {
  assert.equal(detectPrompt("What should the branch be named:").kind, "text");
  assert.equal(detectPrompt("just some streaming logs\nmore logs\n"), null);
});

test("runInteractiveTask answers a live PTY prompt and lets the process continue", async (t) => {
  if (!(await ptyAvailable())) {
    t.skip("node-pty native binary is not built in this environment");
    return;
  }
  const result = await runInteractiveTask({
    command: "bash",
    args: ["-lc", 'printf "Apply changes? (y/n) "; read a; echo "RESULT=$a"'],
    timeoutMs: 8000,
    debounceMs: 120,
    task: { id: "demo", agent: "codex" },
    onPrompt: async (request) => {
      assert.equal(request.kind, "select");
      assert.match(request.question, /Apply changes\?/);
      return "y";
    },
  });
  assert.match(result.output, /RESULT=y/);
});
