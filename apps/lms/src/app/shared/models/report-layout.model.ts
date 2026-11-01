/**
 * Lab report layout configuration models.
 *
 * Three layers:
 *   1. ReportColumn[]            — department-level column structure
 *   2. ReportSection[]           — per-test ordered sections (grid/paragraph/chart/image)
 *   3. ParameterColumnLocks      — per-(test, parameter) overrides
 *
 * The backend's ReportLayoutEngineService consumes (1) + (2) + (3) plus actual
 * result values and returns ResolvedReportLayout, which the report viewer +
 * jsPDF generator both render.
 *
 * Schema is intentionally loose JSON (jsonb in Postgres) so layouts can evolve
 * without migrations. Keep this model in sync with the engine service.
 */

// ═══════════════════════════════════════════════════════════════
// Department-level columns
// ═══════════════════════════════════════════════════════════════

export type ReportColumnType = 'name' | 'text' | 'result' | 'unit' | 'range' | 'flag'
  | 'method' | 'specimen' | 'code' | 'short_name' | 'section'
  /** Drawn, not typed: the range-bar number line (reportStyle.charts.rangeBar). Never stored in a layout. */
  | 'rangebar';

export interface ReportColumn {
  id: string;
  /** Stable machine name, used as the cells[name] key in row payloads. */
  name: string;
  /** Header label shown in the rendered grid. */
  label: string;
  order: number;
  /** Percentage of row width. All columns must sum to 100. */
  width: number;
  type: ReportColumnType;
  /** When `locked: true`, all rows show `lockedValue` for this column. */
  locked: boolean;
  lockedValue?: string | null;
  /** When true, this column is MERGED with the column immediately after it in
   *  the rendered report — both values render in a single cell (e.g. Result +
   *  Unit → "11.4 g/dL"). Consecutive linked columns form one merge group; the
   *  group keeps the first (primary) column's header label. */
  linkedNext?: boolean;
}

/** Default results-table columns for the template-level (singular, common to
 *  every test) results-columns config. Investigation (the parameter name) leads;
 *  Result is linked to Unit so they merge into one cell by default — matching the
 *  conventional "11.4 g/dL" presentation. Widths sum to 100. */
export const DEFAULT_RESULT_COLUMNS: ReportColumn[] = [
  { id: 'rc-name',     name: 'name',     label: 'Investigation',   order: 1, width: 34, type: 'name',   locked: false },
  { id: 'rc-result',   name: 'result',   label: 'Result',          order: 2, width: 16, type: 'result', locked: false, linkedNext: true },
  { id: 'rc-unit',     name: 'unit',     label: 'Unit',            order: 3, width: 10, type: 'unit',   locked: false },
  { id: 'rc-range',    name: 'range',    label: 'Reference Range',  order: 4, width: 24, type: 'range',  locked: false },
  { id: 'rc-specimen', name: 'specimen', label: 'Specimen',         order: 5, width: 16, type: 'text',   locked: false },
];

export interface DepartmentReportColumnsResponse {
  departmentId: string;
  columns: ReportColumn[];
  configured: boolean;
  updatedAt?: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Conditions (shared across grid rows + paragraph + image sections)
// ═══════════════════════════════════════════════════════════════

export type ConditionOperator = '<' | '<=' | '>' | '>=' | '=' | '==' | '!=';

export interface ConditionPredicate {
  parameter?: string;
  operator?: ConditionOperator;
  value?: unknown;
  /** Recursive AND. */
  and?: ConditionPredicate;
  /** Recursive OR. */
  or?: ConditionPredicate;
  /** Image-section helper — true when at least one image is attached. */
  has_images?: boolean;
}

/** Color tokens. The renderer / engine maps to canonical hex.
 *  Custom hex values (`#RRGGBB`) pass through unchanged. */
export type ColorToken = 'red' | 'orange' | 'green' | 'black' | 'none' | string;

export interface ConditionThen {
  /** show: true → force-show, show: false → hide. Omit for "no opinion". */
  show?: boolean;
  /** Legacy aliases honored by the engine. */
  show_section?: boolean;
  hide_section?: boolean;
  /** Row / paragraph styling. */
  color?: ColorToken;
  set_color?: ColorToken;
  bold?: boolean;
  set_bold?: boolean;
  /** Inject template variables (paragraph sections). */
  variables?: Record<string, unknown>;
  /** Override specific cells (grid rows). Keyed by column.name. */
  cells?: Record<string, string>;
  /** Override the merged row's note text on match. Only meaningful for
   *  merged rows; ignored on parameter rows. Lets one merged row carry
   *  different notes for different branches (low/normal/high). */
  merge_content?: string;
}

export interface ConditionRule {
  /** First branch with a matching `if` wins. */
  if?: ConditionPredicate;
  /** Default branch — applied if no `if` matched. */
  else?: boolean;
  then: ConditionThen;
}

// ═══════════════════════════════════════════════════════════════
// Sections
// ═══════════════════════════════════════════════════════════════

export type ReportSectionType = 'grid' | 'paragraph' | 'chart' | 'image'
  /* Culture-only building blocks (offered ONLY for culture_sensitivity
     tests): a labelled summary line bound to a bench data source, and the
     per-organism AST tables block. Other tests never see these types. */
  | 'culture_line' | 'culture_ast'
  /* Profile one-page report layout designer (docs/REPORT-CHARTS.md's sibling
     feature): ONE section per profile, carrying the body-area box
     arrangement (table / chart / analyzer-image / signatures / notes boxes)
     in millimetres. Same jsonb section-array storage as every other
     section — no migration. See shared/utils/report-profile-layout.ts. */
  | 'page_layout';

interface ReportSectionBase {
  id: string;
  type: ReportSectionType;
  order: number;
  label?: string | null;
  conditions?: ConditionRule[];
}

export interface GridRowParameter {
  id: string;
  parameter_name: string;
  /** Cell template per column.name — supports {{placeholders}}. */
  cells: Record<string, string>;
  row_merge: false;
  conditions?: ConditionRule[];
}

export interface GridRowMerged {
  id: string;
  row_merge: true;
  merge_content: {
    type: 'paragraph' | 'image';
    template?: string;
    imageSource?: string;
  };
  conditions?: ConditionRule[];
}

export type GridRow = GridRowParameter | GridRowMerged;

export interface GridSection extends ReportSectionBase {
  type: 'grid';
  rows: GridRow[];
}

export interface ParagraphSection extends ReportSectionBase {
  type: 'paragraph';
  /** Free-form template text; supports {{variable}} placeholders + {{x_unit}} / {{x_range}}. */
  template: string;
}

export interface ImageSection extends ReportSectionBase {
  type: 'image';
  caption?: string;
  maxImages?: number;
}

export interface ChartSection extends ReportSectionBase {
  type: 'chart';
  parameter: string;
  min: number;
  max: number;
  zones: ChartZone[];
  chartType?: 'bar' | 'gauge';
}

/** One labelled line of the culture report ("GRAM STAIN: …"), bound to a
 *  bench data source. The PDF composes the text from the sign-out snapshot;
 *  empty sources are skipped. */
export interface CultureLineSection extends ReportSectionBase {
  type: 'culture_line';
  /** specimen | gramStain | growth | id | colonyCount | organisms |
   *  resistancePattern | intrinsicResistance | clinicalNotes |
   *  infectionControlAdvice | note */
  source: string;
}

/** The per-organism antimicrobial tables + S/R/M legend block. */
export interface CultureAstSection extends ReportSectionBase {
  type: 'culture_ast';
}

export interface ChartZone {
  from: number;
  to: number;
  color: ColorToken;
  label?: string;
}

/** One box of the profile's one-page body layout — see
 *  shared/utils/report-profile-layout.ts for the geometry helpers and the
 *  CBC default. Position/size in millimetres from the BODY area's top-left
 *  (the designer's page-frame origin), not the page's. */
export type PageLayoutBoxKind = 'table' | 'chart' | 'analyzer' | 'signatures' | 'notes';

export interface PageLayoutBox {
  id: string;
  kind: PageLayoutBoxKind;
  /** `chart:<blockId>` → the report-chart section id. `analyzer:<code>` →
   *  the instrument image code (e.g. "12003"). Absent for table/signatures/notes. */
  ref?: string | null;
  /** A lab-facing label, e.g. "WBC histogram". */
  label?: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** table box only: which report columns print, and at what width (%). */
  columns?: Array<{ name: string; visible: boolean; width?: number }>;
  /** table box only: results font size in pt (the fit meter may shrink this
   *  further at print time, down to MIN_BODY_FONT_PT). */
  fontSize?: number;
  /** Kept in the layout but not printed (the designer's "Hide" — the box
   *  stays where it was, ready to show again). Absent = prints. */
  hidden?: boolean;
  /** notes box only: the text it prints (older layouts used `label`). */
  text?: string | null;
  /** table box only: where the rows sit when the box is taller than they
   *  need — 'top' (default), 'fill' (rows spread evenly to fill the box) or
   *  'center'. The report draws exactly this. */
  vAlign?: PageLayoutRowAlign | null;
  /** table box only: space between rows — 'compact', 'normal' (default) or
   *  'relaxed'. The report draws exactly this. */
  rowSpacing?: PageLayoutRowSpacing | null;
  /** table box, MANUAL row mode only: the member rows (parameter names) this
   *  box prints, in the profile's order. Every row belongs to exactly one box. */
  rows?: string[] | null;
}

/** One page of a profile's Custom layout. */
export interface PageLayoutPage {
  id: string;
  boxes: PageLayoutBox[];
}

/** How the results table spreads across table boxes:
 *  'auto' — rows flow from the first table box into the next ("continued");
 *  'manual' — each table box prints the rows chosen for it. */
export type PageLayoutTableMode = 'auto' | 'manual';

export type PageLayoutRowAlign = 'top' | 'fill' | 'center';
export type PageLayoutRowSpacing = 'compact' | 'normal' | 'relaxed';

export interface PageLayoutSection extends ReportSectionBase {
  type: 'page_layout';
  /** 1 = single page (`boxes`); 2 = Custom layout (`pages`; `boxes` mirrors
   *  page 1 so an older reader still prints page 1). */
  v: 1 | 2;
  enabled: boolean;
  /** Page 1's boxes (v1 storage; kept in sync for older readers). */
  boxes: PageLayoutBox[];
  pages?: PageLayoutPage[];
  tableMode?: PageLayoutTableMode;
  /** Analyzer image codes mapped to this profile (Instruments → Code mapping
   *  owns it; the designer only carries it through a save). */
  analyzerImages?: PageLayoutAnalyzerImage[];
}

export interface PageLayoutAnalyzerImage { code: string; label?: string; }

export type ReportSection = GridSection | ParagraphSection | ImageSection | ChartSection
  | CultureLineSection | CultureAstSection | PageLayoutSection;

// ═══════════════════════════════════════════════════════════════
// Per-test layout response
// ═══════════════════════════════════════════════════════════════

export interface TestReportLayoutResponse {
  testId: string;
  sections: ReportSection[];
  version: number;
  configured: boolean;
  updatedAt?: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Per-(test, parameter) locks
// ═══════════════════════════════════════════════════════════════

export interface ColumnLock {
  locked: boolean;
  value: string | null;
}

export interface ParameterColumnLocks {
  id: string;
  parameterName: string;
  /** Display title — prefer over humanizing parameterName. */
  title?: string | null;
  /** Keyed by column.name. */
  columnLocks: Record<string, ColumnLock>;
  updatedAt?: string | null;
}

// ═══════════════════════════════════════════════════════════════
// Resolved view-model — what the engine returns from /preview
// ═══════════════════════════════════════════════════════════════

export interface ResolvedReportLayout {
  testId: string;
  testName: string;
  departmentName: string;
  /** Specimen / sample type for this test (e.g. "Serum", "EDTA Whole
   *  Blood"). Surfaced from TestEntity.Parameters JSON's `sampleType`
   *  wrapper key. The PDF prints this as an italic dim sub-line under
   *  each test name, like the classic "CREATININE, SERUM" rendering. */
  sampleType?: string | null;
  columns: ReportColumn[];
  /** True when `columns` is this test's OWN override (Test Master →
   *  Report columns) rather than the department set. Drives the render
   *  cascade: a profile's override wins for its whole block; a member's
   *  override applies only when the test is ordered standalone. */
  hasColumnOverride?: boolean;
  /** Department-specific patient-strip arrangement — null/absent when the
   *  department prints the tenant-default strip. Applied by the renderer
   *  only when EVERY test on the report resolves to this one department. */
  patientStrip?: { layout?: string; columns?: string[][] } | null;
  /** The department's columns — present ONLY when hasColumnOverride, so
   *  the renderer can fall back when a member's override must be ignored
   *  inside a profile block. */
  departmentColumns?: ReportColumn[] | null;
  /** mw sets this ONLY for a narrative-only layout: a test with values whose
   *  grid-less layout writes out every printing value itself (`{{Gross}}`),
   *  so it prints no results table on purpose. The render safety net
   *  (`results-table.ts`) adds the default table to any other grid-less
   *  layout of a standalone test with values. */
  valuesInNarrative?: boolean | null;
  sections: ResolvedSection[];
}

export interface ResolvedSection {
  id: string;
  type: ReportSectionType;
  label?: string | null;
  isVisible: boolean;
  // Type-specific (only one populated):
  rows?: ResolvedRow[];
  content?: string;
  imageUrls?: string[];
  chart?: ResolvedChart;
  /** Report chart block (type 'chart' with a Test Master chart spec) — the
   *  stored spec, passed through by mw (docs/REPORT-CHARTS.md). */
  trend?: unknown | null;
  /** Profile one-page layout (type 'page_layout') — the stored box array,
   *  passed through by mw verbatim (same pattern as `trend`). */
  pageLayout?: unknown | null;
}

export interface ResolvedRow {
  id: string;
  /** Parameter name this row was built from (e.g. "Hemoglobin"). Empty
   *  for merged rows. The PDF renderer uses this to synthesize a
   *  "Test/Investigation" column when the configured layout doesn't
   *  already display the parameter name itself. */
  parameterName?: string;
  title?: string | null;
  cells: Record<string, string>;
  /** The parameter's unit (e.g. "g/dL"), always populated from the test
   *  parameter metadata even when the layout has no Unit column — so the
   *  renderer can show the unit for every department. */
  unit?: string;
  isMerged: boolean;
  mergeType?: 'paragraph' | 'image';
  mergeContent?: string;
  /** Hex color or null for default. */
  color?: string | null;
  isBold: boolean;
  /** mw's flag for this row's value ('H' | 'L' | 'CL' | 'CH' | 'A' | 'N' | ''; legacy 'C') — the
   *  report PREVIEW (no saved result) carries it so a non-normal dropdown
   *  option prints bold there too. Null / absent = not computed. */
  flag?: string | null;
  /** A FAMILY value's picked item (mw expands them, 2026-10-23): 1 = a pick
   *  under the parent row, 2 = a sub-pick… `title` = the pick, the result
   *  cell = amount + unit, other cells empty. Absent / 0 = a normal row. */
  indent?: number | null;
}

export interface ResolvedChart {
  parameter: string;
  min: number;
  max: number;
  value?: number | null;
  zones: ResolvedChartZone[];
}

export interface ResolvedChartZone {
  from: number;
  to: number;
  color: string;
  label?: string;
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Default 5-column layout the backend hands back when a department isn't
 *  configured yet — keep this in sync with `ReportLayoutController.DefaultColumnsJson`. */
export const DEFAULT_REPORT_COLUMNS: ReportColumn[] = [
  { id: 'c-specimen',    name: 'specimen',    label: 'Specimen',        order: 1, width: 25, type: 'text',   locked: false, lockedValue: null },
  { id: 'c-result',      name: 'result',      label: 'Result',          order: 2, width: 20, type: 'result', locked: false, lockedValue: null },
  { id: 'c-unit',        name: 'unit',        label: 'Unit',            order: 3, width: 15, type: 'unit',   locked: false, lockedValue: null },
  { id: 'c-range',       name: 'range',       label: 'Reference range', order: 4, width: 20, type: 'range',  locked: false, lockedValue: null },
  { id: 'c-description', name: 'description', label: 'Description',     order: 5, width: 20, type: 'text',   locked: false, lockedValue: null },
];

/** Available column types for the admin picker. */
export const COLUMN_TYPE_OPTIONS: { value: ReportColumnType; label: string; description: string }[] = [
  { value: 'name',   label: 'Parameter name', description: 'The investigation / parameter name (e.g. Hemoglobin)' },
  { value: 'text',   label: 'Text',           description: 'Free text — admin or condition fills it' },
  { value: 'result', label: 'Result value',   description: 'Pulls from the entered result for the row\'s parameter' },
  { value: 'unit',   label: 'Unit',           description: 'Pulls from the test parameter\'s unit (e.g. g/dL)' },
  { value: 'range',  label: 'Reference range', description: 'Pulls from the parameter\'s normal range' },
  { value: 'flag',   label: 'Flag (computed)', description: 'Empty cell; row color/bold from conditions reads as the flag' },
  // Test-level sources (the test's Basics) — printed once per test block.
  { value: 'method',     label: 'Methodology',  description: "The test's analytical method (e.g. Hexokinase)" },
  { value: 'specimen',   label: 'Specimen',     description: "The test's sample type (e.g. Serum)" },
  { value: 'code',       label: 'Test code',    description: 'The Test Master code (e.g. BIO005)' },
  { value: 'short_name', label: 'Short name',   description: "The test's short name (e.g. OGCT)" },
  { value: 'section',    label: 'Section',      description: "The test's section (e.g. Glucose)" },
];
