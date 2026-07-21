# Compatibility

Strategos integrates with external agent CLIs through their command-line
interfaces. Those interfaces can change independently, so compatibility is
tracked as a tested baseline rather than as an exact runtime pin.

## Current baseline

The Strategos `0.9.x` line is validated with Node.js 24 and the following agent
CLI releases:

| Agent CLI | Tested version | Command surface used by Strategos |
| --- | ---: | --- |
| Claude Code | `2.1.215` | `-p`, `--output-format`, `--json-schema`, `--permission-mode`, `--tools` |
| OpenAI Codex CLI | `0.144.6` | `exec`, `--sandbox`, `--output-schema`, `--color`, `-C` |
| GitHub Copilot CLI | `1.0.71` | `-p`, `--no-ask-user`, `--output-format`, `--available-tools` |

These are the versions exercised during the latest compatibility check. They
are not hard pins: newer releases may work without changes, but are considered
verified only after the checks below pass. Older releases are outside the
tested support baseline.

## Validation policy

When an agent CLI baseline changes, maintainers should verify:

1. `strategos doctor` detects the installed CLI and reports its version.
2. `npm run check` and `npm test` pass on Node.js 24.
3. A read-only smoke task completes through the updated CLI adapter.
4. A write task remains inside its assigned Git worktree and permission mode.

Any upstream change to the listed command surface should be treated as a
potential adapter compatibility change and documented here with the release
that was tested.
