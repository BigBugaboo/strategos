# Contributing

Strategos is intentionally small and local-first. Before opening a change:

1. Create an issue describing the coordination problem.
2. Keep security and permission changes explicit.
3. Run `npm run check` and `npm test`.
4. Include a sample plan when adding orchestration behavior.

## Local development

Strategos requires Node.js 24 or newer. Clone the repository and prepare the
development checkout:

```bash
git clone https://github.com/BigBugaboo/strategos.git
cd strategos
fnm use 24 # optional when Node.js 24 is already active
npm install
npm run check
npm test
```

Run the CLI directly while developing:

```bash
node ./bin/strategos.js --help
node ./bin/strategos.js doctor
```

To exercise `strategos` as a global command against another local repository,
link it from the active Node.js environment:

```bash
npm link
strategos --help
```

Version managers keep global packages isolated. Repeat `npm link` after
switching Node.js installations. Use `npm unlink -g strategos-cli` to remove
the development link.

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
