# Report charts

A **Chart** is one more block a Test Master author can add to ANY test or
profile's printed report (Test Master → open the test → **Printed report** →
**Add to the report → Chart**). It is a generic option: nothing is tied to OGTT.
A test with no chart block prints exactly as it did before.

Two worked examples drive the design:

| | OGTT (a timed series) | Lipid profile (not a series) |
|---|---|---|
| X axis | the series time points: Fasting, 30 min, 60 min, 90 min, 120 min | the values the author picks: Total cholesterol, HDL, LDL, VLDL, Triglycerides |
| Y | each time point's glucose result, mg/dL | each value's result, mg/dL |
| Type | line (default) | bar |
| Overlays | each time point's own normal band (patient's sex / age); threshold lines "IGT ≥ 140", "Diabetes ≥ 200 at 2 h" | each value's normal band; a threshold "Desirable < 200" |

## 1. What the author configures

The block lives in the print-order list with every other block (results table,
Sentences, Images). Its body is the chart editor, with a live preview drawn with
sample values:

| Setting | Values | Default |
|---|---|---|
| Title | free text (the block's name) | "Chart" |
| Type | one of the 15 types in §1a, picked from visual cards | Line for a timed series, Bar otherwise |
| X axis | **Time points** (only for a repetitive profile) · **Chosen values** | Time points when the profile is repetitive |
| Time-point labels | per offset, e.g. 0 → "Fasting" | 0 = "Fasting", else "30 min" |
| Lines (time points) | up to 6; each plots the values in one unit (optionally only names containing a word). A line in a different unit gets the right-hand axis; a THIRD unit is not drawn (the editor says so) | one line: the first unit |
| Values (chosen) | tick list of the test's / members' numeric values, in print order (a gauge: pick one; a pie / donut: values in ONE unit — % or counts) | the first 6 numeric values |
| Compare with (chosen) | grouped / stacked bar, bar + line: up to 5 further sets, each value paired by position with a chosen value (auto-paired by name: `neutrophils_pct` ↔ `neutrophils_abs`); a set in another unit gets the right axis | none |
| Normal band | shade each point's normal band | on |
| Threshold lines | up to 4: value + label ("Diabetes ≥ 200 at 2 h") | none |
| Show values on points | on / off | on |
| Size | Full width · Half width | Full |
| Y axis | From / To (blank = automatic) | automatic, always includes the thresholds and bands |
| Prints / Hidden | the block's existing Prints pill | Prints |
| Position | the block's existing ↑ / ↓ arrows (before or after the results table, Sentences, Images) | after the last block |

## 1a. Chart types (the catalogue)

The Type setting is a grid of **visual cards**, one per type, each with a live
thumbnail drawn from the test's own sample values by the same geometry that
prints. Only the types that make sense for the test's data are enabled; the
others are listed after them, greyed, with a one-line reason
(`kindAvailability` in `report-chart.model.ts`, shape from `chartShape`).
Choosing a card fills in the data it needs (`specFor` in the editor: a gauge
keeps one value, a pie values in one unit — the % group first, else the
largest count group — a radar at least three, a
two-series type its second line / set).

| Type | Across time points | Across chosen values | Normal band | Thresholds | Example |
|---|---|---|---|---|---|
| Line | yes | no — "joins time points" | per point | lines | OGTT curve |
| Smooth line (monotone: never overshoots a measured value) | yes | no | per point | lines | OGTT |
| Step line (level held, change half-way) | yes | no | per point | lines | OGTT |
| Area | yes | no | per point | lines | OGTT |
| Stacked area | 2+ values in ONE unit per time point | no | — (totals) | lines | split urine protein: albumin + other |
| Bar | yes | yes | slot per bar | lines | lipid fractions |
| Horizontal bar | no — "time runs left to right" | yes | slot per row | vertical lines | lipid fractions with long names |
| Grouped bar | 2+ values per time point | 2+ sets | slot per BAR (its own axis) | lines | WBC differential % + absolute |
| Stacked bar | 2+ values in one unit | 2+ sets | — (totals) | lines | split urine protein |
| Bar + line (combination, dual axis) | 2+ values per time point | 2+ sets | slot per bar | lines | OGTT glucose bars + insulin line |
| Dots | yes | yes | per point | lines | any |
| Pie | no | 2+ values in ONE unit (% or counts), none negative | the key prints each normal range | — | WBC differential % or absolute counts |
| Donut | no | 2+ values in ONE unit (% or counts), none negative | the key prints each normal range | — | WBC differential % or absolute counts |
| Radar | no | 3+ values (any units) | inside the 1× ring (+ low-limit ticks) | — | liver panel |
| Gauge | no | one value | arc on the dial | marks on the dial | HbA1c |

Radar spokes are scaled to each value's OWN upper normal limit (1× ring), so
values in different units share one picture; the spoke label prints the real
value, unit and flag. A value with no saved upper limit sits on the 1× ring
and is starred. Pie / donut slices are shades of the report accent + slate
(distinct in black-and-white print) in the author's order from 12 o'clock;
an abnormal part is outlined in the abnormal style and its key row prints the
value bold with its H / L. Values in % ARE the shares; values in any other
unit are COUNTS (e.g. absolute differential counts): each slice is sized by
its share of the total, the slice / donut centre prints that share, and the
key prints Share · value + unit (+ saved H / L) · Normal, with a note giving
the total. Gate (`partsOfWhole` / `partGroups`): 2+ values sharing one unit,
a unit is required, a value whose normal band can go below zero is never a
part, and a snapshot whose values are in different units or negative draws
no slices (a note says why; the key still prints every value). With more than two series only the abnormal
values are labelled (the table prints every value).

Old saved charts: `line` / `bar` / `dots` keep their names and draw exactly
the operations they drew before (`report-chart.fingerprint.spec.ts` pins the
v1 drawings); other tools' names (`scatter`, `doughnut`, `spline`,
`stacked-bar`…) map to ours; an unknown kind still draws as a line.

Controls are the kit's: `.pf-seg` for the 2–3-way choices, `pf-select` for the
unit, `.pf-toggle[role=switch]` for on / off, kit inputs, SVG icons, light + dark.

## 2. Storage (no migration)

The chart is a section of the test's existing report layout
(`test_report_layouts.SectionsJson`, the same JSON the print-order list already
writes):

```json
{ "id": "s-…", "type": "chart", "order": 3, "label": "Glucose curve", "hidden": false,
  "trend": { "v": 1, "kind": "line", "x": "series",
             "lines": [{ "unit": "mg/dL" }],
             "xLabels": { "0": "Fasting" },
             "refBand": true,
             "thresholds": [{ "value": 140, "label": "IGT ≥ 140" }, { "value": 200, "label": "Diabetes ≥ 200 at 2 h" }],
             "showValues": true, "size": "full", "yMin": null, "yMax": null } }
```

`x: "parameters"` carries `"parameters": ["Total Cholesterol", "HDL", …]` instead
of `lines`, plus (grouped / stacked / combination) `"sets": [{ "label": "Absolute",
"parameters": ["neutrophils_abs", …] }]` and `"mainLabel"` for the legend. `kind`
is any of the 15 types; the object stays `v: 1` (every field is optional and
normalised, so the backend's verbatim pass-through needs no change). The old single-value gauge chart (`parameter` / `min` / `max` /
`zones`, no `trend`) is untouched and still renders as before.

Model + normaliser: `shared/utils/report-chart/report-chart.model.ts`
(`normalizeChartSpec` clamps every field and drops unknown keys).

## 3. Backend (additive, `prefrontal-mw`)

1. **Layout engine** (`ReportLayoutEngineService`): a `chart` section with a
   `trend` object is passed through verbatim as `ResolvedSection.Trend`
   (hidden = not returned; conditions apply as for any block). Nothing is
   re-derived.
2. **Result flags** (`ResultFlaggingService.FlaggedValue`): two new optional
   numbers `low` / `high` = the applied band's L / H, written ONLY when that one
   band is what the report prints (it matched the patient's sex / age, or it is
   the only band). They are part of the saved result snapshot like `range` and
   `flag`, so the chart's shaded band always agrees with the printed range and
   the flag (one resolver; rule 4 "print from the saved snapshot"). Results
   saved before this change have no numbers → their points simply have no band
   (never a band guessed from today's Test Master).

## 4. Data mapping (`report-chart.data.ts`)

`buildChartData(spec, title, ownerId, tests)` reads the report snapshot's tests:

- **Time points:** the members of the owner profile (`profileTestId` /
  `packageTestId` = owner) that carry `repeatOffsetMin`. X = their distinct
  offsets, ascending. For each line and offset, the first numeric value in the
  line's unit (and name word, when set). A time point with no numeric value
  (missed / not collected / not resulted) is a **gap**: the line breaks, the
  tick reads "not measured" and a note under the chart names it
  ("Not measured: 90 min.").
- **Chosen values:** the owner test's own values plus its members' values,
  matched by name (case-insensitive), in the author's order. Missing = gap.
- Each point carries its value, the saved flag mapped through `reportFlag()`
  (criticals print as H / L — never C), and the snapshot's `low` / `high`.

## 5. Drawing — one geometry, two painters

### Why not ECharts (decision, 2026-09-30)

The owner's ask was "chart choices like ECharts". We evaluated adopting Apache
ECharts (already a dependency, lazy-loaded for the patient trend screens) for
the report: ECharts SSR `renderToSVGString` → svg2pdf.js → vector jsPDF.
A spike (echarts 5.6.0 + svg2pdf.js 2.8.1 + jsPDF 4, jsdom) showed:

- **svg2pdf is asynchronous** (returns a Promise). `buildReportPdf` is
  synchronous and draws page by page; an async chart would land on whatever
  page is current when it resolves. Making the whole report path async
  touches every report entry point (viewer, public link, queue, preview,
  blob) — not an additive change.
- **svg2pdf needs a layout engine for text** (`getBBox`): in our vitest
  environment (jsdom) it throws `s.getBBox is not a function`, so the PDF
  path could not be tested; in the browser it would measure labels with the
  screen's fonts, not the PDF's (Helvetica / Source Sans 3), so label
  positions would depend on the machine — not deterministic.
- ECharts' SSR output is not byte-stable run to run (instance ids in class /
  clip-path ids; normalisable), and without a canvas its text measuring
  falls back to estimates that differ from jsPDF's metrics.
- Bundle: tree-shaken `echarts/core` + the 6 charts + SVG renderer ≈ 574 kB
  min / 193 kB gz, + svg2pdf ≈ 88 kB / 26 kB gz — a lazy chunk, but for
  drawing we already do.
- Our rules (per-point normal band from the saved snapshot, abnormal style
  from the template, paper chips behind labels, gaps + "not measured",
  never split) would all have to be rebuilt as ECharts custom series.

**Chosen: Option B** — extend the existing single geometry with ECharts'
chart vocabulary and conventions (monotone smoothing = `smoothMonotone`,
step = `step: 'middle'`, 240° gauge, radar, donut). Arcs and curves are
cubic Béziers (`report-chart.geom.ts`), painted with jsPDF's path operators
(`moveTo / lineTo / curveTo / fill / stroke`) and translucent fills through a
PDF graphics state — still pure vectors, real text, synchronous,
deterministic (fingerprint specs), no new dependency, initial bundle
unchanged. Fonts come from the report theme: the painter takes the theme's
face resolver (`ChartPdfTheme.face`) so an embedded theme font (Modern —
Source Sans 3) is used for measuring and drawing alike.

### The painters

`report-chart.layout.ts` turns chart data into drawing operations (lines,
rects, circles, text) in PDF points. The same operations are painted by:

- `report-chart.pdf.ts` — **vector** jsPDF calls (`line`, `rect`, `circle`,
  `text`, dash patterns); nothing is rasterised, so the chart stays crisp at any
  zoom and its labels are real, selectable text;
- `report-chart.component.ts` (`pf-report-chart`) — inline SVG for the editor
  preview and the lab screens.

So what the author previews is what prints. Style:

- normal band: light tint of the report accent per point (half-way to each
  neighbour); thresholds: dashed dark line + right-aligned label;
- markers: normal = white-filled ring in the accent; **abnormal** = filled, in
  the template's abnormal style (`flagStyle: bold_color` → the high / low
  colours; `bold` → black) with a bold value label;
- line 2 is dashed (readable in black-and-white print); a legend appears when
  there are two lines or a band;
- fonts: the template font family and scale.

## 6. Report placement

- A chart prints after the results table, under the test's / profile's name
  (the table itself is one continuous autotable). Adding a chart never moves
  a test's values out of that table, so each value keeps its saved H / L
  there — the table and the chart print the SAME saved flag (the chart never
  judges a value itself; `report-chart.agree.spec.ts`).
- `report-pdf.ts` hook: `case 'chart'` → `renderReportChart()` when the section
  has `trend`. It measures the chart first; if it does not fit above the page
  floor it moves to a new page **whole** (never split), and a block whose FIRST
  section is a chart keeps its heading with it.

## 7. Lab screens

- **Test Master:** the live SVG preview in the chart block (sample values: each
  point sits inside its band; one value is made abnormal so the author sees the
  abnormal style), plus the full PDF live preview in the side card (profile
  members carry their offsets and plausible values).
- **Validation (pathologist):** when the test being validated belongs to a
  profile (or is a test) whose layout has a chart, a small chart card shows the
  order's current values — the chart that will print.

## 8. Adding a chart in an existing lab

Test Master → open the test or profile → **Printed report** → **Add to the
report → Chart** → pick the type, X axis and overlays → the block saves itself;
the live preview on the right shows the page. Hide it with the block's
**Prints** pill; move it with ↑ / ↓. Nothing changes for labs that don't add one.

## 9. Default catalogue seed

Not shipped in this change (open question for the owner): the default
catalogue's report layouts live in the master snapshot
(`Seed/Master/master_catalog.report_layouts.json`), and **reference-mode labs
read the master's layout live** (`ReportLayoutRepository.GetTestLayoutAsync`),
so seeding an OGTT chart there would also switch it on for every existing
reference-mode lab that has not customised OGTT — against the tenant catalogue
ownership rule. The feature does not depend on a seed; the ready-to-use spec
for BIO003 / BIO004 is the example in §2.

## 10. Limits

- At most 6 series (lines, or the chosen values + 5 sets); the normal band is
  drawn for series 1 (grouped bars: every bar in its own band).
- A series in the SAME unit shares the left axis; a different unit gets the
  right axis. No third axis: a series in a third unit is not drawn (the
  editor names it).
- Units with superscripts (10³/µL) print with raised digits (pdf-text.ts).
- Two half-width charts do not sit side by side (each takes its own row).
