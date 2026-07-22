# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Durable design decisions

- Keep the Web UI visually quiet and dense: a flat graphite/navy shell with thin separators, limited borders, and no dashboard card grid.
- Use the selected Codex-style three-column layout: navigation plus session history on the left, chat and composer in the center, session/run context on the right.
- Keep project selection in the left navigation at the same hierarchy as session history; reserve the header for compact active-project context.
- Group sessions under collapsible project headings instead of maintaining separate project and history lists. Keep pinned sessions at the top of their project.
- Keep Settings anchored at the bottom of the left navigation; do not add a separate Runs module or “View all sessions” action because the project-grouped Sessions list is the navigation surface for saved work.
- Keep the Settings action row separated from the final field divider with 24 pixels of vertical space.
- Keep task notifications opt-in and project-scoped. Request browser permission only after an explicit user action, expose separate success and failure preferences, and explain that the Web UI must remain open for delivery.
- Do not add provider quota controls or quota-based scheduling. CLI availability comes from local health checks and each agent's `enabled` configuration.
- The primary experience is conversation-first. New task, Settings, session selection, attachments, Auto/Manual mode, Run, and Resume must remain functional.
- Keep the new-task surface focused on the composer. Show the right-hand inspector only for a selected chat session, and let users collapse it without losing session state.
- Treat keyboard and transient UI behavior as part of the product: focus the composer for new tasks, support Command/Control-K, close popovers with Escape or outside click, and expose mode choices with descriptions.
- Keep the composer IME-safe: Enter confirms an active input-method composition, plain Enter sends only after composition ends, and Shift+Enter inserts a new line.
- Reuse the repository's Strategos icon and Phosphor icons. Do not replace them with emoji, handcrafted SVGs, or CSS-drawn icons.
