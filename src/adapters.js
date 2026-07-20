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

export function agentInvocation(agent, { prompt, mode, workspace, config }) {
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
        ...extra,
        prompt,
      ],
    };
  }

  if (agent === "copilot") {
    const readOnly = mode === "read-only" ? ["--available-tools=view,grep,glob"] : [];
    return {
      command: definition.command,
      args: ["--no-ask-user", "--output-format=text", ...readOnly, ...extra, "-p", prompt],
    };
  }

  if (Array.isArray(definition.args)) {
    const replacements = {
      "{{prompt}}": prompt,
      "{{workspace}}": workspace,
      "{{mode}}": mode,
    };
    return {
      command: definition.command,
      args: definition.args.map((value) => replacements[value] ?? value),
    };
  }

  throw new Error(`no adapter implementation for agent: ${agent}`);
}

export function strategistInvocation(agent, { prompt, workspace, config, jsonSchema, schemaPath }) {
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
        ...extra,
        "-p",
        prompt,
      ],
    };
  }

  return agentInvocation(agent, { prompt, mode: "read-only", workspace, config });
}

export const BUILTIN_AGENT_NAMES = Object.freeze(["claude", "codex", "copilot"]);
