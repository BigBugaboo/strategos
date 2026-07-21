# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Keep the Web UI visually quiet and dense: a flat graphite/navy shell with thin separators, limited borders, and no dashboard card grid.
- Use the selected Codex-style three-column layout: navigation plus session history on the left, chat and composer in the center, session/run context on the right.
- Keep project selection in the left navigation at the same hierarchy as session history; the product header is reserved for global identity and CLI capacity.
- Keep CLI quota at the top of the product and show exhausted providers as disabled; the orchestration layer must exclude them from planning and execution.
- The primary experience is conversation-first. New task, Runs, Settings, session selection, attachments, Auto/Manual mode, Run, and Resume must remain functional.
- Reuse the repository's Strategos icon and Phosphor icons. Do not replace them with emoji, handcrafted SVGs, or CSS-drawn icons.
