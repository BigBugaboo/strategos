import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeInteractive } from "../src/claude-interactive.js";

// A fake `claude -p --output-format stream-json` that mimics the real flow: it
// spawns the configured MCP permission bridge, performs an approve tools/call
// through it (exactly as Claude would), then emits the stream-json result. This
// exercises runClaudeInteractive + the real bridge + the approval socket end to
// end with no model calls.
const FAKE = `import { spawn } from "node:child_process";
import readline from "node:readline";

// Parse --mcp-config to find the bridge command/args/env.
const argv = process.argv.slice(2);
const cfgIndex = argv.indexOf("--mcp-config");
const cfg = JSON.parse(argv[cfgIndex + 1]);
const s = cfg.mcpServers.strategos;
const emit = (o) => process.stdout.write(JSON.stringify(o) + "\\n");

// Read the user's stream-json message from stdin, then run the flow.
readline.createInterface({ input: process.stdin }).on("line", () => {
  const bridge = spawn(s.command, s.args, { env: { ...process.env, ...s.env }, stdio: ["pipe", "pipe", "inherit"] });
  const send = (o) => bridge.stdin.write(JSON.stringify(o) + "\\n");
  let acc = "";
  bridge.stdout.on("data", (d) => {
    acc += d.toString();
    let nl;
    while ((nl = acc.indexOf("\\n")) !== -1) {
      const line = acc.slice(0, nl); acc = acc.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id === 3) {
        const decision = JSON.parse(m.result.content[0].text);
        emit({ type: "assistant", message: { content: [{ type: "text", text: decision.behavior === "allow" ? "APPLIED" : "REFUSED" }] } });
        emit({ type: "result", subtype: "success", result: decision.behavior === "allow" ? "APPLIED" : "REFUSED" });
        bridge.kill(); process.exit(0);
      }
    }
  });
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "approve", arguments: { tool_name: "Write", input_data: { file_path: "x.txt" }, context: { description: "Claude wants to write x.txt" } } } });
});
`;

async function fakeClaude(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "strategos-claude-fake-"));
  await fs.writeFile(path.join(dir, "fake.mjs"), FAKE);
  const bin = path.join(dir, "claude");
  await fs.writeFile(bin, `#!/bin/sh\nexec node "${path.join(dir, "fake.mjs")}" "$@"\n`);
  await fs.chmod(bin, 0o755);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return bin;
}

test("claude interactive forwards a permission request and applies approval", async (t) => {
  const command = await fakeClaude(t);
  let asked = null;
  const result = await runClaudeInteractive({
    command,
    prompt: "write x.txt",
    cwd: os.tmpdir(),
    timeoutMs: 15_000,
    task: { id: "verify", agent: "claude" },
    onPrompt: async (request) => {
      asked = request.question;
      return "allow";
    },
  });
  assert.match(asked || "", /write/i);
  assert.equal(result.report, "APPLIED");
});

test("claude interactive relays a denial", async (t) => {
  const command = await fakeClaude(t);
  const result = await runClaudeInteractive({
    command,
    prompt: "write x.txt",
    cwd: os.tmpdir(),
    timeoutMs: 15_000,
    task: { id: "verify", agent: "claude" },
    onPrompt: async () => "deny",
  });
  assert.equal(result.report, "REFUSED");
});
