import { runPty } from "./process.js";

const ANSI_PATTERN = /\[[0-9;?]*[A-Za-z]|\][^]*/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_PATTERN, "");
}

/**
 * Best-effort, CLI-agnostic detector for an interactive prompt in a terminal
 * stream. Recognises yes/no confirmations, numbered menus, and trailing
 * question/colon input prompts. Per-CLI detectors can refine this later.
 */
export function detectPrompt(raw) {
  const text = stripAnsi(raw).slice(-4000);
  const lines = text.split(/\r?\n/);
  const last = (lines[lines.length - 1] || "").trim();

  const yesNo = last.match(/(.*\S)?\s*[([]\s*y(?:es)?\s*\/\s*n(?:o)?\s*[)\]]\s*[:?]?\s*$/i);
  if (yesNo) {
    return {
      kind: "select",
      question: (yesNo[1] || "Proceed?").trim(),
      options: [
        { value: "y", label: "Yes" },
        { value: "n", label: "No" },
      ],
    };
  }

  const options = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const cleaned = lines[index].replace(/^[\s❯>*·\-]+/, "");
    const match = cleaned.match(/^(\d+)[.)]\s+(.+\S)\s*$/);
    if (match) {
      options.unshift({ value: match[1], label: match[2].trim() });
      continue;
    }
    if (options.length >= 2) {
      return { kind: "select", question: lines[index].trim() || "Choose an option", options };
    }
    if (options.length) break;
  }

  if (last && /[?:]$/.test(last)) {
    return { kind: "text", question: last };
  }
  return null;
}

let promptSequence = 0;

/**
 * Run a worker CLI inside a PTY, surface interactive prompts to `onPrompt`,
 * and write the user's answer back to the process. Falls back to the caller's
 * plain-pipe path when PTY support is unavailable (the caller checks first).
 */
export async function runInteractiveTask({
  command,
  args = [],
  cwd,
  env,
  signal,
  timeoutMs = 0,
  debounceMs = 350,
  onPrompt,
  task,
  detect = detectPrompt,
  runPtyFn = runPty,
  now = () => Date.now(),
}) {
  let output = "";
  let handledSignature = null;
  let handling = false;
  let idleTimer;
  let child;

  const evaluate = async () => {
    if (handling || !child) return;
    const prompt = detect(output);
    if (!prompt) return;
    const signature = `${prompt.kind}:${prompt.question}`;
    if (signature === handledSignature) return;
    handling = true;
    handledSignature = signature;
    try {
      promptSequence += 1;
      const answer = await onPrompt({
        id: `${task?.id || "task"}-${now()}-${promptSequence}`,
        taskId: task?.id,
        agent: task?.agent,
        question: prompt.question,
        options: prompt.options || [],
        kind: prompt.kind,
      });
      if (answer !== null && answer !== undefined && child) {
        child.write(`${answer}\r`);
        // The answer echoes back; allow the next distinct prompt to fire.
        handledSignature = null;
      }
    } finally {
      handling = false;
    }
  };

  const result = await runPtyFn(command, args, {
    cwd,
    env,
    signal,
    timeoutMs,
    onData: (chunk, pty) => {
      child = pty;
      output += chunk;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void evaluate(), debounceMs);
    },
  });
  if (idleTimer) clearTimeout(idleTimer);
  return { ...result, output: stripAnsi(result.output ?? output) };
}
