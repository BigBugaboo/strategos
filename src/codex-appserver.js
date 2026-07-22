import { spawn } from "node:child_process";
import readline from "node:readline";

// Codex's app-server speaks newline-delimited JSON-RPC over stdio. It forwards
// approval requests as server->client requests that we answer on the user's
// behalf via `onPrompt`, so no PTY/TUI scraping is needed for Codex.
const APPROVAL_METHODS = new Set([
  "execCommandApproval",
  "applyPatchApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
]);

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .join("");
  }
  return "";
}

async function resolveApproval(method, params, onPrompt, task) {
  if (!onPrompt) return "denied";
  const command = Array.isArray(params?.command) ? params.command.join(" ") : "";
  const editing = method.includes("fileChange") || method.includes("applyPatch");
  const question = editing
    ? `Codex wants to edit files${params?.cwd ? ` in ${params.cwd}` : ""}. Apply the change?`
    : `Codex wants to run a command${params?.cwd ? ` in ${params.cwd}` : ""}:\n${command || "(command unavailable)"}\nAllow it?`;
  const answer = await onPrompt({
    id: `${task?.id || "task"}-approval-${params?.callId || params?.approvalId || params?.conversationId || "x"}`,
    taskId: task?.id,
    agent: task?.agent,
    kind: "select",
    question,
    options: [
      { value: "approved", label: "Approve" },
      { value: "approved_for_session", label: "Approve for session" },
      { value: "denied", label: "Deny" },
    ],
  });
  return typeof answer === "string" && answer ? answer : "denied";
}

export async function runCodexAppServer({
  command = "codex",
  prompt,
  cwd,
  env = process.env,
  sandbox = "workspace-write",
  approvalPolicy = "on-request",
  signal,
  timeoutMs = 0,
  onPrompt,
  task,
  version = "0.0.0",
}) {
  const child = spawn(command, ["app-server", "--stdio"], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const reader = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  const messages = [];
  let nextId = 1;
  let settled = false;
  let timer;

  const request = (method, params) => {
    const id = nextId;
    nextId += 1;
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  const respond = (id, result) => child.stdin.write(`${JSON.stringify({ id, result })}\n`);

  return new Promise((resolve) => {
    const onAbort = () => finish({ aborted: true });
    const finish = (extra = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      try {
        reader.close();
      } catch {
        // reader may already be closed
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // child may already have exited
      }
      resolve({
        report: messages.join("\n\n").trim(),
        aborted: Boolean(extra.aborted),
        timedOut: Boolean(extra.timedOut),
        error: extra.error ?? null,
        code: extra.error ? 1 : 0,
      });
    };

    if (timeoutMs > 0) {
      timer = setTimeout(
        () => finish({ timedOut: true, error: `codex exceeded ${Math.round(timeoutMs / 60_000)} minutes` }),
        timeoutMs,
      );
    }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (error) => finish({ error: error.message }));
    child.on("exit", () => finish({}));

    reader.on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      // Response to one of our requests.
      if (message.id !== undefined && message.method === undefined) {
        const waiter = pending.get(message.id);
        pending.delete(message.id);
        if (waiter) {
          if (message.error) waiter.reject(new Error(message.error?.message || "codex request failed"));
          else waiter.resolve(message.result);
        }
        return;
      }
      // Server -> client request (needs a response).
      if (message.id !== undefined && message.method) {
        if (APPROVAL_METHODS.has(message.method)) {
          resolveApproval(message.method, message.params, onPrompt, task).then((decision) =>
            respond(message.id, { decision }),
          );
        } else {
          // Answer unrecognised prompts benignly so Codex never deadlocks.
          respond(message.id, {});
        }
        return;
      }
      // Notification.
      if (message.method === "item/completed") {
        const item = message.params?.item;
        if (item?.type === "agentMessage" || item?.type === "agent_message") {
          const text = item.text || textOfContent(item.content);
          if (text) messages.push(text);
        }
      } else if (message.method === "turn/completed") {
        finish({});
      } else if (message.method === "turn/failed") {
        finish({ error: message.params?.error?.message || "codex turn failed" });
      }
    });

    (async () => {
      try {
        await request("initialize", {
          clientInfo: { name: "strategos", title: null, version },
          capabilities: null,
        });
        const started = await request("thread/start", { cwd, sandbox, approvalPolicy });
        const threadId = started?.thread?.id;
        if (!threadId) throw new Error("codex did not return a thread id");
        await request("turn/start", {
          threadId,
          input: [{ type: "text", text: prompt, text_elements: [] }],
        });
        // Completion arrives via the `turn/completed` notification.
      } catch (error) {
        finish({ error: error.message });
      }
    })();
  });
}
