const VERSION_ARGS = Object.freeze({
  claude: ["--version"],
  codex: ["--version"],
  copilot: ["--version"],
});

export function versionInvocation(agent, config) {
  const definition = config.agents[agent];
  if (!definition) throw new Error(`agent is not configured: ${agent}`);
  return { command: definition.command, args: VERSION_ARGS[agent] || ["--version"] };
}

export function agentInvocation(agent, {
  prompt,
  mode,
  workspace,
  config,
  attachments = [],
  sessionId,
  sessionName,
}) {
  const definition = config.agents[agent];
  if (!definition) throw new Error(`agent is not configured: ${agent}`);
  const extra = Array.isArray(definition.extraArgs) ? definition.extraArgs : [];

  if (agent === "claude") {
    return {
      command: definition.command,
      args: [
        "-p",
        prompt,
        "--output-format",
        "text",
        "--permission-mode",
        mode === "read-only" ? "plan" : "auto",
        ...(sessionId ? ["--session-id", sessionId] : []),
        ...(sessionName ? ["--name", sessionName] : []),
        ...extra,
      ],
    };
  }

  if (agent === "codex") {
    return {
      command: definition.command,
      args: [
        "exec",
        "--sandbox",
        mode === "read-only" ? "read-only" : "workspace-write",
        "--color",
        "never",
        "-C",
        workspace,
        ...attachments.flatMap((attachment) => ["--image", attachment.path]),
        ...extra,
        prompt,
      ],
    };
  }

  if (agent === "copilot") {
    const readOnly = mode === "read-only" ? ["--available-tools=view,grep,glob"] : [];
    return {
      command: definition.command,
      args: [
        "--no-ask-user",
        "--output-format=text",
        ...readOnly,
        ...(sessionId ? ["--session-id", sessionId] : []),
        ...(sessionName ? ["--name", sessionName] : []),
        ...attachments.flatMap((attachment) => ["--attachment", attachment.path]),
        ...extra,
        "-p",
        prompt,
      ],
    };
  }

  if (Array.isArray(definition.args)) {
    const replacements = {
      "{{prompt}}": prompt,
      "{{workspace}}": workspace,
      "{{mode}}": mode,
      "{{sessionId}}": sessionId,
    };
    return {
      command: definition.command,
      args: definition.args.map((value) => replacements[value] ?? value),
    };
  }

  throw new Error(`no adapter implementation for agent: ${agent}`);
}

export function strategistInvocation(agent, {
  prompt,
  workspace,
  config,
  jsonSchema,
  schemaPath,
  attachments = [],
}) {
  const definition = config.agents[agent];
  if (!definition) throw new Error(`agent is not configured: ${agent}`);
  const extra = Array.isArray(definition.extraArgs) ? definition.extraArgs : [];

  if (agent === "claude") {
    return {
      command: definition.command,
      args: [
        "-p",
        prompt,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(jsonSchema),
        "--permission-mode",
        "plan",
        "--tools",
        "Read,Glob,Grep",
        ...extra,
      ],
    };
  }

  if (agent === "codex") {
    return {
      command: definition.command,
      args: [
        "exec",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "-C",
        workspace,
        ...attachments.flatMap((attachment) => ["--image", attachment.path]),
        ...(schemaPath ? ["--output-schema", schemaPath] : []),
        ...extra,
        prompt,
      ],
    };
  }

  if (agent === "copilot") {
    return {
      command: definition.command,
      args: [
        "--no-ask-user",
        "--output-format=text",
        "--available-tools=view,grep,glob",
        ...attachments.flatMap((attachment) => ["--attachment", attachment.path]),
        ...extra,
        "-p",
        prompt,
      ],
    };
  }

  return agentInvocation(agent, { prompt, mode: "read-only", workspace, config, attachments });
}

// Continue an existing native CLI conversation by its own session id. Used to
// resume Claude/Codex transcripts that were imported from the user's machine, so
// the follow-up runs against the original history rather than a fresh session.
export function resumeInvocation(agent, { nativeSessionId, prompt, mode, workspace, config }) {
  const definition = config.agents[agent];
  if (!definition) throw new Error(`agent is not configured: ${agent}`);
  if (!nativeSessionId) throw new Error("nativeSessionId is required to resume a session");
  const extra = Array.isArray(definition.extraArgs) ? definition.extraArgs : [];

  if (agent === "claude") {
    return {
      command: definition.command,
      args: [
        "-p",
        prompt,
        "--resume",
        nativeSessionId,
        "--output-format",
        "text",
        "--permission-mode",
        mode === "read-only" ? "plan" : "auto",
        ...extra,
      ],
    };
  }

  if (agent === "codex") {
    return {
      command: definition.command,
      args: [
        "exec",
        "resume",
        nativeSessionId,
        "--sandbox",
        mode === "read-only" ? "read-only" : "workspace-write",
        "--color",
        "never",
        "-C",
        workspace,
        ...extra,
        prompt,
      ],
    };
  }

  throw new Error(`native resume is not supported for agent: ${agent}`);
}

// Interactive (PTY) invocation for a worker that may pause to ask the user.
// Returns null when interactive mode is not yet supported for the agent, so
// the orchestrator falls back to the non-interactive pipe path.
export function interactiveInvocation(agent, { prompt, mode, workspace, config, attachments = [] }) {
  const definition = config.agents[agent];
  if (!definition) throw new Error(`agent is not configured: ${agent}`);
  const extra = Array.isArray(definition.extraArgs) ? definition.extraArgs : [];

  if (agent === "codex") {
    // Interactive TUI (not `exec`): Codex pauses for approvals, which Strategos
    // forwards to the UI and answers on the user's behalf.
    return {
      command: definition.command,
      args: [
        "-C",
        workspace,
        "--sandbox",
        mode === "read-only" ? "read-only" : "workspace-write",
        ...attachments.flatMap((attachment) => ["--image", attachment.path]),
        ...extra,
        prompt,
      ],
    };
  }

  // claude (stream-json + permission-prompt-tool) and copilot interactive
  // adapters are pending per-CLI work; fall back to the pipe path for now.
  return null;
}

export const BUILTIN_AGENT_NAMES = Object.freeze(["claude", "codex", "copilot"]);
