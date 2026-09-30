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
| Type | **Line** · **Bar** · **Dots** (points, no joining line) | Line for a timed series, Bar otherwise |
| X axis | **Time points** (only for a repetitive profile) · **Chosen values** | Time points when the profile is repetitive |
| Time-point labels | per offset, e.g. 0 → "Fasting" | 0 = "Fasting", else "30 min" |
| Lines (time points) | up to 2; each plots the values in one unit (optionally only names containing a word). A 2nd line in a different unit gets its own right-hand axis | one line: the first unit |
| Values (chosen) | tick list of the test's / members' numeric values, in print order | the first 6 numeric values |
| Normal band | shade each point's normal band | on |
| Threshold lines | up to 4: value + label ("Diabetes ≥ 200 at 2 h") | none |
| Show values on points | on / off | on |
| Size | Full width · Half width | Full |
| Y axis | From / To (blank = automatic) | automatic, always includes the thresholds and bands |
| Prints / Hidden | the block's existing Prints pill | Prints |
| Position | the block's existing ↑ / ↓ arrows (before or after the results table, Sentences, Images) | after the last block |

Controls are the kit's: `.nd-seg` for the 2–3-way choices, `pf-select` for the
unit, `.nd-toggle[role=switch]` for on / off, kit inputs, SVG icons, light + dark.

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
of `lines`. The old single-value gauge chart (`parameter` / `min` / `max` /
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

## 10. v1 limits

- At most 2 lines; the normal band is drawn for line 1 only.
- A second line with the SAME unit shares the left axis; a different unit gets
  the right axis. No third axis.
- Two half-width charts do not sit side by side (each takes its own row).
