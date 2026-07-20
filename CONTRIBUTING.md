# Contributing

Strategos is intentionally small and local-first. Before opening a change:

1. Create an issue describing the coordination problem.
2. Keep security and permission changes explicit.
3. Run `npm run check` and `npm test`.
4. Include a sample plan when adding orchestration behavior.

## Project language

Use English for:

- commit messages and branch names;
- identifiers and source-code comments;
- technical documentation;
- issue and pull-request titles and descriptions;
- code-review comments.

Localized user-facing documentation is welcome when it uses a clear locale
suffix, such as `README.zh-CN.md`. The English document remains the canonical
technical reference.

Bug reports should include the operating system, Node version, agent CLI
versions, the redacted plan, and the run manifest under `.strategos/runs/`.
