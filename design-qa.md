# Terminal Design QA

## Evidence

- Source visual truth:
  `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-9add6e1e-a97a-4db1-96b4-8cafd6511090.png`
- Earlier Strategos comparison:
  `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-25e713df-47a7-4f96-96d9-df208513b2c8.png`
- Implementation pseudo-TTY capture: `/tmp/strategos-workspace-ui.0br1Ab`
- Implementation screenshot: unavailable because the local Computer Use safety
  policy blocks both Warp and Terminal.
- Viewport: 80 terminal columns, dark color-capable pseudo-TTY.
- State: healthy Git, Node.js, Claude Code, Codex CLI, and Copilot CLI; Codex
  selected as strategist; empty input ready for a goal.

## Full-view comparison

The text-mode comparison confirms the intended hierarchy: compact identity,
muted session metadata, compressed healthy state, a strong input boundary, and
visible command guidance. Strategos retains its own wordmark, violet accent,
orchestration language, and approval model. Pixel-level comparison is blocked
without an implementation screenshot.

## Focused-region comparison

Focused image comparison was not performed because no implementation screenshot
could be captured. Automated tests separately cover the 72-column input chrome,
96-column welcome surface, semantic color output, and `NO_COLOR` fallback.

## Findings

- Blocker: a real Warp or Terminal screenshot must be supplied before visual
  fidelity can receive a passing result.
- P3: Strategos uses a scrolling readline console rather than a full-screen
  renderer, so the input guidance repeats after output instead of remaining
  pinned to the bottom. This preserves the zero-dependency and pipe-safe design.

## Comparison history

- Initial reference review identified verbose startup health, weak hierarchy,
  no input boundary, and no persistent command guidance.
- The implementation compressed healthy state, added a branded session header,
  introduced responsive input chrome, and added semantic terminal colors.
- Post-fix pseudo-TTY evidence shows the intended content and control hierarchy;
  post-fix screenshot evidence remains unavailable.

## Implementation checklist

- Brand, version, strategist, and repository path form one compact header.
- Healthy agent details collapse into one scan-friendly status row.
- Node.js and Git versions remain visible without dominating the screen.
- The input separator adapts from 56 to 120 columns.
- Command hints keep planning and `/run` approval visible.
- Semantic colors distinguish brand, success, activity, warning, and error.
- `NO_COLOR`, `TERM=dumb`, redirected stdout, and CI output remain plain.

final result: blocked
