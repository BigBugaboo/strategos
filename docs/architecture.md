# Architecture

## Principles

1. Existing agent CLIs remain responsible for authentication and model access.
2. The task graph is explicit, inspectable, and versionable.
3. Shared context is compiled into prompts; native vendor transcripts are not
   treated as portable state.
4. Worktrees isolate writes. A human controls integration.
5. Failure is local to a task whenever possible.

## Components

```text
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

## Non-goals for v0.1

- Porting native conversation histories between vendors.
- Automatic branch merging or pushing.
- Claiming worktree isolation is a security sandbox.
- An LLM-controlled scheduler with hidden routing decisions.
