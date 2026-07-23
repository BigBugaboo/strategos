// A minimal MCP (stdio, newline-delimited JSON-RPC) server that Claude Code
// launches as its `--permission-prompt-tool` provider. It exposes a single
// `approve` tool; each call is relayed over a unix socket to the Strategos
// orchestrator, which forwards it to the UI and returns the user's decision.
//
// This file runs as its own process (spawned by `claude`), so it must stay
// dependency-free and self-contained.
import net from "node:net";
import readline from "node:readline";

const SOCKET = process.env.STRATEGOS_APPROVAL_SOCKET;
const DEFAULT_PROTOCOL = "2024-11-05";

const APPROVE_TOOL = {
  name: "approve",
  description: "Ask the Strategos user to approve or deny a tool invocation.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input_data: { type: "object" },
      context: { type: "object" },
    },
  },
};

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

// Relay one approval request to the orchestrator and resolve with the decision
// object Claude expects: { behavior: "allow", updated_input? } or
// { behavior: "deny", message, interrupt }.
function askOrchestrator(argumentsObject) {
  return new Promise((resolve) => {
    const deny = (message) => resolve({ behavior: "deny", message, interrupt: false });
    if (!SOCKET) return deny("Strategos approval channel is unavailable");
    let buffer = "";
    let settled = false;
    const socket = net.createConnection(SOCKET);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // already closed
      }
      resolve(value);
    };
    socket.on("connect", () => socket.write(`${JSON.stringify(argumentsObject)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish({ behavior: "deny", message: "Malformed approval response", interrupt: false });
      }
    });
    socket.on("error", () => deny("Strategos approval channel error"));
    socket.on("close", () => deny("Strategos approval channel closed"));
  });
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params?.protocolVersion || DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: "strategos-approvals", version: "1.0.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method?.startsWith("notifications/")) {
    return; // notifications carry no id and need no response
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [APPROVE_TOOL] } });
    return;
  }
  if (method === "tools/call") {
    if (params?.name !== "approve") {
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: "unknown tool" } });
      return;
    }
    const decision = await askOrchestrator(params.arguments || {});
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: JSON.stringify(decision) }], isError: false },
    });
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "method not found" } });
  }
}

const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  void handle(message);
});
