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

## Project context bar regression check

- Missing-toolbar reference: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-e1f52b27-8e99-41f3-bbe1-85d3b19dc1a5.png`
- Final v0.22.0 capture: `/private/tmp/strategos-v0.22.0-toolbar.jpg`
- Side-by-side comparison: `/private/tmp/strategos-toolbar-comparison.jpg`
- The final New task composer exposes the selected repository, local execution environment, and selectable task base branch directly above the input.
- The project menu opens from the toolbar, identifies the active project, lists registered projects, and exposes the local-project registration action.
- Browser diagnostics reported no console errors.

No actionable P0, P1, or P2 findings remain for the requested session-management flow.

final result: passed

---

# Strategos fixed product-title design QA

## Evidence

- Source visual truth: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-f780b9ae-1eac-48f3-967d-12074c68658a.png`
- Source pixels: 1524 × 1232, including 94 pixels of browser chrome
- Browser-rendered implementation: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/strategos-brand-header-implementation.png`
- Implementation pixels: 1524 × 857 at 1× density; CSS viewport override requested at 1524 × 1144 and capped by the visible in-app browser height
- Focused side-by-side comparison: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/strategos-brand-header-comparison.png`
- Normalization: source header cropped from y=94 to 224; implementation header cropped from y=0 to 130; both comparison regions are 1524 × 130 at 1× density
- State: dark theme, empty New task view, then `workspace-prod-tracking` selected from the Sessions sidebar

## Full-view comparison

The requested change is confined to the persistent product header. The full implementation retains the existing three-column shell, sidebar hierarchy, logo, slogan, version label, colors, and spacing. The source and implementation window heights differ because the in-app browser capped the requested height, so no layout findings were inferred from content below the shared header region.

## Focused-region comparison

- Fonts and typography: the title keeps the existing UI family, weight, line height, and hierarchy, but now reads `Strategos` instead of the selected project name.
- Spacing and layout rhythm: the logo, title stack, slogan, and version keep their existing alignment and gaps; no new wrapping or truncation appears.
- Colors and visual tokens: the existing navy background and text tokens are unchanged.
- Image quality and asset fidelity: the repository's Strategos icon remains sharp and unchanged; no replacement or generated asset was introduced.
- Copy and content: the product name is exactly `Strategos`; `One plan. Every agent aligned.` and `v0.22.0` remain in their established positions.

## Interaction and regression checks

- Switching from `strategos` to `workspace-prod-tracking` leaves the banner title as `Strategos`.
- The selected project remains visible in its project group and in the New task project context control.
- Browser diagnostics reported no warnings or errors.
- `npm run web:check`, `npm run web:test`, and `npm run web:build` passed.

## Comparison history

- Earlier P1: the product title inherited `selected?.goal || data.repository.name`, so selecting a project replaced the software identity with `workspace-prod-tracking`.
- Fix: replace the dynamic title with the fixed product name `Strategos` and record the rule in `web/AGENTS.md`.
- Post-fix evidence: the focused comparison and project-switch DOM capture both show `Strategos` while `workspace-prod-tracking` remains selected elsewhere in the UI.

## Findings

No actionable P0, P1, or P2 findings remain for the requested fixed product title.

## Follow-up polish

No P3 changes are needed for this scoped correction.

final result: passed
