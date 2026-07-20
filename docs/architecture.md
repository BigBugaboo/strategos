# Architecture

## Principles

1. Existing agent CLIs remain responsible for authentication and model access.
2. The task graph is explicit, inspectable, and versionable.
3. Shared context is compiled into prompts; native vendor transcripts are not
   treated as portable state.
4. Worktrees isolate writes. A human controls integration.
5. Failure is local to a task whenever possible.
6. Interactive input authorizes one read-only planning call; it never implies
   permission to execute worker tasks.

## Components

```text
User goal
   │
   ▼
Strategist CLI (read-only)
   │ JSON task graph
   ▼
plan.json
   │
   ▼
Plan validator ──► dependency waves
                       │
                       ▼
Context compiler ─► task prompt
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Claude    Codex   Copilot
              │        │        │
              ▼        ▼        ▼
          worktree  worktree  worktree
              └────────┼────────┘
                       ▼
           reports + run manifest
```

### Plan validator

Normalizes task modes, checks agent names and references, and rejects cycles
before any worktree is created.

### Strategist planner

The planner invokes one existing agent CLI through the same adapter boundary
used by workers, but always in read-only mode and in the target repository. It
supplies the goal, shared context, available worker capabilities, and the plan
schema. Strategos extracts and validates the returned JSON; it has no model SDK
or direct provider API dependency. The strategist is excluded from worker
assignment when another healthy CLI is available.

### Interactive console

Running `strategos` without a subcommand starts a zero-dependency readline
console. Ordinary text is converted into a strategist-generated task graph by
invoking the selected strategist CLI in read-only mode. The user must
explicitly enter `/run` before worker orchestration begins. Slash commands
provide strategist selection, plan loading, saving, previewing, execution, run
status, agent health, and context inspection.

The console consumes structured progress events from the orchestrator. Event
rendering is isolated from execution so terminal output failures cannot stop a
run.

### Context compiler

Each task receives:

- the overall goal and its own assignment;
- `AGENTS.md`, `.strategos/context.md`, and `.strategos/memory.md`;
- plan-level and task-level context files;
- completed dependency reports;
- a consistent completion contract.

Context paths must stay inside the repository and are capped by
`maxContextBytes`.

### Scheduler

The scheduler runs ready tasks up to `maxParallel`. Worktrees are created
serially to avoid concurrent Git metadata mutations, then agent processes run
in parallel. A failed task causes dependants to be marked skipped while
independent siblings remain available.

### Adapter boundary

Adapters return a command plus an argument array. Strategos never creates a
shell command by concatenating prompts. Provider-specific permission defaults
live only in `src/adapters.js`.

### Evidence store

The orchestrator owns `.strategos/runs/`. Agent processes only work inside
their assigned worktrees. `run.json` is the machine-readable source of truth;
Markdown and log files are review artifacts.

### Upgrade boundary

The upgrade module detects whether Strategos is running from a global npm
package, an npx cache, a source checkout or npm link, or a project-local
dependency. Only a confirmed global npm installation is updated automatically.
Other modes receive explicit commands so package-manager state and source
checkouts are not silently replaced.

## Non-goals for v0.4

- Porting native conversation histories between vendors.
- Automatic branch merging or pushing.
- Claiming worktree isolation is a security sandbox.
- An LLM-controlled scheduler with hidden routing decisions.
