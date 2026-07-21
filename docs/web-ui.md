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

The production assets are built into `web/dist` and served by the Strategos
process. Configuration remains in `.strategos/config.json`; durable sessions
remain under the repository's Git metadata; run manifests remain in
`.strategos/runs/`.

The packaged UI contains no seeded demo sessions or quota fixtures. Repository
identity, CLI health, capacity settings, session history, plans, task events,
and changed files are loaded from the local Strategos API. A repository with no
saved sessions opens in the empty New task state.

## Project context

The repository used to start `strategos web` is the initial project. Use the
project selector in the header to add another local path. Strategos resolves the
path to its Git root, rejects paths outside an accessible Git repository, and
stores the local project list in `~/.strategos/projects.json`.

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

The Vite+ development server proxies `/api` to `127.0.0.1:4311`. Before a
commit, run the complete verification flow:

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

## Capacity policy

The supported providers do not expose a shared, stable quota command with the
same units and reset semantics. Strategos therefore separates CLI health from
capacity:

- `strategos doctor` determines whether a CLI is installed and runnable.
- Web Settings records capacity as `Available`, `Unknown`, or `Exhausted`, with
  an optional remaining percentage supplied by the user.
- `Exhausted` CLIs are excluded from strategist fallback and worker assignment
  when `excludeExhausted` is enabled, which is the default.
- `Unknown` CLIs stay eligible. Strategos never turns missing quota data into a
  fabricated exact percentage. Missing or unreadable capacity is normalized to
  `Unknown`, even if a stale configuration previously marked the CLI available.
- Capacity is a scheduling guard, not a billing meter. Provider dashboards
  remain the source of truth.

## Main flow

1. Start a new task, optionally attach PNG, JPEG, GIF, or WebP context, and
   choose Auto or Manual mode.
2. An eligible strategist CLI reads the repository and creates the task graph.
3. Auto mode displays the plan and starts eligible workers. Manual mode waits
   for the Run action.
4. The right inspector streams task events and shows the saved run manifest.
5. Select a history item to inspect it. Failed or interrupted sessions expose
   Resume, which sends the durable context back to the strategist.

Worker branches are never merged or pushed automatically.
