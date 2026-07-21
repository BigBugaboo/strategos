# Terminal Design QA

## Evidence

- Source visual truth:
  `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-9add6e1e-a97a-4db1-96b4-8cafd6511090.png`
- Earlier Strategos comparison:
  `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-25e713df-47a7-4f96-96d9-df208513b2c8.png`
- Implementation screenshot:
  `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-5fe0d333-35f9-4d59-ac35-38ed358dcda6.png`
- Reference viewport: 2130 × 732 pixels, dark terminal, empty input state.
- Implementation viewport: 2222 × 1300 pixels, dark terminal, completed
  planning state with the next input ready.
- Shared state: `workspace-prod-tracking`, Codex selected as strategist, healthy
  Git, Node.js, Claude Code, Codex CLI, and Copilot CLI.

The screenshots use similar desktop widths but different heights and
interaction states. The comparison therefore treats the shared startup and
input regions as the fidelity target and avoids claiming pixel-level parity for
the plan output, which is not present in the reference.

## Full-view comparison

The implementation now has the same useful hierarchy as the reference:
identity and session metadata are compact, warnings and health information are
visually separated, the active input has a strong boundary, and secondary
guidance is muted. Strategos keeps its own violet brand, multi-agent health
summary, and explicit plan-review-run language instead of copying Claude's
mascot, permission modes, or product-specific controls.

No P0, P1, or P2 differences are visible in the shared regions. The additional
plan table and dependency flow remain readable at the captured width, and the
current prompt is visible without scrolling.

## Focused-region comparison

- Header: the Strategos wordmark, version, active strategist, and repository
  path form a compact session identity comparable to the Claude header.
- Health: three agents and the Node.js/Git runtime fit into two scan-friendly
  rows; green status tokens are visible without dominating the screen.
- Input: the full-width separator, violet commands, prompt, and cursor create a
  clear interaction boundary with strong focus visibility.
- Plan: semantic cyan and green status labels separate planning from the result;
  the task table, dependency flow, and next actions remain aligned and legible.

Additional crops were not needed because the original-resolution screenshots
make the typography, separators, prompt, status tokens, and table text readable.

## Required fidelity surfaces

- Fonts and typography: passed. Warp's monospace family, bold hierarchy, muted
  metadata, line height, Chinese fallback glyphs, and command accents are
  consistent and readable.
- Spacing and layout rhythm: passed. Section gaps distinguish identity, health,
  input, planning, plan content, and the next prompt without excessive framing.
- Colors and visual tokens: passed. Violet is reserved for Strategos and
  commands, cyan for activity, green for success and healthy agents, and gray
  for secondary information; contrast is appropriate for the dark terminal.
- Image quality and asset fidelity: passed. Strategos intentionally uses its own
  typographic identity; no source logo, illustration, icon, or image asset is
  replaced with a code-drawn approximation.
- Copy and content: passed. The strategist-first behavior and `/run` approval
  boundary are explained directly, while the plan output uses task-specific
  content rather than placeholder text.

## Findings

There are no actionable P0, P1, or P2 findings.

- P3: readline preserves the earlier command-hint row in terminal history while
  showing a new row at the active prompt. This is an accepted consequence of the
  dependency-free scrolling console and avoids introducing a full-screen TUI.
- P3: multi-task dependency cells use compact comma separators. Adding a space
  after commas could improve dense-plan readability in a future polish pass.

## Comparison history

- Initial reference review found verbose startup health, weak hierarchy, no
  input boundary, and no persistent command guidance.
- The v0.5 implementation compressed healthy state, added a branded session
  header, introduced responsive input chrome, and added semantic terminal
  colors. Pseudo-TTY verification passed, but screenshot QA remained blocked.
- The user-supplied Warp screenshot resolved the capture blocker. Direct visual
  comparison found the earlier hierarchy issues fixed and no remaining P0, P1,
  or P2 mismatch.

## Implementation checklist

- Keep the dependency-free, pipe-safe readline architecture.
- Preserve `NO_COLOR`, `TERM=dumb`, and non-TTY behavior.
- Retain the current Strategos identity and explicit `/run` approval boundary.
- Treat repeated history hints and comma spacing as optional P3 follow-up only.

final result: passed
