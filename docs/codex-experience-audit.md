# Codex experience alignment audit

This audit covers the complete local Strategos Web shell against the supplied
Codex-style reference and the interaction patterns of a task-oriented coding
client. Evidence was captured from the production Web build at
`http://127.0.0.1:4310/` during implementation. No demo sessions or quota data
were introduced.

## Reviewed flow

1. Launch and loading state.
2. Start a new task and focus the prompt.
3. Switch Auto or Manual execution mode.
4. Add and remove image context.
5. Add or switch a local project.
6. Navigate Session history and the full Runs view.
7. Inspect an active, completed, failed, or interrupted Session.
8. Collapse and reopen Session details.
9. Edit and save orchestration and CLI-capacity settings.
10. Recover from empty, loading, validation, and request-error states.
11. Navigate with keyboard and visible focus.
12. Use the shell at desktop, compact desktop, and phone widths.

## Findings and resolution

- The previous empty state competed with the composer. It is now smaller and
  the new-task flow focuses the prompt automatically.
- Auto and Manual previously looked like a binary toggle without explaining
  consequences. They are now menu choices with outcome descriptions and
  selected-state semantics.
- The right inspector previously occupied space even without a selected
  Session. It now appears only when it has relevant Session context and can be
  collapsed or restored.
- The project picker previously behaved like an inline form. It now presents a
  focused local-project dialog pattern, closes with Escape or outside click,
  and preserves the Projects/Sessions hierarchy.
- Attachments previously appeared only as a count. Every selected image now has
  a readable filename and a remove action before submission.
- Settings previously looked actionable even when unchanged. Save is disabled
  until the form is dirty and keeps its existing success/error announcement.
- The desktop shell now uses a quieter flat surface, compact active-project
  context, an 820-pixel conversation measure, and a denser Codex-like composer.
- Compact layouts preserve new task, runs, settings, active project, composer,
  execution mode, and send controls without horizontal overflow.

## Accessibility review

- Active navigation uses `aria-current`; the selected project exposes both
  `aria-current` and `aria-pressed`.
- Mode selection uses `menuitemradio`, `aria-checked`, `aria-haspopup`, and
  `aria-expanded`.
- Every icon-only action has an accessible name and visible focus remains
  available for keyboard users.
- Composer, project path, capacity controls, disclosures, live status, and
  errors keep explicit labels or live-region semantics.
- Reduced-motion preferences disable nonessential animation.

Automated browser inspection cannot replace screen-reader testing on each
supported operating system. VoiceOver announcement order and high-contrast
theme behavior remain manual release checks.
