# Strategos Web design QA

## Evidence

- Source visual truth: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-9306b709-660a-4302-b4db-c961d57a6ba7.png`
- Browser-rendered implementation: `/tmp/strategos-real-empty-final.png`
- Full-view comparison: `/tmp/strategos-real-comparison.png`
- Focused top-bar comparison: `/tmp/strategos-real-comparison-top.png`
- Responsive evidence: `/tmp/strategos-real-mobile.png`
- URL and state: `http://127.0.0.1:4310/`, real repository data with no saved sessions and all three installed CLIs reporting unknown manually recorded capacity
- Comparison viewport: `1280 × 720` CSS pixels, plus responsive verification at `390 × 844`; the supplied source shows a populated running state while this pass intentionally verifies the production empty state

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses the native system sans-serif stack with weights, muted small-text hierarchy, truncation, and line-height close to the reference. Dynamic dates follow the browser locale, so the Chinese test environment renders month/day text differently from the English mock; this is acceptable localized content rather than structural drift.
- Spacing and layout rhythm: the final desktop grid uses approximately `22% / 51% / 27%` for navigation, chat, and inspector, matching the reference's visual balance. Thin dividers, compact rows, bottom composer, and low-radius controls preserve the target density.
- Colors and tokens: graphite/navy surfaces, subdued separators, cyan Claude, violet Codex, green status, and red exhausted-quota states map cleanly to the source. Contrast remains readable without turning the interface into a card grid.
- Image quality and asset fidelity: the repository's actual Strategos PNG is used for the brand and assistant avatar. Phosphor supplies the interface icons; no emoji, handcrafted SVG, CSS drawing, placeholder product imagery, or fake logo is present.
- Copy and content: the empty state contains only current repository data and honest `Unknown` quota labels. The missing history, plan, worker, output, and changed-file content is intentional because no local sessions exist; no reference copy is used as runtime data.
- Icons and controls: navigation, attachment, mode, send, disclosure, status, Run, and Resume affordances use one icon family and consistent optical sizing.
- Accessibility and responsiveness: controls are semantic and keyboard-focusable; settings selects have explicit accessible names; the image has alt text; desktop has no clipped persistent controls. Tablet `1024 × 768` hides the inspector with no horizontal overflow. Mobile `390 × 844` collapses navigation labels and the inspector, retains the composer, and reports `scrollWidth === innerWidth === 390`.

## Comparison history

### Iteration 1

- Earlier P2: the initial implementation made the center column too dominant and compressed both side rails compared with the selected mock.
- Fix: changed the desktop workspace tracks to `22% minmax(520px, 1fr) 27%` and the top-bar split to `45% / 55%`.
- Post-fix evidence: `/tmp/strategos-comparison-approved.jpg` and `/tmp/strategos-focus-workspace.jpg` show the three regions, header quota strip, composer, and inspector at the intended balance.

### Iteration 2

- Earlier P2: the quota strip's minimum track width caused 30 pixels of horizontal overflow at a `390` pixel mobile viewport and pushed the composer beyond the right edge.
- Fix: the mobile quota tracks now use `repeat(3, minmax(0, 1fr))` with a bounded width.
- Post-fix evidence: browser measurements show a `390` pixel viewport, `390` pixel document width, and a composer bounded from `80` to `378` pixels.

### Iteration 3

- Earlier P1: when no provider was exhausted, the optional capacity notice was absent but the shell still reserved its grid row. The workspace collapsed to `38` pixels and placed the composer over the header.
- Fix: the shell now uses a two-row layout by default and adds the third notice row only when an exhausted-provider notice is rendered. The app surface also uses a definite viewport height so the empty state fills the page.
- Post-fix evidence: `/tmp/strategos-real-empty-final.png` shows the composer anchored at the bottom, full-height navigation and inspector, and an unclipped center empty state.

## Primary interactions tested

- Load `/api/bootstrap` through the production page and confirm it renders the actual `strategos` repository, three installed CLIs, unknown capacity, zero sessions, and zero active runs.
- Open Settings, save the current real configuration through `/api/settings`, and confirm the success state after the health checks complete.
- Open Runs and confirm the real zero-session state instead of seeded history.
- Return to New task and confirm the composer, attachment control, and Auto/Manual control remain available without creating a synthetic task.
- Verify the `390 × 844` mobile viewport has no horizontal overflow and retains the composer.
- Confirm the browser console contains no warnings or errors.

## Follow-up polish

- P3: a future release could expose an explicit locale preference for timestamps instead of relying on the browser locale.
- P3: provider-specific quota adapters can progressively replace manual percentages while retaining `Unknown` as the honest fallback.

## Implementation checklist

- [x] Match the selected dark three-column composition.
- [x] Reuse the actual Strategos image asset and a consistent icon library.
- [x] Keep exhausted providers visible but excluded from scheduling.
- [x] Make navigation, sessions, settings, composer, Auto/Manual, Run, Resume, and attachments functional.
- [x] Verify desktop, tablet, and mobile overflow behavior.
- [x] Run Vite+ format, lint, type, unit-test, and build checks.
- [x] Remove all runtime demo fixtures and fabricated task labels.
- [x] Verify the production zero-session state against the local API.

final result: passed
