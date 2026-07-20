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

The `0.3.x` console builds a deterministic starter strategy:

1. A write-capable primary agent receives the implementation task.
2. When three agents are available, a second agent receives an independent
   test task that can run in parallel.
3. A remaining agent receives a read-only review task after its dependencies.

This starter strategy is deliberately transparent and does not use an LLM to
route work. Review it with `/plan` or `/preview`. Strategos does not create
worktrees or call an agent until the user explicitly enters `/run`.

## Commands

| Command | Purpose |
| --- | --- |
| `/new [goal]` | Propose another starter strategy. If the goal is omitted, enter it on the next line. |
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

- Starter planning is deterministic rather than LLM-assisted.
- A running task cannot yet be cancelled from the console.
- The console renders a scrolling event stream rather than a full-screen TUI.
- Branch integration remains human-controlled; Strategos does not merge or
  push agent branches automatically.

These boundaries keep the first interactive release dependency-free and
preserve the same safety model as non-interactive execution.
