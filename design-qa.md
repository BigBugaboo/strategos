# Strategos Web design QA

## Evidence

- Source visual truth: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-9306b709-660a-4302-b4db-c961d57a6ba7.png`
- Browser-rendered implementation: `/tmp/strategos-project-hierarchy-final-desktop.png`
- Responsive implementation: `/tmp/strategos-project-hierarchy-final-mobile.png`
- Before-state evidence: `/tmp/strategos-project-hierarchy-before.png`
- URL and state: `http://127.0.0.1:4310/`, production Web UI using registered local projects, no seeded sessions, and all three installed CLIs reporting `Unknown` capacity
- Desktop comparison viewport: `1814 × 1334` CSS pixels, matching the supplied source dimensions
- Responsive verification viewport: `720 × 900` CSS pixels
- Full-view comparison evidence: the source and final desktop screenshots were opened together in one comparison pass
- Focused region comparison: no separate crop was needed because the complete Projects and Sessions hierarchy is fully readable in the left rail of the desktop evidence; the responsive evidence separately verifies the compact project control

## Findings

No actionable P0, P1, or P2 differences remain for the requested hierarchy change.

- Fonts and typography: Projects and Sessions use the same compact heading scale, row density, truncation, and system-font hierarchy. The selected project has a stronger title without competing with the global Strategos brand.
- Spacing and layout rhythm: project selection no longer consumes the product header. Projects and Sessions are sibling sections in the left rail, separated with the same thin dividers and compact vertical rhythm used by the existing navigation.
- Colors and visual tokens: the existing graphite/navy surfaces, muted paths, violet selected-project icon, selected-row fill, and low-contrast separators remain consistent with the selected Codex-style shell.
- Image quality and asset fidelity: the existing Strategos PNG remains the only brand image. Project, navigation, and action icons continue to use Phosphor; no emoji, handcrafted SVG, CSS art, or placeholder asset was introduced.
- Copy and content: the global header now contains only `Strategos`, its version, and provider capacity. `Projects` and `Sessions` accurately describe the two sibling navigation collections.
- Accessibility: every project is a semantic button, the active project exposes `aria-pressed`, the add-project flow has a labeled input, focus outlines remain visible, and the compact narrow-screen control is a labeled native select.
- Responsiveness: at `720 × 900`, the left rail collapses to icons and exposes the active project through the compact native selector. Browser measurements confirmed `scrollWidth === innerWidth === 720`, with the composer and all quota tracks remaining visible.

## Comparison history

### Iteration 1

- Earlier P1: the project selector lived beside the product logo, which made repository context look like a global application setting and gave it more hierarchy than Session history.
- Fix: reduced the header to product identity plus CLI capacity and moved registered repositories into a dedicated Projects section immediately above Sessions.
- Post-fix evidence: `/tmp/strategos-project-hierarchy-after-1.png` shows both navigation collections as sibling sections.

### Iteration 2

- Earlier P2: moving project selection entirely into the desktop rail could have removed access at the existing narrow breakpoint, where Session history is hidden.
- Fix: added a compact folder control backed by the same native project select below `740` pixels.
- Post-fix evidence: `/tmp/strategos-project-hierarchy-final-mobile.png` and the `720` pixel browser measurement show a usable project switcher with no horizontal overflow.

### Iteration 3

- Earlier P2: visual selection alone did not expose the active project to assistive technology.
- Fix: added `aria-pressed` to project rows and verified the selected row is announced as pressed.
- Post-fix evidence: the final browser snapshot marks `workspace-prod-tracking` as pressed while preserving its visible selected state.

## Primary interactions tested

- Loaded the production page and confirmed Strategos `v0.14.0`, all three capacity indicators, registered projects, and the real empty Session state.
- Switched from `strategos` to `workspace-prod-tracking` from the desktop project list and confirmed the selected project state after the scoped bootstrap request completed.
- Opened and cancelled the Add local project form without persisting test data.
- Switched projects through the compact native selector at the responsive breakpoint.
- Confirmed the browser console contains no warnings or errors.

## Follow-up polish

- P3: a future compact layout could add a small project tooltip so the current repository name is visible before opening the native selector.

## Implementation checklist

- [x] Move project selection out of the product header.
- [x] Present Projects and Sessions as sibling left-navigation sections.
- [x] Keep real project switching and add-project behavior functional.
- [x] Expose the selected project semantically.
- [x] Preserve a compact project switcher at the narrow breakpoint.
- [x] Verify Vite+ checks, tests, production build, browser interactions, responsive overflow, and console output.

final result: passed
