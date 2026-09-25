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
- the amber **unpriced / required** dot.

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
Motion   --nd-spring · --nd-spring-bounce · --nd-dur-fast · --nd-dur · --nd-dur-sheet
         .nd-anim-in · .nd-anim-pop · .nd-anim-rise
Mobile   .nd-bottombar(__info) · .nd-sheet(__handle) · .nd-sheet-backdrop · .nd-fullscreen · --nd-nav-h
Tokens   --nd-radius-card · --nd-radius · --nd-radius-sm · --nd-radius-chip · --nd-card-bg · --nd-line
         --nd-shadow-sm · --nd-chip-bg · --nd-sel-bg · --nd-sel-border · --nd-in-tint · --nd-done-tint
         --nd-toggle-on · --nd-toggle-off · --nd-toggle-urgent
Mixins   nd.card · nd.btn-primary · nd.btn-secondary · nd.neutral-selected · nd.no-truncate · nd.reduced-motion
```
