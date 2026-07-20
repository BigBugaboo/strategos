# Upgrading Strategos and Agent CLIs

Strategos can be invoked from several Node.js installation environments. Its
upgrade flow detects the active package location before changing anything, so
an update does not silently replace a source checkout or development link.

## Recommended flow

First inspect the installation mode and planned command:

```bash
strategos upgrade --dry-run
```

For a persistent global npm installation, apply the update and verify it:

```bash
strategos upgrade
strategos --version
strategos doctor
```

`strategos update` is an alias for `strategos upgrade`.

## Installation modes

| Detected mode | Upgrade behavior |
| --- | --- |
| Global npm package | Installs the latest GitHub default branch into the active global npm prefix and verifies `strategos --version`. |
| Source checkout or `npm link` | Does not modify Git automatically; prints `git pull --ff-only`, `npm ci`, and `npm link` commands for the detected checkout. |
| Temporary `npx` package | Does not create a persistent install; prints an `npx --prefer-online` command for the next invocation. |
| Project-local package | Does not change the consuming project automatically; prints the local npm install command. |

Automatic upgrades use the hard-coded package source
`github:BigBugaboo/strategos`. Arbitrary package URLs are not accepted by the
upgrade command.

## Manual commands

Persistent GitHub installation:

```bash
npm install --global github:BigBugaboo/strategos
```

Source checkout or development link:

```bash
git pull --ff-only
fnm use --install-if-missing
npm ci
npm run verify
npm link
```

Fresh one-shot execution that prefers current remote metadata:

```bash
npx --yes --prefer-online github:BigBugaboo/strategos --version
```

## Pinning and rollback

For a controlled deployment, install a known Git tag or commit instead of the
moving default branch:

```bash
npm install --global github:BigBugaboo/strategos#<tag-or-commit>
strategos --version
strategos doctor
```

Keep the selected tag or commit in team setup documentation so every machine
uses the same revision.

## Recovering from `command not found`

Node.js version managers isolate global npm packages. Confirm which runtime and
global prefix are active, reinstall there, and refresh the shell command cache:

```bash
node --version
npm prefix --global
npm install --global github:BigBugaboo/strategos
rehash # zsh only
command -v strategos
strategos --version
strategos doctor
```

If the command works in one repository but not another, compare `node --version`
and `npm prefix --global` in both directories. Tools such as fnm, Vite+, and nvm
may switch Node.js automatically when the working directory changes.

## Upgrading agent CLIs

Strategos does not update Claude Code, Codex CLI, or Copilot CLI on their
behalf. Upgrade each provider through its own supported command, then validate
the complete toolchain:

```bash
claude update
codex update
copilot update
strategos doctor
```

After changing the tested provider versions, run `npm run verify`, complete one
read-only smoke task per updated adapter, and update `COMPATIBILITY.md` with the
versions that actually passed.
