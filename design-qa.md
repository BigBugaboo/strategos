# Strategos Web design QA

## Evidence

- Source visual truth: `/var/folders/s4/zvr523712rzcdfswttvppw400000gn/T/codex-clipboard-9306b709-660a-4302-b4db-c961d57a6ba7.png`
- Final desktop capture: `/tmp/strategos-codex-experience-final-desktop.png`
- Final compact capture: `/tmp/strategos-codex-experience-final-mobile.png`
- Runtime: production Web assets served by `strategos web` at
  `http://127.0.0.1:4310/`
- Real state: two registered local projects, no seeded Sessions, and all three
  installed CLIs reporting `Unknown` capacity
- Comparison: the supplied reference and final desktop capture were opened
  together in one visual-comparison pass

## Findings

No actionable P0, P1, or P2 differences remain for the Codex experience
alignment.

- Information hierarchy: the shell preserves the reference's top capacity
  strip, project/task navigation, conversation surface, composer, and
  contextual right inspector. In the real empty state, the inspector is hidden
  until a Session is selected so the composer remains primary.
- Typography and density: compact system typography, short labels, muted
  secondary copy, and 39–42 pixel navigation rows reproduce the quiet coding
  client rhythm without dashboard cards.
- Surfaces and color: flat graphite/navy surfaces, thin separators, restrained
  violet selection, provider colors, and a high-contrast composer match the
  selected direction.
- Composer: the prompt has autofocus, a compact attachment action, an explicit
  Auto/Manual menu, a single primary send affordance, repository context, and
  keyboard guidance.
- Transient interactions: project and mode menus close through selection,
  Escape, or outside click. Attachments can be removed before submission.
- Session context: the right inspector remains available for real Sessions,
  supports Run and Resume states, preserves output and changed-file
  disclosures, and can be collapsed without clearing selection.
- Empty and loading states: loading, retry, empty Session history, empty Runs,
  and new-task states are visually quiet and retain a clear next action.
- Settings: unchanged settings cannot be submitted; status and errors retain
  live-region feedback.
- Responsive behavior: desktop and compact layouts keep active project, core
  navigation, prompt, mode, attachments, and send controls. Browser metrics
  confirmed no horizontal overflow at 1280 and 390 CSS pixels.
- Asset fidelity: the repository's Strategos PNG and Phosphor icon set are used
  throughout. No placeholder assets, emoji, handcrafted SVG, or CSS-drawn icon
  substitutes were added.

## Accessibility coverage

- Active navigation and project selection expose programmatic selected state.
- Mode choices expose menu and radio semantics.
- Icon-only buttons have accessible names, form inputs have labels, and focus
  rings remain visible.
- Status, errors, disclosures, progress bars, and reduced-motion preferences
  retain dedicated semantics.

VoiceOver announcement order and operating-system high-contrast behavior were
not automated and remain manual release checks.

## Primary interactions verified

- Loaded production assets and confirmed version `0.15.0`, repository context,
  and real `Unknown` capacity values.
- Opened and dismissed the project picker without persisting test data.
- Opened the execution-mode menu and verified Auto and Manual descriptions and
  selection semantics.
- Navigated New task, Runs, and Settings; verified settings dirty state.
- Confirmed the new-task prompt receives focus and the page reports no browser
  warnings or errors.
- Checked 1280-pixel desktop and 390-pixel compact widths with
  `scrollWidth === innerWidth`.
- Ran the full Node and Vite+ verification suite successfully.

## Follow-up polish

- P3: validate VoiceOver phrasing and Windows forced-colors behavior on native
  hardware before a future accessibility-specific release.

final result: passed
