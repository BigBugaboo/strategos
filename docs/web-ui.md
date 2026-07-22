# Local Web UI

Strategos Web is a local Vite+ interface over the existing CLI orchestrator. It
does not add a model SDK, hosted service, or additional AI account. The browser
talks to a localhost Node.js server, which invokes the same authenticated
Claude Code, Codex CLI, and GitHub Copilot CLI adapters as the terminal console.

## Packaged startup

Run this inside the Git repository you want Strategos to orchestrate:

```bash
strategos web
```

Then open `http://127.0.0.1:4310`. The command accepts `--host HOST` and
`--port PORT`. Keep the default localhost binding unless another device
intentionally needs access to the process.

`strategos web` starts a detached background process and returns after the
server is ready. Closing the terminal does not stop it. Stop the service from
the same repository with:

```bash
strategos web stop
```

Restart it while preserving the recorded host and port with:

```bash
strategos web restart
```

Pass `--host` or `--port` to the restart command only when the listener should
change.

Starting it again is idempotent and reports the existing URL. Runtime state is
stored in `.strategos/web.json` with owner-only permissions; daemon output is
appended to `.strategos/web.log`. The stop command authenticates to the exact
recorded process before requesting shutdown, and stale state is removed when
the recorded process no longer exists.

The production assets are built into `web/dist` and served by the Strategos
process. Configuration remains in `.strategos/config.json`; durable sessions
remain under the repository's Git metadata; run manifests remain in
`.strategos/runs/`.

Each completed task with file changes also stores `changes.diff` beside its
report. The inspector's **Files changed** list loads this patch only after a
file is selected, then renders the selected file in a read-only code view.
Unified view is the default and Split view is available from the diff toolbar.
Historical runs created before diff persistence show the filename with a clear
"Diff unavailable" state.

Diff access is deliberately narrow: the API resolves artifacts from the
selected project, Session run ID, and validated task ID rather than accepting a
filesystem path. Stored and served patches are limited to 2 MiB. Binary files
are reported without attempting a text preview, and oversized patches are
truncated at a complete file boundary.

The packaged UI contains no seeded demo sessions. Repository
identity, CLI health, orchestration settings, session history, plans, task events,
and changed files are loaded from the local Strategos API. A repository with no
saved sessions opens in the empty New task state.

Settings can enable project-level desktop notifications for successful tasks
and for failed or interrupted tasks. Enabling the master switch requests the
browser's notification permission. Notifications are emitted by the open Web
UI when an active Session reaches a terminal state; they are not a background
daemon and are not delivered after every Strategos tab is closed. Settings
persist each control change immediately without a manual save action.

## Project context

The repository used to start `strategos web` is the initial project. Use the
Sessions section in the left sidebar or the context bar above the New task
composer to switch among registered local paths. The context bar shows the
selected repository, local execution environment, and task base branch, and
also provides the local-project registration flow. On macOS, Browse opens the
native folder picker; manual path entry remains available on every platform.
The branch control searches local branches, creates a branch from the selected
base when needed, and selects the base used to create new isolated worker worktrees.
Saved work opens directly
from the project-grouped Sessions list rather than a separate Runs page.
Strategos resolves each path to its Git root, rejects paths
outside an accessible Git repository, and stores the local project list in
`~/.strategos/projects.json`.

The gear beside the Sessions heading opens a cross-project batch manager. It
can archive, restore, or delete multiple Session journals. Archive is reversible
and hides the Session from the regular sidebar. Delete requires confirmation
and does not remove saved run artifacts. Active Sessions are excluded from
these operations.

Every Web request carries the selected project path. Configuration, durable
sessions, attachments, repository context collection, strategist planning,
worktrees, runs, and changed-file reporting are all resolved from that project.
Switching projects therefore changes the AI working context rather than only
changing a label in the interface. Project paths and context remain local.

## Vite+ source workflow

Install Vite+ once on macOS or Linux:

```bash
curl -fsSL https://vite.plus | bash
```

Clone and install both workspaces:

```bash
git clone https://github.com/BigBugaboo/strategos.git
cd strategos
fnm use --install-if-missing
npm ci
npm run web:install
```

Run the local API and Vite+ development server in two terminals:

```bash
npm run web:api
```

```bash
npm run web:dev
```

The API command returns after starting the background service. The Vite+
development server proxies `/api` to `127.0.0.1:4311`; run
`strategos web stop` when development is finished. Before a commit, run the
complete verification flow:

```bash
npm run verify
```

Its Web portion is equivalent to:

```bash
cd web
vp check src vite.config.mjs package.json index.html
vp test --run
vp build
```

## Agent availability

`strategos doctor` determines whether a configured CLI is installed and
runnable. Healthy CLIs participate in strategist fallback and worker assignment
unless their agent configuration sets `enabled` to `false`. Strategos does not
track provider quota or billing; use each provider's CLI or dashboard for that
information.

## Main flow

1. Start a new task, optionally attach PNG, JPEG, GIF, or WebP context, and
   choose Auto or Manual mode.
2. An eligible strategist CLI reads the repository and creates the task graph.
3. Auto mode displays the plan and starts eligible workers. Manual mode waits
   for the Run action.
4. The right inspector streams task events and shows the saved run manifest.
   Select a file under **Files changed** to review its saved patch in Unified or
   Split layout.
5. While planning or workers are active, use **Stop session** in the inspector
   to terminate the session's local CLI process group. The session is saved as
   interrupted; generated worktrees and evidence remain on disk.
6. Select a history item to inspect it. Failed or interrupted sessions expose
   Resume, which sends the durable context back to the strategist.

Worker branches are never merged or pushed automatically.

## Web interaction model

- A new task focuses the composer automatically. Press `Enter` to submit or
  `Shift+Enter` to add a line.
- Press `Command+K` on macOS or `Control+K` elsewhere to return to the chat and
  focus the composer. Press `Command+,` or `Control+,` to open Settings.
- Auto and Manual are explicit menu choices. Auto previews the generated plan
  and starts workers; Manual waits for approval after preview.
- Attached images appear above the prompt and can be removed before submission.
- The right details panel appears only for a selected Session. It can be closed
  and reopened without changing the selected Session.
- Stop session uses an inline confirmation. After termination completes, the
  same Session exposes Resume with its saved goal, plan, events, and run state.
- Project and mode menus close with `Escape`; transient menus also close when
  focus moves to another part of the interface.
