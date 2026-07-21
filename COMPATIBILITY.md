# Compatibility

Strategos integrates with external agent CLIs through their command-line
interfaces. Those interfaces can change independently, so compatibility is
tracked as a tested baseline rather than as an exact runtime pin.

## Current baseline

The Strategos `0.11.x` line is validated with Node.js 24 and the following agent
CLI releases:

| Agent CLI | Tested version | Command surface used by Strategos |
| --- | ---: | --- |
| Claude Code | `2.1.215` | `-p`, `--output-format`, `--json-schema`, `--permission-mode`, `--tools`, `--session-id`, `--name` |
| OpenAI Codex CLI | `0.144.6` | `exec`, `--sandbox`, `--output-schema`, `--color`, `--image`, `-C` |
| GitHub Copilot CLI | `1.0.71` | `-p`, `--no-ask-user`, `--output-format`, `--available-tools`, `--attachment`, `--session-id`, `--name` |

The Web UI is built with the Vite+ `vp` CLI `0.2.4`, local `vite-plus` packages
from `web/pnpm-lock.yaml`, Vite `8.x`, and React `19.x`. Vite+ manages Node.js
24 and pnpm for Web development; the packaged Strategos runtime still only
requires Node.js 24.

These are the versions exercised during the latest compatibility check. They
are not hard pins: newer releases may work without changes, but are considered
verified only after the checks below pass. Older releases are outside the
tested support baseline.

## Validation policy

When an agent CLI baseline changes, maintainers should verify:

1. `strategos doctor` detects the installed CLI and reports its version.
2. `npm run verify` passes on Node.js 24, including Vite+ check, test, and build.
3. A read-only smoke task completes through the updated CLI adapter.
4. A write task remains inside its assigned Git worktree and permission mode.

Any upstream change to the listed command surface should be treated as a
potential adapter compatibility change and documented here with the release
that was tested.
