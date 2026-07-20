# Strategos contributor guidance

## Mission

Strategos is a local-first coordinator for existing coding-agent CLIs. It does
not replace agent subscriptions, hide permission bypasses, or merge generated
changes without review.

## Commands

- Syntax check: `npm run check`
- Test: `npm test`
- Local doctor: `node bin/strategos.js doctor`
- Dry-run the example: `node bin/strategos.js run examples/feature-plan.json --dry-run`

## Engineering rules

- Use English for commit messages, branch names, identifiers, source-code
  comments, technical documentation, issues, pull requests, and review comments.
  Localized user-facing documentation such as `README.zh-CN.md` is the explicit
  exception.
- Keep the runtime dependency-free unless a dependency removes substantial,
  well-tested complexity.
- Pass subprocess arguments as arrays. Never build shell command strings from
  task prompts.
- Treat worktrees as the write-isolation boundary.
- Never enable dangerous approval or sandbox bypass flags by default.
- Keep generated run artifacts under `.strategos/runs/`.
- A task failure must not discard successful sibling task reports.

## Definition of done

- Relevant tests pass.
- User-visible behavior is documented in `README.md`.
- Security-sensitive defaults are called out explicitly.
