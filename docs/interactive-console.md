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

The console delegates planning to one installed agent CLI instead of
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

## Image context

Use `/attach <path>` before entering a goal to add PNG, JPEG, GIF, or WebP
context. Paths may point outside the repository; Strategos validates the file,
copies it into `.strategos/attachments/`, and records a content-derived ID.
Attachments are capped at 20 MB and the storage directory is ignored locally
before the file is written.

On macOS, `/attach` without a path captures the current image clipboard through
the optional `pngpaste` command. Install it with `brew install pngpaste`.
Terminal applications do not expose a raw pasted bitmap to a child readline
process, so Command+V inside Warp or another terminal is not a supported image
transport by itself.

The active images are sent to the strategist and copied to each task worktree.
Codex and Copilot receive their native image/attachment arguments. Claude and
custom adapters receive the local paths in the prompt and may read the files
from the worktree. `/attachments` lists selected images; `/detach <id>` or
`/detach all` removes them from the current context without deleting durable
files that an older session may need.

## Single-CLI multi-session mode

At least one supported CLI is sufficient in the default `hybrid` worker mode.
When the healthy worker pool contains only one CLI, the planning prompt asks it to split genuinely independent work
without inventing artificial or overlapping tasks. Every task is still a fresh
process/session with a UUID, task name, isolated worktree, branch, prompt, and
report. Claude and Copilot receive the native session ID; Codex `exec` already
starts a fresh provider session, while Strategos records its own UUID in the
manifest. Ready tasks run concurrently up to `maxParallel`.

## Recovery and resume

Every goal creates a durable, repository-local session journal. Strategos
checkpoints the original goal, selected strategist and workers, generated plan,
preview state, image metadata, run ID, bounded execution events, task reports,
final manifest, and the latest error. Writes are atomic so a partially written checkpoint does
not replace the last valid state.

Session files live under `.git/strategos/sessions/`, outside the tracked working
tree. They do not require a `.gitignore` rule and cannot make an otherwise clean
repository fail the execution gate. They remain local and are never sent
anywhere except as bounded prompt context to the installed strategist CLI when
the user explicitly resumes a session.

At startup, the console identifies the newest planning, planned, previewed,
running, failed, or interrupted session and displays a recovery hint. Use
`/resume` to open the interactive session picker. Each choice shows a title and
a description containing status, age, strategist, task progress, and the last
error when available. Use Up/Down to move, Enter to resume, or Esc to return to
the console. `/resume <id>` skips the picker and remains suitable for scripts or
for a session shown by `/sessions`.
Strategos invokes the selected strategist again in read-only mode with the
saved context and current repository. The recovery prompt requires it to
account for completed work and produce only remaining tasks and verification.
The active `auto` or `manual` execution mode then applies normally.

Entering an unrelated new goal marks the previously offered session as
`abandoned`, preventing repeated startup prompts. It remains inspectable in
`/sessions` and can still be resumed explicitly by ID. Successfully completed
sessions also remain inspectable but are never offered for recovery.

## Commands

| Command | Purpose |
| --- | --- |
| `/new [goal]` | Ask the strategist to produce another plan. If the goal is omitted, enter it on the next line. |
| `/mode [auto\|manual]` | Show or change execution behavior for newly entered goals in this session. |
| `/strategist [agent]` | Show or change the planning CLI for the current session. |
| `/attach [path]` | Attach an image path, or capture the macOS image clipboard when no path is supplied. |
| `/attachments` | List image context selected for the next goal or current session. |
| `/detach <id\|all>` | Remove one or all images from the current context. |
| `/plan` | Show the current task graph and dependency waves. |
| `/load <file>` | Load and validate a JSON plan inside the repository. |
| `/save [file]` | Save the current plan. The default is a timestamped file under `.strategos/plans/`. |
| `/preview` | Validate the current plan and show waves without changing the repository. |
| `/run` | Execute the current plan explicitly. Primarily used in manual mode or after `/load`. |
| `/status [id]` | Show a specific run, or the latest run when no ID is provided. |
| `/sessions` | List the ten most recent durable sessions, including completed and abandoned sessions. |
| `/resume [id]` | Choose a resumable session interactively, or re-plan a specific session ID directly. |
| `/web [port]` | Start the local Web UI in the background. The default port is `4310`; the service keeps running after the console exits. |
| `/web restart` | Restart the background Web UI while preserving its current host and port. |
| `/web stop` | Stop this repository's background Web UI. The equivalent shell command is `strategos web stop`. |
| `/agents` | Re-run environment and agent CLI health checks. |
| `/reload` | Re-read project configuration and refresh agent CLI availability without leaving the current console. |
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

- Each goal or recovery attempt starts a fresh non-interactive strategist call.
  Native vendor chat history is not imported; recovery uses the provider-neutral
  Strategos journal instead.
- Worker tasks cannot yet be cancelled from the console after execution starts.
  Pressing `Ctrl+C` during execution reports this limitation and keeps the
  console attached until the run finishes.
- The console renders a scrolling event stream rather than a full-screen TUI.
- Branch integration remains human-controlled; Strategos does not merge or
  push agent branches automatically.

These boundaries keep planning provider-neutral and preserve the same safety
model as non-interactive execution.
