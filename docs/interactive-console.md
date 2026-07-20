# Interactive Console

Running `strategos` without a subcommand starts the local interactive console.
The console is the human-oriented entrypoint; existing subcommands remain the
stable automation interface for scripts and CI.

## Start

```bash
cd /path/to/a/git/repository
strategos
```

At startup, Strategos displays the repository, Node.js version, and health of
Claude Code, Codex CLI, and Copilot CLI. Enter ordinary text to describe a
development goal.

## Planning and approval

The `0.4.x` console delegates planning to one installed agent CLI instead of
embedding a model provider:

1. The configured strategist, `codex` by default, is invoked immediately in
   read-only mode when the user enters a goal.
2. The strategist inspects the repository and receives shared project context,
   the available worker names, safety constraints, and the plan JSON schema.
3. It returns a task graph for the other healthy agent CLIs. If only one CLI is
   available, that CLI may plan first and work only after approval.
4. Strategos extracts the JSON, validates task IDs, agents, modes,
   dependencies, task count, and cycles, then displays the proposed waves.
5. The user reviews the result with `/plan` or `/preview` and explicitly enters
   `/run` to start worker tasks.

Strategos contains no model SDK, model API integration, or provider key. A goal
does consume one planning call through the selected CLI, but planning creates
no worktree and grants no write permission. Invalid or failed strategist output
is reported as an error rather than replaced with a hidden local plan. Press
`Ctrl+C` during planning to terminate that strategist process and return to the
console.

The default can be changed in `.strategos/config.json`:

```json
{
  "strategist": "codex",
  "planningTimeoutMinutes": 5,
  "maxPlanningTasks": 12
}
```

## Commands

| Command | Purpose |
| --- | --- |
| `/new [goal]` | Ask the strategist to produce another plan. If the goal is omitted, enter it on the next line. |
| `/strategist [agent]` | Show or change the planning CLI for the current session. |
| `/plan` | Show the current task graph and dependency waves. |
| `/load <file>` | Load and validate a JSON plan inside the repository. |
| `/save [file]` | Save the current plan. The default is a timestamped file under `.strategos/plans/`. |
| `/preview` | Validate the current plan and show waves without changing the repository. |
| `/run` | Execute the current plan after the user has reviewed it. |
| `/status [id]` | Show a specific run, or the latest run when no ID is provided. |
| `/agents` | Re-run environment and agent CLI health checks. |
| `/context` | List the shared context files currently present. |
| `/init` | Initialize Strategos without overwriting existing files. |
| `/clear` | Clear an interactive terminal. |
| `/help` | Show command help. |
| `/exit` | Close the console. |

## Live execution

During `/run`, the console reports when the run starts, each worktree is being
prepared, each agent starts, tasks succeed or fail, dependencies are skipped,
and the final manifest is complete. It then prints task branches and errors for
review.

## Repository cleanliness

A real run still requires a clean Git repository. If `/init` or `/save` creates
files, review and commit them before `/run`:

```bash
git add .strategos AGENTS.md .gitignore
git commit -m "configure Strategos orchestration"
```

This ensures every task worktree starts from a reproducible committed `HEAD`.

## Current boundaries

- Each goal starts a fresh non-interactive strategist call; native CLI chat
  history is not imported or shared.
- Worker tasks started by `/run` cannot yet be cancelled from the console.
- The console renders a scrolling event stream rather than a full-screen TUI.
- Branch integration remains human-controlled; Strategos does not merge or
  push agent branches automatically.

These boundaries keep planning provider-neutral and preserve the same safety
model as non-interactive execution.
