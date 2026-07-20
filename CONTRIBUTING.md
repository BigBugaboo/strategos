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
fnm use --install-if-missing # optional when Node.js 24 is already active
npm ci
npm run verify
```

Run the CLI directly while developing:

```bash
npm start -- --help
npm run doctor
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

Before changing the tested CLI baseline, follow [docs/upgrading.md](docs/upgrading.md)
and update `COMPATIBILITY.md` in the same pull request. Upgrade behavior must
remain non-destructive for source checkouts, npm links, npx caches, and
project-local installations.

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
