# Strategos

**A local-first strategist for Claude Code, Codex CLI, and GitHub Copilot CLI.**

Strategos turns one development goal into an explicit task graph, dispatches
ready tasks to existing agent CLIs in parallel, and gives every task its own Git
worktree. Context, dependency reports, logs, branches, and changed-file lists
remain inspectable on your machine.

> Early MVP. Strategos intentionally does not auto-merge or auto-push agent
> branches.

[简体中文](README.zh-CN.md)

## Why

Running three coding agents in three terminals is easy. Keeping them aligned is
not. Their native conversations are incompatible, concurrent edits collide,
and useful decisions disappear into session history.

Strategos provides a small neutral layer:

- **Shared context** compiled from `AGENTS.md`, project context, team memory,
  task-specific files, and completed dependency reports.
- **Explicit task graph** with dependencies rather than an opaque LLM deciding
  everything at runtime.
- **Parallel waves** capped by a configurable concurrency limit.
- **Worktree isolation** for every task, including independent branches.
- **Provider adapters** for `claude`, `codex`, and `copilot` commands already
  authenticated on the host.
- **Durable evidence** under `.strategos/runs/<run-id>/`.
- **Defensive completion checks**: exit code zero without a report is treated as
  failure because some older agent CLIs return success after provider errors.
- **Human-controlled integration**: review and merge the branches you want.

## Quick start

Requirements: Node.js 24+, Git, and at least one supported agent CLI. If you
use `fnm`, run `fnm use` in the repository to select the pinned major version.

### Tested CLI baseline

| CLI | Tested version |
| --- | ---: |
| Claude Code | `2.1.215` |
| OpenAI Codex CLI | `0.144.6` |
| GitHub Copilot CLI | `1.0.71` |

These versions are the current validation baseline, not hard pins. See
[COMPATIBILITY.md](COMPATIBILITY.md) for the support and upgrade policy.

### Start the interactive console

The recommended human workflow is to launch Strategos inside a Git repository
and enter a development goal:

```bash
cd /path/to/your/repository
strategos
```

```text
Strategos 0.3.0
Agents: ✓ Claude  ✓ Codex  ✓ Copilot

What do you want to accomplish?
> Add CSV export and focused tests

Wave 1: implementation, tests
Wave 2: review
```

Ordinary text proposes a starter task graph using the available agent CLIs.
The plan is deterministic and must be reviewed; no agent runs until the user
enters `/run`. Useful console commands include:

```text
/new [goal]   /plan      /load <file>  /save [file]
/preview      /run       /status [id]  /agents
/context      /init      /help         /exit
```

See [docs/interactive-console.md](docs/interactive-console.md) for the complete
workflow and current boundaries.

### Run directly with `npx`

The fastest first run requires no clone or global installation:

```bash
cd /path/to/your/repository
npx --yes github:BigBugaboo/strategos
```

Non-interactive commands remain available when needed:

```bash
npx --yes github:BigBugaboo/strategos init
npx --yes github:BigBugaboo/strategos doctor
npx --yes github:BigBugaboo/strategos run .strategos/example-plan.json --dry-run
```

Until Strategos has a published npm release, `npx` installs the package from
the GitHub default branch and reuses the npm cache on later runs.

### Install persistently from GitHub

Install a reusable `strategos` command without manually cloning the repository:

```bash
npm install --global github:BigBugaboo/strategos
strategos --help
```

Global npm packages belong to the currently active Node.js installation. If
you use `fnm`, Vite+, `nvm`, or another version manager, install Strategos from
the same shell environment in which you plan to run it.

### Install from a source checkout

```bash
git clone https://github.com/BigBugaboo/strategos.git
cd strategos
fnm use --install-if-missing # optional when Node.js 24 is already active
npm ci
npm run verify
npm link
strategos --help
```

Use this linked mode when contributing: the global command follows changes in
the checkout without requiring a reinstall.

### Initialize a target repository

```bash
cd /path/to/your/repository
strategos init
strategos doctor
```

`strategos init` creates `.strategos/config.json`, shared context and memory
files, an example plan, and `AGENTS.md` without overwriting existing files.
Edit those files and commit the configuration before starting a real run.

### Preview and run a plan

```bash
strategos run .strategos/example-plan.json --dry-run
strategos run .strategos/example-plan.json --max-parallel 3
strategos status
```

Strategos requires a clean repository before a real run because new worktrees
start from the committed `HEAD`, not from uncommitted files.

### Troubleshoot `command not found`

Check that the active Node.js environment owns the installation and exposes
its global binary directory:

```bash
node --version
npm prefix -g
npm install -g /absolute/path/to/strategos
rehash # zsh only
command -v strategos
strategos --help
```

For development, run `npm link` again after switching to a different Node.js
installation.

### Upgrade Strategos

Inspect the detected installation mode without changing anything:

```bash
strategos upgrade --dry-run
```

Then upgrade a persistent global npm installation:

```bash
strategos upgrade
strategos --version
strategos doctor
```

`strategos update` is an alias. Source checkouts, `npm link`, temporary `npx`
packages, and project-local dependencies are not overwritten automatically;
the command prints the safe update steps for the detected mode. See
[docs/upgrading.md](docs/upgrading.md) for recovery, pinning, and agent CLI
upgrade workflows.

## Plan example

```json
{
  "version": 1,
  "goal": "Add an export endpoint with tests and an independent review.",
  "context": ["AGENTS.md", "docs/architecture.md"],
  "tasks": [
    {
      "id": "api",
      "agent": "claude",
      "mode": "write",
      "prompt": "Implement the endpoint and focused validation.",
      "dependsOn": []
    },
    {
      "id": "tests",
      "agent": "codex",
      "mode": "write",
      "prompt": "Add API tests and edge cases against the documented contract.",
      "dependsOn": []
    },
    {
      "id": "review",
      "agent": "copilot",
      "mode": "read-only",
      "prompt": "Review both reports for integration and security risks.",
      "dependsOn": ["api", "tests"]
    }
  ]
}
```

`api` and `tests` run concurrently. `review` runs only after both succeed and
receives both reports in its compiled prompt.

## Safety defaults

- Codex runs with `read-only` or `workspace-write` sandbox mode.
- Claude uses `plan` for read-only tasks and `auto` for write tasks.
- Copilot write-mode permission escalation is **not** added automatically. Add
  the flags accepted by your installed version to
  `.strategos/config.json > agents.copilot.extraArgs` only after reviewing
  their effect.
- Strategos never passes dangerous bypass flags, merges, pushes, or removes
  worktrees by default.
- Prompts are passed as subprocess arguments, never interpolated into a shell
  command.

Agent tools still run as your operating-system user. Worktrees prevent Git edit
collisions; they are not a complete OS sandbox.

## Run artifacts

```text
.strategos/runs/<run-id>/
├── plan.json
├── run.json
├── shared-memory.md
└── <task-id>/
    ├── prompt.md
    ├── report.md
    └── stderr.log
```

The task branch and worktree path are recorded in `run.json`. Successful sibling
reports are preserved even when another task fails.

## Architecture and roadmap

See [docs/architecture.md](docs/architecture.md) and
[docs/plan-schema.md](docs/plan-schema.md).

Likely next steps:

1. LLM-assisted planning as an optional replacement for the deterministic starter strategy.
2. Resumable process sessions, cancellation, and richer terminal rendering.
3. Optional Docker/OS sandbox profiles.
4. Cross-agent messaging through a typed local protocol.
5. Test-gated merge queue with an explicit approval step.
6. MCP server so any supported agent can operate Strategos as a tool.

## Inspiration

Strategos is implemented from scratch. Its design is informed by:

- [Daintree](https://github.com/daintreehq/daintree): worktree-oriented agent
  supervision and context injection.
- [Hive](https://github.com/tt-a1i/hive): explicit task graph, team reports, and
  durable team memory.
- [MCO](https://github.com/mco-org/mco): neutral CLI adapters and inspectable
  provider output.
- [Agent of Empires](https://github.com/njbrake/agent-of-empires): persistent
  multi-agent session ergonomics.
- [AgentPipe](https://github.com/kevinelliott/agentpipe): cross-provider shared
  conversation structure.

No source code from those projects is included.

## License

MIT
