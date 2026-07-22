# New task project context bar design QA

## Evidence

- Source layout: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-48ee2f41-6fdf-436f-bfb9-09f683bb58b8.png` (3026 × 1896 pixels, normalized from 2× to a 1513 × 948 CSS target)
- Source component reference: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-e94c344d-d9bf-4ec6-9992-f43e4a46e6ce.png` (1450 × 402 pixels)
- Implementation capture: `/private/tmp/strategos-project-toolbar-new-task.png` (1337 × 948 captured pixels)
- Open-menu capture: `/private/tmp/strategos-project-toolbar-menu.png` (1337 × 948 captured pixels)
- Full-view comparison: `/private/tmp/strategos-project-toolbar-comparison.png`
- Focused composer comparison: `/private/tmp/strategos-project-toolbar-detail-comparison.png`
- Browser CSS viewport: 1513 × 948; the in-app browser returned a 1337 × 948 visible-tab capture, so the full comparison scales the implementation horizontally to the source CSS target. Device density was otherwise treated as 1×.
- Runtime: production Web assets served by `strategos web` at `http://127.0.0.1:4323/`
- State: empty New task, project context bar closed and open-menu variants

## Full-view comparison

The source and implementation were placed in one side-by-side comparison. The implementation preserves the existing Strategos dark shell, sidebar proportions, centered empty state, and bottom composer position. The requested context bar occupies the annotated space immediately above the composer without moving or obscuring the primary input.

## Focused comparison

The source component and rendered composer were placed in one focused comparison. Both use a narrow toolbar attached behind the top edge of the composer, with repository, local environment, and branch ordered from left to right. The implementation intentionally keeps Strategos dark tokens and English product copy instead of copying the reference's light theme and localized labels.

## Fidelity surfaces

- Fonts and typography: existing Strategos system-sans typography is retained. Toolbar labels use an 11px UI size, medium repository emphasis, and single-line truncation for long repository or branch names.
- Spacing and layout rhythm: the bar is 39px high, inset 12px from the composer edges, and overlaps the composer border by 1px to read as one control. Icon and label gaps follow the existing mode control density.
- Colors and visual tokens: borders, hover states, surfaces, shadows, and muted text reuse the established dark palette. The green selected-project mark matches existing success semantics.
- Image and icon fidelity: the existing Strategos raster logo is unchanged. Folder, laptop, branch, caret, check, and add icons come from the project's Phosphor icon library; no placeholder, handcrafted SVG, or CSS-drawn asset was introduced.
- Copy and content: the visible order is repository, `Local`, and the real Git branch. The menu exposes registered projects with paths and a working `Add local project` form.

## Interaction verification

- Opened and closed the project menu from the composer toolbar.
- Switched from `strategos-project-toolbar` to the registered `strategos` project and confirmed the header, path, and branch updated.
- Opened the add-project form and cancelled it without changing the registry.
- Confirmed the composer remained usable and no browser console warnings or errors were emitted.

## Findings and comparison history

Initial comparison found no actionable P0, P1, or P2 differences for the requested project-switching toolbar. The light/dark theme difference is intentional because this is an extension of the existing Strategos interface, not a replacement of its design system. No visual fixes were required after the first browser-rendered comparison.

## Follow-up polish

- P3: a future iteration could expose a worktree or remote label if Strategos adds those execution targets.

final result: passed
