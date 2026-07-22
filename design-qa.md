# Strategos session manager design QA

## Evidence

- Source visual truth: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-8b69f45a-55f8-44b0-b675-2e0a4de4d9b6.png`
- Source pixels: 578 × 1564
- Runtime: `http://127.0.0.1:4310/`
- Runtime build: `index-AhaxuEZL.css` and `index-DyJNUqbH.js`
- Inspection viewport: 1280 × 720
- State: session sidebar visible, workspace project expanded, manager dialog open with two persisted sessions

## Full-view comparison

The source marks the right edge of the `Sessions` heading as the intended entry point. The implementation places a quiet gear button in that exact header row, aligned with the label and inside the existing sidebar gutter. The icon inherits the sidebar's muted color and only gains emphasis on hover or keyboard focus, so it does not compete with `New task` or the active project.

Opening the gear presents a centered `Manage sessions` dialog instead of changing the sidebar into a destructive mode. This preserves project navigation while providing a complete cross-project inventory, multi-selection, select-all behavior, and clear Archive, Restore, and Delete actions.

## Focused-region comparison

- Placement: gear aligned to the right of `Sessions`, matching the annotated source region.
- Hit area: 26 × 26 pixels with an accessible `Manage sessions` label and tooltip.
- Visual hierarchy: no filled container at rest; existing purple accent appears on focus.
- Modal rhythm: project groups, rows, and the sticky action footer use the existing navy surfaces, borders, typography, and spacing tokens.
- Responsive behavior: on narrow viewports the dialog expands to the available width and the action bar wraps without clipping.

## Interaction QA

- Gear opens the batch manager and close restores focus to the trigger.
- Escape and backdrop clicks close the dialog; focus is trapped while it is open.
- Select all and individual checkboxes update the selected count and action availability.
- Archive and Restore persist through the session store and immediately update the sidebar.
- Delete requires a second confirmation and explicitly states that saved run artifacts remain on disk.
- Active sessions are disabled in the UI and rejected by the API.
- Empty selections and more than 100 IDs are rejected by the API.

## Verification

- `npm run check`: passed
- `node --test test/session.test.js test/web-server.test.js test/web-daemon.test.js`: 17 tests passed
- `npm run web:check`: passed
- `npm run web:test`: 12 tests passed
- `npm run web:build`: passed
- `git diff --check`: passed
- Background runtime: HTTP 200 on port 4310 after the invoking terminal exited

No actionable P0, P1, or P2 findings remain for the requested session-management flow.

final result: passed
