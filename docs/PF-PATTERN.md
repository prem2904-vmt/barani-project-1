# New-design pattern (pf-kit)

Every new-design screen in Prefrontal apps follows this pattern and uses the **pf-kit**.
The canonical example is **Order & Payments**
(`apps/lms/src/app/features/frontdesk/order-create/`). The second screen built
on it is **Collect sample** (`apps/lms/src/app/features/lab/sample-collection/`,
the collect drawer).

The shared kit lives in `libs/shared/src/lib/styles/`. LMS imports it
once from `apps/lms/src/styles.scss`; each future app should do the same from
its global stylesheet:

| File | What it is |
| --- | --- |
| `_pf-kit.scss` | **Global** classes and tokens (light + dark). Imported once per app through the library's `styles` entry point. |
| `_pf-mixins.scss` | Mixins only, no CSS output. Component styles may `@use '<relative path to libs/shared/src/lib/styles>' as pf;` where a kit class can't be applied. |

Standalone Angular primitives are exported from `@prefrontal/shared`.
Use `PfButtonComponent`, `PfCardComponent` with its header/body/footer regions,
and `PfStatusChipComponent`; keep workflow logic and domain-specific controls
inside their feature libraries/apps. The shared library is an internal Nx
source library, so its Angular peer dependencies stay aligned with the
workspace version.

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
┌ side card ───────────┐ ┌ main work card (.pf-card) ───────────┐
│ ICON  LABEL  toggles │ │ ICON  LABEL      note / controls     │
│ body (scrolls)       │ │ ──────────────────────────────────── │
│                      │ │ body (scrolls)                       │
│ [secondary][PRIMARY] │ │                                      │  ← sticky footer (side card)
└──────────────────────┘ └──────────────────────────────────────┘
```

- Page: `.pf-page`. There is no page-level scroll; only card bodies scroll.
- Body: `.pf-body.pf-body--split` holds the main card plus a 400px side card
  at ≥1024px — the side card on the LEFT (owner 2026-11-17, same across the app; the DOM keeps main first so
  phones stack main first). Below that it is one column.
- Cards: `.pf-card` > `.pf-card__head` (`.pf-card__icon`, `.pf-card__label`
  in uppercase, optional `.pf-card__note`, `.pf-card__spacer`, header
  controls) > `.pf-card__body` (scrolls) > `.pf-card__foot` (sticky, a 2-column
  button grid; `.pf-span` makes a button full width).
- Order & Payments: the catalogue is the main card, BILLING is the side card.
  Collect: VIALS is the main card, COLLECTION is the side card.

### Continuity: the band is the same on every step

The band always shows the **back chevron**, the **tenant logo and name** and
the **band actions**. It **never** becomes a page or patient title.
Every screen of a work-area where the Process builder places Sample collection gets `pf-collect-band-button` as the RIGHTMOST band action (quiet slate secondary, tube icon, icon-only 44px on phones): with an order selected it opens `/lab/collect?orderId=…&from=…`, otherwise the general queue, and Back returns to the calling screen.

Lab → My Work's LEFT companion follows the workflow: collection placed in the Lab with no dispatch/intake step (tubes auto-receive) → a COLLECTION card (embedded `pf-sample-collection`: find/scan, pending list, collect in place; band Collect focuses it instead of navigating); dispatch + Lab Intake on → the LAB INTAKE card; neither → the work pane runs full width.

The band's pill is the **CONTEXT BAR** for the step:

- **Search screens:** the pill *is* the search (Order & Payments: scope tiles
  plus input).
- **Work screens** (Collect; later results, validate, …): the pill holds the
  current **subject** as read-only chips (patient, order ID, sample IDs) and
  a counter (`.pf-band-chip`). **Filters appear only when they add something
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

### Two jobs on one screen = main card + side card

**Two jobs on one screen = a main card (the work) + a side card (the
companion), styled like BILLING, collapsible to a strip; a sheet on phones.
The side card sits on the LEFT, always (owner 2026-11-17: "same across the app", like Test Master's
Departments) — whether it filters / navigates or summarises / acts:**

- **FILTER / NAVIGATION companion → LEFT.** Reading goes left to right:
  filter first, then the content it filters. Test Master
  (`features/admin/tests/tests/`): DEPARTMENTS (~340px) on the left, the
  test grid (main; its header has the count + the muted "Double-click a cell
  to edit" hint) on the right, filling the rest.
- **ACTION / SUMMARY companion → also LEFT** (was right before 2026-11-17). Collect: COLLECTION on the left,
  VIALS (main) on the right; Order & Payments follows as its screen is moved over.
- Both are the same `.pf-card` with the BILLING header: violet icon chip +
  UPPERCASE label + a neutral collapse icon button. Rows are whole-row
  targets with the neutral selected state; a switch in a row is a separate
  target (slate `.pf-toggle`), and switching OFF something that hides it
  lab-wide asks first (`DialogService`). Disabled items are muted with an
  "Off" tag; counts are plain muted tabular numbers.
- **Collapse** turns the card into a slim vertical strip ON ITS OWN EDGE
  (icon + the label set vertically, one expand target). Chevrons point the
  way the card moves: a left card collapses ‹ and expands ›, a right card
  the reverse. The state is remembered per user (`localStorage`, wrapped in
  try/catch) and the column width animates on `--pf-spring` (none under
  reduced motion).
- **Narrow widths (≤900px):** no side column. The main card is full width
  and the side card opens as a sheet (above the navbar; handle, backdrop,
  × to close) from a button in the band pill (Test Master: "Departments").
  Picking a row in the sheet applies it and closes the sheet.

### Card headers and row actions

- Every card / pane header is the BILLING header: a violet icon chip
  (`.pf-card__icon`) + the UPPERCASE title. ONLY the icon chip is tinted — the
  label and the header row have no fill / pill behind them. Nothing else unless it is a real
  control for that card (toggles in slate). Counts are plain muted text on
  the right — never a pill.
- **Card header: search + filter** = ONE row inside the card padding: a compact
  kit search first (icon + `.pf-input`, 36px), then the neutral segmented
  filter (tab counts = plain tabular numbers). Same height as the sibling card's
  header; the search shrinks first, the filter scrolls in its own box. Phones:
  search full width (44px, 16px text), then the filter row. No filters in the band.
- **Row actions: text on web, icon on touch.** Per-row actions (Delegate,
  Print, Edit…) use the kit's `.pf-rowact`. On web (`(hover: hover) and
  (pointer: fine)`, via `webPointerSignal()` in `shared/utils/pointer-mode.ts`,
  the same query as Order & Payments) they are compact 32px secondary TEXT
  buttons ("Delegate", "Print", "Edit"). On touch (iPad / phone) add
  `.pf-rowact--icon`: a neutral 44px icon button, label kept for AT via
  `aria-label` + the visually-hidden `.pf-rowact__t`. Never a gradient.
- Header / group counts are pluralised properly (`plural()` in
  `shared/utils/plural.ts`): "1 sample", "2 samples". Group dots: NORMAL is
  neutral; red only for URGENT.
- **Priority vs TAT (owner, 2026-09-29).** The lab has exactly two
  priorities — the ORDER's **Urgent** and **Normal** (`urgent` / `stat` →
  Urgent; `routine` / `normal` / empty → Normal). There is no "High". Work
  queues group by that priority (Urgent first) and sort by TAT due time
  inside each group. TAT is a separate clock chip (`pf-tat-indicator`,
  `shared/utils/lab-priority.ts`), never called a priority: **Overdue**
  (rose), **Due in 20m** / **Due in 1h 20m** (amber, within the hour),
  otherwise the plain due time (**Due 14:30**, neutral). A test with no TAT
  budget shows no chip. The abnormal-result "High" (H) flag is a result
  flag and is unaffected.
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

- **Primary** (`.pf-btn.pf-btn--primary`, the violet gradient): **one** per
  view, for the main call to action only. Examples: Continue to payment,
  Confirm ₹X received, Review & Pay, Collect all to finish (only when enabled),
  Dispatch.
- **Secondary** (`.pf-btn--secondary`, outline, like "Save as draft"): Can't
  collect, Label by hand, Save as draft.
- **Tertiary** (`.pf-btn--tertiary`, text): Clear, Discard draft, Edit.
- **Danger** (`.pf-btn--danger`, muted-red outline): destructive actions such as
  Cancel order. Never a filled red button; the confirm stays (DialogService /
  the screen's confirm card).
- **Icon** (`.pf-btn--icon`, neutral): close, "more".
- Everything else is neutral: tiles, chips, segmented controls, counters,
  badges, thumbnails.

✅ Do: a disabled "Collect all to finish" is secondary; it turns primary when enabled.
❌ Don't: a gradient cart icon, a gradient ₹/% toggle, a violet "selected" payment tile.

### Prices are just the price

A price shows as **just the price**, e.g. "₹1": plain normal text, right
aligned, tabular numbers — everywhere (Test Master grid, Pricing, Order &
Payments catalogue / dropdown / cart, booking, the test editor). There is NO
"not priced yet" notice in any form (no amber tag pill, no amber dot, no
tooltip, no "N not priced" count), even for a test still at the ₹1 default.
"Not offered here" (a neutral tag) is a different thing and stays.

### Palette: primary + neutrals only

The palette is **primary (violet)**, **secondary and tertiary (neutrals and
slate)**. No green, teal, sky or other off-palette colour as decoration:
"done / drawn / paid / included" is the neutral selected state (a light
violet tint `--pf-done-tint` + a violet check), never a green tint, badge or
pill. Functional exceptions — these are data or warnings, not decoration:

- tube cap colours and the red blood-fill animation (Collect);
- the muted-red **Urgent** toggle (`.pf-toggle--urgent`);
- error red for validation / short payments;
- the amber **required** dot (`.pf-dot-unpriced`, a legacy class name — it
  marks REQUIRED fields only);
- the **AI-in-progress rainbow glow** (`.pf-ai-glow`, below) — the ONE
  allowed multicolour: **AI in progress only; never decorative.**

### PF Sense: AI in progress

- **AI features are branded PF Sense; show the PF mark, not "AI".** No
  user-facing "AI" text, tag or label anywhere — internal names may stay.
  The mark is the canonical glyph (`pf-logo-mark variant="mono"`, ~14px,
  violet / current colour) with tooltip + aria-label "Read by PF Sense" on
  things PF Sense filled in. Copy: "PF Sense · reading…", "PF Sense isn't
  available — pick …", "PF Sense this month: 1.2M / 2M tokens".
- **While an AI call is in flight** put `.pf-ai-glow` on the surfaces it
  affects and toggle `data-ai-working="true"`: a thin conic rainbow ring
  (violet → blue → cyan → green → yellow → orange → pink) + a soft blurred
  halo, rotating via `@property --pf-ai-angle` (~3.5 s a turn), ~0.6
  opacity (stronger in dark). `.pf-ai-glow--inset` draws ring + halo
  INSIDE a frame / panel that clips or scrolls; `--ring` drops the halo for
  many small items at once (list cells); `.pf-ai-glow-mark` gives SVG
  marks a hue-cycling glow. Removing the attribute fades it out (keep the
  class for the fade). Pseudo-elements only, `pointer-events: none` — the
  user keeps working underneath. Reduced motion: a static soft rainbow
  ring, no rotation.

✅ Do: "All vials collected" = neutral chip with a violet check icon.
❌ Don't: mint tile tint, green check badge, green time chip.

## 3. Selected states are neutral

- Segmented controls: `.pf-seg` > `.pf-seg__item[aria-checked|aria-pressed="true"]`
  shows as a raised neutral segment with normal text.
- Chips: `.pf-chip[aria-pressed="true"]`. Use `.pf-chip--static` for
  read-only chips.
- Tiles / method tiles: `.pf-tile-sel[aria-checked="true"]` gets a stronger
  border and a light tint, with no violet text.
- In cart / drawn: `.pf-row--in` (a subtle tint plus a neutral check) and
  `.pf-row--done` (a light success tint).
- Drive state with ARIA attributes, not `…--on` classes. A global new-design
  rule turns any `button[class*="--on"]` violet.

## 4. Toggles are violet

`.pf-toggle[role=switch][aria-checked]` > `.pf-toggle__track` > `.pf-toggle__knob`.

- ON is a flat brand-violet track (`--pf-switch-on`: the primary #7C3AED in
  light, #8B5CF6 in dark), with a white knob and a small shadow (owner,
  2026-09-27: switches were slate; now violet). `--pf-toggle-on` stays slate
  for the non-switch neutrals that share it (status dots, sliders).
- OFF is a lighter neutral.
- `.pf-toggle--urgent` makes ON a muted red, never violet.
- Examples: Urgent and Include Trendogram in the BILLING header.

## 5. No truncation when there is room

- Titles, names and meta wrap (`.pf-head__title`, `.pf-head__meta` and
  `.pf-row__name` all use the `no-truncate` mixin).
- An ellipsis is allowed only when the text truly overflows a one-row
  container: a phone pill chip, or a flex item with `min-width: 0`.
- Never cut a name in code, e.g. `formatPatientInfo` shortens names to 15
  characters. Use `patientDisplayName` for display.

✅ `Ms. Paravai Munusamy` ❌ `Ms. Paravai Mun..`

## 6. Lists: one row per item

- The row: `.pf-row` > `.pf-row__check` · `.pf-row__code` (mono, violet) ·
  `.pf-row__name` (wraps, up to 2 lines) · `.pf-row__meta` (muted) ·
  `.pf-row__value` (right aligned, e.g. the price).
  Rows are at least 52px tall.
- Search results are **one per row**, so the ranked order reads top to
  bottom and ↑/↓ moves one row. Never lay search results out in a multi-column
  grid.
- Browse grids (the catalogue, vial tiles) may use 2–4 columns of compact
  tiles, about 72–88px tall, with a small glyph rather than an illustration.
- **One font family: Noto Sans.** IDs, codes, times and counts use tabular
  numbers (`.pf-num` = Noto Sans + `font-variant-numeric: tabular-nums`),
  never a system monospace (`monospace` / `ui-monospace` renders as Courier).

### In lab work lists the sample ID is the primary line

Queue / My Work / Completed / Culture tiles and Lab Intake rows lead with the
SAMPLE ID: ~16.5px, weight 600, normal text colour, Noto Sans tabular numbers
(never small violet, never monospace). Patient name ~13px / 500 secondary,
meta ~12px muted. Colour stripe only for an Urgent order (red). A
received / done row goes quieter (muted text + a small violet check), never
a green or amber pill. The next step on a culture case is a neutral chip
whose small violet dot is the one accent.

### List rows & multi-select

Canonical: the Frontdesk work list (`frontdesk-landing`, `.pf-wrow`,
`work-selection.ts`).

- **Row:** `[checkbox] · FULL name + quiet meta · status · action`.
  - The name wraps and is never cut.
  - Meta is one muted tabular line joined with `·`, never `|`: "22/M · AA0006 ·
    1 sample · 9:48 PM".
  - No department code chips.
  - Status is a 7px dot plus a coloured word, with no chip, border or background
    (owner, 2026-09-26). Tones come from the accent tokens: billed or done is
    green, dispatched is blue, in lab, collected or partial is amber, cancelled
    or rejected is red. This is the one place row status may be green or amber.
    Drawers and detail screens keep the neutral chip.
  - The action is `.pf-rowact` (text on web, a 44px icon plus `aria-label` on
    touch) in a right-aligned slot of fixed width, so it lines up in every row.
  - The whole row opens the detail; the checkbox and actions stop propagation.
- **Checkbox:** the kit's `.pf-check` (`button role="checkbox"`,
  `aria-checked`, `aria-label="Select <name>"`, Space toggles), a 20px round
  circle (neutral ring) that fills violet with a white check.
  - Show it only on lists that have bulk actions, and only on rows that can
    take them.
  - A row that can't take them keeps an empty column, so the rows stay aligned.
- **Selected row:** violet at about 7% over the card, plus a 1px violet border.
  No gradient.
- **One model:** the checkbox, the tint and the count all read one computed
  list (the rows shown that are eligible and selected). Never tint from a raw
  id set while counting a filtered subset; that gave "1 selected" with three
  rows tinted.
- **Selection bar:**
  - It sits above the list, outside the scroller, on the card surface with a
    hairline.
  - Contents: "3 selected" (Noto, not uppercase), then Select all / Clear,
    then the bulk actions (at most ONE primary), then a labelled ×.
  - It slides and fades in; there is no motion under reduced motion.
  - On phones it docks at the card's bottom above the navbar, with two equal
    44px buttons.
- **Clearing:** the selection clears on Esc (unless a drawer is open), a tab
  switch, a search change and a date-range change.
  - Shift-click selects a range on web.
  - A long-press selects on touch.

### Work queues: adaptive tile grid, 3/2/1 columns by container width

Queue / My Work / Completed / Culture lists use `<ul [pfTileGrid]="…">`
(`shared/directives/tile-grid.directive.ts` + kit `.pf-tilegrid`). The LIST's
own width decides — never the window, because side panes can be pinned:
≥1100px → 3 columns, ≥640px → 2, below → 1. Tiles in a row share a height,
names wrap (never truncate), the row action sits at the tile's bottom-right,
and group headers (URGENT / NORMAL — order priority) span the full width above each
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

- **Tablet vs desktop is decided by the DEVICE, not only the width.** The
  native app, iPads (incl. iPad-as-Mac), Android and touch-only browsers get
  `html.device-touch` (+ `device-tablet` / `device-phone`) before the first
  paint (index.html, kept current by `DeviceClassService`); a mouse or
  trackpad keeps `device-desktop`. Never write a raw `@media (max-width:
  1279px)` / `(min-width: 1280px)`: use `shared/styles/_device-tier.scss` —
  `dt.tablet-tier`, `dt.tablet-band`, `dt.desktop-only` — so a 1280px+
  Android tablet or iPad Pro in landscape keeps the tablet layout and a
  desktop is unchanged. A Tailwind `xl:` class can't tell them apart: use it
  for density only, never for a layout switch.
- Tap targets are at least 44px. Inputs are at least 16px on phones, so iOS
  doesn't zoom.
- **Phone bottom bar:** `.pf-bottombar` (+ `.pf-bottombar__info`) carries the
  side card's summary and its primary action (the cart bar; Collect's
  "0/1 drawn · Collect all to finish"), above the navbar.
- **Phone sheet:** `.pf-sheet` (about 92dvh minus the top safe area) with a
  `.pf-sheet__handle`, an inner scrolling body, a sticky footer with the
  bottom safe area, and `.pf-sheet-backdrop`. Side-card actions open in it.
- **The bottom navbar is ALWAYS visible — on every screen and size. Never
  hide it.** Layouts fit ABOVE it: `--pf-nav-h` (the docked bar's height,
  incl. the bottom safe area) is reserved by the shell for in-flow pages;
  fixed / teleported full-screen views use `.pf-fullscreen` (ends at
  `bottom: var(--pf-nav-h)`); sticky footers, `.pf-bottombar` and
  `.pf-sheet` sit on top of it (the sheet's height is capped between the top
  safe area and the nav). The only exception is the app-wide soft-keyboard
  dodge that already existed (KeyboardService) — call
  `KeyboardService.reset()` when a view that owns an input tears down.
- Follow the repo's mobile conventions: phone rules are additive, inside
  `@media (max-width: 640px)`, and never change desktop.
- **Result numpad** (`shared/components/numpad`): numeric RESULT fields
  carry `pfNumpad` (label / unit / live flag inputs) inside a
  `pfNumpadScope="<field selector>" pfNumpadCta="<submit selector>"`. On
  touch (`pointer: coarse`) the system keyboard is suppressed with
  `inputmode="none"` (never `readonly`) and ONE shared pad appears: docked
  in a bottom corner on iPad / wide screens (right by default; its grip
  swaps to the left corner, remembered per user) so it never moves while
  techs type → Enter → type, with the edited field scrolled clear of it;
  a bottom sheet on phones. The primary key reads **Enter** (Next / Done).
  Keys replay through the field's own keydown validator (no new rules);
  Next walks down the list skipping `data-numpad-skip` (calculated),
  read-only, disabled and hidden fields, opens a dropdown in between, and
  the last field's Done focuses the CTA. Desktop / hardware keyboards are
  unchanged. Never hand-roll another keypad for result entry.

### PF Keys: the in-app keypad for search fields on tablets

On iPad and Android tablets the system keyboard covers 40–45% of the
screen and squeezes the results. PF Keys docks at the bottom at about 28%
(QWERTY) or 32% (code and number pads) of a landscape tablet (about 21–23%
in portrait). The page above it resizes; nothing overlaps.

- **Where it is used:** search fields only.
  - Test search in order create (the pill's Tests scope).
  - Patient search: `pf-patient-search` everywhere, and the pill's Patient
    scope.
  - Sample / tube number lookups: My Work, Receive and Collect, both the
    band search (`<pf-hero-band keys="sample">`) and the classic inputs.
  - Everything else keeps the system keyboard: remarks, report text,
    names, addresses, the pill's Doctor / Hospital scopes, and the Receive
    sequence box. Never put it on a textarea.
- **Which devices:** the `device-tablet` class only (`DeviceClassService`).
  Phones and desktops are untouched: no `inputmode`, no keypad.
- **How to use it:** `<input pfKeys="test|patient|sample">`.
  - Optional inputs: `pfKeysEnter` / `pfKeysEnterAria` (the primary label),
    `[pfKeysArrows]="true"` (only where the screen already moves a
    highlight with ↑/↓), `[pfKeysPrefixes]`, and `pfKeysLayout` (a default
    override).
  - `[pfKeys]="null"` switches it off.
- **Layouts:**
  - `qwerty`: Q–P, A–L, Z–M (plus ↑ ↓ where supported). The bottom row is
    `123`, the system-keyboard key, space, ⌫, **Add ↵**, and the hide
    chevron. There is no mic.
  - `code`: a DEPARTMENT PREFIX grid, a 3×4 digit grid (1–9, – 0 .), then
    ⌫, hide, `ABC`, the system-keyboard key, and a tall **Add ↵**.
  - `number`: 1–9 and 0, ⌫, `ABC`, and **Open ↵**.
- **Default layouts:**
  - Tests default to QWERTY; `123` switches to the code pad.
  - Patient defaults to the number pad; `ABC` switches to QWERTY, whose
    `123` goes back to the number pad.
  - Samples default to the code pad.
  - The last layout is remembered per user per kind in localStorage (the
    `pf-keys-layout:<user>:<kind>` key). Every access is try/catch.
- **Department prefixes** are the lab's own codes, never hardcoded.
  - Order create passes its catalogue's department codes.
  - Otherwise `/api/tenants/departments` is loaded once, lazily.
  - For a test search, a key types the code (`HEM`).
  - For a sample lookup, a key types the short-barcode prefix DD+YY
    (`0226`) when the department has a 2-digit sample code. Otherwise it
    types the letter code.
    (Live sample IDs are `[space/dept/Lab code][date][number]` — see
    "Sample search preset" below, which pre-types the real head.)
- **The primary key** sends the field its OWN Enter. Test search adds the
  highlighted row (the row shows a neutral "↵ Add" chip while the keys
  are up). Patient search opens or selects the highlighted patient. The
  band searches submit. Primary colour is used only on this key.
  - The label follows what Enter will DO. Order create binds
    `[pfKeysEnter]` / `[pfKeysEnterAria]` / `[pfKeysEnterTone]` to its
    highlight: **Add ↵** when the highlighted test is not in the order,
    **Remove ↵** when it is (Enter toggles). Remove is destructive-neutral:
    the neutral key colour with a muted-red outline and text (ND danger),
    never the violet gradient and never a filled red. Fields that don't
    bind them keep their fixed label (Open / Select / Receive / Search).
- **Fast typing (`key-tap.ts`, shared with the result numpad):**
  - Typing keys (letters, digits, space, ⌫, ↑/↓) act on `pointerdown`, once
    per pointerId, so rolled-over multi-finger taps all land in order.
    Never `(click)` alone: a click waits for the lift, and touch browsers
    drop the clicks of overlapping taps.
  - Commit keys (Enter, 123/ABC, hide, system keyboard, department
    prefixes) act on `pointerup` of the same finger on the same key; a
    `pointercancel` (scroll) does nothing.
  - The click that follows a press is swallowed (document capture, matched
    by position and time), so nothing doubles and nothing clicks through
    to the page after the keys close. A click with no press before it
    (Enter / Space on a key, a screen reader) still acts.
  - Keys are `touch-action: none` and unselectable (no double-tap zoom; a
    pinch can't cancel two rolled-over fingers). ⌫ deletes on touch-down;
    held, it clears the field.
- **The engine is the result numpad's, not a fork.**
  - It uses the same `NumpadService`, also exported as `PfKeysService`.
  - `inputmode="none"` is set on pointerdown and `readonly` is never used.
  - Each key is replayed through the field's keydown listeners, then a
    real `input` event fires, so ngModel and debounced searches work
    unchanged.
  - A real hardware key makes the keypad step aside.
  - Hide keeps focus; tapping the field brings the keypad back.
  - No autocorrect or suggestions: `autocomplete` / `autocorrect` /
    `autocapitalize=off`, `spellcheck=false`.
- **Escape hatch:** the keyboard key gives THIS field the system keyboard
  until it blurs, for paste and unusual characters.
- **Docking:**
  - While open, `html.pf-keys-open` is set and `--pf-keys-h` holds the
    keypad height.
  - The shell's `[data-pf-keys-host]` scroller is padded by that height
    with `!important`, so fixed-height pages end right above the keys.
  - `KeyboardService.setInAppKeyboard(true)` treats PF Keys as a keyboard:
    the docked navbar steps aside, so there is no double gap.
  - Fixed bars, such as order create's cart bar, sit at
    `bottom: calc(var(--pf-keys-h) + 8px)`, directly above the keys.
  - Dropdowns subtract the height (listen for `pf-keys:resize`).
- **Look and feel:**
  - Slate keys on a tray, 10px radius, keys at least 44px tall.
  - Light and dark tokens; the safe-area bottom inset is respected.
  - Reduced motion is respected.
  - Each key is a `tabindex=-1` button with an aria-label ("Letter Q",
    "Backspace (hold to clear)", "Add selected test"), and the panel is a
    labelled group.
  - The panel is its own lazy chunk, loaded the first time a tablet field
    shows it.

### Sample search preset (`pfSamplePreset`)

A lab user's suggestion for labs doing 1000+ samples a day: the sample
search boxes open with the current sample-ID head already typed, so the
tech types only the tail number.

- **Where:** the sample lookups only: the band search with `keys="sample"`
  (on by itself) and the classic inputs of My Work, Receive and Collect
  (`<input pfKeys="sample" pfSamplePreset>`). Every device, not only tablets.
- **What it types** comes from the lab's REAL sample-ID format
  (`GET /api/config/sample-search-preset`), never a guess: `[prefix][sep][date][sep]`
  exactly as the server prints IDs — `2609` for a yymm lab, `HEM26` / `MIC-2609-`
  when the user works in ONE department / space (their auto-assign pools),
  else the branch's Lab code. The date is the LAB's (branch timezone, default
  Asia/Kolkata) and is computed on focus, so it turns into `2610` on 1 October
  without a reload.
- **Behaviour:** typed on focus of an EMPTY field, caret at the end; one
  Backspace (hardware or the PF Keys ⌫) clears the whole preset; a letter
  typed first replaces it (a patient name on Collect); Enter with only the
  preset does nothing; leaving the field with only the preset clears it.
- **Setting:** Lab settings → Sample identification → "Pre-fill sample
  search" (tenant-wide). Automatic by default: ON when the format starts
  with year+month (yymm, yymmdd), OFF otherwise; the switch overrides it and
  "Reset" returns to automatic.

## 9. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--pf-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | search activation, results, scrim |
| `--pf-spring-bounce` | `cubic-bezier(0.34, 1.36, 0.64, 1)` | field grow, sheet rise, pop |
| `--pf-dur-fast` | 200ms | closes and hovers (closes run quicker) |
| `--pf-dur` | 320ms | open / activation |
| `--pf-dur-sheet` | 360ms | billing / phone sheet rise |

- Classes: `.pf-anim-in` (fade and scale from 0.97), `.pf-anim-pop`
  (a confirm tap, e.g. a drawn vial), `.pf-anim-rise` (a sheet).
- Stagger list rows by about 18ms.
- Everything is off under `prefers-reduced-motion`.
- **Navigation motion — list → detail = ZOOM, step → step = SLIDE,
  everything else OPENS AS A PAGE.**
  - **Zoom** (`core/navigation/zoom-transition.ts` + `zoom.directive.ts`):
    put `[pfZoomSource]="keys"` on the tile/row that opens a detail and
    `[pfZoomTarget]="keys"` on the detail's main card AND its loading
    skeleton. Keys are the ids either side answers to — list both when a
    redirect changes the id (culture page: `[orderTestId, sampleId]`).
    Only the TAPPED source is named (`pf-zoom`), only during the
    transition; the box morphs ~400ms on `--pf-spring` while the content
    stays natural size and cross-fades (no stretched text). Render the
    skeleton while `zoom.holding()` too, so the named card is never
    swapped mid-morph. Back reverses it (into the tile, or toward where it
    was). No tap → no zoom (scan / search / deep link are instant). A
    double tap is swallowed. In-page details (Collect's collection view)
    use `zoom.runLocal('in' | 'out', update)`; gated opens (scan to claim,
    a reason prompt) call `zoom.rearm(key)` right before navigating.
  - **Slide** (`core/navigation/slide-transition.ts`): a flow's next step
    (Order & Payments / front desk → Collect) slides forward; back
    reverses.
  - **Page open** (`core/navigation/page-open.service.ts`, `pf-vt-page`):
    every other move to a different screen. Only the shell's `<main>`
    moves (app bar + nav stay still): the old screen eases out (150ms),
    the new one eases in with a 10px rise + 0.992 scale (240ms,
    `--pf-spring`). A slow navigation first draws the destination's frame
    (`<pf-page-frame>`: band + skeleton in that screen's layout, from
    `page-skeleton.ts`), and the screen then cross-fades from it
    (`pf-vt-settle`) — nothing rises twice. Same screen with new query
    params and the branch hop swap instantly. No View Transitions API →
    the shell plays the same entrance in CSS (`data-po-enter`).
  - Real-browser proof: `apps/lms-e2e/src/zoom-transition.rbac.spec.ts`
    (every module pair, 5 taps each).
  - Order & Payments is a zoom destination too: a parked draft (In progress
    row or app-bar shelf chip) zooms in, back zooms out; focus follows the
    zoom (detail card on open, the tile on close).
- **Loading = skeleton, never the PF logo** (the logo is sign-in branding).
  Use the kit in `shared/primitives/skeleton-kit.component.ts`
  (`pf-skeleton-rows | -table | -card | -detail | -form | -tiles`, inline
  `pf-busy` for buttons): draw the shape of the area that is loading. Each
  preset is the region (role=status, aria-busy, polite label).
- **Load-driven states hold a minimum** (`shared/utils/min-duration.ts`:
  `heldFlag`, `withMinDuration`, 600ms) so a fast load reads as one calm
  motion, never a flash. Taps that load nothing stay instant.
- **Branch switch** is in place (`BranchSwitchService`, no page reload):
  the screen recedes, the destination skeleton rises ("Switching to X"),
  holds until the new screen's API calls settle (>= 750ms), then the screen
  zooms up. Reduced motion: opacity only.

### Loading feedback

Owner, 2026-09-29: *"Wherever there is an action that takes time, there needs
to be an animation so the user feels something is happening."* Every tap that
waits on the network or on a lazy screen gives feedback — one standard set,
no new looks:

| Wait | What shows | Primitive |
| --- | --- | --- |
| **A button's request** (save, submit, send, print, approve…) | The SAME frame: `aria-busy`, dimmed, repeat presses swallowed. After 150ms: the kit's busy dots inside the button, and its words say what is happening ("Saving…"). | `[pfBusy]="saving()"` on a native button (`shared/directives/busy.directive.ts`), `[busy]` on `pf-touch-btn`; `busyWhile(flag)` (RxJS) sets the flag. Keep the button's own `[disabled]` binding. |
| **A screen on its way** (lazy chunk, guards) | The screen OPENS at the tap (owner, 2026-09-30: "not a loading bar — a page-open animation and skeletons"). After 90ms: the DESTINATION's frame (its band + a skeleton of its body in that screen's layout) eases in over the screen being left, which eases out. On arrival the view transition opens the screen (fade + small rise, 240ms, nd spring; a pure cross-fade when the frame was up). Zoom / slide pairs keep their own motion (frame only after 400ms). No View Transitions (older WebKit): the same entrance in CSS. Reduced motion: instant. **Never a top progress bar.** | `PageOpenService` + `<pf-page-frame>` (shell, once) + `slideTransition` (`pf-vt-page`). Layout per destination: ONE table, `core/navigation/page-skeleton.ts` — add a row when you add a screen. |
| **The thing you tapped opens a screen** (a DOM-built grid row action, a tile) | The pressed element turns "held" (tint + a slow pulse) the same frame, until that navigation settles (cancel included). When the destination is heavy to build, navigate AFTER that frame is painted so the press is never swallowed. | `PageOpenService.markSource(el)` + `afterNextPaint(() => router.navigate(…))` (`shared/utils/busy.ts`) |
| **Opening an editor / drawer / page** | Its OWN layout as a skeleton on the first frame — band + name chip placeholder, the section card as fields, the side card as a block — never a blank form or a frozen previous screen. Save is not offered for a record that isn't on screen yet. | Skeleton kit (`pf-skeleton-form / -card / -detail`), held with `heldFlag(loading)` (600ms minimum). Canonical: the test editor (`recordSkeleton()`). |
| **A grid / list's first load** | Skeleton rows in the grid's box (over the mounted grid so it keeps its size); later reloads keep the rows on screen. | `pf-skeleton-table` / `pf-skeleton-rows`, `heldFlag`. Canonical: Test Master (`listSkeleton()`). |
| **A long save / upload / bulk job** | The button stays busy AND the region says so: a progress count when the work is countable ("Saving 3 of 12…"), otherwise the busy dots with the words. | `[pfBusy]` + text; `pf-busy` inline. |
| **A lazy screen the user is about to open** | Nothing — it is simply fast: the list warms the editor's code while idle and on hover / focus of its action. | `prefetchWhenIdle(key, loader)` + `prefetch(key, loader)` (`shared/utils/prefetch.ts`), with ONE loader shared with the route (e.g. `test-editor.loader.ts`). |

Timing rules (`shared/utils/busy.ts`):

- **Instant press feedback, always** — the pressed control changes in the
  same frame (busy state, `.press` scale, held tint). Never a dead click.
- **Moving indicators only after `BUSY_SHOW_AFTER_MS` (150ms)** — dots
  never flicker for a fast answer (`spinDelay` / `createSpinDelay`); the
  destination frame waits `FRAME_AFTER_MS` (90ms).
- **Once shown, held `BUSY_MIN_SHOW_MS` (300ms)**; load-driven skeletons are
  held 600ms (`heldFlag`, see "Load-driven states hold a minimum").
- **Reduced motion:** no shimmer, no page-open motion, static dots, no pulse — the
  states still appear (opacity / tint only).
- **Accessibility:** skeleton presets are the loading region (role=status,
  aria-busy, polite label); busy buttons carry `aria-busy` + an SR label;
  the destination frame announces "Opening <screen>…" once.
- **Not a loading look:** the PF logo (`pf-loading-logo`) is sign-in branding
  only; never spinners that block the whole screen for one button's request.
- **Tests:** a screen that loads asserts its skeleton on the first render and
  its busy button (disabled + `aria-busy`) while the request is in flight —
  see `test-editor.loading.spec.ts`, `busy.directive.spec.ts`.

## 10. Always

- **No emoji.** Icons are stroked inline SVGs with `aria-hidden="true"`;
  icon-only buttons get an `aria-label`.
- **No native controls.** No `<select>`, `datalist` or `window.confirm`: use
  `pf-select` and `DialogService`.
- **Theme tokens only.** Light and dark must both be right; never force dark.
- **Tests:** add specs for the pattern hooks. Examples: only one primary; kit
  classes present; no truncation; mode switching.
- **Esc that the screen uses is taken.** The desktop app opens full screen and
  a spare Esc leaves it (`core/services/desktop-fullscreen-esc.ts`). An
  overlay that closes on Esc is `role="dialog"` / `alertdialog` / `menu`, a
  floating `listbox`, an expanded `aria-haspopup` / combobox trigger, or
  carries `data-pf-esc`; any OTHER Esc action (clear a selection, zoom out of a
  detail, deselect) calls `preventDefault()` when it acts.

### Desktop full screen + top-strip clock (Electron only)

- Opens full screen on every launch (nothing remembered). Esc leaves it only
  when the app did not use the Esc (rule above); back in with F11 (Windows /
  Linux), ⌃⌘F or the green button (macOS), or **Full screen** in the avatar
  menu (shown only when windowed).
- While full screen the top strip ends (right end, after the avatar) with a
  Windows-taskbar-style clock (`pf-desktop-clock`): two right-aligned lines,
  time on top ("12:39 PM") and the dd/mm/yyyy date under it ("30/09/2026"),
  IST, Indian locale (12 h), tabular numbers, minute ticks, `<time datetime>`.
  Windowed, web and the iPad / phone apps never show it.

### The ⋮ actions menu (`pf-actions-menu`)

- ONE reusable kebab menu: `shared/components/actions-menu/actions-menu.component.ts`.
  It is the secondary-actions home next to a screen's primary CTA (the primary
  stays a visible button). Hosts pass `[actions]` already filtered by permission
  + state and handle `(action)` with their EXISTING handlers (DialogService
  confirms stay in the host). Project a host-styled button with
  `pfActionsTrigger` to keep the host's own button classes.
- Popover beside the ⋮ on web / iPad; a bottom sheet (handle, heading, Cancel,
  above the navbar) on phones ≤640px. `role=menu` / `menuitem`, ↑ ↓ Home End,
  Esc / Tab close, focus returns to the ⋮. Rows ≥44px, stroked SVG icons.
- Reports: every report screen (Report view, Results rows, Patient profile order
  detail, Validate) uses it; shared share/link/delivery flows live in
  `core/services/report-actions.service.ts` (patient link = `/track/{token}`,
  fallback `/reports/public/{qrToken}`; share ladder in `shared/utils/report-share.ts`).

### Draft tray (bottom bar)

- The docked bar's "work you left unfinished" tray (`layout/top-strip`,
  rules in `draft-tray.ts`): a quiet "Drafts N" caption, then compact SOLID
  chips (nd chip radius, hairline, small violet dot = unsubmitted) that show
  ONLY the sample number (front desk: the patient) in tabular figures. The
  patient name lives in the tooltip / `aria-label` ("Resume result for 26123 ·
  Mr. Sathish Kumar") and the overflow menu — never on the chip.
- Chip count = the width ceiling (`draftCap`: 3/4/5/6), then MEASURED: a chip
  is dropped while the chips overflow; with no room for one the tray collapses
  to a "Drafts N" chip. The rest sit behind "+N", which opens `pf-actions-menu`
  (every draft: number, patient · time; the on-stage one `current`).
- Selection is ARIA (`aria-current` / `data-current`), never a `--on` class.
  Phones (<768px) don't show the tray (owner).

## 11. Scanner

One shared modal (`shared/components/barcode-scanner/barcode-scanner-modal.component.ts`)
serves every scan point. Redesign it, never fork it per screen.

- Shell: pf-card modal (16px radius, soft shadow) on web; `.pf-sheet` on
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
- **Camera · Scanner · Type** (owner 2026-10-24): a kit `.pf-seg`
  radiogroup at the top of the body picks how this DEVICE reads codes —
  `camera` (QR / barcode, the viewfinder), `scanner` (a USB / Bluetooth
  hardware scanner: no camera, a neutral "Ready — scan now" panel with the
  last read as a chip) or `type`. Remembered per device in localStorage
  (`ScanInputPrefService`, key `pf.scanInput`); nothing chosen → the lab
  default from the tenant's Scan / Manual setting (manual → Type, else
  Camera). The tenant setting is never changed by it.
- States: match = violet check pops over the reticle, then hand-off;
  mismatch = red inline message + red reticle flash, scanning continues;
  camera unavailable = neutral panel + secondary "Type the number".
- Footer: tertiary "Cancel" only (the switch replaced "Enter manually").
  The only primary is the Type view's Confirm. Red only for the wrong-vial
  warning; no green, no pink, no spaced monospace caps.
- A tube QR carries `MRN|SampleID`: every scan path reduces it with
  `normalizeTubeScan()` (part after the last `|`) before comparing / looking
  up; URLs, JSON and plain barcodes pass through untouched. The Type view's
  5-digit PF box also takes a whole scanned PF-… code.

### Hardware scanner everywhere (`HardwareScanService` / `onHardwareScan`)

A hardware scanner is a keyboard (web, desktop, iPad, Android tablet). ONE
window capture-phase keydown listener (`@prefrontal/shared`
`HardwareScanService`) treats ≥ 4 keys each < 35 ms apart, ended by Enter /
Tab, as a scan — whatever has focus (or nothing: iPad hides the soft
keyboard with a Bluetooth scanner) and whichever mode the switch is on.
Characters are never blocked or delayed; only a completed burst's Enter /
Tab is stopped (a highlighted dropdown row or a form submit never reacts to
it), the field it was typed into gets its text back, and the newest
registered handler gets the code. Screens register with
`onHardwareScan(handler, { when })` — Collection, Receive (PKG- codes →
package), My Work (Lab Intake box → receive, else the band), Billing
counter, Stores; an open scanner window registers on top of its screen
(result-entry re-scan gate, analyzer attach, shell "Scan order"). Never add
a private HID buffer to a screen. The sample-ID preset clears itself on a
burst so an all-digit scan isn't glued to it.

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
  `.pf-seg`, standard height, each tab ONLY the sample ID (+ the violet
  open-work dot; tests in its tooltip / aria-label), in a **fixed order**
  (series offset, then sample ID). Switching moves only the selected
  indicator, which slides on `--pf-spring` (off under reduced motion).
- **Submit all** (2+ tube tabs): the ONE primary becomes **Submit all**
  (per-tab submit = secondary "Submit this sample"; phones: both as icons).
  Every field filled → submits every tab straight away; any empty field →
  ONE `DialogService` confirm ("Some fields are empty", the fields listed
  by tab · test, Go back → first empty field / Submit anyway). Tab marks:
  violet dot = unsaved or draft values, green check = every field filled.
- **Phones: the patient chip shows the FULL name** — the "29/M · AA0012"
  meta moves to its tooltip, and a long name wraps to two lines; never an
  ellipsis.
- **Phones: no tabs control.** The pill shows the patient + the CURRENT
  sample chip ("26124", violet dot when it has open work). With 2+ tubes
  that chip carries a chevron and opens a small list (sample ID + tests,
  fixed order); picking one switches tube. One tube = a plain chip.
- **No side panel.** RESULTS cards take the full width: one `.pf-card` per
  test (a profile = one card) — violet icon chip, the test name as the
  label, "+ Note" as the small secondary button. Web: the calm row table
  (1px `--pf-line` rows, parameter 14px / 500, range / unit / method
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
- **Report notes** (Lab settings → "Technician notes on report", per
  branch): a quiet document-icon button (`pf-report-note-button`) on each
  test row / test card header / profile header opens the inline editor
  (`pf-report-note-editor`: textarea + B / I / U / bullets / numbers,
  Ctrl/Cmd+B/I/U, live "Prints as" preview, 1000 cap); a saved note shows
  read-only under its row with Edit. Department + whole-report notes live in
  the "Report notes" card (`pf-report-notes-card`) after the results. One
  `ReportNotesStore` per screen; the server decides what is editable. Never
  a second "Note" button style — the comment "+ Note" stays for the bench
  conversation.
- **Type scale:** card label 13px / 600 uppercase (12px on phones — it
  must beat the global phone `h2` cap), parameter 14px / 500, chips and
  tabs 13px, buttons 14px, meta 12px. Watch global phone rules with
  `!important` (`[role='tablist']`, `h2`): component rules that must win
  need the specificity.
- Order-level extras above the cards only when they apply: the
  validator's "Submitted …" line, the slate **Include Trendogram** toggle
  (+ range picker), the flags the last submit raised.
- **Zoom from the queue:** tiles carry `[pfZoomSource]="tube.sampleId"`;
  the RESULTS skeleton (held through the morph) and then the first card
  carry `[pfZoomTarget]`, so the tapped tile morphs into it (~400ms, nd
  spring); back reverses it (§9 "list → detail = zoom"). No View
  Transitions or reduced motion → instant.
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
- **No stage tabs.** Every stage is a stacked `.pf-card` in order (Gram →
  Growth → Identification → AST): violet icon chip + the stage title (13px
  / 600 uppercase), a neutral state chip (violet check = done, violet dot =
  mine, held by …), the quiet note pencil, then per the lock rules
  **Submit** (secondary — that stage only), Delegate · Drop (tertiary), or
  Edit once done.
- **Rows:** [kit report tick] name 14px / 500 · the control column ·
  pencil. Option controls FILL the control column: an `.pf-seg` grid of
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
  - "Reading method" is a normal-case label + a kit `.pf-seg`; headers
    normal case; the zone field a kit field (Noto, tabular); × a quiet
    labelled icon button; "Hide organism / sensitivity" tertiary.
- **Measure zones modal** (`plate-measure`), like the scanner: an pf-card
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
    neutral `.pf-seg` (90 · 100 · 150 mm), default = the saved session, the
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
    header, and `.pf-ai-glow` on the plate frame, the list panel, each code
    cell still reading and (`.pf-ai-glow-mark`) the disk badges. It fades
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
  - **Plate BEFORE the organism (microbiology SME, 2026-09-25) — an extra
    path; the organism-first path stays.** On the culture case the AST area
    opens with a **PLATE** block (neutral card: 11px uppercase label, a
    secondary **Measure plate** / **Re-measure plate**, then one static chip
    per measured antibiotic — "AMC 30 · 6 mm" — and a muted line saying what
    happens next). Measure runs the same modal, but PF Sense reads the codes
    against the lab's **whole antibiotic master** (every drug's printed codes
    + potency, `masterCandidates` in `disk-codes.ts`; the backend takes up
    to 400, listed one per line). A drug is used once — two printed aliases
    of one drug ("CFS 105" / "CFS 75/30") count as the same.
    - **Held on the case:** after Review → Apply, the reading (disk → code →
      antibiotic → zone mm, photo, rings, PF Sense audit id) is saved on the
      branch's AST stage as `plateJson` inside the case's StagesJson (`PUT
      /api/microbiology/culture/{id}/stage/ast/plate`, `?caseId=` for a
      subculture) — no schema change; it survives reloads.
    - **Assign organism** sits right under the PLATE chips (a searchable
      `pf-select` of the organism master; "Organism" once assigned — pick
      again to change). Identification seeding the organism does the same.
    - **The table is the organism's FULL CLSI panel** (owner, 2026-09-25):
      the plate's antibiotics FIRST, in plate order, **ticked** (the report
      tick), zones filled, S / I / R from the organism's breakpoints; every
      other drug of the panel follows **unticked** (not reported, no zone —
      tick it to enter one by hand). Plate drugs land on the panel's own rows
      by their printed code ("PIT 100/10" → "Piperacillin-Tazobactam 100",
      "AMC 30" → the 20/10 row), else by drug.
    - **A measured drug outside the panel** is still added, ticked, with its
      zone and a muted "No CLSI breakpoint for <organism> — enter S ≥ and
      R ≤" line; its breakpoint cells are the usual editable boxes, and S / I
      / R computes from what is typed ("Breakpoint entered manually"). The
      typed breakpoints ride on the row (this case only). With the Test
      Master permission (`manage_tests`) a **Save to CLSI for <organism>**
      checkbox writes an organism-pinned lab breakpoint (`POST
      /api/microbiology/breakpoints`, `organism` set) so the next case fetches
      it; without it the line says "kept on this case".
    - **Changing the organism** rebuilds the same way on the SAME zones (the
      tech's corrected zones kept): the new full panel, plate drugs ticked,
      every verdict recomputed, manual overrides reset; manual breakpoints
      are kept only for drugs still outside the new panel.
    - The report prints only ticked rows (`reportedAstRows`, key
      `ast:<organism>:<drug>`); + Add antibiotic works as before; an organism
      that already has entered results is never overwritten by a plate.
    - Automatic plate changes don't count as the technician's edits.
  - **Measure on the Identification header (owner, 2026-09-26) — the MAIN
    path.** ORGANISM IDENTIFICATION carries a quiet neutral **Measure**
    button (PF mark icon, neutral border, never violet-filled) left of the
    pencil, shown only when the AST stage and Identification are open to
    this user on an active case (`culture_workbench`). It claims both stages,
    opens the AST editor and the same measure modal (whole antibiotic master,
    one PF Sense call, glow only while reading). The last step is
    **Organism** (not Review): a searchable `pf-select` of the organism master
    (phones: a trigger that opens a search + 44px-row sheet; the modal is
    full screen above the navbar), pre-filled from Organism isolated, then
    the organism's CLSI panel — plate drugs ticked with zone mm and live
    S / I / R (the subtle AST tints), the rest unticked, S ≥ / R ≤ boxes (+
    Save to CLSI with `manage_tests`) for measured drugs outside the panel.
    ONE primary, **OK**. OK: the reading goes on the case, the organism joins
    Organism isolated (others kept), its AST table is (re)built, the page
    scrolls gently to the AST stage and outlines it briefly (static under
    reduced motion). Nothing is submitted. Replacing an organism's results
    the technician already entered needs an inline "Replace them" tick; a
    table the plate built untouched is re-measured without asking. Measure
    again reopens on that organism's photo + rings, else the case plate. The
    AST stage's own Measure plate / per-organism Measure stay.
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
- **One culture screen.** Entry AND pathologist sign-out live on the
  Culture case page; nothing else renders the culture form:
  - Route guards (`core/navigation/culture-redirect.guard.ts`, marker =
    `parameters.microFormat === 'culture_sensitivity'`) send a culture-only
    tube on `/lab/sample/:id` (search, scan, notifications, Completed,
    report queue, bookmarks — and `?validate=1` for validators), a culture
    test on `/lab/result/:id`, and `/pathologist/validate/:id` to
    `/lab/culture/:orderTestId`. The pending-validation list routes culture
    tests there directly. The route admits `culture_workbench` OR
    `validate_result`.
  - **Sign-out (review mode):** a validator on an `awaiting_signout` case
    sees every stage read-only (the AST as the read-only table), no bench
    tools, and the band actions **Reject** (secondary; the reason is
    required, via `DialogService.prompt`) + **Validate & sign out** (THE
    primary) — the same `/api/validation/:id/validate|reject` calls the
    pathologist screens use.
  - **Mixed tubes** (culture + other tests) stay on sample result entry:
    the culture test is a small "Culture: open on the bench →" row linking
    to `/lab/culture/:orderTestId`, and it never rides the tube's draft /
    submit / validate batches. `result-entry` and `validate-result` show
    the same link instead of the old form.

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
- **Save state** (`.pf-savestate`, in the band actions beside Save): muted
  text; a violet check + "All changes saved", or a violet dot + "Unsaved
  changes". Never green / amber. Phones keep only the mark (the words stay
  for AT). Autosave only where it is truly authoritative — the test editor
  is NOT (its sections save on Save), so Save stays the primary.
- **Context bar** (`pf-hero-band [customSearch] [contextBar]`, projected
  `<div band-search class="pf-ctx">`) = **the record's name + its section
  tabs, nothing else** (owner, 2026-09-25): `[Test name ✎] | [Basics |
  Price & sample | Result entry | Printed report | Consumables]`.
  - The name is the primary chip (`.pf-ctx__primary`, 15px / 600, FULL —
    wraps, never an ellipsis) with a quiet pencil (`.pf-ctx__edit`) that
    opens the field. A tiny muted origin badge (Master / changed here /
    Branch) may sit on it. A new record says what it is ("New test").
  - **No fact chips** (code, department, sample, price, TAT, fasting …):
    the sections below already show them — duplication is against the
    pattern. Editors without sections may carry at most the one or two
    identity facts the form doesn't show (a role's type, a field's key).
  - The sections are a neutral segmented control IN the pill, after a
    hairline divider: the selected segment is a raised card surface that
    SLIDES between tabs (`--pf-spring`, off under reduced motion); each tab
    has a small violet status dot (filled = complete, ring = something to
    finish). One line at 1440; narrower, the tabs scroll inside the pill
    (the open tab is kept in view); phones stack the name above a
    sideways-scrolling tabs row. No SECTIONS rail, no separate tabs row.
  - No big title, breadcrumb or subtitle anywhere. Single-section editors
    skip the tabs (name only).
- **Content:** the focused section is ONE `.pf-card` (violet icon chip +
  UPPERCASE label + a short `.pf-card__note`); only its body scrolls.
  Fields are kit fields (`.pf-field` › `.pf-field__lbl` + `.pf-input` +
  `.pf-field__hint`; read-only codes: `[readonly]` → dashed, chip surface,
  `.pf-num`), `pf-select` for choices, `.pf-seg` for 2–4 options, slate
  `.pf-toggle[role=switch]` for on / off (never checkbox pills), tick lists
  as kit rows (`.pf-row` + `.pf-row__check`, `.pf-row--in` when ticked;
  a visually hidden checkbox keeps keyboard + forms). Type: labels 12px /
  500 secondary, hints 12px tertiary, sub-headings 13px / 600.
- **Side card only when it adds info** the form can't show — the test
  editor's LIVE PREVIEW (the printed page), 400px at ≥1024px. Below that it
  hides behind a secondary **Preview** button in the band actions (an icon
  on phones) and opens as a sheet (phones: `.pf-sheet`-style, above the navbar; tablets: a
  side sheet), with a scrim; Esc / × / scrim close.
- **Fields line up:** on band pages `pf-select` triggers and
  `pf-number-input` boxes match `.pf-input` (40px; 44px on phones).
  Selected chips / tiles use `aria-pressed` / `aria-checked`, never an
  `…--on` class (a global rule paints `button[class*="--on"]` violet).
- **Palette + font:** violet + neutrals + slate; no green / teal / amber
  status text or pills ("Complete" = violet check, "Needs a name" = the
  amber required dot); Noto only, tabular numbers for codes, never
  monospace; SVG icons, never glyphs (✕ ↑ ↓ ⠿ ƒ ●).
- **Real-layout check:** `apps/lms-e2e/src/test-editor-layout.rbac.spec.ts`
  (seeded Lab Admin; opens BIO005 via Test Master's own list call; read
  only) asserts ONE primary on every tab, the pill = the full name + the
  tabs on ONE line (no fact chips), the 400px preview card at 1440, no page scroll, and no
  monospace / green computed anywhere on the editor; at 375 the tabs scroll,
  Save is an icon and Preview opens a sheet above the navbar. Run it against
  a build: `BASE_URL=http://localhost:4310 CORS_RELAY=1 SHOTS_DIR=…`.

## 15. Patient registration

**Registration = one single form, no tabs, keyboard-first** (owner,
2026-09-25 — the tabbed version was rejected: minimise clicks).
`/frontdesk/patients/new` (+ `?patientId=` = edit details; Order & Payments'
"Register a new patient" / "Edit … details" add `returnTo=order`) —
`features/frontdesk/patient-register/`, over the tenant's
`patient_registration` workflow.

- **One form, every section visible at once** — no tabs, no "Next", no
  section switching. Each workflow section is an `.pf-card` (violet icon
  chip + label + "N required" with the amber dot, or "Optional"):
  **Identity | Contact & IDs | Additional details** (+ any tenant step).
  ≥1200px: 3 columns side by side filling the body — the default form fits
  above the navbar at 1440×900 with no page / body scroll; extra tenant
  fields scroll inside a card body, never the page. Tablet (≥768px): 2
  columns. Phone: 1 column scrolling under the pinned band. Inside a card
  fields sit two-up; wide ones (Title, DOB ⇄ age, phone, textareas) span
  the card; one column on phones / narrow cards.
- **Pill = the patient's NAME … + the ABHA helpers**, at the STANDARD band
  pill size — the search pill's max-width + centring
  (`pf-hero-band [standardPill]`), never the full band width (the owner saw
  it edge to edge at ~2000px). Left: the name ("New patient" → the FULL live
  name, "Baby of <mother>"; edit = the patient) + pencil → First name.
  Right: **Fill from ABHA** · **Create ABHA** (edit: **Verify / create
  ABHA**) as quiet grey `.pf-btn--quiet` — icon + label on desktop, icon
  only on phones. Nothing in the card headers.
- **Band:** back · tenant · Cancel, Save & book test, Save & book
  appointment (ghosts) and the ONE primary **Register patient** (edit: the
  neutral save state, Cancel, **Save changes**). Phones: Cancel goes, the
  rest are 44px icons. **Ctrl / ⌘ + Enter** saves from anywhere.
- **Keyboard-first:** First name is focused on arrival (web; never on touch
  — no surprise keyboard). **Enter = next field** in reading order (card by
  card, top to bottom; a textarea keeps Enter, an open `pf-select` uses it
  to pick); **Enter on the last field = Register**. Tab follows the same
  order. Title / Sex / Yes-No are neutral `.pf-seg` **radio groups** (one
  Tab stop, ←/→ select, Home / End, a letter picks — M / F / O on Sex, M
  cycles Mr. / Mrs. / Ms. / Master on Title). Title → Sex where unambiguous
  (Mr. / Master → Male, Mrs. / Ms. → Female); a manual Sex always wins.
- **Fewer clicks:** DOB-or-age inline; the phone country code defaults to the
  tenant's own (from its phone number, else +91); no confirms except the
  existing duplicate-patient check (`DialogService`, then retry with
  `force`).
- **Date of birth is EMPTY by default** — a typed `dd/mm/yyyy` box (auto
  slashes, tabular numbers; a native date input shows today greyed in
  Safari, so it is never the visible control) + a calendar button over a
  hidden native picker. Impossible / future dates are an inline error and
  never stored; no DOB is ever defaulted or submitted unless entered (or
  derived from a typed age).
- **No number spinners:** Age is a numeric TEXT box (`inputmode="numeric"`,
  digits only); a number field that is really a phone ("Additional
  contact", "Alternate mobile" … by name / label) gets the phone treatment
  (tel + country code); the kit hides spinners on every
  `.pf-input[type=number]`.
- **Errors are field-level:** every invalid field is outlined in error red
  (`.pf-input--error`, stays red while focused) with its message under it
  (`aria-invalid` + `aria-describedby`); focus + scroll go to the FIRST
  invalid field; fixing a field clears only its error. No banner.
- **Back to the order:** from a half-built Order & Payments, the cart
  (tests, priority, referring doctor / hospital) is stashed
  (`pf:order-draft:pending-registration`) and Register / Save changes /
  Cancel return to `/frontdesk/order?patientId=…&resume=registration`, which
  restores it with the patient attached (one-shot; ignored without
  `resume`; a day's TTL).
- **Fields** (`pf-workflow-renderer [nd] [hideActions] [stepHeaderTpl]` →
  `pf-dynamic-input [nd] [error] [defaultCountryCode]`, both OFF by default):
  kit `.pf-field` / `.pf-input` 40px (44px + 16px text on phones), amber
  required dot, tabular numbers for phone / IDs / age, no flag emoji, slate
  switches. Violet + neutrals only; Noto only.
- **ABHA modals** (`abha-prefill`, `abha-wizard`): pf-card modal, kit inputs,
  OTP in Noto tabular numbers, neutral info text; phones: a sheet above the
  navbar.
- **Real-layout check:** `apps/lms-e2e/src/patient-register-layout.rbac.spec.ts`
  (seeded Lab Admin; every `/api/patients` write answered in the browser and
  asserted never sent; edit mode loads a made-up patient in the browser):
  at 1440×900 three cards side by side, no page / body scroll, the pill at
  the standard size (also at 2000px) with the ABHA helpers at its right,
  an empty DOB, no spinners, one primary, First name focused, Enter → Last name, Title → Sex,
  Sex quick key, field errors focusing the first; 1024 two columns; 375 one
  column, icon primary above the pill, full-width 44px / 16px fields, the
  band pinned while the body scrolls. `BASE_URL=… CORS_RELAY=1 SHOTS_DIR=…`
  (shots `v3-*`).

## 16. Reference ranges = H, L, CL, CH and a report box

Owner, 2026-09-26 (FINAL — replaces the table experiments): "keep it very
simple — H, L, CL, CH and a report box; the reference range is typed as text
itself so it's simple and neat." Every numeric value has a list of **groups**
(Who + Age); each group has four optional limits and the words the report
prints.

`pf-range-table` (`features/admin/tests/test-editor/range-table.component.ts`,
byte-identical in prefrontal-admin-ui) on the **Result entry** tab. Shared
logic: `shared/utils/range-insight.ts` (validation, tester),
`shared/utils/reference-range.ts` (the ONE resolver, flag rule, report text)
and `shared/utils/flag-conditions.ts` (report conditions). Nothing decides a
flag of its own: every verdict is `flagBand` (= `liveFlag` = mw `FlagOne`).

```
Who        Age                L g/dL  H      CL     CH     Report text
[Anyone ▾] [0–28 days      ▾] [14  ]  [22 ]  [7  ]  [25 ]  [14–22 g/dL (placeholder)         ] ×
[Male   ▾] [18 years+      ▾] [13  ]  [17 ]  [7  ]  [20 ]  [13 – 17 g/dL                     ] ×
[Female ▾] [18 years+      ▾] [12  ]  [16 ]  [7  ]  [20 ]  [12 – 16 g/dL                     ] ×
+ Add group
Try a value [6] for [Female ▾] aged [35] [years ▾] → Critical low
```

- **Columns:** Who (`pf-select` Anyone / Male / Female) · Age · **L** ·
  **H** · **CL** · **CH** (the unit ONCE, muted, in the L header; each header
  and box names itself in full for screen readers — "L — below this prints L
  (low)") · **Report text** (the wide column) · a quiet ×. Plain number boxes:
  no chips, no bars, no zones, no footnotes, no Advanced grid. Noto with
  tabular numbers, 1px row lines, palette tokens, light + dark.
- **Flag rule** (mw `ResultFlaggingService` = client `flagAgainst` /
  `flagBand`): value < L → **L**; value > H → **H**; value < CL or > CH →
  **critical** (stored "C", the existing critical marker, alerts and
  notifications). **On a limit = not flagged.** A blank limit = no flag on
  that side. One-sided groups are inclusive too ("≤ 200").
- **Reports never show C / Critical; criticals print as H / L. Critical is
  internal.** (owner 2026-09-26) One helper, `shared/utils/report-flag.ts`
  `reportFlag()`, maps a stored "C" to H / L by the value against the row's
  printed range (same letter / arrow / none indicator and high / low colours)
  for every report path — PDF, previews, Test Master live preview. Internal
  screens keep showing critical.
- **Report text** prints on the report EXACTLY as typed — "Normal: 70–99 ·
  Prediabetes: 100–125 · Diabetes: ≥126", "12 – 16 g/dL", "Follicular
  2.9–14.6 · Luteal 1.4–8.9". Nothing is derived or templated. Blank prints
  the simple fallback "L–H unit" ("13–17 g/dL", "≤ 200 mg/dL"), shown as the
  box's placeholder so the author sees what will print. When no group matches
  the patient (unknown sex / age) the report lists every group, each prefixed
  with its who ("Female: 12 – 16 g/dL").
- **Age in natural units:** stored as `minAge` / `maxAge` / `ageUnit`, shown
  as people say it — `0–28 days`, `28 days – 1 year`, `18 years+`, `Any age`.
  The Age cell is a field-like button; it opens a row underneath: From [n]
  [unit] to [n] [unit] (blank "to" = and over). Touching ages are fine: "1–6
  years" + "6–10 years" — a patient on the 6th birthday gets the second group.
- **Strict validation, blocking Save** (client `validateRanges` = mw
  `ReferenceRangeValidator`): age from < to · L ≤ H · CL ≤ L · CH ≥ H · CL <
  CH · no two groups cover the same patients (Anyone overlaps Male and
  Female; ages overlap as [from, to); profile-scoped groups only clash within
  their profile). Each problem is ONE plain line under its row ("CH (20) must
  not be below H (22).", "Overlaps group 1 (Male · 18 years+) — two groups
  cannot cover the same patients.") with the box outlined. Data saved before
  these rules opens with the same line and **must be fixed before that test
  saves** — no grandfathering (mw refuses any range change that is invalid).
- **Stored shape** (`referenceRanges[]`, backward compatible): `{ sex,
  minAge, maxAge, ageUnit, min (L), max (H), criticalLow (CL), criticalHigh
  (CH), reportText, profileCode? }`. An untouched group is never re-written;
  an edited group is written in this shape — a legacy `segment` becomes
  structured sex / age, a legacy authored `label` becomes the report text so
  the report does not change silently, `segment` / `label` / `minOp` /
  `maxOp` are dropped (still READ until the catalogue is migrated; an
  explicit legacy strict op still flags its limit). Test-wide
  `criticalLow` / `criticalHigh` open as each group's CL / CH (a group's own
  wins) and leave the parameter on the next range save.
- **Try a value:** ONE small line — value · for Anyone / Male / Female · aged
  [n] [days / months / years] → the flag (criticals in error red).
- **Phones (≤640px):** one card per group — line 1 "Female · 18 years+",
  line 2 the report text (or the fallback); tap to edit: Who as a segmented
  control, the age editor, L / H / CL / CH in a 2-column grid, the Report
  text; 44px targets, 16px inputs, "Remove this group" as a quiet action;
  "+ Add group" under the cards.
- **Dropdown results:** a chosen option NOT ticked Normal prints **bold** on
  the report and its preview (mw saves "A"; `report-pdf.ts` bolds it whatever
  the indicator setting) — only when that option list has at least one option
  ticked Normal; with none ticked nothing is bolded (tick the normals, e.g.
  "Not Seen").
- **Report conditions** (Printed report tab) keep the flag choices: *is
  Critical high · is High (not critical) · is High or critical high · is
  Normal · is Low or critical low · is Low (not critical) · is Critical low ·
  is Critical (high or low) · is Abnormal (any flag)*, stored as `{
  parameter, operator: 'flag', value }` (legacy letters = stored codes: H =
  High not critical, C = either critical). Description lines: first match
  wins, ↑ / ↓ to reorder; blocks print independently.
- **Real-layout check:** `apps/lms-e2e/src/test-editor-ranges.rbac.spec.ts`
  (seeded Lab Admin, HEM011, read-only — writes are aborted): ONE table with
  the eight headers (Who · Age · L · H · CL · CH · Report text), no chips /
  bars / grid / footnotes, natural-unit ages, nothing past the card at 1440,
  the age editor, the one-line tester; at 375 cards (line 1 who · age, line 2
  the report text; 44px / 16px boxes, nothing past the card);
  `SHOTS_DIR=…` saves 1440 / 375 × light / dark.

## 17. Billing counter

`/billing-counter` (`features/billing-counter/`, branches in
`billing_mode = separate_counter`) — the owner's counter flow (2026-09-26):
**the patients waiting to pay stacked on the left → tap one → their cart,
mode of payment and the payment taken right here.** Three cards: QUEUE
(filter / navigation companion, LEFT) · BILLING (the work, main) · MONEY
(summary companion, RIGHT).

- **Band:** back · tenant. The pill is ONE unified search — "Search patient,
  phone, MRN, order or invoice ID" — with the scan icon (invoice / order
  barcodes, the shared scanner with `noun="invoice or order"`) inside the
  field. Typing **filters the queue** (name, order number, phone, MRN) AND
  opens the grouped type-ahead (**Patients** / **Orders & invoices**: the
  exact `/api/billing/lookup` hit + open balances whose patient name
  matches), one row per result, ↑/↓ across both groups. **Enter** on an
  exact order / invoice ID (nothing highlighted) and a scan open that cart
  directly. A searched patient who is in the queue opens straight to their
  cart; otherwise their orders still to bill. No KPI strip.
- **LEFT card QUEUE — "Waiting to pay" (340px; 300px ≤1280):** every
  patient waiting to pay in the active branch, **oldest first**. Source:
  `GET /api/billing/outstanding` `due` (branch-scoped bills with balance > 0
  — in separate-counter mode Order & Payments raises the bill at
  registration, so this IS the "awaiting billing" list) **minus balances
  deferred with Pay later** (`payLater: true` on the row) + today's orders with `billStatus = 'unbilled'` from
  `GET /api/orders/today` (bill not raised yet; billed on payment). Order
  number / tests come from today's feed, else one `GET /api/orders/{id}` per
  older balance (capped). Row: full name (wraps, never cut), order number ·
  N tests (· "Not billed yet"), the amount due and a quiet "waiting since"
  (just now · 12 min · 2 h 5 min · 3 d) in tabular numbers; the picked row
  has the neutral selected state. Refunds owed stay in MONEY. **Live
  refresh:** there is no order / billing realtime event, so it polls every
  20 s (skipped while the tab is hidden). Empty: **"No one waiting to
  pay"**; a filter with no match says so and offers Enter for an exact ID.
- **MAIN card BILLING — the cart:** empty = "Pick a patient to bill". Picked
  = the subject (full name, order number, date), a neutral status chip, the
  items (bill lines with prices, else the order's tests), Discount / Payable
  / Paid / Balance, then **Payment**: Order & Payments'
  `InlinePaymentPanelComponent` (`[externalFooter]`, `[allowLater]="true"`;
  Pay now UPI / Card / Cash / Split, Bill to vendor, **Pay later** with an
  optional advance, UPI QR, cash change), re-created per order. The
  money is recorded here — `POST /api/billing/{id}/payment` (split = one per
  part; vendor = `/api/vendors/{id}/charge` first; no bill yet =
  `POST /api/billing/` first). **Never navigates to `/frontdesk/order`.**
  Discount rules / approvals stay where the bill is raised (Order &
  Payments); the counter shows the discount already on the bill.
- **Pay later** (2026-09-26) — the same rules as Order & Payments, which has
  no pay-later permission, reason or approval: the bill is raised (or kept)
  with its balance (no bill yet = `POST /api/billing/`), an optional advance
  is one `POST /api/billing/{id}/payment`, then
  `POST /api/billing/{id}/pay-later` stamps `Bill.Metadata.payLater` (perm
  `collect_payment` | `create_bill`; money / status untouched). Nothing else
  changes: raising the bill moves the order `created → billed`, and the
  branch **payment gate** (`paymentGateStage` dispatch / report) still holds
  it server-side until the balance is paid — the counter only names it
  (`paymentGateStage` on the branch lab config). The patient **leaves the
  queue at once** (session set, then the server's `payLater` flag for every
  cashier) and the balance stays in MONEY's **Balances due** ("· Pay later"
  in the row). Picking that row reopens the cart with **Collect ₹X** and Pay
  later available again (a partial = a new advance).
- **ONE primary per state**, in the card's sticky footer: **Collect ₹X**
  (vendor: "Bill ₹X to vendor"; **Pay later picked: "Save — pay later"**,
  with an advance "Collect ₹A — rest later"). Pay later itself is a neutral
  choice in the panel's segmented track, never a second violet button. The
  CTA is a disabled secondary until the panel is
  complete (e.g. cash received typed), primary once it can go. **Refund ₹X**
  for a refund owed (Cash / UPI / Card slate `.pf-seg`,
  `POST /api/billing/{id}/refund`; without `process_refund` a note, no
  primary). A settled order: "Print receipt" secondary only.
- **After payment:** a compact success state (violet check, "₹X received",
  name, mode · invoice number) with **Print receipt** (secondary, the same
  invoice generator as Order & Payments) and **Next patient** (primary —
  opens the oldest remaining; "Done" when the queue is empty). The paid
  patient drops off the queue at once (kept off until the server list
  catches up). **After Pay later** the same compact state reads **"Bill
  saved — ₹X due later"** (name, advance · mode or "Pay later", invoice
  number, the gate note) with **Print bill** (secondary, same generator —
  the invoice shows the balance) and **Next patient**. **No "Collect sample" / label step here UNLESS the workflow
  puts collection at this counter:** `collectsAtBillingCounter(cfg)`
  (`shared/models/process-workflow.model.ts`) — an enabled
  `sample_collection` in the same Process-builder menu as the enabled
  `billing` action (not the front desk). Then **Collect sample** is the
  primary (`/sample-collection?orderId=…`) and Next patient secondary.
  Otherwise the success line says they can go to sample collection: paying
  in full moves the order `created → billed` and clears `paymentHold`
  (`BillingService.CollectPaymentAsync`), and the collection queue
  (`/api/samples/pending-collection`) already lists the pending tubes.
- **RIGHT side card MONEY (400px; 360px ≤1280):** unchanged — "Balances due
  / refunds owed" (calm 11px uppercase titles, Noto — never spaced mono;
  rows = patient + amount, tap opens the cart; refunds as −₹, no amber / red
  pills), then "Day-end summary" with the **kit date** (`pf-date`: typed
  dd/mm/yyyy + calendar button over a hidden native picker) and a Mode /
  Count / Total table (Cash, UPI, Card… capitalised; tabular numbers), then
  Collected / Refunded / **Net** (600). Collapses to a strip on the RIGHT
  edge (› hides, ‹ shows; remembered per user).
- **≤900px / phones:** one card at a time — the compact neutral two-way
  `.pf-seg` switch (Billing · Money · n) in the pill's tools row. Billing =
  the queue **full screen**; tapping a patient **zooms** the cart in
  (`[pfZoomSource]` row → `[pfZoomTarget]` card, `zoom.runLocal`) and the
  band's back (`[backAction]`) zooms back to the list. Opening a balance
  from Money flips to the cart. 44px targets, 16px inputs — including the
  shared payment panel's choices, tenders and advance field (scoped
  `.pf-bc-pay ::ng-deep` at ≤640px).
- **Real-layout check:** `apps/lms-e2e/src/billing-counter-layout.rbac.spec.ts`
  (seeded Lab Admin, read-only — writes aborted) asserts the pill, Queue
  left / Billing / Money ~400px right, no primary at rest, the queue's
  oldest-first order, a pick → the cart with the payment panel and at most
  one primary, Pay later picked → exactly one primary "Save — pay later"
  (never clicked), no navigation to `/frontdesk/order`, no visible native date,
  no monospace, no page scroll, the grouped dropdown at the pill's width,
  the strip, and at 375 the full-screen queue → cart → back and the switch.
  `BASE_URL=… CORS_RELAY=1 SHOTS_DIR=…`.

## 18. Messages

`/messages` (`features/messages/`) — team chat on the kit (owner, 2026-09-26).
`MessagesRouteComponent` picks the screen live: the new design renders
`MessagesNdComponent`, which EXTENDS the classic page (realtime SignalR,
unread, typing, receipts, attachments, calls, deep links `?c=`, modals are
the same code); classic keeps its page.

- **Band:** back · tenant · actions = a neutral "Reconnecting…" chip (only
  while a hub is down), the sounds toggle and **New chat** — both ghosts.
  The page's ONE primary is the composer's **Send**.
- **Pill = the context bar:** "Search conversations and people" (a
  conversation matches on its name AND every participant; people come from
  the directory and open a direct chat) + an `All · Unread · Groups · Calls`
  `.pf-seg` radio group (one Tab stop, arrows move). Calls swaps the list
  for the call log in the same card.
- **CONVERSATIONS = LEFT card** (a navigation companion, §1 "two jobs"),
  ~360px, BILLING header + collapse to a left strip (remembered per user,
  `pf:msgs:list-collapsed:<uid>`). Rows (≥60px, whole-row target, neutral
  selected state): avatar (+ presence dot: violet reachable, slate busy,
  muted red calls-blocked, hollow offline), the FULL name (wraps), tabular
  time, a one-row preview with an SVG kind icon (attachment / deleted /
  sent check — never emoji; ellipsis only on that one row, never cut in
  code), unread = a NEUTRAL chip with a violet dot (never a loud badge).
- **THREAD = main card:** head = avatar + name (wraps) + status (presence /
  "N members" / "typing…") + the record chip; quiet 36px icon buttons
  (search in conversation, mute, voice call — audio only, members). Calm
  bubbles: ours a subtle violet tint, theirs neutral; muted Noto tabular
  times; sent = a muted check, SEEN = a violet double check; day
  separators as a neutral chip on a hairline; voice notes a kit player
  (play · track · time — never native `<audio controls>`), files / shared
  records as neutral cards with the violet icon chip; hover (tap on touch)
  toolbar with SVG actions.
- **Composer, sticky at the card floor:** a quiet attach icon (menu:
  Attach a file · Share a patient · Emoji), the kit field with the **mic
  INSIDE it**, and **Send** as the one primary icon button (disabled when
  there's nothing to send). Enter sends, Shift+Enter is a new line. Voice
  notes = the chat-windows contract: mic → the recording row (time,
  discard, stop) → stop gives a PREVIEW (play / discard) → Send or Enter
  uploads + sends; nothing leaves before that.
- **≤900px: one pane at a time.** The list is the screen; a row tap PUSHES
  the thread (slide, §9 step → step), the band's back chevron / edge
  swipe pops it (the list slides back). Deep links open instantly. In a
  thread the pill becomes "Search in <name>".
- **The navbar is never hidden** — `html.pf-chat-immersive` (classic's
  WhatsApp mode) is never set by the new design; the page fits above the
  bar and modals are sheets above it. Inputs 16px on phones, 44px touch
  targets, safe areas via the shell.
- **Motion:** only messages that arrive / are sent while the thread is
  open fade + slide in (6px, ~260ms, `--pf-spring`); history and older
  pages never animate. Nothing moves under reduced motion.
- **Floating chat windows** (`shared/components/chat-windows/`) match:
  neutral avatars, the same calm bubbles, Noto tabular times, Send as the
  window's one primary, unread heads as a neutral chip + violet dot.
- **Real-layout check:** `apps/lms-e2e/src/messages-layout.rbac.spec.ts`
  (seeded Lab Admin, READ-ONLY: chat REST answered in the browser from
  made-up fixtures, both SignalR hubs a local fake WebSocket that answers
  every invocation and pushes one message) asserts the left card, one
  primary, the mic inside the field, no page scroll, no monospace, no
  immersive class, the collapse strip, and at 375 the push + composer
  above the navbar. `BASE_URL=… CORS_RELAY=1 SHOTS_DIR=…`.

### Shared records (Share to Messages, 2026-10-31)

- **Send to colleague** — ONE sheet (`shared/components/share-sheet`, opened with
  `ShareService.openSheet`, rendered once in the shell; only with the Messages
  module): the card being sent (static preview) · To chips · search · Recent /
  People / Groups rows (whole-row toggle, neutral selected state, violet check;
  up to 10) · a Note with @mentions (`@Name` typed, `@<authId>` on the wire) ·
  **Send** (the sheet's one primary; "Send to N"). One share per destination;
  a partial failure keeps only the failed ones picked. Centred pf-card modal on
  web, bottom sheet above the navbar on phones (44px targets, 16px inputs).
- **Entry points**: patient profile ⋮ "Send to a colleague", order detail band
  "Send to colleague", the collect tube card's corner icon ("Ask about this
  tube"), result entry's per-value icon ("Ask about this value" — SAVED values
  only; the assigned validator suggested), Validate ⋮ "Share with colleague" /
  "Ask the technician" (who entered it preselected), Report view "Share with…",
  Analyzer results row icon, Insights band "Share" (this view + period).
- **The card** (`<pf-share-card>`): violet icon chip · eyebrow · title (wraps)
  · subtitle · a status chip in WORDS (Critical low = muted red; others neutral)
  · arrow. The sender's caption shows UNDER it in the bubble. Tap → resolve for
  the receiver → open, or a friendly notice / branch-switch confirm.
- **Pasted link** → a removable card preview above the composer (✕ = send as
  text); Send shares the card with the rest of the text as the caption.
- **Deep links**: `/o/:id?view=detail`, `/p/:id` (read-only `/patients/:id`
  for lab roles), `/lab/sample/:id?param=` + `/lab/result/:id?param=` (row
  scrolled + marked), `/lab/analyzer-results?message=&tab=` (run revealed +
  marked), `/pathologist/validate/:id` (item scrolled into view on a multi-test tube).

## 19. Report view

`/reports/view/:id` (`features/reports/report-viewer/`) — one report, the
exact PDF on screen. Visual redesign only: every action and API is unchanged.

- **Band:** back (`backTo="/reports"`, pops history when you came from the
  Results list) · tenant · actions: **Edit** (only with `edit_result`),
  **Print**, **Share with…** (only with the Messages module) as ghosts, and
  THE primary **Send WhatsApp** (delivery to the patient). Web: text
  buttons. Touch: 44px icons, words kept via `aria-label`. Phones: the
  primary + the ⋮ report-actions menu (`pf-actions-menu`, every width:
  share, the PDF, workflow steps, go-to; a bottom sheet on phones).
- **Action feedback:** Print shows "Preparing…" while the PDF builds, then a
  brief "Printing" with an SVG check; Send shows "Sent" with the check
  (~1.8s, a small pop), then the label returns. Errors stay on the toast.
- **Send WhatsApp = the lab's WhatsApp Cloud API number** when the lab has a
  sender (`GET /api/whatsapp/settings` → `canSend`; `WhatsAppSendService`):
  the server sends the approved template with the report link to THE
  patient's number (`POST /api/whatsapp/reports/{id}/resend`). The primary
  reads **Sending…** (spinner, disabled) → **Sent** / **Delivered** / **Read**
  with the check while the message is watched (~30 s poll of the status
  endpoint); the toast names the masked number ("+91 ••••• 79229"); a Meta
  failure / opt-out / no phone / unpaid bill stays on the toast and the REPORT
  card's WhatsApp section. The ⋮ then offers **Send WhatsApp** + **Share via
  my WhatsApp** (the wa.me link on this device, secondary). No sender, or a
  preliminary report: today's wa.me flow and one "Send on WhatsApp" row. The
  Results list rows and the Patient profile order ⋮ follow the same rule
  (`ReportActionsService.whatsAppActions` / `sendWhatsApp`).
- **Context bar (the pill):** the patient chip (FULL name + "29/M · MRN";
  phones: the name only, wrapping), the order number (≥1024px), a status
  chip "Final · Completed" (violet dot; a ring for Preliminary; "Amended"
  when the snapshot says so) and the generated date / time in tabular
  numbers (≥1100px). ≤900px adds a quiet **Details** button.
- **PREVIEW = the main card** (violet icon chip, "N pages" on the right).
  Its body is the only thing that scrolls: the pdf.js-painted pages (the
  same jsPDF file Print uses — the PDF content is never restyled) on a calm
  desk tint, and — on a partial report — a neutral "Preliminary report"
  notice with an SVG icon above the pages.
- **REPORT = the right side card** (action / summary companion, 400px;
  360px ≤1280): one status line ("Ready to deliver" / "Delivered via
  WhatsApp", violet mark), report type, pending departments, generated,
  patient-link expiry, delivery note, **Partner lab reports** (`.pf-rowact`
  "Open · print") and one explanation line. Collapses to a strip on the
  RIGHT edge (remembered per user, `pf:rv:side-collapsed:<uid>`); ≤900px it
  is a sheet (phones: from the bottom; tablets: from the right edge).
- **Loading / errors:** a static page-shaped skeleton (head, patient block,
  table rows — no looping shimmer) until every page is painted; then the
  pages fade + rise in (320ms, `--pf-spring`). Load / render failures are
  `.pf-empty` with **Try again**.
- **Zoom:** the Results row (`[pfZoomSource]="[r.id, r.orderId]"`) and a
  shared report card in Messages (new design) morph into the PREVIEW card
  (`[pfZoomTarget]` on the ONE card from skeleton to pages). While
  `zoom.holding()` the skeleton stays and the pages' host is not mounted,
  so the target never swaps mid-morph.
- **Motion:** the pill chips + actions fade in once, staggered 40ms; the side
  card collapses with the billing width + opacity motion; sheets rise, the
  web share modal fades + scales. All off under reduced motion.
- **Specs:** `report-viewer.pf.spec.ts` (pill, one primary, every action
  reachable, More sheet, collapse, skeleton before pages, one zoom target,
  `.pf-empty`, no native controls / glyphs, reduced motion, palette). Real
  layout: `apps/lms-e2e/src/report-view-layout.rbac.spec.ts` (read only;
  `REPORT_ID=… BASE_URL=… CORS_RELAY=1 SHOTS_DIR=…`).

## 20. Reports list

`/reports` (`features/reports/report-queue/`) — the delivery queue that opens
the Report view (§19). The New design only; classic is unchanged.

- **Band:** search + ONE status filter in the pill: a kit `.pf-seg`
  radiogroup (All · Completed · Partial · Delivered · Failed), the raised
  neutral selected tab, counts as plain `.pf-num` text; no colour dots (a
  non-zero Failed count is the only red). No second stats strip, no stats
  popover. Band actions **Refresh** and **Generate** are both quiet ghosts:
  reports generate themselves on validation (+ the page's backfill), so
  "Generate for an order id" is a fallback, not the page's main action — the
  list has NO primary. Phones: the filter scrolls in its own row, 44px tabs.
- **One card anatomy on every tab:** FULL patient name (wraps, never
  `formatPatientInfo`) + "29/M · MRN · Order LAB-… · time" (Noto, tabular, no
  "|", no mono) + ONE status + actions. The card is the
  `[pfZoomSource]="[r.id, r.orderId]"`; report actions are `.pf-rowact`
  (View · Download · Share ▾ · More — text on web, 44px icons on touch).
- **ONE status per card, on every tab:** a dot + coloured word, no chip,
  border or background, in the Frontdesk rows' language and tokens (dot =
  `--<tone>-text`, word = that token mixed 70% with `--text-primary`, AA in
  light and dark). It sits in a fixed-width, right-aligned column (min-width
  fits "Preliminary") so status and actions line up on every row. Words
  (`reportStatus()`, in priority order): **Failed** (red) › **Unpaid** (red,
  bill due and not yet delivered) › **Delivered** (green, a check instead of
  the dot) › **Preliminary** (amber: a partial report isn't final, so it
  REPLACES "Completed") › **Completed** (green). Never a second chip: a fact
  the status hides ("Preliminary", "Payment due") is appended to the meta
  line. Phones: the status sits under the name, left-aligned.
- **Partial cards** (`report-queue.partial.ts`) are grouped by DEPARTMENT,
  not tube: a department is ready / partly ready / pending, and a test is
  "ready" exactly when its tube is fully validated (that is what
  `generate/partial` prints). Status: "Preliminary" (amber); the count ("1 of
  3 departments ready", or "partly ready") is a meta line under the name, not
  a chip. Partly-ready departments mark each test Ready / Pending with where
  it is ("Sample not received at the lab yet", "Awaiting validation",
  "Culture in progress · 2 of 4 stages done"). Culture tests show Growth ·
  Organism · AST (n drugs · r resistant) from the snapshot's stages — never
  "No parameter values". Pending = a neutral info row with an SVG clock and
  department NAMES. "Generate partial PDF" is secondary. Expand/collapse =
  grid-rows on `--pf-spring` (off under reduced motion), `inert` when closed.
- **Empty:** `.pf-empty`. **Specs:** `report-queue.pf.spec.ts`; real layout
  `apps/lms-e2e/src/reports-list-layout.rbac.spec.ts` (read only).

## 21. Appointments

`/frontdesk/appointments` (`features/frontdesk/appointments-calendar/`) and
`/frontdesk/appointments/new` (`features/frontdesk/book-appointment/`). A
visual redesign only: the same APIs (`GET /api/appointments?from&to`, the
queue transitions, `/api/appointments/config`, `/api/tests/`,
`/api/patients?q=`, `POST /api/appointments`), guards and actions. Classic
keeps its own templates; the new design lives in `*.pf.ts` (helpers +
styles scoped under `.pf-apc` / `.pf-bka`).

- **Calendar band:** back (`/frontdesk`) · tenant · ONE primary **New
  appointment**. The pill: search "patient, phone or MRN" (filters what is
  loaded: name / MRN substring, phone digits 3+ — the grid, the counts and
  the day list) · the neutral **Day · Week · Month** `.pf-seg` radiogroup
  (one Tab stop, arrows move) · ‹ **Today** › · a jump icon over a hidden
  native date picker. Web default = Month (as before); ≤900px opens on Day.
- **CALENDAR = main card** (the range in the header, "N appointments" /
  "N matches"). Day / Week = ONE scroller with sticky day headers and a
  sticky hour rail (128px an hour, half-hour slot buttons; a free future slot
  books that time, a past one keeps the warning). Appointments are neutral
  cards: the FULL name, a quiet "10:30 · 22/M · AA0006" (Noto tabular), and
  the status as a 7px dot + coloured word (booked violet, checked in / in
  progress amber, completed green, cancelled / no-show red). Same start =
  side-by-side lanes; in a week those lanes are `--tight` (name + dot; meta
  and word in the tooltip / aria-label and the day list). Today = a light
  violet disc on the date, a 3% column tint and a thin violet now-line with a
  time chip — never a gradient. A day header opens that day. Month: a day
  books on it; its neutral "N appointments" chip opens the day.
- **DAY = the right companion** (billing-style, 400px / 360px ≤1280,
  collapses to a strip on the RIGHT edge, remembered per user
  `pf:appt:side-collapsed:<uid>`): a 7-day strip (picks the day without
  changing the view) and one row per appointment (full name + meta +
  status). A row or a calendar card **zooms** into the APPOINTMENT detail
  in the same card (`[pfZoomSource]` → `[pfZoomTarget]`, `zoom.runLocal`):
  name, meta, status, When / Type / Collection / Token / Phone / Tests /
  Address / Notes, then every original action as secondaries — Open
  profile · Check in · Reschedule · No-show (booked) · Complete · Mark
  urgent · No-show (checked in) · **Cancel appointment** (`.pf-btn--danger`).
  **Reschedule is a step** that slides in (`pf-date` + a searchable
  `pf-select` of half-hours; Back slides back). Esc steps back.
- **New appointment:** ONE page, no tabs. Band: back (the calendar) · Cancel
  (ghost) · ONE primary **Book appointment** (Ctrl / ⌘ + Enter anywhere).
  The pill = the context bar: Date · Slot ("Not picked") · the patient's
  full name + "44/F · AA0007" once chosen. Cards in reading order (3
  columns ≥1200px filling the body, card bodies scroll; 2 on tablets; 1 on
  phones): **PATIENT** (a kit combobox over the same patient lookup, one row
  per result; picked = a kit row + Change) and **DATE** (`pf-date`, min
  today, + 7 one-tap days) · **TIME SLOT** (Morning / Afternoon / Evening /
  Night radiogroup with counts, a chip grid: available = neutral outline,
  taken = dashed + struck + "Full" (`aria-disabled`), selected = violet
  border + light tint + check) · **DETAILS** (tests: search, ↑/↓ + Enter
  adds, rows code · name · price, the total; Walk-in / Home collection
  `.pf-seg` with address · pincode · latitude · longitude as text fields;
  notes).
- **Keyboard-first:** the patient search has focus on arrival (web). Enter
  = the next field: patient (Enter picks) → date → the slot grid (one Tab
  stop; arrows move, Enter / Space picks) → tests (Enter adds; empty = next)
  → collection → the home fields → notes (a textarea keeps Enter).
- **Validation is inline:** Book with something missing outlines the
  patient field / the slot grid with "Pick the patient to book for." /
  "Pick a time slot." and focuses the first; a server error is one alert
  line above the cards. Nothing is sent until it is complete.
- **Phones (≤640px):** calendar = the day list first with a full-width
  **New appointment** at the card foot; the pill's tools are two rows (the
  switch, then ‹ Today › · jump); Week scrolls sideways to today; the detail
  is a sheet above the navbar (tablets: a side sheet). Booking = one column,
  2-column slot chips (≥48px), 44px targets, 16px inputs, and **Book
  appointment** full width in the bottom bar above the navbar.
- **Motion:** calendar → New appointment slides forward, back reverses
  (`slideDirection`); list / card → detail zooms; Reschedule slides; rows
  stagger in 18ms. All off under reduced motion.
- **Specs:** `appointments-calendar.pf.spec.ts`,
  `book-appointment.pf.spec.ts`; real layout
  `apps/lms-e2e/src/appointments-layout.rbac.spec.ts` (read only — writes
  aborted; the calendar GET gets made-up appointments for today on top of
  the real list; `BASE_URL=… CORS_RELAY=1 SHOTS_DIR=…`).

## 22. Patient profile

`/frontdesk/patients/:id` (`features/frontdesk/patient-profile/`) is
**clinical-first**: a doctor or technician reads the patient's lab story in
five seconds, then acts. The pure helpers are in `patient-profile.clinical.ts`
(snapshot, grid, sparklines, timeline, quick actions) and
`patient-profile.pf.ts` (pill, labels, tones).

**Data.** Two reads, fired in parallel on load, never one per report:
`GET /api/patients/{id}` (patient, orders with bill + report summaries,
`test.tatHours`, and the patient's appointments / home visits) and
`GET /api/patients/{id}/cumulative-results` (every resulted test, validated =
final, entered = preliminary, with the value, unit, printed range and flag the
lab SAVED; one query; tenant-guarded; `view_report` | `validate_result` |
`view_order`). The trend chart loads `/lab-trends` only when opened. Nothing is
made up: no data → an `.pf-empty`, never generated OPD / IPD records.

```
band ‹ tenant                              [Edit patient] [⋮] [+ New order]
 pill: FULL name · 22/M · MRN · phone · ABHA ✓ · (flags)
┌ SNAPSHOT ──────────────────────────────────────────────┐ ┌ PATIENT  [Timeline n|Details] › ┐
│ NEEDS ATTENTION n      │ IN PROGRESS NOW n │ LAST VISIT │ │ [Repeat last] [Reprint labels]  │
│ ● Potassium   ↑ 6.4    │ tests ▬▬▬▭        │ 24 Sep     │ │ [View last report]              │
│   Ref · date · +31%…   │ ● Awaiting · by…  │ tests · Dr │ │ ○ feed: order / report / visit  │
├ CUMULATIVE RESULTS  [search] (Abnormal only) ──────────┤ │   (rows zoom into the order)    │
│ [All][Biochemistry][Haematology]                        │ │                                 │
│ ANALYTE      ~spark~ ↑%  REF    27 Sep  24 Sep  12 Aug… │ │                                 │
│ BIOCHEMISTRY · Lipid Profile                            │ │                                 │
│ LDL  mg/dL   ╱╱      +17% <130   162▲    138▲          │ │                                 │
└──────────────────────── legend ─────────────────────────┘ └─────────────────────────────────┘
```

- **Band:** back (history, else `/frontdesk`; an open detail closes first) ·
  tenant · **Edit patient** (ghost) · **More** · THE primary **New order**,
  shown only when `canOpenRoute('/frontdesk/order')` passes. The pill (the
  CONTEXT BAR) is unchanged: FULL name, "22/M · MRN · phone", a neutral ABHA
  chip (violet check when verified), and the flags Known allergies (red),
  Minor (amber), Payment due (red), Fall risk (amber).
- **More:** Book appointment, Send to a colleague (Messages only), Link /
  Verify / Refresh ABHA, Print ID card, Show QR code, Copy patient ID, Full
  timeline (real lab history only) and Merge a duplicate (edit rights). A menu
  on web, a sheet on phones (Edit patient moves into it).
- **SNAPSHOT** (one card, three panes, top of the main column):
  - **Needs attention:** each analyte's LATEST value when it is flagged and
    comes from one of the 3 most recent resulted visits (older flags never
    re-tested are history). Criticals first (a red tint on the row), then
    newest. A row = dot + analyte (+ test), the value + unit in the tone with
    an SVG ↑/↓ from the stored code (CH / H up, CL / L down; legacy C is
    critical with no arrow; criticals via `isCriticalFlag`), "Ref …",
    the date ("prelim" when awaiting validation) and the delta vs the
    previous value in the same unit ("+18% since 12 Aug"; none across units).
    Four rows (three ≤900px), then "Show all N in results" = the grid's
    Abnormal only. A row opens the analyte's trend (or its visit when it has
    one value).
  - **In progress now:** active orders (ordered → collected → in lab →
    awaiting validation), a 4-segment violet stage bar, the stage as a dot +
    word, and "Ready by …" from created + the slowest test's `tatHours`
    ("Overdue by N h" in red). A row zooms into the order.
  - **Last visit:** the newest COMPLETED visit (else the newest order): date,
    tests, doctor, report status (dot + word) and **View** (report in place).
- **CUMULATIVE RESULTS** (`cumulative-results.component.ts`, fills the rest):
  the card header is search analytes + the slate **Abnormal only** switch;
  department chips (`.pf-chip[aria-pressed]`, A–Z) sit under it. A table with
  a sticky header row and a sticky analyte column; one column per resulted
  visit, newest first, older visits scroll sideways. Groups = department →
  panel (the profile a test arrived through, else the test). The analyte cell
  holds the name, unit, a 64×22 inline-SVG sparkline (violet line, the
  reference band shaded neutral, flagged points toned, the latest dot always
  drawn) and the trend arrow + % since the previous result. Flagged cells are
  tinted subtly (amber H / L, red critical) with an SVG arrow; preliminary
  values are dotted-underlined. **Units:** a row whose visits used different
  units shows an amber "Units differ" tag, the odd cells print their unit, and
  no trend is drawn across them. A row → the full trend chart (`pf-lab-trends`
  with `[focus]`); a cell → that visit's order with its report open. A legend
  (High / low · Critical · Reference band · Awaiting validation) closes the
  card. Empty: "No results yet"; no match: Clear filters; no permission:
  "Results need report access" (and no request is made).
- **Detail = zoom.** Grid rows / cells, snapshot rows and timeline rows are
  `[pfZoomSource]`; the detail card (`[pfZoomTarget]` = the order id or the
  analyte key) replaces the main column via `zoom.runLocal('in')`: the order
  (`pf-lab-orders [detailId] [autoReport]`: tests, saved results, Repeat,
  View report) or the trend. Back / Esc zooms out.
- **PATIENT companion** (right, 380px; 340px ≤1280px; collapsible to a strip,
  remembered in `pf:pp:side-collapsed:<uid>`): header = icon + PATIENT + the
  neutral `.pf-seg` **Timeline n · Details** (one Tab stop) + collapse.
  - **Quick actions** (secondary buttons, only those the user may take —
    `quickActions()` over `route-access` + the APIs' permissions, and only
    when there is something to act on): Repeat last order, Reprint labels
    (off-screen label cards + `printLabelOnly`), View last report. New order
    is the band primary.
  - **Timeline:** a rail of kind icons; orders (bill folded into the meta:
    "₹2,350 paid" / "₹1,800 due"), reports (partial / ready, delivered),
    appointments and home visits, newest first. Order / report rows zoom into
    the order; appointment rows expand in place (grid-rows, `inert` closed).
    "Open the full timeline" opens the shell overlay.
  - **Details:** Patient (age · sex, DOB, blood group, ID + copy,
    registered), Clinical notes (allergies), Contact (tel:, email, guardian,
    ABHA KYC address), ABHA (status chip, number, View card / Verify / Link),
    Billing (Outstanding in red when due, total billed, visits, tests).
- **≤1100px:** the snapshot is attention full width over the other two.
  **≤900px:** no companion column; ONE stacked column scrolls inside the body
  (the navbar stays): snapshot → results → Timeline (+ quick actions) →
  Details.
- **Phones (≤640px):** the snapshot panes stack; results become one card per
  analyte (name, trend %, the latest value in its tone, a 128×34 sparkline,
  the flag word, ref, date · n results); then the timeline and details.
  **New order** is the full-width `.pf-bottombar` above the navbar. Targets
  ≥44px; sheets above the navbar. Pane titles are `h3` (the global phone `h2`
  clamp would inflate them).
- **Motion:** pill chips + actions fade in (40ms stagger), the snapshot rises,
  attention / timeline / card rows stagger 18–30ms, list → detail zooms, the
  companion collapses on the billing width motion. All off under reduced
  motion.
- **Loading:** a static skeleton (snapshot panes + rows) inside the main
  column, which is the ONE route `[pfZoomTarget]` (the patient id) from
  skeleton to content, and shows while `zoom.holding()` on arrival.
- **Specs:** `patient-profile.clinical.spec.ts` (range parsing, CL / CH
  critical + direction, legacy C, units, deltas, the grid + unit-mismatch flag,
  filters, sparklines, needs attention, stages + TAT, last visit, a
  real-only timeline, permission-gated quick actions) and
  `patient-profile.pf.spec.ts` (band, one primary, More, snapshot, grid →
  trend / report zoom, filters, phone cards, companion, empty / skeleton /
  not-found, no monospace / emoji / native controls, reduced motion). Real
  layout: `apps/lms-e2e/src/patient-profile-layout.rbac.spec.ts` (read only).
  Backend: `CumulativeResultsBuilderTests`, `PatientCumulativeResultsTests`.

## 23. Pathologist queue

`/pathologist` (`features/pathologist/pending-validation/`). New design only;
classic unchanged. Same APIs (`GET /api/validation/queue`, the validate /
reject / reassign actions on the review screens) plus `GET /api/validation/scope`.

- **Band:** search (patient · MRN · sample ID · test) + ONE neutral radiogroup
  `All · Assigned to me` with plain tabular counts (filtered locally; the
  queue is always fetched whole). Refresh is a quiet ghost band action.
- **QUEUE card (main):** one tile per TUBE in `[pfTileGrid]`, grouped
  by ORDER priority, URGENT / NORMAL (neutral dot for Normal). Sample ID leads
  (16.5/600 tabular), FULL patient name, meta `44/F · MRN · Department ·
  entered 9:48 PM`, the tests. ONE status: dot + coloured word — Critical ›
  Overdue (red) › Due in 20m (amber) › On time (green). "Assigned to you"
  is quiet text with a violet dot. Row action `.pf-rowact` Review (text on
  web, 44px eye icon on touch); the whole tile is the `pfZoomSource` and
  opens the tube review (`/lab/sample/:id?validate=1`; culture → culture case).
  A department radiogroup sits in the card header only when the queue holds
  more than one department.
- **SCOPE card (side):** the consultant's departments (static chips, or "All
  departments" + the hint to get assigned in Users & roles), Today (pending,
  overdue, critical, assigned to you, validated today, by you) and the ONE
  primary **Review next** (mine › critical › Urgent order › soonest due). Tablet (641–1023):
  the side column narrows to 300px. Phones: the side card is a sheet; its
  summary + Review next ride `.pf-bottombar`.
- **Department scope (server):** a consultant listed in a department's
  validator pool (Users & roles → Departments, or Lab settings) only gets
  those departments' results; unassigned consultants and admins see all.
- **Reassign** is a DialogService choice of the validators who cover the
  result's department (`GET /api/validation/{id}/reassign-options`), never a
  pasted id.
- **Registration number prompt:** a signing user (validate_result) with no
  registration number sees `pf-regno-prompt` at the top of the SCOPE card
  (and in the tube review strip): a neutral notice (slate surface, violet
  SVG mark) "Add your registration number — it prints under your
  signature." + an `.pf-rowact` **Add** link to `/signature?tab=registration`.
  It disappears once saved. The number lives ONLY on the user
  (`users.RegistrationId`); admins edit it in Users & roles → Edit user or
  OPD → Doctors.
- **Specs:** `pending-validation.pf.spec.ts`, `reassign-picker.spec.ts`. `regno-prompt.component.spec.ts`.

## 24. Public report link (patients, no login)

`/reports/public/:token` (`features/reports/public-report/`) — the link in the
WhatsApp template `lab_report_ready` and on the report QR. A patient opens it
in a phone browser: no app chrome, no login, no shell (the shell route is
lazy, and the root skips the idle lock / push / calling boot on
`core/navigation/public-paths.ts` paths).

- **Lab first, patient never before the answer.** `GET /api/public/report/{token}`
  returns only the lab (name, logo, phone) + the link state. The header shows
  the lab logo (or its initials) and name on every step.
- **Identity step:** "Confirm it's you" — last 4 phone digits or DOB as DDMM
  (`inputmode=numeric`, 56px field, 18–24px text), "Use my invoice number
  instead" switches to text. Misses read "That doesn't match — N attempts
  left" (`role=alert`); the server's lockout shows a countdown and a
  **Call** button (`tel:`). The field scrolls clear of the soft keyboard.
- **States:** skeleton (link read / PDF prep), identity, locked, expired
  ("This link has expired" + the lab's phone), invalid, not ready yet, and
  the report card.
- **Report card:** Ready (violet dot) / Partial (ring) chip, date, the
  printed name, age · sex, order number; a superseded link shows the latest
  with a note. ONE primary **Download PDF** (the API's attachment URL, file
  `Report-<Name>-<date>.pdf`; a client-rendered PDF saves via `<a download>`),
  **View** (new tab: iOS shows every page there, never an iframe) and
  **Share** (the file where Web Share supports files, else the link — it still
  asks for the answer).
- `noindex` + `no-referrer` meta while open; API answers are `no-store`.
- **Specs:** `public-report.component.spec.ts`.

## 25. Critical results (NABL acknowledgement register)

`/lab/critical-results` (`features/lab/critical-results/`) — the record of
every critical value: who was alerted, who acknowledged it and who was told.
The record itself is the backend's `critical_result_events` row (one per
critical result version); the bell is only the alert.

- **Band:** search pill (patient, MRN, order, sample, test, values); quiet
  ghost **Refresh** + **Export CSV** (the server's CSV, IST stamps, every
  filtered row). The page has NO primary. Phones: a **Filters** band button
  opens the companion as a sheet.
- **FILTERS companion on the LEFT** (filter first): a kit `.pf-seg`
  radiogroup for the status (Not acknowledged · Acknowledged · Communicated ·
  All, counts as plain `.pf-num`), the IST detection range as a quick-pick
  radiogroup (Today · 7 days · 30 days · Custom) + two `pf-date` boxes, and
  a `pf-select` branch filter ONLY for multi-branch users. Opens on the last
  30 days of unacknowledged records.
- **MAIN card:** the Test Master AG-Grid theme; header = icon chip +
  "CRITICAL RESULTS" + the muted count ("3 records · 1 not acknowledged").
  Each row: Detected (IST) · Patient (MRN · order under) · Test + the critical
  values ("Potassium 7.2 mmol/L CH") · ONE status word (dot + colour: red
  Not acknowledged, amber Acknowledged, green Communicated) · Acknowledged
  (who, when, from where) · Communicated (method, to whom, by whom, notes) ·
  Alerted count · row actions as `.pf-rowact` (text on web, 44px icons on
  touch). Phones keep Detected · Patient · Test · Status · actions.
- **Acknowledge** is an explicit action everywhere (bell row, tube screen,
  validate page rail, pathologist queue tile, register row) — viewing never
  counts. The first acknowledger owns the record; later ones are appended.
  **Record communication** (`pf-critical-communication-dialog`): `pf-select`
  method (phone / in person / WhatsApp / other), name + `pf-select` role,
  notes; saved with the time and the user. No native controls.
- **On the result screens** the open records of the tube ride in
  `pf-critical-ack-strip` (red left rule, one line per record with the status
  word and the two actions); the pathologist tile's status becomes
  "Critical · not acknowledged" until this user acknowledges.
- **Specs:** `critical-results.component.spec.ts`,
  `critical-ack-strip.component.spec.ts`,
  `critical-communication-dialog.component.spec.ts`,
  `pending-validation.critical.spec.ts`, the bell spec.

## API summary

```
Layout   .pf-page · .pf-head(__back|__who|__title|__meta|__actions) · .pf-band-chip
         .pf-body · .pf-body--split
Card     .pf-card · .pf-card__head · __icon · __label · __note · __spacer · __body · __foot · .pf-span
Buttons  .pf-btn + --primary | --secondary | --tertiary | --danger | --icon | --quiet (neutral grey helper)
Select   .pf-seg / .pf-seg__item[aria-checked] · .pf-chip[aria-pressed] · .pf-chip--static · .pf-tile-sel
Toggle   .pf-toggle[role=switch][aria-checked] › .pf-toggle__track › .pf-toggle__knob · .pf-toggle--urgent
Row      .pf-row › __check · __code · __name · __meta · __value · .pf-row--in · .pf-row--done
Numbers  .pf-num (Noto Sans + tabular-nums; .pf-mono is an alias)
Fields   .pf-field › __lbl · .pf-input(--error)[readonly] · __hint
Date     pf-date[value][max][label] (typed dd/mm/yyyy + hidden native picker; ISO out)
Editors  pf-hero-band[contextBar] › .pf-ctx › __primary · __edit (+ the section tabs in the pill)
         .pf-ctx__chip · __k · .pf-dot-unpriced = the amber REQUIRED dot (identity facts only where no section shows them)
         .pf-tabs[role=tablist] › .pf-tabs__item[role=tab][aria-selected] › .pf-tabs__dot(--ok) · .pf-savestate(__dot)
Motion   --pf-spring · --pf-spring-bounce · --pf-dur-fast · --pf-dur · --pf-dur-sheet
         .pf-anim-in · .pf-anim-pop · .pf-anim-rise
Loading  [pfBusy] · pf-touch-btn[busy] · busyWhile(flag) · spinDelay · afterNextPaint · <pf-page-frame> + PageOpenService (shell, once; page-skeleton.ts)
         PageOpenService.markSource(el) · prefetch / prefetchWhenIdle · pf-skeleton-* + heldFlag
AI       .pf-ai-glow[data-ai-working] · .pf-ai-glow--inset · .pf-ai-glow--ring · .pf-ai-glow-mark · --pf-ai-angle (PF Sense only)
Mobile   .pf-bottombar(__info) · .pf-sheet(__handle) · .pf-sheet-backdrop · .pf-fullscreen · --pf-nav-h
Tokens   --pf-radius-card · --pf-radius · --pf-radius-sm · --pf-radius-chip · --pf-card-bg · --pf-line
         --pf-shadow-sm · --pf-chip-bg · --pf-sel-bg · --pf-sel-border · --pf-in-tint · --pf-done-tint
         --pf-toggle-on · --pf-toggle-off · --pf-toggle-urgent
Ranges   pf-range-table[param][unit](bandsChange) · range-insight.ts (bandZones · tryValue · validateRanges)
         flag-conditions.ts (FLAG_CONDITIONS · operator 'flag' · evaluateRules · analyzeLines)
Mixins   pf.card · pf.btn-primary · pf.btn-secondary · pf.neutral-selected · pf.no-truncate · pf.reduced-motion
```

## 26. Report chart block (Test Master)

A **Chart** is a block of the Printed report print-order list
(`pf-report-structure` → `pf-report-chart-editor`), available on ANY test or
profile — see `docs/REPORT-CHARTS.md`. The block body is the editor (kit
fields, a grid of `.pf-tile-sel` type cards (live marks-only thumbnail on a
paper surface, name, and — when the type does not fit the test's data — a
dashed, greyed thumbnail with a one-line reason; fitting types first, the
chosen one with a neutral check), `.pf-seg` for Across / Size, `pf-select` for a line's unit,
violet `.pf-toggle` switches, kit tick rows for chosen values) with a live
preview drawn from sample values by the SAME geometry the PDF paints
(`pf-report-chart`, inline SVG on a white paper surface in light and dark).
The preview sits beside the form (sticky) at ≥760px of block width and
ABOVE it below that. Prints / Hidden and ↑ / ↓ are the block's usual header
controls. The PDF draws the chart as vectors and never splits it.

## 27. Inventory (Stores desk + Admin → Inventory)

Both screens share ONE layout (`features/stores/inv-layout.scss`) and ONE set
of view rules (`features/stores/inventory-view.ts`: stock level, expiry,
ledger words, tests covered, barcode-link body).

- **Stores (`/stores`):** band pill = ONE field + the section tabs
  `Overview · Receive · Issue · Count` (`pf-segmented`; icons on phones, so
  nothing truncates). Overview: STOCK is an AG-Grid (Item + SKU · category,
  On hand, Reorder at, Status) with a neutral level filter whose counts are
  plain numbers; ATTENTION (Low / Out / Expiring as neutral numbers, lots
  expiring, items at or below reorder) is the side card. Receive / Issue /
  Count: the field is the scan box (Enter resolves; typing filters the ITEMS
  list, one item per row); the picked item opens the action side card with
  its ONE primary (Receive N / Issue N). The band's primary is "Receive
  stock" on Overview only.
- **Admin → Inventory:** Items = the item AG-Grid (main) + the ITEM side
  card (`Batches · Receive · Label · Ledger`, one primary in its footer;
  New / Edit item open in the same card; nothing picked = ATTENTION). Test
  consumables = the TESTS list on the LEFT (band search) + the picked
  test's CONSUMABLES as the main card, each line saying how many tests the
  branch's stock still covers.
- **Status = `.pf-sdot`:** a neutral word + a 7px dot; the dot alone carries
  the colour (amber Low / expiring, red Out / expired, violet done). Never a
  green "In stock" pill, never coloured KPI numbers.
- Expiry uses `pf-date`, never a visible native date input.
- The lab's Scan / Manual setting (`ScanService.manualEntry`) is honoured:
  manual = no camera, no "Scanner ready", no document-level gun capture.
- Unknown barcode: the note says exactly what happens. With
  `manage_inventory` the side card offers **Link barcode** (the item upsert,
  `POST /api/inventory/items` with the scanned GTIN; replacing an existing
  item barcode asks first); without it, the copy says an inventory admin
  links it. No items at all: an empty state that links to Admin → Inventory
  (with permission) — never "No items match".
- ≤900px: every side card is a sheet (Test Master pattern); ATTENTION opens
  from a band chip.

## 28. Prefrontal Bridges (Lab settings → Bridges)

Zero-touch analyzer boxes (bridge-api v1, `prefrontal-bridge/docs/ZERO-TOUCH-PLAN.md`).
Pure rules + every word live in `shared/bridges/` (`bridge-status.ts` is the ONE
home for status / link / command words and the copy of EVERY contract error
code); the screens are `features/admin/bridges/`. Gate: `manage_bridges`.

- **List (`/admin/bridges`):** band search; BRIDGES = AG-Grid with the ND skin
  (`nd-grid-theme`): Bridge (+ serial · analyzers), Branch, Status (dot +
  word, "Last seen …" when not online), Last message, Queue (+ "N held"),
  Version (update hint), Wi-Fi (SSID · signal words). ADD side card: one
  primary **Add Bridge**, the server's nearby offers (row action "Add"), the
  status counts.
- **Detail (`/admin/bridges/:id`):** band = back · context chips (name, status
  `.nd-sdot`, serial, branch) · Refresh + ⋮ (Rename, Move branch, Refresh
  settings, Restart, **Remove** — red, DialogService confirm that NAMES the
  discarded queue / held counts). ANALYZERS card: new-source callouts
  ("Sysmex XN-350 connected on port 6661 — link it?", secondary **Link it** +
  tertiary Ignore), the assigned analyzers grid (Connection = "Listens on
  port N" / "Connects to host:port", framing, link state, queue; row actions
  Connection / Remove), footer primary **Assign analyzer**. BRIDGE side card:
  status line, facts (Wi-Fi, address, last result, waiting, software, model,
  serial, added by, security pin), Recent activity (command words + state);
  footer secondaries Change Wi-Fi / Setup hotspot.
- **Add (`/admin/bridges/add`):** method tiles (`.nd-tile-sel`): Scan its QR
  (the shared scanner modal), Type the code (`XXXXX-XXXXX`, formatted as you
  type), Found on this network (server offer; adding asks the admin to check
  the serial), **On this Wi-Fi** (mDNS — phone / desktop apps ONLY; plain web
  never shows a local option). DETAILS side card: optional name, branch
  (pf-select, default the active branch), ONE primary **Add Bridge**. Phone
  app + QR also offers **Add + set up Wi-Fi** (the hotspot relay: progress
  steps, then the shared Wi-Fi picker, primary **Send to Bridge**).
- **Dialogs** use the kit's `.nd-dialog` (centred card on web, a sheet above
  the navbar on phones): Change Wi-Fi (scan → pick → PSK / enterprise PEAP;
  no CA and no server domain → an amber warning AND a DialogService confirm),
  Link analyzer (new vs existing, `.nd-seg`), Assign analyzer (listen /
  connect, port, framing via pf-select).
- **Shell:** "New Bridge found nearby — add it?" — a small banner, ONE offer
  at a time, `manage_bridges` only, never over the Bridges screens; "Not now"
  hides that Bridge 24 h (per browser).
- The QR link `/b#1.S.C.P.F` is public: the fragment is handed to the add
  screen through sessionStorage and scrubbed from the address bar — a claim
  secret never rides a URL param.
