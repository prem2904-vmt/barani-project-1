# New-design pattern (nd-kit)

Every new-design screen in the LMS follows this pattern and uses the **nd-kit**.
The canonical example is **Order & Payments**
(`apps/lms/src/app/features/frontdesk/order-create/`). The second screen built
on it is **Collect sample** (`apps/lms/src/app/features/lab/sample-collection/`,
the collect drawer).

The kit lives in `apps/lms/src/app/shared/styles/`:

| File | What it is |
| --- | --- |
| `_nd-kit.scss` | **Global** classes and tokens (light + dark). Imported once by `apps/lms/src/styles.scss`. |
| `_nd-mixins.scss` | Mixins only, no CSS output. Component styles may `@use '…/shared/styles/nd-mixins' as nd;` where a kit class can't be applied. |

If a screen needs something the kit doesn't have, add it to the kit first,
then use it. Don't write a one-off look inside a component.

---

## 1. Layout: band, then cards

```
┌ band (pf-hero-band) ─────────────────────────────────────────────┐
│ ‹  [logo] Micro World                           [band actions]  │
│      ┌ pill = CONTEXT BAR ─────────────────────────────────────┐ │
└──────│ search  OR  subject chips + this step's filters + count │─┘
       └─────────────────────────────────────────────────────────┘
┌ main work card (.nd-card) ───────────┐ ┌ side action card ────┐
│ ICON  LABEL      note / controls     │ │ ICON  LABEL  toggles │
│ ──────────────────────────────────── │ │ body (scrolls)       │
│ body (scrolls)                       │ │                      │
│                                      │ │ [secondary][PRIMARY] │ ← sticky footer
└──────────────────────────────────────┘ └──────────────────────┘
```

- Page: `.nd-page`. There is no page-level scroll; only card bodies scroll.
- Body: `.nd-body.nd-body--split` holds the main card plus a 400px side card
  at ≥1024px. Below that it is one column.
- Cards: `.nd-card` > `.nd-card__head` (`.nd-card__icon`, `.nd-card__label`
  in uppercase, optional `.nd-card__note`, `.nd-card__spacer`, header
  controls) > `.nd-card__body` (scrolls) > `.nd-card__foot` (sticky, a 2-column
  button grid; `.nd-span` makes a button full width).
- Order & Payments: the catalogue is the main card, BILLING is the side card.
  Collect: VIALS is the main card, COLLECTION is the side card.

### Continuity: the band is the same on every step

The band always shows the **back chevron**, the **tenant logo and name** and
the **band actions**. It **never** becomes a page or patient title.

The band's pill is the **CONTEXT BAR** for the step:

- **Search screens:** the pill *is* the search (Order & Payments: scope tiles
  plus input).
- **Work screens** (Collect; later results, validate, …): the pill holds the
  current **subject** as read-only chips (patient, order ID, sample IDs) and
  a counter (`.nd-band-chip`). **Filters appear only when they add something
  the page doesn't already show** — e.g. Collect has none: every vial tile
  already shows its own state.
- On phones the pill is one row: keep the subject chips; the counter goes to
  the bottom bar.

### Side card = actions + info the main card doesn't show

Never repeat the main card's items in the side card (Collect: no per-tube
list). Fill the side card with what the main card hides — Collect: the
tests each tube is for (+ draw volume) and an Ordered → Drawn → Dispatched
timeline. Type stays calm: section titles 11px uppercase muted, body 12.5–13px
at weight 400–500; counters 500, never 700+. The side card carries one status line (a neutral chip with a violet
mark), information the main card lacks (only fields the data really has —
e.g. priority, fasting, referral), a short explanation line, and the footer
actions.

### Card headers and row actions

- Every card / pane header is the BILLING header: a violet icon chip
  (`.nd-card__icon`) + the UPPERCASE title. ONLY the icon chip is tinted — the
  label and the header row have no fill / pill behind them. Nothing else unless it is a real
  control for that card (toggles in slate). Counts are plain muted text on
  the right — never a pill.
- **Row actions: text on web, icon on touch.** Per-row actions (Delegate,
  Print, Edit…) use the kit's `.nd-rowact`. On web (`(hover: hover) and
  (pointer: fine)`, via `webPointerSignal()` in `shared/utils/pointer-mode.ts`,
  the same query as Order & Payments) they are compact 32px secondary TEXT
  buttons ("Delegate", "Print", "Edit"). On touch (iPad / phone) add
  `.nd-rowact--icon`: a neutral 44px icon button, label kept for AT via
  `aria-label` + the visually-hidden `.nd-rowact__t`. Never a gradient.
- Header / group counts are pluralised properly (`plural()` in
  `shared/utils/plural.ts`): "1 sample", "2 samples". Group dots: NORMAL is
  neutral; red / amber only for urgent / high.
- Tiles don't repeat a test count ("1 test") — it is noise on a sample row.
- Status on rows (Validated, Submitted, Draft) = neutral chips; a violet
  dot/check marks "done". Red only for real warnings (Re-entry).

### Tiles in a row are symmetric

Tiles in a size class share a fixed illustration box (same width + height
for every container type); illustrations scale into it bottom-centred, so
the text rows below start at the same y and align across tiles; badges sit
at the same corner of the box.

✅ Do: `‹ Micro World` + pill `[Ms. Paravai Munusamy 44/F · AA0007] [Order LAB-2609-000085] [Sample 26117] … [0/1 drawn]`
❌ Don't: replace the band with a big "Collect sample" / patient-name header.

In-page steps that close rather than navigate pass `[backAction]` to
`pf-hero-band` (Collect: `closeFn`).

---

## 2. Colour: primary only for the main call to action

- **Primary** (`.nd-btn.nd-btn--primary`, the violet gradient): **one** per
  view, for the main call to action only. Examples: Continue to payment,
  Confirm ₹X received, Review & Pay, Collect all to finish (only when enabled),
  Dispatch.
- **Secondary** (`.nd-btn--secondary`, outline, like "Save as draft"): Can't
  collect, Label by hand, Save as draft.
- **Tertiary** (`.nd-btn--tertiary`, text): Clear, Discard draft, Edit.
- **Icon** (`.nd-btn--icon`, neutral): close, "more".
- Everything else is neutral: tiles, chips, segmented controls, counters,
  badges, thumbnails.

✅ Do: a disabled "Collect all to finish" is secondary; it turns primary when enabled.
❌ Don't: a gradient cart icon, a gradient ₹/% toggle, a violet "selected" payment tile.

### Palette: primary + neutrals only

The palette is **primary (violet)**, **secondary and tertiary (neutrals and
slate)**. No green, teal, sky or other off-palette colour as decoration:
"done / drawn / paid / included" is the neutral selected state (a light
violet tint `--nd-done-tint` + a violet check), never a green tint, badge or
pill. Functional exceptions — these are data or warnings, not decoration:

- tube cap colours and the red blood-fill animation (Collect);
- the muted-red **Urgent** toggle (`.nd-toggle--urgent`);
- error red for validation / short payments;
- the amber **unpriced / required** dot;
- the **AI-in-progress rainbow glow** (`.nd-ai-glow`, below) — the ONE
  allowed multicolour: **AI in progress only; never decorative.**

### PF Sense: AI in progress

- **AI features are branded PF Sense; show the PF mark, not "AI".** No
  user-facing "AI" text, tag or label anywhere — internal names may stay.
  The mark is the canonical glyph (`pf-logo-mark variant="mono"`, ~14px,
  violet / current colour) with tooltip + aria-label "Read by PF Sense" on
  things PF Sense filled in. Copy: "PF Sense · reading…", "PF Sense isn't
  available — pick …", "PF Sense this month: 1.2M / 2M tokens".
- **While an AI call is in flight** put `.nd-ai-glow` on the surfaces it
  affects and toggle `data-ai-working="true"`: a thin conic rainbow ring
  (violet → blue → cyan → green → yellow → orange → pink) + a soft blurred
  halo, rotating via `@property --nd-ai-angle` (~3.5 s a turn), ~0.6
  opacity (stronger in dark). `.nd-ai-glow--inset` draws ring + halo
  INSIDE a frame / panel that clips or scrolls; `--ring` drops the halo for
  many small items at once (list cells); `.nd-ai-glow-mark` gives SVG
  marks a hue-cycling glow. Removing the attribute fades it out (keep the
  class for the fade). Pseudo-elements only, `pointer-events: none` — the
  user keeps working underneath. Reduced motion: a static soft rainbow
  ring, no rotation.

✅ Do: "All vials collected" = neutral chip with a violet check icon.
❌ Don't: mint tile tint, green check badge, green time chip.

## 3. Selected states are neutral

- Segmented controls: `.nd-seg` > `.nd-seg__item[aria-checked|aria-pressed="true"]`
  shows as a raised neutral segment with normal text.
- Chips: `.nd-chip[aria-pressed="true"]`. Use `.nd-chip--static` for
  read-only chips.
- Tiles / method tiles: `.nd-tile-sel[aria-checked="true"]` gets a stronger
  border and a light tint, with no violet text.
- In cart / drawn: `.nd-row--in` (a subtle tint plus a neutral check) and
  `.nd-row--done` (a light success tint).
- Drive state with ARIA attributes, not `…--on` classes. A global new-design
  rule turns any `button[class*="--on"]` violet.

## 4. Toggles are slate

`.nd-toggle[role=switch][aria-checked]` > `.nd-toggle__track` > `.nd-toggle__knob`.

- ON is a slate track (`--nd-toggle-on`: #AEB8C2 in light, a darker slate in
  dark), with a white knob and a small shadow.
- OFF is a lighter neutral.
- `.nd-toggle--urgent` makes ON a muted red, never violet.
- Examples: Urgent and Include Trendogram in the BILLING header.

## 5. No truncation when there is room

- Titles, names and meta wrap (`.nd-head__title`, `.nd-head__meta` and
  `.nd-row__name` all use the `no-truncate` mixin).
- An ellipsis is allowed only when the text truly overflows a one-row
  container: a phone pill chip, or a flex item with `min-width: 0`.
- Never cut a name in code, e.g. `formatPatientInfo` shortens names to 15
  characters. Use `patientDisplayName` for display.

✅ `Ms. Paravai Munusamy` ❌ `Ms. Paravai Mun..`

## 6. Lists: one row per item

- The row: `.nd-row` > `.nd-row__check` · `.nd-row__code` (mono, violet) ·
  `.nd-row__name` (wraps, up to 2 lines) · `.nd-row__meta` (muted) ·
  `.nd-row__value` (right aligned, e.g. the price and the unpriced dot).
  Rows are at least 52px tall.
- Search results are **one per row**, so the ranked order reads top to
  bottom and ↑/↓ moves one row. Never lay search results out in a multi-column
  grid.
- Browse grids (the catalogue, vial tiles) may use 2–4 columns of compact
  tiles, about 72–88px tall, with a small glyph rather than an illustration.
- **One font family: Noto Sans.** IDs, codes, times and counts use tabular
  numbers (`.nd-num` = Noto Sans + `font-variant-numeric: tabular-nums`),
  never a system monospace (`monospace` / `ui-monospace` renders as Courier).

### In lab work lists the sample ID is the primary line

Queue / My Work / Completed / Culture tiles and Lab Intake rows lead with the
SAMPLE ID: ~16.5px, weight 600, normal text colour, Noto Sans tabular numbers
(never small violet, never monospace). Patient name ~13px / 500 secondary,
meta ~12px muted. Colour stripes only for urgent (red) / high (amber). A
received / done row goes quieter (muted text + a small violet check), never
a green or amber pill. The next step on a culture case is a neutral chip
whose small violet dot is the one accent.

### Work queues: adaptive tile grid, 3/2/1 columns by container width

Queue / My Work / Completed / Culture lists use `<ul [ndTileGrid]="…">`
(`shared/directives/tile-grid.directive.ts` + kit `.nd-tilegrid`). The LIST's
own width decides — never the window, because side panes can be pinned:
≥1100px → 3 columns, ≥640px → 2, below → 1. Tiles in a row share a height,
names wrap (never truncate), the row action sits at the tile's bottom-right,
and group headers (URGENT / HIGH / NORMAL) span the full width above each
group's grid. **Search results stay one per row** (section 6).

## 7. Search: one mode per device type

- **Web / desktop** (`(hover: hover) and (pointer: fine)`): results only in
  a dropdown under the pill.
  - The page behind never changes.
  - A scrim dims it.
  - The dropdown is the pill's width, with one row per result.
  - A single sticky filter row: type segment on the left, department chips on the right.
- **Touch** (iPad and phones): no dropdown for the main search. The main
  card becomes the results ("N results for 'x'"); clearing restores it.
  Pick-one lookups (patient, doctor, hospital) keep a dropdown.
- Detect the mode reactively from `matchMedia`, using a signal plus a
  change listener.
- Matching: case-insensitive substring on code, name, short name and profile
  label, ranked. No fuzzy matching. A 1-character query matches prefixes only
  (`filterTestListStrict`).

## 8. Touch

- Tap targets are at least 44px. Inputs are at least 16px on phones, so iOS
  doesn't zoom.
- **Phone bottom bar:** `.nd-bottombar` (+ `.nd-bottombar__info`) carries the
  side card's summary and its primary action (the cart bar; Collect's
  "0/1 drawn · Collect all to finish"), above the navbar.
- **Phone sheet:** `.nd-sheet` (about 92dvh minus the top safe area) with a
  `.nd-sheet__handle`, an inner scrolling body, a sticky footer with the
  bottom safe area, and `.nd-sheet-backdrop`. Side-card actions open in it.
- **The bottom navbar is ALWAYS visible — on every screen and size. Never
  hide it.** Layouts fit ABOVE it: `--nd-nav-h` (the docked bar's height,
  incl. the bottom safe area) is reserved by the shell for in-flow pages;
  fixed / teleported full-screen views use `.nd-fullscreen` (ends at
  `bottom: var(--nd-nav-h)`); sticky footers, `.nd-bottombar` and
  `.nd-sheet` sit on top of it (the sheet's height is capped between the top
  safe area and the nav). The only exception is the app-wide soft-keyboard
  dodge that already existed (KeyboardService) — call
  `KeyboardService.reset()` when a view that owns an input tears down.
- Follow the repo's mobile conventions: phone rules are additive, inside
  `@media (max-width: 640px)`, and never change desktop.

## 9. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--nd-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | search activation, results, scrim |
| `--nd-spring-bounce` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | field grow, sheet rise, pop |
| `--nd-dur-fast` | 200ms | closes and hovers (closes run quicker) |
| `--nd-dur` | 320ms | open / activation |
| `--nd-dur-sheet` | 360ms | billing / phone sheet rise |

- Classes: `.nd-anim-in` (fade and scale from 0.97), `.nd-anim-pop`
  (a confirm tap, e.g. a drawn vial), `.nd-anim-rise` (a sheet).
- Stagger list rows by about 18ms.
- Everything is off under `prefers-reduced-motion`.

## 10. Always

- **No emoji.** Icons are stroked inline SVGs with `aria-hidden="true"`;
  icon-only buttons get an `aria-label`.
- **No native controls.** No `<select>`, `datalist` or `window.confirm`: use
  `pf-select` and `DialogService`.
- **Theme tokens only.** Light and dark must both be right; never force dark.
- **Tests:** add specs for the pattern hooks. Examples: only one primary; kit
  classes present; no truncation; mode switching.

## 11. Scanner

One shared modal (`shared/components/barcode-scanner/barcode-scanner-modal.component.ts`)
serves every scan point. Redesign it, never fork it per screen.

- Shell: nd-card modal (16px radius, soft shadow) on web; `.nd-sheet` on
  phones, a tall sheet that sits **above** the always-visible bottom
  navbar (the nav is never hidden in the new design).
- Header = BILLING header: violet icon chip + `SCAN SAMPLE` (or
  `ENTER SAMPLE` in manual mode) + neutral × icon button. Title 18px/600.
- Expected ID: a neutral chip — muted "Expected", then the ID at 600 in the
  normal text colour with tabular numbers. Never faint, never monospace.
- Viewport: inset, 12px corners, outside of the scan window dimmed. The
  window is four white corner brackets (Apple reticle) with a slow violet
  sweep line (off under reduced motion). Camera switch / torch are 40px
  glass icon buttons at the top-right (44px on phones), with aria-labels.
- Status line in the app font, sentence case: violet pulsing dot + what to
  do. A handheld (HID) read appears as a neutral chip — no placeholder dash.
- States: match = violet check pops over the reticle, then hand-off;
  mismatch = red inline message + red reticle flash, scanning continues;
  camera unavailable = neutral panel + secondary "Enter manually"; manual
  tenants skip the camera entirely.
- Footer: secondary "Enter manually" + tertiary "Cancel". The only primary
  is the manual view's Confirm. Red only for the wrong-vial warning; no
  green, no pink, no spaced monospace caps.

## 12. Result entry

`/lab/sample/:id` (`features/lab/sample-result-entry/`) — the tube is the
unit of work. It follows the band rules above with these specifics
(owner reviews, 2026-09-25):

- **Band:** back + tenant, and the page's actions in the band's actions
  slot (top-right): the technician, then secondary **Save draft** and the
  ONE primary **Submit results** (validation mode: Reject + Validate (n);
  a finished tube: Edit result). The disabled rules are unchanged.
  - Web + tablet: text buttons, the technician as a small neutral chip
    (name + Reg), and a quiet "Saved 14:02" note.
  - Phones: the same actions as 44px ICON buttons at the top (save icon,
    violet check = the primary; aria-label + tooltip keep the words; a
    tiny violet dot on the save icon = saved, time in its tooltip) and the
    technician as an initials avatar ("AU", Reg in the tooltip) — it fits
    at 320px. No bottom action bar.
- **Context bar (the pill):** the patient chip with the FULL name +
  "29/M · AA0012"; the order ID where it fits (≥1280px). Web + tablet show
  no current-sample chip — the tube tabs say which sample is open.
- **Tube tabs** (web + tablet, band tools slot): a compact neutral
  `.nd-seg`, standard height, each tab ONLY the sample ID (+ the violet
  open-work dot; tests in its tooltip / aria-label), in a **fixed order**
  (series offset, then sample ID). Switching moves only the selected
  indicator, which slides on `--nd-spring` (off under reduced motion).
- **Phones: the patient chip shows the FULL name** — the "29/M · AA0012"
  meta moves to its tooltip, and a long name wraps to two lines; never an
  ellipsis.
- **Phones: no tabs control.** The pill shows the patient + the CURRENT
  sample chip ("26124", violet dot when it has open work). With 2+ tubes
  that chip carries a chevron and opens a small list (sample ID + tests,
  fixed order); picking one switches tube. One tube = a plain chip.
- **No side panel.** RESULTS cards take the full width: one `.nd-card` per
  test (a profile = one card) — violet icon chip, the test name as the
  label, "+ Note" as the small secondary button. Web: the calm row table
  (1px `--nd-line` rows, parameter 14px / 500, range / unit / method
  muted), results as kit fields or `pf-select`, the note pencil a quiet
  neutral icon button. Flag chips keep their functional colours.
- **Grid only.** No Grid / Form switch. Enter walks the fields and lands
  on Submit. The result field is a real box (visible border + background,
  ≥40px; 44px on touch); free text is a growing multi-line box.
- **Phones: stacked rows, EVERY row type:** name (wrapping normally)
  with **[i]** and the pencil on its right, then a FULL-WIDTH field
  (≥44px; free text ≈88px). Range, unit and method are not lines — the
  [i] (hidden when a row has none) opens a small peek with them that
  fades / scales in and auto-hides after ~4s, on an outside tap or a
  second tap. The peek is a BODY-level overlay (position: fixed), width
  min(300px, viewport − 32px), below the icon or flipped above, always
  16px inside the viewport — never inside the card, which would clip it. (A table can't lay out at 360px: never leave phone rows on
  table columns — that collapsed the name to one letter per line.)
- **Notes in ONE step:** the pencil (or "+ Note") opens an inline
  textarea under that row with focus in it. Enter or blur saves,
  Shift+Enter is a new line, Esc cancels.
- **Type scale:** card label 13px / 600 uppercase (12px on phones — it
  must beat the global phone `h2` cap), parameter 14px / 500, chips and
  tabs 13px, buttons 14px, meta 12px. Watch global phone rules with
  `!important` (`[role='tablist']`, `h2`): component rules that must win
  need the specificity.
- Order-level extras above the cards only when they apply: the
  validator's "Submitted …" line, the slate **Include Trendogram** toggle
  (+ range picker), the flags the last submit raised.
- **Zoom from the queue:** tiles carry `data-vt-sample="<id>"`;
  `core/navigation/zoom-transition.ts` names ONLY the tapped tile
  `sample-<id>` for the transition; the first RESULTS card (or its
  skeleton) carries the same `view-transition-name`, so the tile morphs
  into it (~400ms, nd spring); back reverses it. No View Transitions or
  reduced motion → instant.
- **Real-layout check:** `apps/lms-e2e/src/result-entry-layout.rbac.spec.ts`
  (seeded Lab Admin; opens a tube via My Work's band search) asserts at
  375px: name cell ≥200px, full-width ≥44px field, 44px band icons, no
  bottom bar, no tabs, 12px card label. `SHOTS_DIR=… ` saves 375 / 768 /
  1440 screenshots.

## 13. Culture case

`/lab/culture/:orderTestId` (`features/lab/culture-workbench/`) — one
culture case (MICRO26001), every stage on ONE page. Band rules as above,
plus (owner reviews, 2026-09-25):

- **Band actions (top-right):** the technician as a neutral chip (no status
  dot; initials avatar on phones) and ONE primary, **Submit all results** —
  the existing whole-case action (Validate & submit for a validator, else
  Submit for sign-out), enabled only when every stage is done. Awaiting
  sign-out → a neutral "Awaiting sign-out" chip instead. Phones: a 44px
  icon button (label kept for AT + tooltip).
- **Context bar (the pill):** the case ID as the primary chip, the patient's
  FULL name, the test and "Day N" as calm neutral chips, "0/4 stages" at the
  right. No spaced mono caps anywhere.
- **Navigation row** above the cards: "Specimen" (normal-case label) +
  `pf-select`, the branch segment (Primary · subcultures) with a tertiary
  "+ Subculture"; on the right the incubation group — a neutral status chip
  ("Ready in 5h 12m", a violet check when complete) and **Inoculate &
  incubate / + Hours** as a SECONDARY button (its popover keeps presets,
  custom hours and Stop). Phones: the row wraps and Inoculate is a
  full-width secondary button.
- **No stage tabs.** Every stage is a stacked `.nd-card` in order (Gram →
  Growth → Identification → AST): violet icon chip + the stage title (13px
  / 600 uppercase), a neutral state chip (violet check = done, violet dot =
  mine, held by …), the quiet note pencil, then per the lock rules
  **Submit** (secondary — that stage only), Delegate · Drop (tertiary), or
  Edit once done.
- **Rows:** [kit report tick] name 14px / 500 · the control column ·
  pencil. Option controls FILL the control column: an `.nd-seg` grid of
  EQUAL segments (`repeat(n, 1fr)` up to 4 options; more wrap into balanced
  rows with `repeat(auto-fit, minmax(110px, 1fr))`), ≈38px (44px on touch),
  neutral selected state. Free text / organism pickers fill the column too.
  One tap on the pencil opens the inline note composer with focus.
- **Phones:** rows stack — name + pencil, then the control full width
  (fields ≥44px, textareas ≈88px).
- **Palette:** no green (old tech dot / done chips), no amber (old
  Inoculate / held chips), no cyan (incubation). Clinical colours stay where
  they carry meaning — the AST S / I / R interpretation in `culture-entry`
  (green = sensitive, amber = intermediate, red = resistant).
- **Real-layout check:** `apps/lms-e2e/src/culture-case-layout.rbac.spec.ts`
  (seeded Lab Admin; opens the first case from My Work → Culture) asserts
  one band primary "Submit all results", stacked stages (no tablist),
  Inoculate in the nav row as secondary, options filling the column with
  equal segments at 1440, stacked rows + 44px band icons at 375.
  `SHOTS_DIR=…` saves 1440 / 375, dark + light.
- **AST table** (`culture-entry`) — **result S / I / R subtle colour when
  picked, breakpoints neutral** (owner, both themes):
  - Breakpoint headers, breakpoint chips (neutral kit chips, normal text)
    and the MIC line under a drug are NEUTRAL in light AND dark. No row
    tints by verdict.
  - The PICKED S / I / R carries a subtle tint + dark text (≥4.5:1):
    light S `rgba(16,185,129,.13)` / #065f46, I `rgba(245,158,11,.14)` /
    #92400e, R `rgba(239,68,68,.12)` / #991b1b; dark the same hues at 20%
    with pale text (#6ee7b7 / #fcd34d / #fca5a5). Unpicked stays neutral.
    Class-driven (`.ce-sir-picked.ce-sir--s|i|r`), never inline colours;
    the small-screen cells share the tints.
  - Every antimicrobial row is its own subtle card in both themes: 10px
    radius, 6px gap, a stronger hover (light `#f6f7f9` → `#eef0f3`, dark
    the glass surface).
  - "Reading method" is a normal-case label + a kit `.nd-seg`; headers
    normal case; the zone field a kit field (Noto, tabular); × a quiet
    labelled icon button; "Hide organism / sensitivity" tertiary.
- **Measure zones modal** (`plate-measure`), like the scanner: an nd-card
  modal (phones: a tall sheet above the navbar, camera full width) with the
  violet icon chip + "MEASURE ZONES", neutral full-screen / × icon buttons,
  the title at 18px / 600, and a neutral stepper over the real steps
  (**Capture → Calibrate → Measure & read → Review**; violet active dot,
  "Step n of 4"). The camera is 12px-rounded with the outside of the plate
  dimmed; the reticle is a thin SOLID white circle (`.pm-reticle`) + a small
  centre crosshair + a slow violet sweep (off under reduced motion). ONE
  primary per step (Capture / Measure / Review / **Apply to table**),
  everything else secondary.
- **Measure & read (owner, 2026-09-25): OpenCV measures, ONE PF Sense call reads.**
  - **OpenCV.js 4.10, BUNDLED and lazy (owner, 2026-09-25).** The
    unmodified single-file build of `@techstark/opencv-js@4.10.0-release.1`
    is vendored at `apps/lms/public/assets/vendor/opencv/opencv.js` (+ its
    Apache-2.0 `LICENSE`, `README.md`) and ships as the same-origin static
    asset `assets/vendor/opencv/opencv.js` in every build (web, Electron,
    Capacitor: `cap sync` copies `dist/apps/lms/browser`), so it works
    offline. `opencv-loader.ts` injects it (resolved against the document
    base) the first time the modal needs it: ~10 MB (~3.4 MB gzipped),
    browser-cached, 0 bytes in the main / initial bundle. **No CDN
    fallback**; if the local load fails the calibrate line says "Couldn’t
    load the measuring tools…" and the manual rim + ring tools carry on.
    OpenCV does grayscale, blur and Hough (plate rim, disk candidates) in
    `plate-detect.ts`; everything that DECIDES and MEASURES is pure TS in
    `plate-vision.ts` (unit-tested on synthetic plates). The Emscripten
    module is a thenable — strip `then` before resolving it (awaiting it
    loops forever).
  - **Calibrate:** the rim is found automatically (dashed violet circle, two
    draggable ends; tapping two rim edges still works). Plate size is a
    neutral `.nd-seg` (90 · 100 · 150 mm), default = the saved session, the
    lab default input, the last pick on this device, else 90.
  - **The disks are the ruler.** Paper disks (≈6 mm) are refined onto their
    edge and kept only with a crisp round rim, printed text inside (more
    texture in than around — glare speckle is the same), the expected size
    and a round shape. Rejected glare shows as faint dashed circles behind
    the slate **Show rejected** toggle (tap one to promote it to a disk). The
    median disk (6 mm) is a second scale: plate vs disks off by > 8% → a
    neutral note "Plate size looks different — is it 100 mm?" (tertiary
    "Use 100 mm") and the disks win. Each zone is measured against its OWN
    disk's outline sized by the disk + its two nearest neighbours (local
    tilt correction), along the long and short axis, averaged. Plate-wide
    disk ellipse > 1.15 → "Retake from directly above". No zone = 6 mm.
  - **Overlays:** each disk a numbered neutral badge; each zone a thin ring
    (an ellipse on a tilted photo) with a mm chip in Noto tabular numbers —
    violet for the selected disk or one without a code, neutral otherwise
    (dark mode keeps S / I / R ring colours). The view fits the plate. Rings
    stay editable: drag the edge (zone) or centre (move), double-tap to
    re-measure, tap an empty spot and drag to add a missed disk, arrows /
    `[` `]` on the keyboard, undo / redo.
  - **The list** (side card at ≥820px, under the plate on phones), one row
    per disk: number · code chip (a `pf-select` of the case's own panel as
    disk codes + "Not a disk"; "Reading…" shimmer while PF Sense runs,
    "Still reading…" after 15 s; "Unknown — tap to pick"; the small **PF
    mark** on codes PF Sense filled in; "Probably CPM 30 · Confirm" as a
    neutral one-tap chip — never applied by itself) · the zone mm (editable
    field) · S / I / R from the existing breakpoint logic (neutral + a 5px
    red dot on R in light mode). A code used on another disk is marked "on
    disk n" in the list; picking it moves it. The monthly usage is one muted
    line ("PF Sense this month: 1.2M / 2M tokens").
  - **While reading:** a "PF Sense · reading…" pill (PF mark) by the DISKS
    header, and `.nd-ai-glow` on the plate frame, the list panel, each code
    cell still reading and (`.nd-ai-glow-mark`) the disk badges. It fades
    when the call returns; rows that got a code do a brief shimmer that
    settles. The technician keeps adjusting zones throughout.
  - **No PF Sense** (404 / unavailable / error): a neutral note at the top
    of the list, "PF Sense isn't available — pick each disk's code" (the
    monthly cap has its own line).
  - **Review keeps the picker:** every disk's code is the same `pf-select`
    as Measure & read, with the drug (or "Not applied — pick a code") under
    it; picking there updates "N zones go to the AST table" and enables
    **Apply to table**.
  - **ONE PF Sense call, in the background:** a canvas mosaic of numbered 256px
    disk crops (4 per row, JPEG 0.9) → `POST /api/culture/ast/disk-read`
    `{ orderTestId, image, tiles, candidates }` (candidates = the panel's
    printed codes — maker + CLSI, `disk-codes.ts` — minus codes the
    technician already placed); 60 s client timeout. The technician keeps
    working meanwhile. 404 / `ai_unavailable` / errors → the "PF Sense
    isn't available" note; `ai_cap_reached` says so.
  - **Nothing is written until Apply.** PF Sense codes are suggestions. Review
    lists code → drug, mm, S / I / R and says what is left out; **Apply to
    table** writes each coded disk's mm into its drug row (matched by code),
    keeps the photo + session (rings, codes, ruler), then posts
    `/disk-read/{auditId}/confirm` (errors ignored).
  - **Real-plate check:** `apps/lms-e2e/src/culture-measure-read.rbac.spec.ts`
    (`PLATE_JPG=…/plate.jpg SHOTS_DIR=…`): uploads the real plate, runs
    OpenCV in the browser from the bundled asset (CDNs are blocked; exactly
    one same-origin `opencv.js` load, none before the modal), asserts ≥8
    disk badges, the PIT zone > 6 mm and
    the code list pending → manual (404) → filled (the prototype's read,
    answered in the browser).
- **AST screenshots** in the real-layout check rewrite the case response in
  the browser (AST open, an identified organism) and answer the pick
  locally — nothing is claimed or written on the server.

## 14. Editors (single-record pages)

Every page that edits ONE record — `/admin/tests/:id/edit` (test, profile,
package), `/admin/tests/new`, user invite / edit, role new / edit, workflow
screen + field editors, and any other `:id` / `new` page — follows the band
rules above. There are no exempt editors any more (owner, 2026-09-25). The
canonical example is the **test editor**
(`features/admin/tests/test-editor/`).

- **Band:** back (`[back]` + `[backTo]` the parent list) · tenant · band
  actions. Actions: a neutral save state, then secondaries (Revert to
  master, Duplicate, Delete — `pf-hb-btn--ghost`), then the ONE primary
  (**Save** / **Create** / **Invite**, `pf-hb-btn--primary` with an SVG so
  it turns into a 44px icon on phones). Embedded sub-editors (notes, report
  columns, consumables, advanced layout, formula) never carry a second
  primary: their own saves are secondary.
- **Save state** (`.nd-savestate`, in the band actions beside Save): muted
  text; a violet check + "All changes saved", or a violet dot + "Unsaved
  changes". Never green / amber. Phones keep only the mark (the words stay
  for AT). Autosave only where it is truly authoritative — the test editor
  is NOT (its sections save on Save), so Save stays the primary.
- **Context bar** (`pf-hero-band [customSearch] [contextBar]`, projected
  `<div band-search class="nd-ctx">`): the record's name as the primary
  chip (`.nd-ctx__primary`, 15px / 600, FULL — wraps, never an ellipsis)
  with a quiet pencil (`.nd-ctx__edit`) that opens the field; then neutral
  key / value chips (`.nd-ctx__chip` › `.nd-ctx__k` + value): origin (no
  coloured dot), codes in Noto tabular (`.nd-num`), department, sample,
  price, TAT, fasting, role, status … A chip may jump to its section. The
  unpriced price carries the one allowed mark, `.nd-dot-unpriced`. A new
  record's primary chip says what it is ("New test", "New role"). No big
  title, breadcrumb or subtitle anywhere on the page. `[contextBar]` lets
  the pill grow to a second row and use the band's full width; on phones
  the chips scroll sideways in one row.
- **Sections = a tabs row** (`.nd-tabs[role=tablist]` ›
  `.nd-tabs__item[role=tab][aria-selected]`: glyph + label +
  `.nd-tabs__dot`, violet = complete, hollow = something to finish) under
  the band — the report-designer precedent. No SECTIONS rail: the content
  takes the full width. Phones: the row scrolls sideways.
- **Content:** the focused section is ONE `.nd-card` (violet icon chip +
  UPPERCASE label + a short `.nd-card__note`); only its body scrolls.
  Fields are kit fields (`.nd-field` › `.nd-field__lbl` + `.nd-input` +
  `.nd-field__hint`; read-only codes: `[readonly]` → dashed, chip surface,
  `.nd-num`), `pf-select` for choices, `.nd-seg` for 2–4 options, slate
  `.nd-toggle[role=switch]` for on / off (never checkbox pills), tick lists
  as kit rows (`.nd-row` + `.nd-row__check`, `.nd-row--in` when ticked;
  a visually hidden checkbox keeps keyboard + forms). Type: labels 12px /
  500 secondary, hints 12px tertiary, sub-headings 13px / 600.
- **Side card only when it adds info** the form can't show — the test
  editor's LIVE PREVIEW (the printed page), 400px at ≥1024px. Below that it
  hides behind a secondary **Preview** button at the end of the tabs row and
  opens as a sheet (phones: `.nd-sheet`-style, above the navbar; tablets: a
  side sheet), with a scrim; Esc / × / scrim close.
- **Palette + font:** violet + neutrals + slate; no green / teal / amber
  status text or pills ("Complete" = violet check, "Needs a name" = the
  amber required dot); Noto only, tabular numbers for codes, never
  monospace; SVG icons, never glyphs (✕ ↑ ↓ ⠿ ƒ ●).
- **Real-layout check:** `apps/lms-e2e/src/test-editor-layout.rbac.spec.ts`
  (seeded Lab Admin; opens BIO005 via Test Master's own list call; read
  only) asserts ONE primary on every tab, the full name in the context bar,
  the tabs row, the 400px preview card at 1440, no page scroll, and no
  monospace / green computed anywhere on the editor; at 375 the tabs scroll,
  Save is an icon and Preview opens a sheet above the navbar. Run it against
  a build: `BASE_URL=http://localhost:4310 CORS_RELAY=1 SHOTS_DIR=…`.

## API summary

```
Layout   .nd-page · .nd-head(__back|__who|__title|__meta|__actions) · .nd-band-chip
         .nd-body · .nd-body--split
Card     .nd-card · .nd-card__head · __icon · __label · __note · __spacer · __body · __foot · .nd-span
Buttons  .nd-btn + --primary | --secondary | --tertiary | --icon
Select   .nd-seg / .nd-seg__item[aria-checked] · .nd-chip[aria-pressed] · .nd-chip--static · .nd-tile-sel
Toggle   .nd-toggle[role=switch][aria-checked] › .nd-toggle__track › .nd-toggle__knob · .nd-toggle--urgent
Row      .nd-row › __check · __code · __name · __meta · __value · .nd-row--in · .nd-row--done
Numbers  .nd-num (Noto Sans + tabular-nums; .nd-mono is an alias)
Fields   .nd-field › __lbl · .nd-input(--error)[readonly] · __hint
Editors  pf-hero-band[contextBar] › .nd-ctx › __primary · __edit · __chip · __k · .nd-dot-unpriced
         .nd-tabs[role=tablist] › .nd-tabs__item[role=tab][aria-selected] › .nd-tabs__dot(--ok) · .nd-savestate(__dot)
Motion   --nd-spring · --nd-spring-bounce · --nd-dur-fast · --nd-dur · --nd-dur-sheet
         .nd-anim-in · .nd-anim-pop · .nd-anim-rise
AI       .nd-ai-glow[data-ai-working] · .nd-ai-glow--inset · .nd-ai-glow--ring · .nd-ai-glow-mark · --nd-ai-angle (PF Sense only)
Mobile   .nd-bottombar(__info) · .nd-sheet(__handle) · .nd-sheet-backdrop · .nd-fullscreen · --nd-nav-h
Tokens   --nd-radius-card · --nd-radius · --nd-radius-sm · --nd-radius-chip · --nd-card-bg · --nd-line
         --nd-shadow-sm · --nd-chip-bg · --nd-sel-bg · --nd-sel-border · --nd-in-tint · --nd-done-tint
         --nd-toggle-on · --nd-toggle-off · --nd-toggle-urgent
Mixins   nd.card · nd.btn-primary · nd.btn-secondary · nd.neutral-selected · nd.no-truncate · nd.reduced-motion
```
