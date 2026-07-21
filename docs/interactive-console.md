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

## Planning and execution

The `0.7.x` console delegates planning to one installed agent CLI instead of
embedding a model provider:

1. The configured strategist, `codex` by default, is invoked immediately in
   read-only mode when the user enters a goal.
2. The strategist inspects the repository and receives shared project context,
   the available worker names, safety constraints, and the plan JSON schema.
3. It returns a task graph for the healthy worker pool. The default `hybrid`
   pool includes the strategist, so it may plan first and receive a worker task.
4. Strategos extracts the JSON, validates task IDs, agents, modes,
   dependencies, task count, and cycles, then displays the proposed waves.
5. In the default `auto` execution mode, Strategos displays the validated plan,
   renders the dry-run preview, and immediately starts worker tasks.
6. In `manual` mode, Strategos stops after displaying the plan and waits for
   `/preview`, `/save`, or `/run`.

Strategos contains no model SDK, model API integration, or provider key. A goal
does consume one planning call through the selected CLI, but planning creates
no worktree and grants no write permission. Invalid or failed strategist output
is reported as an error rather than replaced with a hidden local plan. The
first `Ctrl+C` during planning warns that interruption will cancel the task;
press it again within three seconds to terminate the strategist process and
return to the console. When no planning call is active, `Ctrl+C` exits
Strategos.

The default can be changed in `.strategos/config.json`:

```json
{
  "strategist": "codex",
  "workerMode": "hybrid",
  "executionMode": "auto",
  "planningTimeoutMinutes": 5,
  "maxPlanningTasks": 12
}
```

`workerMode` controls whether the planning CLI can also work:

| Mode | Behavior |
| --- | --- |
| `hybrid` | Default. Every healthy CLI, including the strategist, is available for worker tasks after planning. The prompt asks the strategist to use all workers when meaningful work exists and to leave final independent review to another agent. |
| `separated` | The strategist plans only and is removed from the worker pool. At least one other healthy CLI is required. |

Changing `/strategist` affects which CLI plans; `workerMode` continues to
control whether that selected CLI is also eligible for execution.

`executionMode` controls what happens after a valid plan is generated:

| Mode | Behavior |
| --- | --- |
| `auto` | Default. Display the plan, run the dry-run preview, and immediately execute it. Entering the goal authorizes both planning and worker execution. |
| `manual` | Display the plan and wait. The user may inspect or save it and must use `/run` to execute it. |

Use `/mode auto` or `/mode manual` to change the current console session. The
setting applies to newly entered goals and does not automatically execute an
already loaded or previously generated plan.

## Commands

| Command | Purpose |
| --- | --- |
| `/new [goal]` | Ask the strategist to produce another plan. If the goal is omitted, enter it on the next line. |
| `/mode [auto\|manual]` | Show or change execution behavior for newly entered goals in this session. |
| `/strategist [agent]` | Show or change the planning CLI for the current session. |
| `/plan` | Show the current task graph and dependency waves. |
| `/load <file>` | Load and validate a JSON plan inside the repository. |
| `/save [file]` | Save the current plan. The default is a timestamped file under `.strategos/plans/`. |
| `/preview` | Validate the current plan and show waves without changing the repository. |
| `/run` | Execute the current plan explicitly. Primarily used in manual mode or after `/load`. |
| `/status [id]` | Show a specific run, or the latest run when no ID is provided. |
| `/agents` | Re-run environment and agent CLI health checks. |
| `/context` | List the shared context files currently present. |
| `/init` | Initialize Strategos without overwriting existing files. |
| `/clear` | Clear an interactive terminal. |
| `/help` | Show command help. |
| `/exit` | Close the console. Idle `Ctrl+C` is the keyboard equivalent. |

## Terminal presentation

Interactive terminals use a compact four-level layout inspired by mature
coding-agent consoles:

1. A Strategos wordmark, version, active strategist, and shortened repository
   path establish the session.
2. Healthy agents and runtime dependencies are summarized on two lines;
   unavailable tools expand into warnings.
3. A dedicated input boundary separates conversation output from the next
   goal or slash command.
4. A muted footer keeps `/help`, the active execution mode, and its
   preview-to-run behavior visible without repeating the full command list.

The presentation uses Strategos colors and wording rather than another tool's
brand assets. Terminal width is clamped to keep separators readable on narrow
and very wide windows. `NO_COLOR=1` disables styling. Non-TTY output, pipes,
logs, and CI never receive ANSI styling, preserving the automation contract.
Use `/agents` when full command versions or failure details are needed.

## Live execution

During automatic or explicit execution, the console reports when the run
starts, each worktree is being prepared, each agent starts, tasks succeed or
fail, dependencies are skipped, and the final manifest is complete. It then
prints task branches and errors for review.

## Repository cleanliness

A real run still requires a clean Git repository. If `/init` or `/save` creates
files, review and commit them before `/run`:

```bash
git add .strategos AGENTS.md .gitignore
git commit -m "configure Strategos orchestration"
```

This ensures every task worktree starts from a reproducible committed `HEAD`.
In auto mode, a dirty repository stops execution after the preview; no worker
starts until the repository is clean and the goal is entered again.

## Current boundaries

- Each goal starts a fresh non-interactive strategist call; native CLI chat
  history is not imported or shared.
- Worker tasks cannot yet be cancelled from the console after execution starts.
  Pressing `Ctrl+C` during execution reports this limitation and keeps the
  console attached until the run finishes.
- The console renders a scrolling event stream rather than a full-screen TUI.
- Branch integration remains human-controlled; Strategos does not merge or
  push agent branches automatically.

These boundaries keep planning provider-neutral and preserve the same safety
model as non-interactive execution.
