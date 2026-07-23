import { spawn } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const BRIDGE_PATH = fileURLToPath(new URL("./claude-permission-bridge.js", import.meta.url));

function describeApproval(args) {
  const tool = args?.tool_name || "a tool";
  const ctx = args?.context || {};
  if (ctx.description) return ctx.description;
  if (tool === "Bash") return `Claude wants to run: ${args?.input_data?.command || "(command)"}`;
  if (tool === "Edit" || tool === "Write") {
    return `Claude wants to modify ${args?.input_data?.file_path || "a file"}.`;
  }
  return `Claude wants to use ${tool}.`;
}

// Run Claude Code headlessly with stream-json I/O and route its tool-permission
// requests to `onPrompt` via a bundled MCP bridge, so the user can approve or
// deny each one from the UI while Claude keeps running.
export async function runClaudeInteractive({
  command = "claude",
  prompt,
  cwd,
  env = process.env,
  signal,
  timeoutMs = 0,
  onPrompt,
  task,
}) {
  const socketPath = path.join(
    os.tmpdir(),
    `strategos-approve-${crypto.randomBytes(6).toString("hex")}.sock`,
  );

  // Local socket the MCP bridge connects to for each approval decision.
  const server = net.createServer((connection) => {
    let buffer = "";
    connection.on("data", async (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      let args;
      try {
        args = JSON.parse(buffer.slice(0, newline));
      } catch {
        connection.end(`${JSON.stringify({ behavior: "deny", message: "bad request" })}\n`);
        return;
      }
      const answer = onPrompt
        ? await onPrompt({
            id: `${task?.id || "task"}-approval-${args?.context?.tool_use_id || crypto.randomBytes(4).toString("hex")}`,
            taskId: task?.id,
            agent: task?.agent,
            kind: "select",
            question: describeApproval(args),
            options: [
              { value: "allow", label: "Approve" },
              { value: "deny", label: "Deny" },
            ],
          })
        : "deny";
      const decision =
        answer === "allow"
          ? { behavior: "allow", updated_input: args?.input_data ?? null, updated_permissions: null }
          : { behavior: "deny", message: "Denied by the Strategos user.", interrupt: false };
      connection.end(`${JSON.stringify(decision)}\n`);
    });
  });
  await new Promise((resolve) => server.listen(socketPath, resolve));

  const mcpConfig = {
    mcpServers: {
      strategos: {
        type: "stdio",
        command: process.execPath,
        args: [BRIDGE_PATH],
        env: { STRATEGOS_APPROVAL_SOCKET: socketPath },
      },
    },
  };

  const child = spawn(
    command,
    [
      "-p",
      // Force `default` mode so approvals route to our tool even when the user's
      // own settings would otherwise bypass permission prompts.
      "--permission-mode",
      "default",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--verbose",
      "--permission-prompt-tool",
      "mcp__strategos__approve",
      "--mcp-config",
      JSON.stringify(mcpConfig),
    ],
    { cwd, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const reader = readline.createInterface({ input: child.stdout });

  return await new Promise((resolve) => {
    let settled = false;
    let report = "";
    let errorText = "";
    let timer;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        reader.close();
      } catch {
        /* already closed */
      }
      try {
        child.kill("SIGKILL");
      } catch {
        /* already exited */
      }
      server.close();
    };
    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        report: (extra.report ?? report).trim(),
        aborted: Boolean(extra.aborted),
        timedOut: Boolean(extra.timedOut),
        error: extra.error ?? null,
        code: extra.error ? 1 : 0,
      });
    };
    const onAbort = () => finish({ aborted: true });

    if (timeoutMs > 0) {
      timer = setTimeout(
        () => finish({ timedOut: true, error: `claude exceeded ${Math.round(timeoutMs / 60_000)} minutes` }),
        timeoutMs,
      );
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (error) => finish({ error: error.message }));
    child.stderr.on("data", (chunk) => {
      errorText += chunk.toString();
    });
    child.on("exit", () => finish(report ? {} : { error: errorText.trim() || "claude exited without a result" }));

    reader.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.type === "assistant") {
        const blocks = message.message?.content || [];
        for (const block of blocks) {
          if (block.type === "text" && block.text) report += block.text;
        }
      } else if (message.type === "result") {
        finish({ report: typeof message.result === "string" ? message.result : report });
      }
    });

    child.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: prompt } })}\n`,
    );
  });
}
