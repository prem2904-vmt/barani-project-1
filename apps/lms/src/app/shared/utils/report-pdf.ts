import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  DEFAULT_RESULT_COLUMNS,
  ReportColumn,
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../models/report-layout.model';
import { ReportSignature, ReportTemplate } from '../models/report.model';

/**
 * Render an A4 lab report PDF in the Drlogy template style — blue
 * accent (#0066CC), bold-uppercase "LAB NAME" wordmark, three-column
 * patient block with vertical separators (no background fills), centered
 * uppercase test name between hairlines, plain-text column headers with
 * a single underline rule, white body rows (no zebra), inline RED
 * "High"/"Low" tags beside the result, three-column signature footer,
 * and "****End of Report****" closing marker.
 *
 * Layouts that pre-configure per-test sections (grid/paragraph/image/
 * chart) are honored. Empty columns are dropped automatically so an
 * unused "Specimen" cell never leaves an empty column behind. Tests
 * without a configured layout fall through to a four-column legacy
 * table that mirrors the Drlogy shape (Investigation · Result ·
 * Reference Value · Unit).
 */
export interface ReportPdfInput {
  /** ReportEntity-like row. We only need a few fields. */
  report: {
    id: string;
    type: string;
    createdAt?: string;
    data?: string | null;
  };
  /** Legacy practice letterhead — used when no `template` is supplied.
   *  When both are present, `template` wins on every field it covers. */
  practice?: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    nablNumber?: string;
    sigLabTechName?: string;
    sigLabTechTitle?: string;
    sigPathologist1Name?: string;
    sigPathologist1Title?: string;
    sigPathologist2Name?: string;
    sigPathologist2Title?: string;
  };
  /** Per-tenant template config (colors, fonts, header layout, date
   *  format, signatures, watermark, end-of-report text). When supplied
   *  the renderer reads it instead of the hardcoded Drlogy defaults —
   *  every visual element in the PDF can be tuned from the admin UI. */
  template?: ReportTemplate | null;
  /** Optional: per-test resolved layouts. When provided, the PDF renders
   *  the configured sections instead of the legacy parameter table. */
  resolvedLayouts?: Record<string, ResolvedReportLayout>;
  /** Base URL prepended to relative image URLs (logos, signatures).
   *  Defaults to '' so URLs already starting with http(s)://… work
   *  as-is. */
  assetBaseUrl?: string;
  /** Pre-fetched image cache, keyed by the ORIGINAL URL (the one stored
   *  on the template, e.g. "/uploads/.../foo.png"). Each value is a
   *  base64 data URL that jsPDF.addImage can consume directly.
   *  Built by `preloadReportImages()` — the renderer is sync, so any
   *  caller that wants uploaded images embedded MUST preload first. */
  imageCache?: Record<string, string>;
  /** Optional Trendogram charts (serial-result trends) to append after the
   *  results. Each is a pre-rendered PNG data URL + a title, laid out 2-per-row
   *  (half-page each), up to 6 per page. Prepared by the caller via
   *  renderTrendogramPng() before the sync build. */
  trendograms?: Array<{ title: string; dataUrl: string }>;
}

/** Effective theme + chrome values fed to every drawing function.
 *  Built by `resolveTheme()` from the template (preferred) and the
 *  legacy practice shape (fallback). Keeps every renderer free of
 *  null-checks against the template. */
interface ResolvedTheme {
  // Colors
  accent: string;          // top bar, blue band, wordmark accent words
  primary: string;         // headings, dept strip
  body: string;            // body text
  divider: string;         // hairlines, table border
  tableHeaderBg: string;
  tableHeaderText: string;
  // Typography
  font: 'helvetica' | 'times' | 'courier';
  // Body font scale — 1.0 = current Drlogy size
  fontScale: number;
  // Layout
  headerPreset: 'drlogy' | 'centered' | 'banner' | 'minimal';
  logoPosition: 'left' | 'center' | 'right';
  logoSize: 'sm' | 'md' | 'lg';
  topAccentBar: boolean;
  tableStyle: 'plain' | 'bordered' | 'striped';
  zebraRows: boolean;
  // Date / time
  dateFormat: string;
  timeFormat: 'none' | '12h' | '24h';
  dateTimeSeparator: string;
  showRegistered: boolean;
  showCollected: boolean;
  showReported: boolean;
  // Patient block toggles
  showBarcode: boolean;
  // Results — abnormal-flag styling. 'bold' = bold black value + indicator;
  // 'bold_color' = additionally tint high/low. Admin-configurable.
  flagStyle: 'bold' | 'bold_color';
  // Abnormal indicator glyph: 'letter' = H/L, 'arrow' = ↑/↓, 'none' = no marker.
  flagIndicator: 'letter' | 'arrow' | 'none';
  // Colours used when flagStyle === 'bold_color' (admin picks). High + low.
  abnormalColor: string;
  abnormalLowColor: string;
  // Group the continuous results table by department band as well as
  // panel. Off by default → panel/profile headers only (no department).
  groupByDepartment: boolean;
  // When true, each department's section starts on a fresh page.
  departmentPageBreak: boolean;
  // Chrome
  endOfReportText: string;
  showSampleBand: boolean;
  showPoweredBy: boolean;
  watermarkText: string;
  watermarkOpacity: number;
  footerText: string;
  // Signature blocks (always 3 slots — empty slots render nothing)
  signatures: ReportSignature[];
  // Tagline string (raw — split on '|' at draw time so accent-coloured pipes render)
  tagline: string;
  // NABL accreditation badge in the header
  nablAccredited: boolean;
  nablNumber: string;
  nablLogoUrl: string;
  // Custom patient-registration fields to print (label + the attribute key)
  patientFields: { name: string; title: string }[];
  // Drag-arranged 3-column patient block: item keys per column. Empty = default.
  patientColumns: string[][];
  // Patient block layout preset
  patientLayout: 'three-col' | 'four-col-grid' | 'stacked';
  // Whether to show ABHA ID row in the patient block
  showAbhaId: boolean;
  // Footer chrome
  disclaimer: string;
  // QR code toggle (drawn in the sample-band area)
  showQrCode: boolean;
}

interface ReportSnapshot {
  patient?: {
    displayName?: string;
    age?: number | string;
    sex?: string;
    phone?: string;
    /** Lifetime MRN, e.g. `DEL-2605-004217-3`. Server-assigned;
     *  legacy patients may be null until backfilled. */
    mrn?: string;
    /** JSON of the patient's saved registration custom fields ({name: value}). */
    attributes?: string;
  };
  order?: {
    id?: string;
    createdAt?: string;
    priority?: string;
    refDoctorName?: string;
  };
  type?: string;
  isPartial?: boolean;
  /** Present only on a corrected re-issue. Drives the "AMENDED" banner. */
  amendment?: {
    isAmended?: boolean;
    reason?: string;
    supersedesReleasedAt?: string;
  } | null;
  pendingDepts?: string[];
  tests?: Array<{
    testId?: string;
    name?: string;
    department?: string;
    departmentCode?: string;
    /** Specimen / sample type — pulled from TestEntity.Parameters JSON
     *  during snapshot build. Rendered in the continuous results table's
     *  Specimen column (once, on the test's first parameter row). */
    sampleType?: string | null;
    status?: string;
    result?: Record<string, unknown> | null;
    resultedAt?: string;
    validatedAt?: string;
    /** NABL accreditation scope for this test. When `false`, the test is
     *  segregated into a separate "Tests not under NABL scope" section
     *  (NABL 133 — non-accredited tests must be separated, not asterisked).
     *  Undefined ⇒ treated as in-scope so we never make a false claim. */
    nablScope?: boolean;
    /** Referral / subcontracted lab name. When present we print
     *  "Tested at: {referralLab}" under the panel header (ISO 15189 7.4.1.6). */
    referralLab?: string | null;
    /** Analytical method (e.g. "Photometry"). Rendered as a dim sub-line
     *  under the panel header when the template's `showMethod` is on. */
    method?: string | null;
  }>;
  /** Per-report signatories (validating pathologist + resulting technician),
   *  injected server-side from the users who signed off. When present, the PDF
   *  prefers these over the admin template signature slots. Each `signatureUrl`
   *  is a base64 data URL (already embedded — no prefetch needed). */
  signatures?: ReportSignature[];
}

// ── Page geometry ─────────────────────────────────────────────────
// MARGIN_TOP / MARGIN_BOTTOM are `let` because the pre-printed-letterpad mode
// overrides them per render (the blank top/bottom space the lab's stationery
// occupies). They reset to these defaults at the start of every non-letterpad
// render. HEADER_RESERVE is the drawn-letterhead height the patient block sits
// below — 0 in letterpad mode (no header is drawn).
const A4 = { w: 595.28, h: 841.89 };
const MARGIN_X = 30;
let MARGIN_TOP = 28;
let MARGIN_BOTTOM = 150; // reserves room for the 3-column sig block + disclaimer band
let HEADER_RESERVE = 70; // drawn letterhead height above the patient block
let LETTERPAD = false;   // pre-printed-letterpad mode: blank header/footer, body only
const MM_TO_PT = 2.834645669; // 1mm in PDF points (72dpi)

// ── Drlogy palette ────────────────────────────────────────────────
// Mutable module-level theme. `applyTheme()` (called at the start of
// every buildReportPdf) overrides these from the tenant's
// ReportTemplate so admins can re-skin the PDF without us threading
// a theme argument through every drawing function.
let BLUE = '#0066CC';        // Wordmark accent words, blue band
const BLUE_DARK = '#003F8F'; // (reserved — secondary blue, rarely used)
let BLACK = '#000000';       // Wordmark first word, headings
let TEXT = '#1a1a1a';        // Body text
const TEXT_DIM = '#666666';  // Muted footer / secondary labels
let HAIR = '#cccccc';        // Hairlines, dividers, table border
const FLAG_RED = '#dc2626';  // High / critical inline tag
const FLAG_BLUE = '#2563eb'; // Low inline tag

// Standard digital-signature disclaimer shown in the report footer unless the
// lab has configured its own. (Cortex OPS-39.)
export const DEFAULT_DISCLAIMER =
  'This report has been digitally signed by an authorized laboratory professional and is valid ' +
  'without a handwritten signature. Test results should be interpreted in conjunction with the ' +
  'patient’s clinical history and other diagnostic findings. Please consult your treating ' +
  'physician for appropriate medical advice.';
let PDF_FONT: 'helvetica' | 'times' | 'courier' = 'helvetica';
/** Canonical grid columns for the WHOLE report. Each test is laid out against
 *  these same columns + widths so the table lines up down the entire report,
 *  regardless of which typed columns an individual test's layout happens to
 *  carry. Set once per render in buildReportPdf, before the test loop. */
let CANON_COLS: { type: 'result' | 'range' | 'unit'; label: string }[] = [];
/** Lookup of pre-fetched image data URLs for the current render. Set
 *  inside buildReportPdf from input.imageCache. */
let IMG_CACHE: Record<string, string> = {};

/** Per-render theme — frozen once at the start of buildReportPdf.
 *  Functions read from these closure-captured vars at draw time. */
let theme: ResolvedTheme = defaultTheme();

function defaultTheme(): ResolvedTheme {
  return {
    accent: '#0066CC', primary: '#1B3A6B', body: '#1a1a1a', divider: '#cccccc',
    tableHeaderBg: '#ffffff', tableHeaderText: '#000000',
    font: PDF_FONT, fontScale: 1,
    headerPreset: 'drlogy', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
    tableStyle: 'plain', zebraRows: false,
    flagStyle: 'bold', flagIndicator: 'letter', abnormalColor: '#dc2626', abnormalLowColor: '#2563eb', groupByDepartment: false, departmentPageBreak: false,
    dateFormat: 'dd MMM yyyy', timeFormat: '12h', dateTimeSeparator: ', ',
    showRegistered: true, showCollected: true, showReported: true,
    showBarcode: true,
    endOfReportText: '****End of Report****',
    showSampleBand: true, showPoweredBy: true,
    watermarkText: '', watermarkOpacity: 0.08, footerText: '',
    signatures: [],
    tagline: 'Accurate | Caring | Instant',
    nablAccredited: false, nablNumber: '', nablLogoUrl: '',
    patientFields: [],
    patientColumns: [],
    patientLayout: 'three-col',
    showAbhaId: false,
    disclaimer: DEFAULT_DISCLAIMER,
    showQrCode: true,
  };
}

/** Resolve the template + practice into the effective theme used by the
 *  renderer. Template values win; practice + Drlogy defaults fill gaps. */
function resolveTheme(
  tpl: ReportTemplate | null | undefined,
  practice: NonNullable<ReportPdfInput['practice']>
): ResolvedTheme {
  const t = defaultTheme();
  if (!tpl) {
    // Legacy: build minimal signatures array from the flat practice shape.
    t.signatures = [
      { name: practice.sigLabTechName,      title: practice.sigLabTechTitle      },
      { name: practice.sigPathologist1Name, title: practice.sigPathologist1Title },
      { name: practice.sigPathologist2Name, title: practice.sigPathologist2Title },
    ].filter(s => s.name);
    return t;
  }
  // Colors: treat empty strings like missing so blank fields in the DB
  // (older rows or partial edits where the admin cleared an input) fall
  // back to the sane Drlogy defaults instead of breaking jsPDF's
  // setTextColor() with an empty value (which renders as no-text / white).
  t.accent          = pickColor(tpl.accentColor,     pickColor(tpl.primaryColor, t.accent));
  t.primary         = pickColor(tpl.primaryColor,    t.primary);
  t.body            = pickColor(tpl.bodyTextColor,   t.body);
  t.divider         = pickColor(tpl.dividerColor,    t.divider);
  t.tableHeaderBg   = pickColor(tpl.tableHeaderBg,   t.tableHeaderBg);
  t.tableHeaderText = pickColor(tpl.tableHeaderText, t.tableHeaderText);
  t.font            = (['helvetica','times','courier'].includes(tpl.fontFamily ?? '')
                       ? (tpl.fontFamily as 'helvetica'|'times'|'courier') : 'helvetica');
  t.fontScale       = tpl.fontSize === 'sm' ? 0.9 : tpl.fontSize === 'lg' ? 1.1 : 1.0;
  t.headerPreset    = (tpl.headerPreset as ResolvedTheme['headerPreset']) ?? 'drlogy';
  t.logoPosition    = (tpl.logoPosition as 'left'|'center'|'right') ?? 'left';
  t.logoSize        = (tpl.logoSize as 'sm'|'md'|'lg') ?? 'md';
  t.topAccentBar    = tpl.topAccentBar ?? true;
  t.tableStyle      = (tpl.tableStyle as 'plain'|'bordered'|'striped') ?? 'plain';
  t.zebraRows       = tpl.zebraRows ?? (tpl.tableStyle === 'striped');
  t.flagStyle       = tpl.flagStyle === 'bold_color' ? 'bold_color' : 'bold';
  t.flagIndicator   = tpl.flagIndicator === 'arrow' ? 'arrow' : tpl.flagIndicator === 'none' ? 'none' : 'letter';
  t.abnormalColor   = pickColor(tpl.abnormalColor, '#dc2626');
  t.abnormalLowColor = pickColor(tpl.abnormalLowColor, '#2563eb');
  t.groupByDepartment = tpl.groupByDepartment ?? false;
  t.departmentPageBreak = tpl.departmentPageBreak ?? false;
  t.dateFormat      = tpl.dateFormat ?? t.dateFormat;
  t.timeFormat      = (tpl.timeFormat as 'none'|'12h'|'24h') ?? '12h';
  // An EMPTY separator mashes date+time together ("07 Aug 202608:03 PM") —
  // never legible, so blank falls back to the default ", ". A single space is
  // still respected as an explicit choice.
  t.dateTimeSeparator = tpl.dateTimeSeparator ? tpl.dateTimeSeparator : t.dateTimeSeparator;
  t.showRegistered  = tpl.showRegistered ?? true;
  t.showCollected   = tpl.showCollectionDate ?? true;
  t.showReported    = tpl.showReportDate ?? true;
  t.showBarcode     = tpl.showBarcode ?? true;
  t.endOfReportText = tpl.endOfReportText && tpl.endOfReportText.trim().length > 0
                      ? tpl.endOfReportText : t.endOfReportText;
  t.showSampleBand  = tpl.showSampleCollectionBand ?? true;
  t.showPoweredBy   = tpl.showPoweredBy ?? true;
  t.watermarkText   = tpl.watermarkText ?? '';
  t.watermarkOpacity = Math.max(0, Math.min(1, tpl.watermarkOpacity ?? 0.08));
  t.footerText      = tpl.footerText ?? '';
  t.signatures      = parseSignatures(tpl.signaturesJson, tpl.signatureUrl);
  if (tpl.tagline && tpl.tagline.trim().length > 0) t.tagline = tpl.tagline;
  t.nablAccredited  = !!tpl.nablAccredited;
  t.nablNumber      = tpl.nablNumber ?? '';
  t.nablLogoUrl     = tpl.nablLogoUrl ?? '';
  t.patientFields   = parsePatientFields(tpl.patientFieldsJson);
  t.patientColumns  = parsePatientColumns(tpl.patientColumnsJson);
  t.patientLayout   = (tpl.patientLayout as ResolvedTheme['patientLayout']) ?? 'three-col';
  t.showAbhaId      = tpl.showAbhaId ?? false;
  // A template may omit the disclaimer (null/undefined) → fall back to the
  // standard note. An explicit empty string means the lab intentionally cleared
  // it, so honour that and show nothing.
  t.disclaimer      = tpl.disclaimer ?? DEFAULT_DISCLAIMER;
  t.showQrCode      = tpl.showQrCode ?? true;
  return t;
}

/** Color fallback that treats undefined / null / empty-string / whitespace
 *  as "missing" — `??` alone passes empty strings through, which become
 *  invalid jsPDF color args (renders as transparent / white text). */
function pickColor(val: string | null | undefined, fallback: string): string {
  return val && val.trim().length > 0 ? val : fallback;
}

function parseSignatures(json: string | undefined, legacySigUrl?: string): ReportSignature[] {
  if (json && json.trim()) {
    try {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) return arr.filter((s): s is ReportSignature => !!s && (!!s.name || !!s.signatureUrl));
    } catch { /* fall through */ }
  }
  if (legacySigUrl) return [{ signatureUrl: legacySigUrl }];
  return [];
}

/** Parse the template's chosen custom patient fields: a JSON array of
 *  `{ name, title }`. Tolerates a plain string[] (treats name === title). */
function parsePatientFields(json: string | undefined | null): { name: string; title: string }[] {
  if (!json || !json.trim()) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((f): { name: string; title: string } | null => {
        if (typeof f === 'string') return { name: f, title: f };
        if (f && typeof f.name === 'string') return { name: f.name, title: f.title || f.name };
        return null;
      })
      .filter((f): f is { name: string; title: string } => !!f);
  } catch { return []; }
}

/** Parse the saved 3-column patient-block arrangement: a JSON `string[][]` of
 *  item keys. Returns [] (use the default layout) unless it's exactly 3 arrays. */
function parsePatientColumns(json: string | undefined | null): string[][] {
  if (!json || !json.trim()) return [];
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length === 3 && arr.every(c => Array.isArray(c))) {
      return arr.map(c => c.filter((k: unknown): k is string => typeof k === 'string'));
    }
    return [];
  } catch { return []; }
}

/** The patient's saved registration custom-field values ({name: value}). */
function parsePatientAttributes(snap: ReportSnapshot): Record<string, unknown> {
  const raw = snap.patient?.attributes;
  if (!raw || !raw.trim()) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

/** Render the lab-chosen custom patient fields (title: value) in a compact
 *  two-column row beneath the patient block. Values come from the patient's
 *  saved registration attributes. No-op when none are chosen or have a value. */
function drawCustomPatientFields(doc: jsPDF, snap: ReportSnapshot, startY: number): number {
  // When a column arrangement is configured, every field is placed via the
  // columns (placement = shown) — nothing renders below the block.
  if (theme.patientColumns.length >= 1 && theme.patientColumns.some(c => c.length > 0)) return startY;
  if (!theme.patientFields.length) return startY;
  const attrs = parsePatientAttributes(snap);
  // Fields already placed inside a drag-arranged column are drawn there, not here.
  const placed = new Set(theme.patientColumns.flat());
  const rows = theme.patientFields
    .filter(f => !placed.has(f.name))
    .map(f => ({ title: f.title, value: attrs[f.name] }))
    .filter(r => r.value != null && String(r.value).trim() !== '');
  if (!rows.length) return startY;

  let y = startY + 12;
  const colW = (A4.w - 2 * MARGIN_X) / 2;
  doc.setFontSize(8.5 * theme.fontScale);
  rows.forEach((r, i) => {
    if (i % 2 === 0 && i > 0) y += 13;
    const x = MARGIN_X + (i % 2) * colW;
    const label = `${r.title}: `;
    doc.setFont(PDF_FONT, 'bold');
    doc.setTextColor(BLACK);
    doc.text(label, x, y);
    doc.setFont(PDF_FONT, 'normal');
    doc.setTextColor(TEXT_DIM);
    doc.text(String(r.value), x + doc.getTextWidth(label), y);
  });
  return y + 4;
}

function applyTheme(t: ResolvedTheme) {
  theme = t;
  BLUE = t.accent;
  BLACK = t.primary;
  TEXT = t.body;
  HAIR = t.divider;
  PDF_FONT = t.font;
}

/** Build the PDF document without saving — used by both the download
 *  flow and the live admin preview (which wraps the doc as a blob URL). */
export function buildReportPdf(input: ReportPdfInput): jsPDF {
  const { report, practice: rawPractice = {}, resolvedLayouts = {}, template = null, imageCache = {} } = input;
  const snap = parseSnapshot(report.data);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  IMG_CACHE = imageCache;

  // Merge template identity fields into the practice shape. The drawing
  // functions read from `practice.{name,address,phone,email,website,nablNumber}`
  // for legacy reasons; without this merge, edits to those fields in
  // the admin editor (which only passes `template`) wouldn't appear in
  // the live preview because every read fell back to the Drlogy defaults.
  const practice: NonNullable<ReportPdfInput['practice']> = template ? {
    ...rawPractice,
    name:        rawPractice.name        ?? template.labName,
    address:     rawPractice.address     ?? template.address,
    phone:       rawPractice.phone       ?? template.phone,
    email:       rawPractice.email       ?? template.email,
    website:     rawPractice.website     ?? template.website,
    nablNumber:  rawPractice.nablNumber  ?? template.nablNumber,
  } : rawPractice;

  applyTheme(resolveTheme(template, practice));
  // Per-report signatories (who validated / entered results) take precedence
  // over the admin template signature slots. Their signatureUrls are embedded
  // data URLs, so no prefetch is required.
  if (snap.signatures && snap.signatures.length > 0) theme.signatures = snap.signatures;

  // Pre-printed letterpad mode: skip the rendered header + footer and reserve
  // blank top/bottom space on every page (the lab's stationery occupies it),
  // printing only the results body. Reset to the normal defaults otherwise
  // (module-level margins persist across renders).
  LETTERPAD = !!template?.letterpadMode;
  if (LETTERPAD) {
    MARGIN_TOP = Math.max(0, template?.letterpadHeaderMm ?? 45) * MM_TO_PT;
    MARGIN_BOTTOM = Math.max(20, template?.letterpadFooterMm ?? 30) * MM_TO_PT;
    HEADER_RESERVE = 0;
  } else {
    MARGIN_TOP = 28;
    MARGIN_BOTTOM = 150;
    HEADER_RESERVE = 70;
  }

  drawLetterhead(doc, practice, template?.logoUrl ?? null);
  const patientBottom = drawCustomPatientFields(doc, snap, drawPatientBlock(doc, snap, report));

  // ── Amended-report banner ──────────────────────────────────────
  // A corrected re-issue carries snap.amendment; flag it prominently so the
  // reader knows this supersedes a previously released report.
  let cursorY = patientBottom + 14;
  if (snap.amendment?.isAmended) {
    const supersededOn = snap.amendment.supersedesReleasedAt
      ? new Date(snap.amendment.supersedesReleasedAt).toLocaleDateString()
      : null;
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(FLAG_RED);
    doc.text(
      supersededOn
        ? `AMENDED REPORT — supersedes the report issued on ${supersededOn}`
        : 'AMENDED REPORT — supersedes a previously issued report',
      MARGIN_X, cursorY + 10);
    cursorY += 22;
    if (snap.amendment.reason) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor('#92400e');
      doc.text(`Reason: ${snap.amendment.reason}`, MARGIN_X, cursorY + 6);
      cursorY += 18;
    }
  }

  // ── Body — ONE continuous results table, grouped by panel/profile ──
  // Each tabular test becomes a bold full-width "panel" header row
  // followed by its parameter rows under a single header band
  // (Investigation · Result · Reference Range · Unit · Specimen). Tests
  // with a narrative/image layout (histopathology, cytology) and
  // microbiology culture reports keep their own block format and render
  // after the table. No department strips — panel headers only (NABL /
  // reference-report style); department banding is opt-in via the template.
  const tests = snap.tests ?? [];
  const tabular: typeof tests = [];
  const special: typeof tests = [];
  for (const t of tests) {
    const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
    if ((t.result as { microFormat?: string } | null)?.microFormat === 'culture_sensitivity') {
      special.push(t);
    } else if (layout && layout.sections.some(s => s.isVisible && s.type !== 'grid')) {
      // Narrative / image / chart content can't live in the columnar table.
      special.push(t);
    } else {
      tabular.push(t);
    }
  }

  // Build panel groups (panel header + its parameter rows) for the table.
  // Keep zero-row groups: a test with a pending/empty result still renders its
  // bold panel header in its department position, rather than being dropped
  // (or, in the viewer, sunk to the un-bold block at the bottom).
  const groups = tabular
    .map(t => buildPanelGroup(t, t.testId ? resolvedLayouts[t.testId] : undefined));

  // Canonical typed columns (result/range/unit) across every resolved layout.
  // Computed up-front so BOTH the continuous table and the grid sections lay
  // out against the same column template — units are shown (or merged) the same
  // way for every test.
  CANON_COLS = buildCanonicalColumns(resolvedLayouts);

  // NABL 133 — segregate non-accredited tests into their own section
  // (separated, never asterisked). Only when the lab is NABL-accredited
  // AND at least one test is explicitly marked out-of-scope; otherwise we
  // render a single table and make no scope claim.
  const claimsNabl = !!template?.nablAccredited;
  const outScope = claimsNabl ? groups.filter(g => g.inScope === false) : [];
  const inScope = outScope.length > 0 ? groups.filter(g => g.inScope !== false) : groups;

  if (inScope.length > 0) {
    cursorY = renderContinuousTable(doc, inScope, cursorY, practice, null);
  }
  if (outScope.length > 0) {
    cursorY = renderScopeHeading(doc, 'TESTS NOT UNDER NABL SCOPE', cursorY + 6, practice);
    cursorY = renderContinuousTable(doc, outScope, cursorY, practice, null);
  }

  // Narrative + microbiology blocks after the columnar results.
  // Canonical columns (already computed above) feed any grid section embedded
  // in a narrative test.
  for (const t of special) {
    const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
    if (cursorY > A4.h - MARGIN_BOTTOM - 90) { cursorY = newPage(doc, practice); }
    if ((t.result as { microFormat?: string } | null)?.microFormat === 'culture_sensitivity') {
      cursorY = renderCultureSection(doc, t, cursorY, practice);
    } else if (layout && layout.sections.length > 0) {
      cursorY = renderResolvedTest(doc, t, layout, cursorY, practice);
    } else {
      cursorY = renderLegacyTest(doc, t, cursorY, practice);
    }
    cursorY += 10;
  }

  // ── Pending-depts banner (preliminary only) ────────────────────
  if (snap.isPartial && (snap.pendingDepts?.length ?? 0) > 0) {
    if (cursorY > A4.h - MARGIN_BOTTOM - 60) { cursorY = newPage(doc, practice); }
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor('#92400e');
    doc.text(`Other departments still pending: ${snap.pendingDepts!.join(', ')}`,
      MARGIN_X, cursorY + 10);
    cursorY += 22;
  }

  // ── Trendogram charts (serial-result trends), 2-per-row, up to 6/page ──
  if (input.trendograms?.length) {
    if (cursorY > A4.h - MARGIN_BOTTOM - 200) { cursorY = newPage(doc, practice); }
    cursorY = renderTrendogramSection(doc, input.trendograms, cursorY, practice);
  }

  // ── "Thanks for Reference  ...  ****End of Report****" line ────
  if (cursorY > A4.h - MARGIN_BOTTOM - 26) { cursorY = newPage(doc, practice); }
  drawEndOfReport(doc, snap, cursorY);

  // ── Signature footer + page numbers (every page, drawn last) ───
  // Skipped in letterpad mode — the blank MARGIN_BOTTOM reserve is where the
  // lab's own pre-printed footer/signatures sit.
  if (!LETTERPAD) drawSignatureFooter(doc, practice, snap);
  return doc;
}

/** Build + trigger a file download. Filename is derived from the
 *  report's short id and type (final vs preliminary). */
export function generateReportPdf(input: ReportPdfInput): void {
  const doc = buildReportPdf(input);
  const snap = parseSnapshot(input.report.data);
  const tag = snap.isPartial ? 'PRELIM' : 'REPORT';
  const shortId = input.report.id.replace(/-/g, '').slice(-8).toUpperCase();
  doc.save(`${tag}-${shortId}.pdf`);
}

/** Build + return a blob URL — used by the admin editor's live preview
 *  iframe. Caller is responsible for URL.revokeObjectURL when swapping. */
export function renderReportPdfBlobUrl(input: ReportPdfInput): string {
  const doc = buildReportPdf(input);
  const blob = doc.output('blob');
  return URL.createObjectURL(blob);
}

/** Resolve a template/practice URL to an absolute one for fetching:
 *  absolute http(s) URLs pass through; "/uploads/…" gets prepended with
 *  the supplied API base. */
function absoluteAssetUrl(url: string, baseUrl: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  return `${baseUrl.replace(/\/$/, '')}${url}`;
}

/** Fetch a single image and re-encode it as a PNG data URL via canvas.
 *  jsPDF.addImage accepts PNG/JPEG data URLs directly but not raw URLs —
 *  hence the manual fetch + canvas pass. Re-encoding via canvas also
 *  normalises SVG/WEBP/JPEG into PNG so all uploaded formats work. */
async function fetchAsDataUrl(absUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(absUrl, { mode: 'cors' });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.crossOrigin = 'anonymous';
        i.onload = () => res(i);
        i.onerror = e => rej(e);
        i.src = objectUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 200;
      canvas.height = img.naturalHeight || 200;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    return null;
  }
}

/** Pre-fetch every image URL referenced by the template + report so the
 *  sync PDF renderer can embed them. The editor / viewer awaits this
 *  before calling renderReportPdfBlobUrl or generateReportPdf with the
 *  returned `imageCache`. Failed fetches are silently dropped — the
 *  renderer falls back to its placeholder visuals for missing entries. */
export async function preloadReportImages(
  input: Omit<ReportPdfInput, 'imageCache'>,
  baseUrl: string
): Promise<Record<string, string>> {
  const urls = new Set<string>();
  const tpl = input.template;
  if (tpl?.logoUrl)     urls.add(tpl.logoUrl);
  if (tpl?.nablLogoUrl) urls.add(tpl.nablLogoUrl);
  // Parse signatures JSON to discover sig image URLs.
  if (tpl?.signaturesJson) {
    try {
      const arr = JSON.parse(tpl.signaturesJson) as ReportSignature[];
      if (Array.isArray(arr)) arr.forEach(s => { if (s?.signatureUrl) urls.add(s.signatureUrl); });
    } catch { /* malformed json — skip */ }
  }
  if (tpl?.signatureUrl) urls.add(tpl.signatureUrl);

  const cache: Record<string, string> = {};
  await Promise.all(Array.from(urls).map(async u => {
    const abs = absoluteAssetUrl(u, baseUrl);
    if (!abs) return;
    const data = await fetchAsDataUrl(abs);
    if (data) cache[u] = data; // key by original (relative) URL — what the template stores
  }));
  return cache;
}

// ──────────────────────────────────────────────────────────────
// Letterhead — "LAB NAME" wordmark, address, phone, web band
// ──────────────────────────────────────────────────────────────

/** Renders the tagline by splitting on '|' and colouring each separator
 *  pipe with the accent colour (Drlogy style). For taglines without
 *  pipes ("Accurate. On time.") it just renders as a single black line. */
function drawTagline(doc: jsPDF, tagline: string, x: number, y: number) {
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(9);
  const parts = tagline.split('|');
  let cx = x;
  parts.forEach((seg, i) => {
    const txt = seg;
    doc.setTextColor(BLACK);
    doc.text(txt, cx, y);
    cx += doc.getTextWidth(txt);
    if (i < parts.length - 1) {
      doc.setTextColor(BLUE);
      doc.text(' | ', cx, y);
      cx += doc.getTextWidth(' | ');
    }
  });
}

/** Faint cursive scribble — placeholder shown when no signature image
 *  has been uploaded for a sign-off block. */
function drawSigScribble(doc: jsPDF, px: number, baseY: number) {
  doc.setDrawColor(TEXT_DIM);
  doc.setLineWidth(0.6);
  doc.line(px - 22, baseY,     px - 14, baseY - 6);
  doc.line(px - 14, baseY - 6, px - 4,  baseY + 4);
  doc.line(px - 4,  baseY + 4, px + 6,  baseY - 4);
  doc.line(px + 6,  baseY - 4, px + 18, baseY + 2);
}

/** Placeholder blue disc + white plus, drawn when no logo upload exists
 *  (or the bytes failed to decode). Scales with the requested size. */
function drawLogoPlaceholder(doc: jsPDF, sizePx: number) {
  const r = sizePx / 2;
  const cx = MARGIN_X + r;
  const cy = MARGIN_TOP + r;
  doc.setFillColor(BLUE);
  doc.circle(cx, cy, r, 'F');
  const arm = sizePx * 0.45;
  const thick = Math.max(1.5, sizePx * 0.08);
  doc.setFillColor('#ffffff');
  doc.rect(cx - thick / 2, cy - arm / 2, thick, arm, 'F');
  doc.rect(cx - arm / 2, cy - thick / 2, arm, thick, 'F');
}

function drawLetterhead(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>, logoUrl: string | null) {
  // Pre-printed letterpad: draw nothing — the blank MARGIN_TOP reserve is the
  // space the lab's own printed letterhead occupies.
  if (LETTERPAD) return;
  switch (theme.headerPreset) {
    case 'centered':  drawLetterheadCentered(doc, practice, logoUrl); break;
    case 'banner':    drawLetterheadBanner  (doc, practice, logoUrl); break;
    case 'minimal':   drawLetterheadMinimal (doc, practice);          break;
    case 'drlogy':
    default:          drawLetterheadDrlogy  (doc, practice, logoUrl);
  }
}

/** Drlogy preset — logo + wordmark left, phone/email right, address
 *  below, optional blue accent band. */
function drawLetterheadDrlogy(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>, logoUrl: string | null) {
  const sizePx = theme.logoSize === 'sm' ? 24 : theme.logoSize === 'lg' ? 40 : 32;
  const logoX = logoXFor(sizePx);
  drawLogo(doc, logoUrl, logoX, MARGIN_TOP, sizePx);

  const fullName = (practice.name ?? 'Prefrontal Pathology Lab').toUpperCase();
  const tokens = fullName.split(' ');
  const firstWord = tokens[0];
  const rest = tokens.slice(1).join(' ');

  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(18 * theme.fontScale);
  doc.setTextColor(BLACK);
  const wordmarkX = logoX + sizePx + 6;
  const wordmarkY = MARGIN_TOP + 18;
  doc.text(firstWord, wordmarkX, wordmarkY);
  const firstW = doc.getTextWidth(firstWord + ' ');
  doc.setTextColor(BLUE);
  doc.text(rest, wordmarkX + firstW, wordmarkY);

  drawTagline(doc, theme.tagline, wordmarkX, wordmarkY + 14);

  const rightX = A4.w - MARGIN_X;
  // NABL badge at the top-right corner; contact info right-aligns to its left.
  const contactX = rightX - drawNablBadge(doc, rightX, MARGIN_TOP - 2);
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9 * theme.fontScale);
  doc.setTextColor(BLACK);
  if (practice.phone) doc.text(practice.phone, contactX, MARGIN_TOP + 14, { align: 'right' });
  if (practice.email) doc.text(practice.email, contactX, MARGIN_TOP + 28, { align: 'right' });

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8 * theme.fontScale);
  doc.setTextColor(TEXT_DIM);
  if (practice.address) doc.text(practice.address, MARGIN_X, MARGIN_TOP + 46);

  drawTopAccentBar(doc, practice);
}

/** Centered preset — logo, wordmark, tagline, address all stacked
 *  and centered. Phone + email on a single centered line below. */
function drawLetterheadCentered(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>, logoUrl: string | null) {
  drawNablBadge(doc, A4.w - MARGIN_X, MARGIN_TOP - 2);
  const sizePx = theme.logoSize === 'sm' ? 24 : theme.logoSize === 'lg' ? 40 : 32;
  drawLogo(doc, logoUrl, (A4.w - sizePx) / 2, MARGIN_TOP, sizePx);

  const fullName = (practice.name ?? 'Prefrontal Pathology Lab').toUpperCase();
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(18 * theme.fontScale);
  doc.setTextColor(BLACK);
  doc.text(fullName, A4.w / 2, MARGIN_TOP + sizePx + 14, { align: 'center' });

  // Centered tagline — split + recolour the pipes.
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(9 * theme.fontScale);
  const taglineW = doc.getTextWidth(theme.tagline.replace(/\|/g, ' | '));
  drawTagline(doc, theme.tagline, A4.w / 2 - taglineW / 2, MARGIN_TOP + sizePx + 28);

  // Contact line: phone · email · website
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8 * theme.fontScale);
  doc.setTextColor(TEXT_DIM);
  const contact = [practice.phone, practice.email, practice.website].filter(Boolean).join('  ·  ');
  if (contact) doc.text(contact, A4.w / 2, MARGIN_TOP + sizePx + 40, { align: 'center' });
  if (practice.address) doc.text(practice.address, A4.w / 2, MARGIN_TOP + sizePx + 50, { align: 'center' });

  drawTopAccentBar(doc, practice);
}

/** Banner preset — solid coloured band across the top with white text
 *  inside. Eye-catching, less "lab-formal". */
function drawLetterheadBanner(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>, logoUrl: string | null) {
  drawNablBadge(doc, A4.w - MARGIN_X, MARGIN_TOP - 2);
  const bannerH = 54;
  doc.setFillColor(BLUE);
  doc.rect(0, 0, A4.w, bannerH, 'F');

  const sizePx = theme.logoSize === 'sm' ? 22 : theme.logoSize === 'lg' ? 36 : 28;
  const lx = theme.logoPosition === 'right' ? A4.w - MARGIN_X - sizePx
           : theme.logoPosition === 'center' ? (A4.w - sizePx) / 2
           : MARGIN_X;
  // White-on-blue logo placeholder swap: if we have a real upload, use it;
  // else draw the placeholder over a thin white circle for contrast.
  drawLogo(doc, logoUrl, lx, (bannerH - sizePx) / 2, sizePx);

  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(18 * theme.fontScale);
  doc.setTextColor('#ffffff');
  const wmX = theme.logoPosition === 'center' ? (A4.w / 2) : (lx + sizePx + 10);
  const wmAlign: 'left' | 'center' = theme.logoPosition === 'center' ? 'center' : 'left';
  doc.text((practice.name ?? 'Prefrontal Pathology Lab').toUpperCase(),
    wmX, 24, { align: wmAlign });

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9 * theme.fontScale);
  doc.text(theme.tagline, wmX, 40, { align: wmAlign });

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8 * theme.fontScale);
  doc.setTextColor(TEXT_DIM);
  const sub = [practice.address, practice.phone, practice.email].filter(Boolean).join('  ·  ');
  if (sub) doc.text(sub, MARGIN_X, bannerH + 10);
}

/** Minimal preset — text-only. No logo, no accent bar. */
function drawLetterheadMinimal(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>) {
  drawNablBadge(doc, A4.w - MARGIN_X, MARGIN_TOP - 2);
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(16 * theme.fontScale);
  doc.setTextColor(BLACK);
  const align: 'left' | 'center' | 'right' = theme.logoPosition === 'center' ? 'center'
                                            : theme.logoPosition === 'right'  ? 'right' : 'left';
  const x = align === 'center' ? A4.w / 2 : align === 'right' ? A4.w - MARGIN_X : MARGIN_X;
  doc.text((practice.name ?? 'Prefrontal Pathology Lab').toUpperCase(), x, MARGIN_TOP + 14, { align });

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9 * theme.fontScale);
  doc.setTextColor(TEXT_DIM);
  doc.text(theme.tagline, x, MARGIN_TOP + 26, { align });
  const sub = [practice.address, practice.phone, practice.email, practice.website].filter(Boolean).join('  ·  ');
  if (sub) doc.text(sub, x, MARGIN_TOP + 38, { align });
}

/** Compute the left-X coordinate for the logo group based on the
 *  template's logoPosition. */
function logoXFor(sizePx: number): number {
  if (theme.logoPosition === 'right') {
    // Reserve room for the wordmark roughly proportional to the page.
    return A4.w - MARGIN_X - sizePx - 200;
  }
  if (theme.logoPosition === 'center') {
    return (A4.w - sizePx - 200) / 2;
  }
  return MARGIN_X;
}

/** Embed an uploaded logo (when available in IMG_CACHE) or fall back
 *  to the parametric placeholder. Shared by all letterhead presets. */
function drawLogo(doc: jsPDF, logoUrl: string | null, x: number, y: number, sizePx: number) {
  const cached = logoUrl && IMG_CACHE[logoUrl];
  if (cached) {
    try {
      doc.addImage(cached, 'PNG', x, y, sizePx, sizePx, undefined, 'FAST');
      return;
    } catch { /* fall through to placeholder */ }
  }
  drawLogoPlaceholderAt(doc, x, y, sizePx);
}

/** Draw the NABL accreditation badge (the uploaded badge image, else a green
 *  "NABL" text chip) at the top-right corner, with the accreditation number
 *  beneath it. Returns the horizontal space it consumed so the caller can shift
 *  adjacent content (phone/email) left of it. No-op unless the lab is
 *  NABL-accredited (theme.nablAccredited). */
function drawNablBadge(doc: jsPDF, rightX: number, topY: number): number {
  if (!theme.nablAccredited) return 0;
  const size = 30;
  const x = rightX - size;
  const cached = theme.nablLogoUrl && IMG_CACHE[theme.nablLogoUrl];
  if (cached) {
    try { doc.addImage(cached, 'PNG', x, topY, size, size, undefined, 'FAST'); }
    catch { /* fall through to the text chip */ }
  } else {
    doc.setDrawColor('#10b981');
    doc.setFillColor('#ecfdf5');
    doc.roundedRect(x, topY + 5, size, 15, 3, 3, 'FD');
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(8);
    doc.setTextColor('#059669');
    doc.text('NABL', x + size / 2, topY + 15.5, { align: 'center' });
  }
  if (theme.nablNumber) {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(theme.nablNumber, x + size / 2, topY + size + 6, { align: 'center' });
  }
  return size + 8; // badge width + gap
}

/** Same as drawLogoPlaceholder but at an explicit (x, y) — needed for
 *  centered / right-aligned presets. */
function drawLogoPlaceholderAt(doc: jsPDF, x: number, y: number, sizePx: number) {
  const r = sizePx / 2;
  const cx = x + r;
  const cy = y + r;
  doc.setFillColor(BLUE);
  doc.circle(cx, cy, r, 'F');
  const arm = sizePx * 0.45;
  const thick = Math.max(1.5, sizePx * 0.08);
  doc.setFillColor('#ffffff');
  doc.rect(cx - thick / 2, cy - arm / 2, thick, arm, 'F');
  doc.rect(cx - arm / 2, cy - thick / 2, arm, thick, 'F');
}

/** Optional thin accent band beneath the letterhead with a "website"
 *  pill on the right. Shared by drlogy + centered presets. */
function drawTopAccentBar(doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>) {
  const bandY = MARGIN_TOP + 54;
  if (!theme.topAccentBar) return;
  doc.setFillColor(BLUE);
  doc.rect(MARGIN_X, bandY, A4.w - 2 * MARGIN_X, 4, 'F');

  if (practice.website) {
    const w = doc.getTextWidth(practice.website) + 12;
    doc.setFillColor('#ffffff');
    doc.rect(A4.w - MARGIN_X - w, bandY - 3, w, 12, 'F');
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(BLUE);
    doc.text(practice.website, A4.w - MARGIN_X - 6, bandY + 5.5, { align: 'right' });
  }
}

// ──────────────────────────────────────────────────────────────
// Patient block — three columns with thin vertical separators
// ──────────────────────────────────────────────────────────────

function drawPatientBlock(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  // Dispatch to the chosen patient-block layout. All three renderers
  // share the same external contract: take snapshot + report, return
  // the cursor Y after the block.
  // Any layout: when the lab has saved a drag-arranged column set, render from
  // it (N columns = the layout's column count) so placement + order are honoured.
  if (theme.patientColumns.length >= 1 && theme.patientColumns.some(c => c.length > 0)) {
    return drawPatientBlockColumns(doc, snap, report);
  }
  switch (theme.patientLayout) {
    case 'four-col-grid': return drawPatientBlockFourCol(doc, snap, report);
    case 'stacked':       return drawPatientBlockStacked(doc, snap, report);
    case 'three-col':
    default:              return drawPatientBlockThreeCol(doc, snap, report);
  }
}

/** Patient-block: three-column Classic layout (default). When the lab has saved
 *  a drag-arranged column layout (theme.patientColumns), render from that
 *  instead so the PDF reflects their chosen placement + order. */
function drawPatientBlockThreeCol(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  const top = MARGIN_TOP + HEADER_RESERVE;
  const blockH = 80;
  const w = A4.w - 2 * MARGIN_X;
  const col1W = w * 0.36;
  const col2W = w * 0.36;
  const col3W = w * 0.28;

  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, top, A4.w - MARGIN_X, top);
  doc.line(MARGIN_X, top + blockH, A4.w - MARGIN_X, top + blockH);

  // Vertical separators between the three columns
  doc.line(MARGIN_X + col1W, top + 6, MARGIN_X + col1W, top + blockH - 6);
  doc.line(MARGIN_X + col1W + col2W, top + 6, MARGIN_X + col1W + col2W, top + blockH - 6);

  // ── Col 1 — Patient identity ──
  const x1 = MARGIN_X + 10;
  let y = top + 18;
  // Auto-shrink a long patient name so it never spills past the column
  // separator into the Specimen(s) column (was overlapping at 13pt).
  const patientName = snap.patient?.displayName ?? '—';
  const nameMaxW = col1W - 16;
  doc.setFont(PDF_FONT, 'bold');
  let nameSize = 13;
  doc.setFontSize(nameSize);
  while (nameSize > 8 && doc.getTextWidth(patientName) > nameMaxW) { nameSize -= 0.5; doc.setFontSize(nameSize); }
  doc.setTextColor(BLACK);
  doc.text(patientName, x1, y);
  y += 16;
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  if (snap.patient?.age != null) {
    doc.text(`Age : ${snap.patient.age} Years`, x1, y);
    y += 12;
  }
  if (snap.patient?.sex) {
    doc.text(`Sex : ${snap.patient.sex}`, x1, y);
    y += 12;
  }
  const mrn = (snap.patient?.mrn ?? '').trim();
  if (mrn) {
    doc.text(`MRN : ${mrn}`, x1, y);
  }

  // ── Col 2 — Specimens collected + Ref doctor ──
  const x2 = MARGIN_X + col1W + 10;
  y = top + 18;
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(BLUE);
  doc.text('Specimen(s) :', x2, y);
  y += 13;

  // Roll up unique specimens across all tests in the order so the
  // sample type IS visible somewhere even if a particular layout
  // doesn't echo it. Falls back to a "Phone:" line if nothing was
  // captured (older snapshots).
  const specimens = Array.from(new Set(
    (snap.tests ?? [])
      .map(t => (t.sampleType ?? '').trim())
      .filter(s => s.length > 0)
  ));
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  if (specimens.length > 0) {
    const text = specimens.join(', ');
    const lines = doc.splitTextToSize(text, col2W - 20);
    doc.text(lines, x2, y);
    y += lines.length * 11 + 6;
  } else if (snap.patient?.phone) {
    doc.text(`Phone: ${snap.patient.phone}`, x2, y);
    y += 14;
  }

  if (snap.order?.refDoctorName) {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(BLACK);
    doc.text('Ref. By: ', x2, y);
    const refW = doc.getTextWidth('Ref. By: ');
    doc.setFont(PDF_FONT, 'bold');
    doc.text(snap.order.refDoctorName, x2 + refW, y);
  }

  // ── Col 3 — Sample IDs + registration/collection/report times ──
  const x3 = MARGIN_X + col1W + col2W + 10;
  y = top + 14;
  // Tiny barcode-style placeholder: a row of black bars to evoke a barcode.
  if (theme.showBarcode) {
    drawBarcodePlaceholder(doc, x3, y, col3W - 20, 18);
  }
  // Sample ID number under the barcode
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(BLACK);
  // Barcode reads the report (accession) id, not the patient MRN — labs
  // scan the per-visit code into the LIS, not the lifetime MRN.
  const barcodeText = (snap.order?.id ?? report.id).replace(/-/g, '').slice(-12).toUpperCase();
  doc.text(barcodeText, x3 + (col3W - 20) / 2, y + 26, { align: 'center' });
  y += 36;

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(BLACK);
  const drawTimeLine = (label: string, value: string) => {
    if (!value) return;
    doc.setFont(PDF_FONT, 'normal');
    doc.text(label, x3, y);
    const labelW = doc.getTextWidth(label);
    doc.setFont(PDF_FONT, 'bold');
    doc.text(value, x3 + labelW + 2, y);
    y += 11;
  };
  if (theme.showRegistered) drawTimeLine('Registered on: ', formatShort(snap.order?.createdAt));
  if (theme.showCollected)  drawTimeLine('Collected on: ',  formatShort(snap.order?.createdAt));
  if (theme.showReported)   drawTimeLine('Reported on: ',   formatShort(report.createdAt));

  return top + blockH;
}

/** Config-driven N-column patient block. Renders each column from the lab's
 *  drag-arranged item-key order (theme.patientColumns); the column count = the
 *  saved array length (3-col → 3, 4-col → 4, stacked → 1). Equal widths; the
 *  bottom border tracks the tallest column. Each item draws via drawPatientItem. */
function drawPatientBlockColumns(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  const top = MARGIN_TOP + HEADER_RESERVE;
  const w = A4.w - 2 * MARGIN_X;
  const cols = theme.patientColumns;
  const n = Math.max(1, cols.length);
  const colW = w / n;

  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, top, A4.w - MARGIN_X, top);

  let maxBottom = top + 22;
  cols.forEach((keys, ci) => {
    const x = MARGIN_X + ci * colW + 10;
    let y = top + 16;
    for (const key of keys) y = drawPatientItem(doc, key, x, colW - 16, y, snap, report);
    if (y > maxBottom) maxBottom = y;
  });
  const blockBottom = maxBottom + 4;

  // Vertical separators between columns.
  for (let i = 1; i < n; i++) {
    doc.line(MARGIN_X + i * colW, top + 6, MARGIN_X + i * colW, blockBottom - 6);
  }
  doc.line(MARGIN_X, blockBottom, A4.w - MARGIN_X, blockBottom);
  return blockBottom;
}

/** Draw one patient-block item at (x, y) within a column of width colW; returns
 *  the new y. Unknown keys are treated as custom registration fields (label from
 *  theme.patientFields, value from the patient's saved attributes). */
function drawPatientItem(
  doc: jsPDF, key: string, x: number, colW: number, y: number,
  snap: ReportSnapshot, report: ReportPdfInput['report']
): number {
  switch (key) {
    case 'name':
      doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(12); doc.setTextColor(BLACK);
      doc.text(snap.patient?.displayName ?? '—', x, y);
      return y + 16;
    case 'age':
      if (snap.patient?.age == null) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(`Age : ${snap.patient.age} Years`, x, y); return y + 12;
    case 'sex':
      if (!snap.patient?.sex) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(`Sex : ${snap.patient.sex}`, x, y); return y + 12;
    case 'mrn': {
      const mrn = (snap.patient?.mrn ?? '').trim(); if (!mrn) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(`MRN : ${mrn}`, x, y); return y + 12;
    }
    case 'phone':
      if (!snap.patient?.phone) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(`Phone : ${snap.patient.phone}`, x, y); return y + 12;
    case 'orderid': {
      const oid = (snap.order?.id ?? '').slice(0, 8); if (!oid) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(`Order : ${oid}`, x, y); return y + 12;
    }
    case 'refdoctor': {
      if (!snap.order?.refDoctorName) return y;
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text('Ref. By: ', x, y);
      const rw = doc.getTextWidth('Ref. By: ');
      doc.setFont(PDF_FONT, 'bold'); doc.text(snap.order.refDoctorName, x + rw, y);
      return y + 12;
    }
    case 'specimen': {
      const specimens = Array.from(new Set((snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(s => s)));
      doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(BLUE);
      doc.text('Specimen(s) :', x, y); y += 12;
      if (specimens.length) {
        doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
        const lines = doc.splitTextToSize(specimens.join(', '), colW);
        doc.text(lines, x, y); y += lines.length * 11 + 2;
      }
      return y;
    }
    case 'barcode': {
      // Placement in a column is the show control here — always draw it.
      drawBarcodePlaceholder(doc, x, y - 4, Math.min(colW, 130), 18);
      doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(BLACK);
      const txt = (snap.order?.id ?? report.id).replace(/-/g, '').slice(-12).toUpperCase();
      doc.text(txt, x, y + 22);
      return y + 30;
    }
    case 'registered': return drawPatientTimeItem(doc, 'Registered on: ', formatShort(snap.order?.createdAt), x, y);
    case 'collected':  return drawPatientTimeItem(doc, 'Collected on: ',  formatShort(snap.order?.createdAt), x, y);
    case 'reported':   return drawPatientTimeItem(doc, 'Reported on: ',   formatShort(report.createdAt), x, y);
    default: {
      const fld = theme.patientFields.find(f => f.name === key);
      const val = parsePatientAttributes(snap)[key];
      if (val == null || String(val).trim() === '') return y;
      const label = `${fld?.title ?? key}: `;
      doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(BLACK);
      doc.text(label, x, y);
      doc.setFont(PDF_FONT, 'normal'); doc.setTextColor(TEXT_DIM);
      doc.text(String(val), x + doc.getTextWidth(label), y);
      return y + 12;
    }
  }
}

function drawPatientTimeItem(doc: jsPDF, label: string, value: string, x: number, y: number): number {
  if (!value) return y;
  doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(8.5); doc.setTextColor(BLACK);
  doc.text(label, x, y);
  const lw = doc.getTextWidth(label);
  doc.setFont(PDF_FONT, 'bold'); doc.text(value, x + lw, y);
  return y + 11;
}

/** Patient-block: 4-column labelled grid (compact, label-above-value).
 *  Two rows of four cells each. No vertical separators — the labels
 *  themselves act as visual anchors. Best when the lab wants a more
 *  "form" feel than the Drlogy 3-column block. */
function drawPatientBlockFourCol(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  const top = MARGIN_TOP + HEADER_RESERVE;
  const blockH = 76;
  const w = A4.w - 2 * MARGIN_X;
  const colW = w / 4;
  const mrn = (snap.patient?.mrn ?? '').trim();
  const ageSex = [
    snap.patient?.age != null ? `${snap.patient.age} yrs` : '',
    snap.patient?.sex ?? ''
  ].filter(Boolean).join(' / ');
  const specimens = Array.from(new Set(
    (snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(s => s.length > 0)
  )).join(', ');

  doc.setFillColor('#f8fafc');
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN_X, top, w, blockH, 4, 4, 'FD');

  const cells: { label: string; value: string }[][] = [
    [
      { label: 'PATIENT', value: snap.patient?.displayName ?? '—' },
      { label: 'MRN', value: mrn || '—' },
      { label: 'AGE / SEX', value: ageSex || '—' },
      { label: 'REF DOCTOR', value: snap.order?.refDoctorName ?? 'Self' },
    ],
    [
      { label: 'PHONE', value: snap.patient?.phone ?? '—' },
      { label: 'COLLECTED', value: formatShort(snap.order?.createdAt) || '—' },
      { label: 'REPORTED', value: formatShort(report.createdAt) || '—' },
      { label: 'SAMPLE(S)', value: specimens || '—' },
    ],
  ];

  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const x = MARGIN_X + c * colW + 10;
      const y = top + r * (blockH / 2) + 13;
      doc.setFont(PDF_FONT, 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(cells[r][c].label, x, y);
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(TEXT);
      const fit = doc.splitTextToSize(cells[r][c].value, colW - 20)[0] ?? cells[r][c].value;
      doc.text(fit, x, y + 12);
    }
  }
  // Faint vertical separators between cells
  doc.setDrawColor(HAIR);
  for (let c = 1; c < 4; c++) {
    const x = MARGIN_X + c * colW;
    doc.line(x, top + 6, x, top + blockH - 6);
  }
  return top + blockH;
}

/** Patient-block: stacked single-column. Each labelled row spans the
 *  full width on its own line. Best for small labs that want a clean
 *  "letter" feel and aren't worried about real-estate. */
function drawPatientBlockStacked(
  doc: jsPDF,
  snap: ReportSnapshot,
  report: ReportPdfInput['report']
): number {
  const top = MARGIN_TOP + HEADER_RESERVE;
  const mrn = (snap.patient?.mrn ?? '').trim();
  const orderShort = (snap.order?.id ?? '').replace(/-/g, '').slice(-8).toUpperCase();
  const ageSex = [
    snap.patient?.age != null ? `${snap.patient.age} yrs` : '',
    snap.patient?.sex ?? ''
  ].filter(Boolean).join(' / ');
  const specimens = Array.from(new Set(
    (snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(s => s.length > 0)
  )).join(', ');

  const rows: { label: string; value: string }[] = [];
  rows.push({ label: 'Patient name', value: snap.patient?.displayName ?? '—' });
  rows.push({ label: 'Age / Sex',    value: ageSex || '—' });
  if (mrn) rows.push({ label: 'MRN', value: mrn });
  if (orderShort) rows.push({ label: 'Order No.', value: `#${orderShort}` });
  if (theme.showAbhaId) rows.push({ label: 'ABHA ID', value: '—' });
  if (snap.patient?.phone) rows.push({ label: 'Phone', value: snap.patient.phone });
  if (snap.order?.refDoctorName) rows.push({ label: 'Ref Doctor', value: snap.order.refDoctorName });
  if (specimens) rows.push({ label: 'Specimens', value: specimens });
  if (theme.showRegistered) rows.push({ label: 'Registered on', value: formatShort(snap.order?.createdAt) });
  if (theme.showCollected)  rows.push({ label: 'Collected on',  value: formatShort(snap.order?.createdAt) });
  if (theme.showReported)   rows.push({ label: 'Reported on',   value: formatShort(report.createdAt) });

  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, top, A4.w - MARGIN_X, top);

  let y = top + 16;
  const labelW = 110;
  rows.forEach(row => {
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(9);
    doc.setTextColor(TEXT_DIM);
    doc.text(`${row.label} :`, MARGIN_X, y);
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(TEXT);
    doc.text(row.value, MARGIN_X + labelW, y);
    y += 14;
  });
  doc.line(MARGIN_X, y + 2, A4.w - MARGIN_X, y + 2);
  return y + 6;
}

/** Cheap visual stand-in for a Code-128 barcode — black bars of
 *  varying widths in a band. Good enough for a printed report; a real
 *  barcode can be wired up later with a font or canvas pass. */
function drawBarcodePlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(BLACK);
  const widths = [1, 2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2, 1, 2, 1, 3, 1, 1, 2, 1, 1, 3, 1, 2];
  let cx = x;
  let i = 0;
  while (cx < x + w - 2) {
    const bw = widths[i % widths.length];
    const gap = (i % 3 === 0) ? 1.5 : 1;
    doc.rect(cx, y, bw, h, 'F');
    cx += bw + gap;
    i++;
  }
}

// ──────────────────────────────────────────────────────────────
// Continuous results table — panel/profile grouping, single header
// band (Investigation · Result · Reference Range · Unit · Specimen).
// This is the primary results renderer; every tabular test's rows are
// merged into ONE table so the column header is drawn once (and repeats
// only on page breaks), matching professional NABL / reference reports.
// ──────────────────────────────────────────────────────────────

interface PanelRowData {
  kind: 'param' | 'note';
  name?: string;
  result?: string;
  range?: string;
  unit?: string;
  /** Display letter: 'H' | 'L' | 'C' | 'A' | '' */
  flag?: string;
  isLow?: boolean;
  abnormal?: boolean;
  note?: string;
}

interface PanelGroup {
  testName: string;
  /** Department name — drives per-department section grouping + its columns. */
  department?: string;
  /** The resolved per-department column layout for this test (incl. linkedNext
   *  merges). Empty ⇒ the renderer falls back to the default layout. */
  columns?: ReportColumn[];
  specimen?: string;
  method?: string;
  referralLab?: string | null;
  /** undefined ⇒ treated as in NABL scope (no claim either way). */
  inScope?: boolean;
  rows: PanelRowData[];
}

/** Extract a test's parameter rows into a panel group for the continuous
 *  table. Uses the resolved grid layout when present, else the legacy
 *  `result.values` map. */
function buildPanelGroup(
  t: NonNullable<ReportSnapshot['tests']>[number],
  layout: ResolvedReportLayout | undefined
): PanelGroup {
  const group: PanelGroup = {
    testName: t.name ?? layout?.testName ?? 'Test',
    department: (t.department ?? '').trim() || undefined,
    columns: layout?.columns ?? [],
    specimen: ((t.sampleType ?? layout?.sampleType) ?? '').trim() || undefined,
    method: (t.method ?? '').trim() || undefined,
    referralLab: (t.referralLab ?? '').trim() || undefined,
    inScope: t.nablScope,
    rows: [],
  };

  const gridSections = (layout?.sections ?? []).filter(s => s.isVisible && s.type === 'grid');
  if (gridSections.length > 0) {
    const cols = layout!.columns;
    const srcOf = (type: string): ReportColumn | undefined => cols.find(c => c.type === type);
    const resultSrc = srcOf('result'), rangeSrc = srcOf('range'), unitSrc = srcOf('unit');
    for (const sec of gridSections) {
      for (const r of sec.rows ?? []) {
        if (r.isMerged) {
          const note = (r.mergeContent ?? '').trim();
          if (note) group.rows.push({ kind: 'note', note });
          continue;
        }
        const label = flagLabel(r);
        const rc = coerceResultCell(resultSrc ? r.cells[resultSrc.name] : '');
        const letter = (label === 'High' ? 'H' : label === 'Low' ? 'L' : '') || rc.flag;
        group.rows.push({
          kind: 'param',
          name: humanize(r.parameterName ?? ''),
          result: rc.value || (resultSrc ? String(r.cells[resultSrc.name] ?? '') : ''),
          range: coerceCellText(rangeSrc ? r.cells[rangeSrc.name] : ''),
          // Prefer the Unit column when present; otherwise fall back to the
          // parameter's own unit so EVERY department shows it (e.g. "11.4 g/dL").
          unit: coerceCellText(unitSrc ? r.cells[unitSrc.name] : '') || (r.unit ?? ''),
          flag: letter,
          isLow: letter === 'L',
          abnormal: !!r.color || (!!rc.flag && rc.flag !== 'N'),
        });
      }
    }
    return group;
  }

  // Legacy values map.
  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string }> | undefined;
  for (const [paramName, v] of Object.entries(values ?? {})) {
    const flag = (v?.flag ?? '').toUpperCase();
    const letter = ['H', 'L', 'C', 'A'].includes(flag) ? flag : '';
    group.rows.push({
      kind: 'param',
      name: humanize(paramName),
      result: String(v?.value ?? '—'),
      range: v?.range ?? '',
      unit: v?.unit ?? '',
      flag: letter,
      isLow: flag === 'L',
      abnormal: !!letter,
    });
  }
  return group;
}

/** A thin uppercase section heading + rule — used for the
 *  "Tests not under NABL scope" segregation band. */
function renderScopeHeading(
  doc: jsPDF,
  text: string,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 60) { y = newPage(doc, practice); }
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(9);
  doc.setTextColor(theme.primary);
  doc.text(text, MARGIN_X, y + 10);
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 14, A4.w - MARGIN_X, y + 14);
  return y + 18;
}

/** Render panel groups grouped into per-DEPARTMENT sections — each department's
 *  tests render in their own block under THAT department's column layout (with
 *  its merges), so one report can show different columns per department. */
function renderContinuousTable(
  doc: jsPDF,
  groups: PanelGroup[],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  _title: string | null
): number {
  if (groups.length === 0) return startY;
  // Partition into departments, preserving first-seen order.
  const order: string[] = [];
  const byDept = new Map<string, PanelGroup[]>();
  for (const g of groups) {
    const d = (g.department ?? '').trim();
    if (!byDept.has(d)) { byDept.set(d, []); order.push(d); }
    byDept.get(d)!.push(g);
  }
  const multiDept = order.filter(Boolean).length > 1;
  let y = startY;
  let rendered = 0;
  for (const dept of order) {
    const dg = byDept.get(dept)!;
    // Optionally start each department (after the first) on a fresh page.
    if (rendered > 0 && theme.departmentPageBreak) {
      y = newPage(doc, practice);
    }
    // Show a department heading when the report spans departments (or when the
    // admin opted into department banding or page breaks).
    if (dept && (multiDept || theme.groupByDepartment || theme.departmentPageBreak)) {
      y = renderScopeHeading(doc, dept.toUpperCase(), y + 4, practice);
    }
    y = renderColumnarTable(doc, dg, deptColumns(dg), y, practice);
    rendered++;
  }
  return y;
}

/** Resolve the column layout for one department's groups: the first group's
 *  resolved columns (else the default), guaranteeing an Investigation (name)
 *  lead column so the parameter name always shows. Sorted by order. */
function deptColumns(groups: PanelGroup[]): ReportColumn[] {
  const src = groups.find(g => g.columns && g.columns.length)?.columns ?? DEFAULT_RESULT_COLUMNS;
  let cfg = src.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!cfg.some(c => c.type === 'name')) {
    cfg = [{ id: 'rc-name', name: 'name', label: 'Investigation', order: 0, width: 30, type: 'name', locked: false }, ...cfg];
  }
  return applyDefaultResultUnitLink(cfg);
}

/** When a column config has NO merges set yet, merge an adjacent Result→Unit by
 *  default ("11.4 g/dL") — so EVERY department shows the unit beside the value
 *  even if its saved layout predates the link feature. Once any link exists, the
 *  admin's choices are respected exactly. */
function applyDefaultResultUnitLink(cfg: ReportColumn[]): ReportColumn[] {
  if (cfg.some(c => c.linkedNext)) return cfg;
  const ri = cfg.findIndex(c => c.type === 'result');
  if (ri >= 0 && cfg[ri + 1]?.type === 'unit') {
    return cfg.map((c, i) => (i === ri ? { ...c, linkedNext: true } : c));
  }
  return cfg;
}

/** Render panel groups as ONE columnar autoTable against the column config
 *  `cfg`. Consecutive LINKED columns merge into a single cell ("11.4 g/dL")
 *  and keep the first column's header label. */
function renderColumnarTable(
  doc: jsPDF,
  groups: PanelGroup[],
  cfg: ReportColumn[],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  if (groups.length === 0) return startY;
  if (startY > A4.h - MARGIN_BOTTOM - 70) { startY = newPage(doc, practice); }

  const usable = A4.w - 2 * MARGIN_X;
  type VCol = { members: ReportColumn[]; label: string; weight: number; hasResult: boolean; textOnly: boolean; nameOnly: boolean };
  const vcols: VCol[] = [];
  for (let i = 0; i < cfg.length; i++) {
    const members: ReportColumn[] = [cfg[i]];
    while (cfg[i]?.linkedNext && i + 1 < cfg.length) { members.push(cfg[++i]); }
    vcols.push({
      members,
      label: members[0].label || '',
      weight: members.reduce((s, m) => s + (m.width || 0), 0) || 1,
      hasResult: members.some(m => m.type === 'result'),
      textOnly: members.every(m => m.type === 'text'),
      nameOnly: members.every(m => m.type === 'name'),
    });
  }
  const hasResultCol = vcols.some(c => c.hasResult);
  const totalWeight = vcols.reduce((s, c) => s + c.weight, 0) || 1;
  const colWidths = vcols.map(c => (c.weight / totalWeight) * usable);
  const COLSPAN = vcols.length;
  const resultColIdx = Math.max(0, vcols.findIndex(c => c.hasResult));

  type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const head: Cell[][] = [vcols.map(c => ({ content: c.label, styles: { halign: 'left' } }))];

  const body: Cell[][] = [];
  // Parallel to `body` — carries the arrow indicator to draw in the result
  // column for abnormal rows (jsPDF standard fonts can't render ↑/↓ glyphs,
  // so we draw a small triangle in didDrawCell). null = no arrow on that row.
  const bodyMeta: Array<{ arrow: 'up' | 'down'; color: string } | null> = [];
  for (const g of groups) {
    // A single-analyte test renders COMPACT: one plain row, no bold panel band
    // and no Method sub-line — the band + method treatment is reserved for
    // multi-parameter panels/profiles (CBC, LFT…). This matches the classic
    // report style: a 20-test biochem order reads as 20 rows, not 20 panels.
    const compact = g.rows.length === 1 && g.rows[0].kind === 'param' && !g.referralLab;

    if (!compact) {
      // Panel / profile header band — bold, full width.
      body.push([{
        content: g.testName.toUpperCase(),
        colSpan: COLSPAN,
        styles: { fillColor: '#eef2f7', textColor: theme.primary, fontStyle: 'bold', fontSize: 9.5, halign: 'left' },
      }]);
      bodyMeta.push(null);

      // Method + referral-lab sub-line (ISO 15189 7.4.1.6 for referrals).
      const sub: string[] = [];
      if (g.method) sub.push(`Method: ${g.method}`);
      if (g.referralLab) sub.push(`Tested at: ${g.referralLab}`);
      if (sub.length > 0) {
        body.push([{
          content: sub.join('       '),
          colSpan: COLSPAN,
          styles: { fontStyle: 'italic', fontSize: 8, textColor: TEXT_DIM, fillColor: '#ffffff', halign: 'left' },
        }]);
        bodyMeta.push(null);
      }
    }

    let firstParam = true;
    for (const r of g.rows) {
      if (r.kind === 'note') {
        body.push([{
          content: r.note ?? '',
          colSpan: COLSPAN,
          styles: { fillColor: '#f8fafc', textColor: TEXT, fontStyle: 'italic', halign: 'left', fontSize: 8.5 },
        }]);
        bodyMeta.push(null);
        continue;
      }
      // A 'N' (normal) flag is never abnormal — keep it plain black, never
      // bold/coloured, even if the row carried a stray colour.
      const isNormal = !r.abnormal || r.flag === 'N';
      const abnColor = r.isLow ? theme.abnormalLowColor : theme.abnormalColor;
      // Letter mode appends the flag letter to the result; arrow mode draws a
      // triangle (didDrawCell). 'none' → no glyph/arrow.
      const useArrow = theme.flagIndicator === 'arrow' && (r.flag === 'H' || r.flag === 'L');
      const glyph = (r.flag && !useArrow && theme.flagIndicator !== 'none') ? r.flag : '';
      const isFirst = firstParam;
      firstParam = false;

      // Value for a single configured column member, by type.
      const valueOf = (m: ReportColumn): string => {
        switch (m.type) {
          // Compact single-analyte rows fall back to the TEST name so the row
          // is never blank when the parameter name is missing.
          case 'name':   return (r.name ?? '').trim() || g.testName;
          case 'result': return (r.result ?? '').trim();
          case 'unit':   return (r.unit ?? '').trim();
          case 'range':  return (r.range ?? '').trim();
          case 'flag':   return (r.flag ?? '').trim();
          case 'text':
          default:
            if (m.locked) return (m.lockedValue ?? '').trim();
            // A 'specimen' text column shows the group's specimen once.
            if (m.name === 'specimen') return isFirst ? (g.specimen ?? '').trim() : '';
            return '';
        }
      };

      const cells: Cell[] = vcols.map(vc => {
        let txt = vc.members.map(valueOf).filter(Boolean).join(' ');
        const styles: Record<string, unknown> = { halign: 'left', textColor: TEXT_DIM };
        if (vc.nameOnly) { styles['fontStyle'] = 'bold'; styles['textColor'] = BLACK; }
        else if (vc.textOnly) { styles['fontSize'] = 8; }
        if (vc.hasResult) {
          if (glyph) txt = txt ? `${txt}  ${glyph}` : glyph;
          styles['textColor'] = BLACK;
          if (!isNormal && theme.flagIndicator !== 'none') {
            styles['fontStyle'] = 'bold';
            if (theme.flagStyle === 'bold_color') styles['textColor'] = abnColor;
          }
        }
        return { content: txt, styles };
      });
      body.push(cells);
      bodyMeta.push((useArrow && hasResultCol) ? { arrow: r.isLow ? 'down' : 'up', color: theme.flagStyle === 'bold_color' ? abnColor : BLACK } : null);
    }
  }

  autoTable(doc, {
    startY,
    head: head as unknown as Array<Array<string | Cell>>,
    body: body as unknown as Array<Array<string | Cell>>,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM },
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: Object.fromEntries(
      colWidths.map((w, i) => [i, { cellWidth: w, halign: 'left' }])
    ) as unknown as Record<number, { cellWidth: number }>,
    // Arrow indicator: draw a small ▲/▼ triangle at the right of the result
    // cell for abnormal rows (standard PDF fonts can't render ↑/↓ glyphs).
    didDrawCell: (d: { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; width: number; height: number } }) => {
      if (d.section !== 'body' || d.column.index !== resultColIdx) return;
      const m = bodyMeta[d.row.index];
      if (!m) return;
      const s = 3.2;
      const cx = d.cell.x + d.cell.width - 9;
      const cy = d.cell.y + d.cell.height / 2;
      doc.setFillColor(m.color);
      if (m.arrow === 'up') doc.triangle(cx - s, cy + s, cx + s, cy + s, cx, cy - s, 'F');
      else doc.triangle(cx - s, cy - s, cx + s, cy - s, cx, cy + s, 'F');
    },
  } as unknown as Parameters<typeof autoTable>[1]);
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
}

// ──────────────────────────────────────────────────────────────
// Per-test renderers — Drlogy table style (plain header + hairline)
// ──────────────────────────────────────────────────────────────

function renderResolvedTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  layout: ResolvedReportLayout,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 70) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? layout.testName ?? 'Test', y);
  y += 26;

  for (const sec of layout.sections) {
    if (!sec.isVisible) continue;
    if (y > A4.h - MARGIN_BOTTOM - 40) { y = newPage(doc, practice); }

    switch (sec.type) {
      case 'grid':
        y = renderGridSection(doc, layout, sec, t, y);
        break;
      case 'paragraph':
        y = renderParagraphSection(doc, sec, y);
        break;
      case 'image':
        y = renderImageSection(doc, sec, y);
        break;
      case 'chart':
        y = renderChartSection(doc, sec, y);
        break;
    }
    y += 4;
  }
  return y;
}

/** Drlogy-style centered uppercase test name. */
function drawTestHeading(doc: jsPDF, name: string, y: number) {
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(BLACK);
  doc.text(name.toUpperCase(), A4.w / 2, y + 14, { align: 'center' });
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 22, A4.w - MARGIN_X, y + 22);
}

/** Resolved grid section → Drlogy 4-column shape.
 *
 *  Empty columns are dropped automatically; a synthesized "Investigation"
 *  column is prepended whenever the layout doesn't already include a
 *  parameter-name column. Bold result cells get red/blue inline color
 *  when the engine's conditions paint the row.
 *
 *  Specimen / sample type (per-test) is rendered as a small dim
 *  italic line BENEATH the test name in the parameter cell, not as a
 *  separate column — matching Drlogy ("CREATININE, SERUM" with
 *  "Compensated Jaffe's reaction, IDMS traceable" italic below). */
function renderGridSection(
  doc: jsPDF,
  layout: ResolvedReportLayout,
  sec: ResolvedSection,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number
): number {
  const rows = sec.rows ?? [];
  if (rows.length === 0) return startY;
  const bodyRows = rows.filter(r => !r.isMerged);

  // Lay this test out against the report-wide CANONICAL columns (set in
  // buildReportPdf) so every test's table lines up. Investigation (the parameter
  // name) is always the leading column and the typed columns + widths are
  // identical for every test; the test's own layout only tells us WHICH of its
  // columns supplies the value for each canonical type.
  const canon = CANON_COLS;
  const srcOf = (type: string): ReportColumn | undefined => layout.columns.find(c => c.type === type);

  const usable = A4.w - 2 * MARGIN_X;
  const investWidth = 0.34 * usable;
  const remaining = usable - investWidth;
  const RATIO: Record<string, number> = { result: 30, range: 42, unit: 28 };
  const totalRatio = canon.reduce((s, c) => s + (RATIO[c.type] ?? 25), 0) || 1;
  const dataColWidths = canon.map(c => ((RATIO[c.type] ?? 25) / totalRatio) * remaining);

  // ── Build head + body against the canonical columns ──
  type RowCell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const head: RowCell[][] = [[
    { content: 'Investigation', styles: { halign: 'left' as const } },
    ...canon.map(c => ({ content: c.label, styles: { halign: alignFor(c.type) as 'left' | 'right' | 'center' } })),
  ]];

  const totalCols = 1 + canon.length;
  // Prefer the snapshot's sampleType; fall back to the layout's.
  const sampleTypeLine = ((t.sampleType ?? layout.sampleType) ?? '').trim();

  const body: RowCell[][] = rows.map((r): RowCell[] => {
    if (r.isMerged) {
      return [{
        content: r.mergeContent ?? '',
        colSpan: totalCols,
        styles: { fillColor: '#f8fafc', textColor: TEXT, fontStyle: 'italic', halign: 'center', fontSize: 8.5 },
      }];
    }
    // Bold parameter name + (only on the first non-merged row) the sample-type sub-line.
    const isFirstBodyRow = bodyRows.length > 0 && bodyRows[0].id === r.id;
    const paramTitle = humanize(r.parameterName ?? '');
    const investContent = isFirstBodyRow && sampleTypeLine
      ? `${paramTitle}\n${sampleTypeLine}`
      : paramTitle;
    const investCell: RowCell = { content: investContent, styles: { fontStyle: 'bold', textColor: BLACK, fontSize: 9 } };

    const dataCells: RowCell[] = canon.map(c => {
      const src = srcOf(c.type);
      // Unwrap an enriched value-object cell ({value,flag,…}) to its text so
      // the PDF never prints raw JSON.
      const value = src ? coerceCellText(r.cells[src.name]) : '';
      const styles: Record<string, unknown> = {};
      if (c.type === 'result') {
        // The value is the focal point: bold, coloured red(high)/blue(low) by the
        // engine, with an inline "High"/"Low" tag (Drlogy pattern).
        styles['fontStyle'] = 'bold';
        styles['textColor'] = r.color ?? BLACK;
        if (r.color) {
          const tag = flagLabel(r);
          if (tag) return { content: `${value}    ${tag}`, styles };
        }
        return { content: value, styles };
      }
      // Reference range + unit muted so the result value stands out.
      styles['textColor'] = TEXT_DIM;
      return { content: value, styles };
    });
    return [investCell, ...dataCells];
  });

  const columnStyles: Record<number, { cellWidth: number; halign?: string }> = {};
  let idx = 0;
  columnStyles[idx++] = { cellWidth: investWidth, halign: 'left' };
  canon.forEach((c, i) => { columnStyles[idx++] = { cellWidth: dataColWidths[i], halign: alignFor(c.type) }; });

  autoTable(doc, {
    startY,
    head: head as unknown as Array<Array<string | RowCell>>,
    body: body as unknown as Array<Array<string | RowCell>>,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: theme.tableHeaderBg === '#ffffff' ? '#ffffff' : '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: columnStyles as unknown as Record<number, { cellWidth: number }>,
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

/** Shared body styles for both grid + legacy tables. Honours the
 *  template's font family, font scale, and divider colour, and switches
 *  to bordered lines when tableStyle === 'bordered'. */
function tableBodyStyles() {
  const bordered = theme.tableStyle === 'bordered';
  return {
    font: PDF_FONT,
    fontSize: 9 * theme.fontScale,
    cellPadding: { top: 6, right: 6, bottom: 6, left: 6 },
    textColor: TEXT,
    lineColor: HAIR,
    lineWidth: bordered ? 0.4 : 0,
  };
}

/** Shared head styles: template-driven bg/text colours; falls through
 *  to the white-bg + hairline-under-header look when no admin overrides. */
function tableHeadStyles() {
  const bordered = theme.tableStyle === 'bordered';
  return {
    fillColor: theme.tableHeaderBg,
    textColor: theme.tableHeaderText,
    fontStyle: 'bold' as const,
    fontSize: 10 * theme.fontScale,
    halign: 'left' as const,
    cellPadding: { top: 4, right: 6, bottom: 8, left: 6 },
    lineColor: HAIR,
    lineWidth: bordered
      ? 0.4
      : ({ top: 0, right: 0, bottom: 0.5, left: 0 } as unknown as number),
  };
}

/** True if the layout includes any flag-type column. When it does, the
 *  renderer leaves the inline tag off the result cell. */
function showsFlagColumn(cols: ReportColumn[]): boolean {
  return cols.some(c => c.type === 'flag');
}

/** Resolved paragraph section → wrapped text block. */
function renderParagraphSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const text = sec.content ?? '';
  if (!text.trim()) return startY;
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(TEXT);
  const usable = A4.w - 2 * MARGIN_X;
  const lines = doc.splitTextToSize(text, usable);
  let y = startY + 11;
  for (const ln of lines) {
    if (y > A4.h - MARGIN_BOTTOM - 12) { y = newPage(doc, {}) + 6; }
    doc.text(ln, MARGIN_X, y);
    y += 12;
  }
  return y + 2;
}

function renderImageSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const urls = sec.imageUrls ?? [];
  if (urls.length === 0) return startY;
  doc.setFont(PDF_FONT, 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(TEXT_DIM);
  doc.text(`[ ${urls.length} attached image${urls.length === 1 ? '' : 's'} ]`, MARGIN_X, startY + 11);
  return startY + 18;
}

function renderChartSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const chart = sec.chart;
  if (!chart || chart.max <= chart.min) return startY;

  const barX = MARGIN_X;
  const barY = startY + 6;
  const barW = A4.w - 2 * MARGIN_X;
  const barH = 11;

  doc.setFillColor('#f1f5f9');
  doc.roundedRect(barX, barY, barW, barH, 4, 4, 'F');

  const range = chart.max - chart.min;
  for (const z of chart.zones) {
    const left  = ((z.from - chart.min) / range) * barW;
    const width = ((z.to - z.from) / range) * barW;
    if (width <= 0) continue;
    doc.setFillColor(zoneHexForPdf(z.color));
    doc.rect(barX + left, barY, width, barH, 'F');
  }

  if (chart.value !== null && chart.value !== undefined) {
    const mx = barX + ((chart.value - chart.min) / range) * barW;
    doc.setFillColor(BLUE);
    doc.rect(mx - 1.5, barY - 3, 3, barH + 6, 'F');
  }

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_DIM);
  doc.text(String(chart.min), barX, barY + barH + 12);
  if (chart.value !== null && chart.value !== undefined) {
    doc.text(String(chart.value), barX + barW / 2, barY + barH + 12, { align: 'center' });
  }
  doc.text(String(chart.max), barX + barW, barY + barH + 12, { align: 'right' });

  return barY + barH + 18;
}

/** Legacy renderer — used when a test has no admin-configured layout.
 *  Drlogy 4-column shape: Investigation · Result · Reference Value · Unit.
 *  Inline RED "High"/blue "Low" tag in the Result cell. */
function renderLegacyTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 70) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? '—', y);
  y += 26;

  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string }> | undefined;
  type LCell = { content: string; styles?: Record<string, unknown> };
  const tableRows: LCell[][] = [];
  const sampleTypeLine = (t.sampleType ?? '').trim();
  const entries = values ? Object.entries(values) : [];

  if (entries.length > 0) {
    entries.forEach(([paramName, v], i) => {
      const flag = (v?.flag ?? '').toUpperCase();
      const flagText = flag === 'H' ? 'High' : flag === 'L' ? 'Low'
        : flag === 'C' ? 'Critical' : flag === 'A' ? 'Abnormal' : '';
      const valueText = String(v?.value ?? '—');
      const investContent = (i === 0 && sampleTypeLine)
        ? `${humanize(paramName)}\n${sampleTypeLine}`
        : humanize(paramName);
      const resultStyles: Record<string, unknown> = {
        fontStyle: 'bold',
        textColor: flagText === 'Low' ? FLAG_BLUE : flagText ? FLAG_RED : BLACK,
      };
      tableRows.push([
        { content: investContent, styles: { fontStyle: 'bold', textColor: BLACK } },
        { content: flagText ? `${valueText}    ${flagText}` : valueText, styles: resultStyles },
        { content: v?.range ?? '—' },
        { content: v?.unit ?? '—' },
      ]);
    });
  } else {
    tableRows.push([{ content: 'No parameters recorded.', styles: { halign: 'center', fontStyle: 'italic', textColor: TEXT_DIM } }]);
  }

  autoTable(doc, {
    startY: y,
    head: [['Investigation', 'Result', 'Reference Value', 'Unit']],
    body: tableRows as unknown as Array<Array<string | LCell>>,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 130, fontStyle: 'bold' },
      2: { cellWidth: 130 },
      3: { cellWidth: 'auto' as unknown as number },
    },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

// ──────────────────────────────────────────────────────────────
// Microbiology — Culture & Sensitivity
// ──────────────────────────────────────────────────────────────

interface PdfAst { name?: string; interpretation?: string }
interface PdfOrganism { name?: string; antibiotics?: PdfAst[] }
interface PdfCulture {
  specimen?: string; gramStain?: string; colonyCount?: string; noGrowth?: boolean;
  organisms?: PdfOrganism[]; resistancePattern?: string; intrinsicResistance?: string;
  clinicalNotes?: string; infectionControlAdvice?: string;
}

function renderCultureSection(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 90) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? 'Culture & Sensitivity', y);
  y += 26;

  const c = (t.result?.['values'] as PdfCulture | undefined) ?? {};

  const line = (label: string, value?: string): void => {
    if (y > A4.h - MARGIN_BOTTOM - 30) { y = newPage(doc, practice); }
    doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(8.5); doc.setTextColor(BLACK);
    doc.text(`${label.toUpperCase()}:`, MARGIN_X, y);
    doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(value && value.trim() ? value : '—', A4.w - 2 * MARGIN_X - 4);
    doc.text(lines, MARGIN_X, y + 11);
    y += 11 + lines.length * 11 + 4;
  };

  line('Specimen', c.specimen || (t.sampleType ?? ''));
  line('Gram stain', c.gramStain);
  line('Colony count', c.colonyCount);

  if (c.noGrowth) {
    line('Result', 'No growth after 48 hours of aerobic incubation.');
    return y;
  }

  // Keep any organism that is named OR carries antibiotic data. A tech may
  // fill the whole sensitivity panel before naming the isolate — we must
  // never silently drop measured results and mislabel them "no growth".
  const organisms = (c.organisms ?? []).filter(o =>
    (o.name ?? '').trim() || (o.antibiotics ?? []).some(a => (a.name ?? '').trim()));
  const orgLabel = (o: PdfOrganism, i: number): string => (o.name ?? '').trim() || `Isolate ${i + 1}`;
  const names = organisms.map((o, i) => `${i + 1}. ${orgLabel(o, i)}`).join('   ');
  line('Organism(s) isolated', names || 'No significant growth');

  const interpWord = (v?: string): { txt: string; color: string } => {
    const u = (v ?? '').toUpperCase();
    if (u === 'S') return { txt: 'S', color: '#16a34a' };
    if (u === 'R') return { txt: 'R', color: FLAG_RED };
    if (u === 'I') return { txt: 'M', color: '#d97706' };
    return { txt: '—', color: BLACK };
  };

  for (let idx = 0; idx < organisms.length; idx++) {
    const org = organisms[idx];
    if (y > A4.h - MARGIN_BOTTOM - 60) { y = newPage(doc, practice); }
    const rows = (org.antibiotics ?? [])
      .filter(a => (a.name ?? '').trim())
      .map(a => {
        const w = interpWord(a.interpretation);
        return [
          { content: a.name ?? '', styles: {} },
          { content: w.txt, styles: { fontStyle: 'bold', textColor: w.color, halign: 'center' } },
        ];
      });
    if (rows.length === 0) continue;
    autoTable(doc, {
      startY: y,
      head: [[`Antimicrobial for ${orgLabel(org, idx)}`, 'Interpretation']],
      body: rows as unknown as Array<Array<string>>,
      margin: { left: MARGIN_X, right: MARGIN_X },
      theme: 'plain',
      styles: tableBodyStyles(),
      headStyles: tableHeadStyles(),
      bodyStyles: { fillColor: '#ffffff' },
      columnStyles: { 0: { cellWidth: 340 }, 1: { cellWidth: 'auto' as unknown as number, halign: 'center' } },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  }

  // Legend.
  if (y > A4.h - MARGIN_BOTTOM - 40) { y = newPage(doc, practice); }
  doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(7.5); doc.setTextColor(TEXT_DIM);
  const legend = [
    'S - Sensitive (clinically effective at standard therapeutic dose)',
    'R - Resistant (clinically ineffective at standard or increased dose)',
    'M - Intermediate (may be effective at higher dose or in concentrated body sites)',
    'Choice of antimicrobial depends on the clinical status, site of infection, and the drug pharmacokinetics/pharmacodynamics.',
  ];
  // Advance by the ACTUAL wrapped-line count — the last legend line wraps to
  // two lines, so a fixed 10px step left the next block ("Resistance pattern")
  // overlapping it.
  legend.forEach(l => {
    const lines = doc.splitTextToSize(l, A4.w - 2 * MARGIN_X) as string[];
    doc.text(lines, MARGIN_X, y);
    y += lines.length * 10;
  });
  y += 4;

  line('Resistance pattern', c.resistancePattern);
  line('Intrinsic resistance', c.intrinsicResistance);
  line('Clinical notes', c.clinicalNotes);
  line('Infection control advice', c.infectionControlAdvice);
  return y;
}

// ──────────────────────────────────────────────────────────────
// "Thanks for Reference  ...  ****End of Report****"
// ──────────────────────────────────────────────────────────────

/**
 * Trendogram section: serial-result trend charts laid out 2-per-row (each a
 * half-page-wide cell), up to 6 per page (3 rows). Charts arrive as pre-rendered
 * PNG data URLs (grid lines baked in by the light-theme ECharts option).
 */
function renderTrendogramSection(
  doc: jsPDF,
  charts: Array<{ title: string; dataUrl: string }>,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
): number {
  const gap = 14;
  const cellW = (A4.w - 2 * MARGIN_X - gap) / 2;   // half-page cell
  const cellH = cellW * 0.66;

  // Section heading (centered uppercase + hairline, matching the report style).
  let y = startY + 12;
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(10);
  doc.setTextColor('#334155');
  doc.text('TRENDOGRAM — SERIAL RESULT TRENDS', A4.w / 2, y, { align: 'center' });
  y += 8;
  doc.setDrawColor('#cbd5e1'); doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y, A4.w - MARGIN_X, y);
  y += 14;

  charts.forEach((c, i) => {
    const col = i % 2;
    if (col === 0 && i > 0) {
      // New row. Cap at 6 charts (3 rows) per page; otherwise advance and
      // page-break if the next row won't fit.
      if (i % 6 === 0) { y = newPage(doc, practice); }
      else { y += cellH + gap; if (y > A4.h - MARGIN_BOTTOM - cellH) y = newPage(doc, practice); }
    }
    const x = MARGIN_X + col * (cellW + gap);
    doc.setDrawColor('#e2e8f0'); doc.setLineWidth(0.5);
    doc.roundedRect(x, y, cellW, cellH, 6, 6);
    try { doc.addImage(c.dataUrl, 'PNG', x + 4, y + 4, cellW - 8, cellH - 8, undefined, 'FAST'); }
    catch { /* skip an un-embeddable chart */ }
  });

  return y + cellH + 14;   // advance past the last row
}

function drawEndOfReport(doc: jsPDF, snap: ReportSnapshot, startY: number) {
  const y = startY + 12;
  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(BLACK);
  doc.text('Thanks for Reference', MARGIN_X, y);
  // Admin-configurable marker — defaults to "****End of Report****".
  // Preliminary reports get an explicit "PRELIMINARY" wrapper.
  const marker = snap.isPartial
    ? `**** End of Preliminary Report ****`
    : theme.endOfReportText;
  doc.text(marker, A4.w / 2, y, { align: 'center' });
}

// ──────────────────────────────────────────────────────────────
// Three-column signature footer — runs on every page
// ──────────────────────────────────────────────────────────────

function drawSignatureFooter(
  doc: jsPDF,
  practice: NonNullable<ReportPdfInput['practice']>,
  snap: ReportSnapshot
) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    drawSigFooterPage(doc, practice, snap, i, total);
  }
}

function drawSigFooterPage(
  doc: jsPDF,
  practice: NonNullable<ReportPdfInput['practice']>,
  snap: ReportSnapshot,
  pageNo: number,
  pageTotal: number
) {
  const sigY = A4.h - 118;
  const sigsW = A4.w - 2 * MARGIN_X;
  const colW = sigsW / 3;

  // Prefer template-supplied signatures (admin-editable JSON array); the
  // legacy flat practice shape is the fallback when no template is set.
  const sigs: ReportSignature[] = theme.signatures.length > 0
    ? theme.signatures.slice(0, 3)
    : [
        { name: practice.sigLabTechName,      title: practice.sigLabTechTitle      },
        { name: practice.sigPathologist1Name, title: practice.sigPathologist1Title },
        { name: practice.sigPathologist2Name, title: practice.sigPathologist2Title },
      ];

  sigs.forEach((s, i) => {
    if (!s.name && !s.signatureUrl) return;
    const cx = MARGIN_X + i * colW;
    const px = cx + colW / 2;
    const baseY = sigY;
    // Signature image wins; without one we draw the faint scribble placeholder
    // so the column still reads as a sign-off zone. A per-validator signature
    // (data URL) is already embedded and used directly; template-configured
    // upload URLs come pre-fetched from IMG_CACHE.
    const sigSrc = s.signatureUrl
      ? (s.signatureUrl.startsWith('data:') ? s.signatureUrl : IMG_CACHE[s.signatureUrl])
      : null;
    if (sigSrc) {
      try {
        const sigW = 70, sigH = 24;
        doc.addImage(sigSrc, 'PNG', px - sigW / 2, baseY - sigH + 4, sigW, sigH, undefined, 'FAST');
      } catch {
        drawSigScribble(doc, px, baseY);
      }
    } else {
      drawSigScribble(doc, px, baseY);
    }

    if (s.name) {
      doc.setFont(PDF_FONT, 'bold');
      doc.setFontSize(10);
      doc.setTextColor(BLACK);
      doc.text(s.name, px, baseY + 18, { align: 'center' });
    }

    if (s.title) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(`(${s.title})`, px, baseY + 30, { align: 'center' });
    }
    if (s.regNo) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(`Reg. ${s.regNo}`, px, baseY + 40, { align: 'center' });
    }
  });

  // Disclaimer + footer text — full-width in the band between the signatures
  // and the date strip. Only on the last page so it doesn't repeat ad nauseam
  // on multi-page reports.
  if (pageNo === pageTotal) {
    // Baseline of the lowest disclaimer line sits just above the date strip
    // (drawn at A4.h - 30); lines stack upward from there.
    let extraY = A4.h - 40;
    if (theme.disclaimer) {
      doc.setFont(PDF_FONT, 'italic');
      doc.setFontSize(7);
      doc.setTextColor(TEXT_DIM);
      const lines: string[] = doc.splitTextToSize(theme.disclaimer, A4.w - 2 * MARGIN_X);
      for (let i = lines.length - 1; i >= 0; i--) {
        doc.text(lines[i], MARGIN_X, extraY);
        extraY -= 8.5;
      }
      extraY -= 2; // small gap above the disclaimer for the footer line
    }
    if (theme.footerText) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(theme.footerText, MARGIN_X, extraY);
    }
  }

  // Bottom strip: "Generated on : <date>" on the left, "Page N of M" on the right
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, A4.h - 30, A4.w - MARGIN_X, A4.h - 30);

  doc.setFont(PDF_FONT, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(BLACK);
  doc.text(`Generated on :  ${formatShort(new Date().toISOString())}`, MARGIN_X, A4.h - 18);
  doc.text(`Page ${pageNo} of ${pageTotal}`, A4.w - MARGIN_X, A4.h - 18, { align: 'right' });

  // Blue band at the bottom (Drlogy "Sample Collection" strip).
  // Admin toggles via template.showSampleCollectionBand.
  if (theme.showSampleBand && snap.patient?.phone) {
    doc.setFillColor(BLUE);
    doc.rect(0, A4.h - 12, A4.w, 12, 'F');
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor('#ffffff');
    doc.text(`Sample Collection  ${snap.patient.phone}`, A4.w / 2, A4.h - 3.5, { align: 'center' });
  }

  // Optional Powered-by footnote (last page only)
  if (theme.showPoweredBy && pageNo === pageTotal && !theme.showSampleBand) {
    doc.setFont(PDF_FONT, 'italic');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_DIM);
    doc.text('Powered by Prefrontal LMS', A4.w / 2, A4.h - 4, { align: 'center' });
  }

  // Optional watermark — drawn behind everything (this runs per-page).
  if (theme.watermarkText && pageNo === 1) {
    const wm = theme.watermarkText;
    const op = theme.watermarkOpacity;
    // jsPDF doesn't expose a true alpha for text directly without GState;
    // emulate via a very light grey color computed from the opacity.
    const lighten = (1 - op) * 255;
    const grey = Math.round(lighten).toString(16).padStart(2, '0');
    const wmColor = `#${grey}${grey}${grey}`;
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(48);
    doc.setTextColor(wmColor);
    // Rotate 30deg around page center
    const cx = A4.w / 2;
    const cy = A4.h / 2;
    doc.text(wm, cx, cy, { align: 'center', angle: 30 });
  }
}

/** Add a new page and redraw the per-page furniture (letterhead etc.
 *  are not repeated — Drlogy reports keep the body pages clean and
 *  rely on the bottom strip alone). */
function newPage(doc: jsPDF, _practice: NonNullable<ReportPdfInput['practice']>): number {
  doc.addPage();
  return MARGIN_TOP + 10;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

/** Result is right-aligned, unit/range center-aligned, text/flag left. */
function alignFor(type: string): 'left' | 'right' | 'center' {
  if (type === 'result') return 'left';
  if (type === 'unit' || type === 'range') return 'left';
  return 'left';
}

/** Union of the typed columns (result / range / unit) across every test's
 *  resolved layout, in the conventional Result → Reference Value → Unit order.
 *  Becomes the single column template the whole report is laid out against. */
function buildCanonicalColumns(
  resolvedLayouts: Record<string, ResolvedReportLayout>
): { type: 'result' | 'range' | 'unit'; label: string }[] {
  const seen = new Set<string>();
  for (const lay of Object.values(resolvedLayouts ?? {})) {
    for (const c of lay.columns ?? []) {
      if (c.type === 'result' || c.type === 'range' || c.type === 'unit') seen.add(c.type);
    }
  }
  const out: { type: 'result' | 'range' | 'unit'; label: string }[] = [];
  if (seen.has('result')) out.push({ type: 'result', label: 'Result' });
  if (seen.has('range'))  out.push({ type: 'range',  label: 'Reference Value' });
  if (seen.has('unit'))   out.push({ type: 'unit',   label: 'Unit' });
  return out;
}

/** Reorder a column list into the conventional Drlogy lab-report
 *  arrangement: result first, then reference range (right next to the
 *  value so the eye can compare them), then unit. Text/flag columns
 *  preserve their original relative position around the typed core. */
function drlogyOrderedColumns(cols: ReportColumn[]): ReportColumn[] {
  // Build a position map so non-typed columns retain their relative order
  // (e.g. an admin-added "Method" text column stays after the unit, where
  // they placed it).
  const result = cols.find(c => c.type === 'result');
  const range  = cols.find(c => c.type === 'range');
  const unit   = cols.find(c => c.type === 'unit');
  const flag   = cols.find(c => c.type === 'flag');
  if (!result && !range && !unit) return cols;
  const typedSet = new Set<ReportColumn>([result, range, unit, flag].filter(Boolean) as ReportColumn[]);
  const ordered: ReportColumn[] = [];
  if (result) ordered.push(result);
  if (range)  ordered.push(range);
  if (unit)   ordered.push(unit);
  if (flag)   ordered.push(flag);
  // Append any remaining (text) columns in their original order.
  cols.forEach(c => { if (!typedSet.has(c)) ordered.push(c); });
  return ordered;
}

/** Drlogy-style column header label. Renames the server's "Reference
 *  range" to "Reference Value" (the term Drlogy uses on its PDFs);
 *  falls back to title-casing the layout's original label for anything
 *  custom. */
function drlogyLabelFor(c: ReportColumn): string {
  if (c.type === 'range') return 'Reference Value';
  return titleCaseHeader(c.label);
}

function titleCaseHeader(label: string): string {
  // Drlogy uses title case ("Investigation", "Result", "Reference Value", "Unit").
  // The admin layout sometimes ships caps ("REFERENCE RANGE") — gently normalise.
  if (!label) return '';
  return label
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** A resolved 'result' cell sometimes arrives as the whole enriched value
 *  object JSON ({value,flag,range,unit,segment}) instead of just the value
 *  (layout engine put the object in the result column). Unwrap value + flag. */
function coerceResultCell(raw: unknown): { value: string; flag: string } {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try {
      const o = JSON.parse(s) as { value?: unknown; flag?: string };
      return { value: o.value == null ? '' : String(o.value), flag: (o.flag ?? '').toUpperCase() };
    } catch { /* fall through */ }
  }
  return { value: s, flag: '' };
}

/** Unwrap any cell to its .value text when it's an enriched object JSON. */
function coerceCellText(raw: unknown): string {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try { const o = JSON.parse(s) as { value?: unknown }; return o.value == null ? '' : String(o.value); }
    catch { /* fall through */ }
  }
  return s;
}

function flagLabel(r: ResolvedRow): string {
  if (!r.color) return '';
  const c = r.color.toLowerCase();
  if (c.includes('dc26') || c.includes('ef44') || c.includes('red') || c.includes('b91c')) return 'High';
  if (c.includes('2563') || c.includes('3b82') || c.includes('blue')) return 'Low';
  return '';
}

function zoneHexForPdf(token: string): string {
  if (token === 'red')    return '#fecaca';
  if (token === 'orange') return '#fed7aa';
  if (token === 'green')  return '#bbf7d0';
  return token.startsWith('#') ? token : '#e2e8f0';
}

/** "hemoglobin_a1c" → "Hemoglobin A1c". */
function humanize(s: string): string {
  if (!s) return '—';
  if (/\s/.test(s) || /^[A-Z]/.test(s)) return s;
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase());
}

function parseSnapshot(raw: string | null | undefined): ReportSnapshot {
  if (!raw) return {};
  try { return JSON.parse(raw) as ReportSnapshot; } catch { return {}; }
}

function groupBy<T>(items: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(item);
  }
  return out;
}

/** Admin-configurable date/time stamp. Token-based formatting (NOT .NET):
 *   'dd MMM yyyy'   → "14 May 2026"
 *   'dd/MM/yyyy'    → "14/05/2026"
 *   'MMM dd, yyyy'  → "May 14, 2026"
 *   'yyyy-MM-dd'    → "2026-05-14"
 *   Time format: 'none' | '12h' (e.g. "10:59 PM") | '24h' (e.g. "22:59").
 *   Joined by `theme.dateTimeSeparator` when both shown. */
function formatShort(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mmNum = String(d.getMonth() + 1).padStart(2, '0');
  const mmm = months[d.getMonth()];
  const yyyy = String(d.getFullYear());

  let datePart: string;
  switch (theme.dateFormat) {
    case 'dd/MM/yyyy':   datePart = `${dd}/${mmNum}/${yyyy}`; break;
    case 'MMM dd, yyyy': datePart = `${mmm} ${dd}, ${yyyy}`;  break;
    case 'yyyy-MM-dd':   datePart = `${yyyy}-${mmNum}-${dd}`; break;
    case 'dd MMM yyyy':
    default:             datePart = `${dd} ${mmm} ${yyyy}`;
  }

  if (theme.timeFormat === 'none') return datePart;

  const min = String(d.getMinutes()).padStart(2, '0');
  let timePart: string;
  if (theme.timeFormat === '24h') {
    timePart = `${String(d.getHours()).padStart(2, '0')}:${min}`;
  } else {
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    timePart = `${String(h).padStart(2, '0')}:${min} ${ampm}`;
  }
  return `${datePart}${theme.dateTimeSeparator}${timePart}`;
}
