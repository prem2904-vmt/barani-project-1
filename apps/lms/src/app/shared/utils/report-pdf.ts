import { jsPDF } from 'jspdf';
import { drawTextWithSuperscripts, hasSuperscript, installPdfTextSanitizer, pdfSafeText } from './pdf-text';
import autoTable from 'jspdf-autotable';
import JsBarcode from 'jsbarcode';
import {
  DEFAULT_RESULT_COLUMNS,
  ReportColumn,
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../models/report-layout.model';
import { ReportSignature, ReportTemplate } from '../models/report.model';
import { flagCodeOf, savedFlagOf, type SavedFlag } from './result-flag';

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
  /** Admin live-preview: keep every configured column visible even when empty. */
  previewKeepEmptyColumns?: boolean;
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
    /** Human order number (LAB-2608-000042) — the report barcode encodes it. */
    orderNumber?: string | null;
    createdAt?: string;
    priority?: string;
    refDoctorName?: string;
    /** Referral + collection details, placeable in the patient block. */
    refHospitalName?: string | null;
    branchName?: string | null;
    collectedBy?: string | null;
    collectedAt?: string | null;
    /** Comma-joined distinct department names across the order's samples. */
    departments?: string | null;
  };
  type?: string;
  isPartial?: boolean;
  /** Present only on a corrected re-issue. Audit metadata — deliberately NOT printed on the page. */
  amendment?: {
    isAmended?: boolean;
    reason?: string;
    supersedesReleasedAt?: string;
  } | null;
  pendingDepts?: string[];
  tests?: Array<{
    /** Tech attachments marked show — printed as an images block. */
    images?: string[] | null;
    /** Per-REPORT value picker: parameter names the tech unticked for this
     *  order — their rows never print (bench record keeps them). */
    hidden?: string[] | null;
    testId?: string;
    name?: string;
    department?: string;
    departmentCode?: string;
    /** The tube's sample ID — shown on the department band. */
    sampleId?: string | null;
    /** Profile linkage: tests ordered through a profile carry the profile's
     *  test id + name and are compiled into ONE panel under that name. */
    packageTestId?: string | null;
    packageName?: string | null;
    /** Bundle type of packageTestId ('profile'|'package'); null on legacy
     *  snapshots, which then keep the old group-by-bundle behaviour. */
    packageType?: string | null;
    /** Nearest enclosing PROFILE the leaf came through (package members). */
    profileTestId?: string | null;
    profileName?: string | null;
    /** Timed-series time point (minutes from the first draw) — set when the
     *  test was drawn as one point of a repetitive profile. Disambiguates the
     *  SAME test repeated across time points inside one profile block. */
    repeatOffsetMin?: number | null;
    /** Specimen / sample type — pulled from TestEntity.Parameters JSON
     *  during snapshot build. Rendered in the continuous results table's
     *  Specimen column (once, on the test's first parameter row). */
    sampleType?: string | null;
    status?: string;
    result?: Record<string, unknown> | null;
    resultedAt?: string;
    validatedAt?: string;
    /** Tech's overall observation(s) written at result entry (OPS-56) —
     *  clinical notes rendered as italic lines under the test's rows. */
    observations?: string[] | null;
    /** NABL accreditation scope for this test. When `false`, the test is
     *  segregated into a separate "Tests not under NABL scope" section
     *  (NABL 133 — non-accredited tests must be separated, not asterisked).
     *  Undefined ⇒ treated as in-scope so we never make a false claim. */
    nablScope?: boolean;
    /** Referral / subcontracted lab name. When present we print
     *  "Tested at: {referralLab}" under the panel header (ISO 15189 7.4.1.6). */
    referralLab?: string | null;
    /** Analytical method (e.g. "Photometry"). Rendered as a dim sub-line
     *  under the panel header when the template's `showMethod` is on. This is
     *  the TEST-level default; see `valueMethods`. */
    method?: string | null;
    /** EFFECTIVE method per value (hybrid, TM rule 6):
     *  `{ paramName: value.methodology ?? test.Methodology }`. Where present
     *  it wins over `method` for that value's row. */
    valueMethods?: Record<string, string> | null;
    /** Test Master identity fields — selectable as report columns. */
    code?: string | null;
    shortName?: string | null;
    section?: string | null;
  }>;
  /** Per-report signatories (validating pathologist + resulting technician),
   *  injected server-side from the users who signed off. When present, the PDF
   *  prefers these over the admin template signature slots. Each `signatureUrl`
   *  is a base64 data URL (already embedded — no prefetch needed). */
  signatures?: ReportSignature[];
  /** Per-department signatories (that department's technician + consultant),
   *  drawn at the end of each department's block. When present, the global
   *  per-page signature row is suppressed. */
  deptSignatures?: Array<{ department?: string; signatures?: ReportSignature[] }>;
}

// ── Page geometry ─────────────────────────────────────────────────
// MARGIN_TOP / MARGIN_BOTTOM are `let` because the pre-printed-letterpad mode
// overrides them per render (the blank top/bottom space the lab's stationery
// occupies). They reset to these defaults at the start of every non-letterpad
// render. HEADER_RESERVE is the drawn-letterhead height the patient block sits
// below — 0 in letterpad mode (no header is drawn).
const A4 = { w: 595.28, h: 841.89 };
const MARGIN_X = 30;

/** True when a sampleType names a CONCRETE specimen. Catalogue mapping
 *  placeholders ("As per Test–Specimen Mapping", "As applicable") mean no
 *  specimen was chosen for the test — they must never print as one. */
function isConcreteSpecimen(s: string): boolean {
  return s.length > 0 && !/^as\s+(per|applicable)/i.test(s);
}
/** Barcode height in points. 26pt ≈ 9.2mm: tall enough to scan reliably at
 *  counter range, while leaving room for the three timestamp lines inside the
 *  80pt header block. (12mm would be ideal in isolation but crowds the block.)
 *  Width is NOT reduced — at the full column the narrow bar is 0.254mm, just
 *  over the 0.25mm ISO floor; narrowing it is what actually breaks scanning. */
const BARCODE_H = 26;
/** Clearance under the barcode before the next line of text. addImage is
 *  TOP-anchored and text is BASELINE-anchored, so this has to cover the
 *  following line's ascent — 6pt alone let the timestamps print over the bars. */
const BARCODE_GAP = 14;
let MARGIN_TOP = 28;
let MARGIN_BOTTOM = 150; // table floor — the band signatures are pulled DOWN into (see FOOTER_RESERVE)
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
let PREVIEW_KEEP_EMPTY_COLS = false; // admin preview: show configured columns even when empty
let CANON_COLS: { type: 'result' | 'range' | 'unit'; label: string }[] = [];
/** Lookup of pre-fetched image data URLs for the current render. Set
 *  inside buildReportPdf from input.imageCache. */
let IMG_CACHE: Record<string, string> = {};
/** Template logo URL for the page-1 watermark combination (set per build). */
let WM_LOGO_URL: string | null = null;

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
    // Accept ANY column count. The admin arranger saves 4 columns for the
    // four-col layout and 1 for stacked; requiring exactly 3 silently threw
    // those away and fell back to the hardcoded renderer, so the admin's
    // arrangement appeared not to save.
    if (Array.isArray(arr) && arr.length >= 1 && arr.every(c => Array.isArray(c))) {
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
  // Built-in PDF fonts are cp1252-only: superscripts (×10⁹/L), subscripts
  // (CO₂) and Greek (β-hCG) would otherwise print as garbage. One wrapper on
  // doc.text covers every draw here AND inside jspdf-autotable.
  installPdfTextSanitizer(doc);
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
  PREVIEW_KEEP_EMPTY_COLS = !!input.previewKeepEmptyColumns;
  if (LETTERPAD) {
    MARGIN_TOP = Math.max(0, template?.letterpadHeaderMm ?? 45) * MM_TO_PT;
    MARGIN_BOTTOM = Math.max(20, template?.letterpadFooterMm ?? 30) * MM_TO_PT;
    HEADER_RESERVE = 0;
  } else {
    MARGIN_TOP = 28;
    MARGIN_BOTTOM = 150;
    HEADER_RESERVE = 70;
  }

  // ── Department-specific patient strip (owner's model, 2026-09-19) ──
  // Each department may carry its own patient-block arrangement on its
  // resolved layout. It applies ONLY when every test on this report
  // resolves to that one department (a Micro-only report prints Micro's
  // strip); mixed-department reports keep the tenant default, since the
  // strip prints once for the whole document.
  {
    const layouts = (snap.tests ?? []).map(t => (t.testId ? resolvedLayouts[t.testId] : undefined));
    const deptNames = new Set(layouts.map(l => l?.departmentName ?? '\u0000missing'));
    if (layouts.length > 0 && deptNames.size === 1 && !deptNames.has('\u0000missing')) {
      const strip = layouts[0]?.patientStrip;
      if (strip && Array.isArray(strip.columns) && strip.columns.some(c => Array.isArray(c) && c.length > 0)) {
        theme.patientColumns = strip.columns.map(c => [...c]);
        if (strip.layout) theme.patientLayout = strip.layout as ResolvedTheme['patientLayout'];
      }
    }
  }

  WM_LOGO_URL = template?.logoUrl ?? null;
  drawLetterhead(doc, practice, template?.logoUrl ?? null);
  const patientBottom = drawCustomPatientFields(doc, snap, drawPatientBlock(doc, snap, report));

  // No amended-report banner on the printed page (owner's call, 2026-08-16):
  // the patient-facing document shows only the corrected values and its own
  // Reported-on time. The amendment trail lives in the data — snap.amendment,
  // AmendedBy/AmendmentReason on the report row, the result versions and the
  // order activity — where the audit needs it.
  let cursorY = patientBottom + 14;

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
    // A test ordered THROUGH a profile never prints its own narrative notes —
    // the profile's print instead (see the merge below) — so its layout can't
    // pull it out of the columnar table. Without this, a member that merely
    // carries a note escaped the merge and printed as a standalone block.
    // Image sections don't count: every attachments-enabled test carries an
    // Images block in its layout, and that alone must not pull a plain
    // numeric test out of the columnar table.
    const narrative = !t.packageTestId
      && !!layout && layout.sections.some(s => s.isVisible && s.type !== 'grid' && s.type !== 'image');
    if ((t.result as { microFormat?: string } | null)?.microFormat === 'culture_sensitivity') {
      special.push(t);
    } else if (narrative) {
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
  //
  // Tests ordered through a PROFILE (packageTestId) are COMPILED into one
  // panel under the profile's name — "Liver Function Test" with its members
  // as rows — instead of every member listing as its own standalone test.
  const groups: PanelGroup[] = [];
  const byPkg = new Map<string, PanelGroup>();
  /** Profile id → the profile's OWN note rows, appended after its members. */
  const profileNotes = new Map<string, PanelRowData[]>();
  // Timed-series disambiguation: within one profile block, the SAME test can
  // legitimately repeat across time points (OGTT: Glucose at 0/60/120). Only
  // then does the row name gain a " (60 min)" suffix — self-naming members
  // ("OGTT – 30 Minutes") stay untouched. Pre-pass counts names per bundle.
  const seriesDupNames = new Map<string, Set<string>>();
  {
    const counts = new Map<string, Map<string, number>>();
    for (const t of tabular) {
      if (t.repeatOffsetMin == null) continue;
      const legacy = t.packageType == null;
      const b = t.profileTestId
        ?? (t.packageType === 'profile' ? t.packageTestId : null)
        ?? (legacy ? t.packageTestId : null);
      if (!b) continue;
      const key = (t.name ?? '').trim().toUpperCase();
      const m = counts.get(b) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      counts.set(b, m);
    }
    for (const [b, m] of counts) {
      const dups = new Set([...m].filter(([, n]) => n > 1).map(([k]) => k));
      if (dups.size) seriesDupNames.set(b, dups);
    }
  }
  const seriesSuffix = (t: (typeof tabular)[number], bundle: string | null): string => {
    if (t.repeatOffsetMin == null || !bundle) return '';
    return seriesDupNames.get(bundle)?.has((t.name ?? '').trim().toUpperCase())
      ? ` (${t.repeatOffsetMin} min)` : '';
  };
  // Tech observations (OPS-56) → italic note rows appended after a test's
  // parameter rows. Prefixed "Note:" so a clinical remark reads distinctly
  // from the admin-authored narrative/interpretation paragraphs.
  const obsRowsFor = (t: (typeof tabular)[number]): PanelRowData[] =>
    (t.observations ?? [])
      .map(o => (o ?? '').trim())
      .filter(Boolean)
      .map(o => ({ kind: 'note', note: `Note: ${o}` }));
  // Profile members' observations belong under the profile block; collect them
  // per bundle and append after the member rows (like profileNotes).
  const profileObs = new Map<string, PanelRowData[]>();
  for (const t of tabular) {
    const g = buildPanelGroup(t, t.testId ? resolvedLayouts[t.testId] : undefined);
    g.sampleId = t.sampleId ?? undefined;
    // The panel a member compiles under is the BENCH bundle: its nearest
    // PROFILE. A package's name never appears on a report — a package is
    // billing vocabulary; the report speaks in profiles and individual tests.
    // So a package's direct members print standalone, its profile members
    // compile under the profile, and only legacy snapshots (no packageType)
    // keep the old group-by-ordered-bundle behaviour.
    const legacy = t.packageType == null;
    const pkg = t.profileTestId
      ?? (t.packageType === 'profile' ? t.packageTestId : null)
      ?? (legacy ? t.packageTestId : null)
      ?? null;
    const pkgName = t.profileTestId ? (t.profileName || t.packageName) : t.packageName;
    if (!pkg) { g.rows.push(...obsRowsFor(t)); groups.push(g); continue; }
    // Stash this member's observations for the profile block (appended below).
    const memberObs = obsRowsFor(t);
    if (memberObs.length) {
      const arr = profileObs.get(pkg) ?? [];
      arr.push(...memberObs);
      profileObs.set(pkg, arr);
    }
    let merged = byPkg.get(pkg);
    if (merged && g.sampleId && !merged.sampleIds?.includes(g.sampleId)) {
      (merged.sampleIds ??= []).push(g.sampleId);
    }
    if (!merged) {
      // Method varies per member — a single method claim on the profile band
      // would be wrong, so the merged panel carries none.
      merged = { ...g, testName: pkgName || g.testName, method: undefined, methodLine: undefined, rows: [],
        sampleIds: g.sampleId ? [g.sampleId] : [] };
      // Column cascade for the BLOCK: the PROFILE's own override wins for
      // the whole block; a member's override never leaks into it — the
      // block falls back to the member's department columns instead.
      const pkgLayout = resolvedLayouts[pkg];
      if (pkgLayout?.hasColumnOverride) {
        merged.columns = pkgLayout.columns;
        merged.columnsOverridden = true;
        merged.deptColumns = pkgLayout.departmentColumns ?? undefined;
      } else {
        merged.columns = g.columnsOverridden ? (g.deptColumns ?? []) : g.columns;
        merged.columnsOverridden = undefined;
        merged.deptColumns = undefined;
      }
      byPkg.set(pkg, merged);
      groups.push(merged);
      // NOTES FOLLOW WHAT WAS ORDERED: the profile was ordered, so the
      // PROFILE's own notes print here. Members' notes are dropped below.
      // (Order a member on its own and it keeps its notes — the same test
      // reads differently depending on how it was ordered.)
      const pkgNotes = (resolvedLayouts[pkg]
        ? buildPanelGroup({ ...t, testId: pkg, name: pkgName ?? '' } as typeof t, resolvedLayouts[pkg]).rows
        : []).filter(r => r.kind === 'note');
      profileNotes.set(pkg, pkgNotes);
    }
    // Drop the member's OWN notes — they belong to it only when ordered alone.
    const memberRows = g.rows.filter(r => r.kind !== 'note');
    const suffix = seriesSuffix(t, pkg);
    if (memberRows.length === 0 && t.repeatOffsetMin != null) {
      // A missed/unresulted series time point still occupies its row in the
      // schedule — the clinician must SEE that the point exists and was not
      // measured, not wonder whether it was ever ordered.
      merged.rows.push({ kind: 'param', name: `${g.testName}${suffix}`, result: '—' });
      continue;
    }
    if (memberRows.length === 1 && memberRows[0].kind === 'param') {
      // Single-analyte member → one row named after the member test.
      merged.rows.push({ ...memberRows[0],
        name: (((memberRows[0].name ?? '').trim() || g.testName) + suffix) });
    } else if (suffix) {
      // Multi-analyte series member: every row carries the time point, else
      // the repeated analytes are indistinguishable inside the block.
      merged.rows.push(...memberRows.map(r =>
        r.kind === 'param' ? { ...r, name: `${(r.name ?? '').trim()}${suffix}` } : r));
    } else {
      merged.rows.push(...memberRows);
    }
  }
  // Append each profile's own notes AFTER its member rows.
  for (const [pkg, notes] of profileNotes) {
    const panel = byPkg.get(pkg);
    if (panel && notes.length) panel.rows.push(...notes);
  }
  // Then the members' tech observations (OPS-56), after the notes.
  for (const [pkg, obs] of profileObs) {
    const panel = byPkg.get(pkg);
    if (panel && obs.length) panel.rows.push(...obs);
  }

  // The profile's own NARRATIVE notes (the "Interpretation" paragraphs the
  // notes editor writes) render once under the profile's name, after the
  // table — the same place a standalone test's narrative goes. Profiles have
  // no row of their own in the snapshot, so stand one in from a member.
  const benchBundles = new Map<string, (typeof tests)[number]>();
  for (const t of tests) {
    const legacy = t.packageType == null;
    const b = t.profileTestId
      ?? (t.packageType === 'profile' ? t.packageTestId : null)
      ?? (legacy ? t.packageTestId : null);
    if (b && !benchBundles.has(b)) benchBundles.set(b, t);
  }
  for (const [pkg, member] of benchBundles) {
    const pl = resolvedLayouts[pkg];
    // Only when there is something to PRINT. A visible-but-empty paragraph
    // (the notes editor saves a blank one freely) used to sail through and
    // render the profile's name as a big lone heading after the table.
    const hasNarrative = pl?.sections.some(s =>
      s.isVisible && s.type !== 'grid' && (
        (s.type === 'paragraph' && !!s.content?.trim()) ||
        (s.type === 'image' && (s.imageUrls?.length ?? 0) > 0) ||
        (s.type === 'chart' && !!s.chart)
      ));
    if (!hasNarrative) continue;
    special.push({ ...member, testId: pkg, packageTestId: null, profileTestId: null,
                   name: (member.profileTestId === pkg ? member.profileName : member.packageName)
                         || pl.testName || '' });
  }

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

  // Per-department signatories: that department's technician + consultant sign
  // at the end of their OWN block.
  const deptSigs = new Map<string, ReportSignature[]>();
  for (const d of snap.deptSignatures ?? []) {
    if (d.department && d.signatures?.length) deptSigs.set(d.department.trim(), d.signatures);
  }

  // The report's very last department signs AFTER the "End of Report" marker
  // (deferred via this collector) — every earlier department still signs
  // inline at the end of its own block.
  const finalSigs: { sigs: ReportSignature[] | null } = { sigs: null };
  if (inScope.length > 0) {
    cursorY = renderContinuousTable(doc, inScope, cursorY, practice, null, deptSigs,
      outScope.length === 0 ? finalSigs : undefined);
  }
  if (outScope.length > 0) {
    cursorY = renderScopeHeading(doc, 'TESTS NOT UNDER NABL SCOPE', cursorY + 6, practice);
    cursorY = renderContinuousTable(doc, outScope, cursorY, practice, null, deptSigs, finalSigs);
  }

  // Tech attachments for TABULAR tests — the columnar table has no
  // per-test section hook, so their shown images print here, labelled.
  // The Test Master's Images block is the print switch: hidden (all image
  // sections invisible) = lab-only traceability, nothing on the PDF.
  for (const t of tabular) {
    const imgs = (t as { images?: string[] | null }).images ?? [];
    if (!imgs.length) continue;
    const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
    const imgSecs = layout?.sections.filter(s => s.type === 'image') ?? [];
    if (imgSecs.length > 0 && !imgSecs.some(s => s.isVisible)) continue;
    if (cursorY > A4.h - MARGIN_BOTTOM - 120) { cursorY = newPage(doc, practice); }
    cursorY = drawImagesBlock(doc, imgs, cursorY + 4, practice, `${t.name ?? 'Test'} — images`);
  }

  // Narrative + microbiology blocks after the columnar results.
  // Canonical columns (already computed above) feed any grid section embedded
  // in a narrative test.
  for (const t of special) {
    const layout = t.testId ? resolvedLayouts[t.testId] : undefined;
    if (cursorY > A4.h - MARGIN_BOTTOM - 90) { cursorY = newPage(doc, practice); }
    if ((t.result as { microFormat?: string } | null)?.microFormat === 'culture_sensitivity') {
      cursorY = renderCultureSection(doc, t, cursorY, practice, layout);
    } else if (layout && layout.sections.length > 0) {
      cursorY = renderResolvedTest(doc, t, layout, cursorY, practice);
    } else {
      cursorY = renderLegacyTest(doc, t, cursorY, practice);
    }
    {
      const imgs = (t as { images?: string[] | null }).images ?? [];
      const imgSecs = layout?.sections.filter(s => s.type === 'image') ?? [];
      const drawnInLayout = imgSecs.some(s => s.isVisible && (s.imageUrls?.length ?? 0) > 0);
      // All image sections hidden = the admin cut them from the PDF on
      // purpose (lab-only traceability) — no fallback either.
      const suppressed = imgSecs.length > 0 && !imgSecs.some(s => s.isVisible);
      if (imgs.length && !drawnInLayout && !suppressed) {
        cursorY = drawImagesBlock(doc, imgs, cursorY + 2, practice, `${t.name ?? 'Test'} — images`);
      }
    }
    cursorY += 10;
  }

  // Culture/narrative-only reports never enter the columnar table — the only
  // place department signatories are drawn — so their sign-off block used to
  // vanish entirely. Collect the special tests' department signatures and
  // defer them below the End-of-Report marker like any final department.
  if (inScope.length === 0 && outScope.length === 0 && special.length > 0 && !finalSigs.sigs) {
    const sigs: ReportSignature[] = [];
    const seen = new Set<string>();
    for (const t of special) {
      for (const sg of deptSigs.get((t.department ?? '').trim()) ?? []) {
        const k = `${sg.name ?? ''}|${sg.signatureUrl ?? ''}`;
        if (!seen.has(k)) { seen.add(k); sigs.push(sg); }
      }
    }
    if (sigs.length) finalSigs.sigs = sigs;
  }

  // (Pending-departments banner intentionally NOT printed — a preliminary
  // report should read clean; the "End of Preliminary Report" marker already
  // signals more results are coming.)

  // ── Trendogram charts (serial-result trends), 2-per-row, up to 6/page ──
  if (input.trendograms?.length) {
    if (cursorY > A4.h - MARGIN_BOTTOM - 200) { cursorY = newPage(doc, practice); }
    cursorY = renderTrendogramSection(doc, input.trendograms, cursorY, practice);
  }

  // ── "Thanks for Reference  ...  ****End of Report****" line ────
  if (cursorY > A4.h - MARGIN_BOTTOM - 26) { cursorY = newPage(doc, practice); }
  cursorY = drawEndOfReport(doc, snap, cursorY);

  // The final department's signatories sign BELOW the End-of-Report marker —
  // the marker closes the results; the signatures authorise the document.
  if (finalSigs.sigs?.length) {
    // Sign-off belongs at the FOOT of the page, immediately above the
    // disclaimer/footer strip — the conventional lab-report format — not
    // floating directly under the last result row with a blank half-page
    // beneath it. Anchor to the bottom, but never pull the block UP into
    // content: a long report that already reaches this far keeps flowing.
    // Ends flush on the footer band — directly above the disclaimer line.
    // Height comes from the block itself: 1-3 signatories are one row,
    // 4-7 wrap 3-up into more rows, and the anchor rises to fit them so the
    // LAST row still lands on the footer band.
    const anchored = Math.max(cursorY, A4.h - FOOTER_RESERVE - signatureBlockHeight(finalSigs.sigs));
    cursorY = drawInlineSignatures(doc, finalSigs.sigs, anchored, practice);
  }

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

  // Result attachments: snapshot-level (tabular fallback) + any resolved
  // image sections (positioned by the test's layout).
  try {
    const snap = JSON.parse(input.report.data ?? '{}') as ReportSnapshot;
    for (const t of snap.tests ?? []) for (const u of t.images ?? []) urls.add(u);
  } catch { /* malformed snapshot — images just won't preload */ }
  for (const l of Object.values(input.resolvedLayouts ?? {})) {
    for (const sec of l.sections ?? []) for (const u of sec.imageUrls ?? []) urls.add(u);
  }

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
      .filter(isConcreteSpecimen)
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
  // REAL scannable Code-128 barcode encoding the ORDER identifier (the human
  // order number, else the order GUID). Scanning it — front-desk global scan,
  // billing lookup — resolves straight to this order/patient. No digits
  // printed underneath: the code itself is the accession link.
  if (theme.showBarcode) {
    // Full column width so the bars stay above the ISO minimum; plain, no digits.
    y = drawReportBarcode(doc, snap, x3, y, col3W - 6);
  } else {
    y += 6;
  }

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
/** "Label: value" row in the patient block — label normal, value bold, matching
 *  how "Ref. By:" already prints. Skips the row entirely when there's no value
 *  so an unset field costs no vertical space. */
function drawPatientLabelled(
  doc: jsPDF, label: string, value: string | null | undefined, x: number, y: number
): number {
  const v = (value ?? '').trim();
  if (!v) return y;
  doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
  doc.text(label, x, y);
  const lw = doc.getTextWidth(label);
  doc.setFont(PDF_FONT, 'bold');
  doc.text(v, x + lw, y);
  return y + 12;
}

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
      // The human order number (LAB-2608-000049) — not a slice of the GUID,
      // which is what staff were being asked to read out loud.
      const oid = snap.order?.orderNumber?.trim() || (snap.order?.id ?? '').slice(0, 8);
      if (!oid) return y;
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
    case 'refhospital':
      return drawPatientLabelled(doc, 'Ref. Hospital: ', snap.order?.refHospitalName, x, y);
    case 'collectedby':
      return drawPatientLabelled(doc, 'Collected by: ', snap.order?.collectedBy, x, y);
    case 'department':
      return drawPatientLabelled(doc, 'Department: ', snap.order?.departments, x, y);
    case 'branch':
      return drawPatientLabelled(doc, 'Centre: ', snap.order?.branchName, x, y);
    case 'specimen': {
      const specimens = Array.from(new Set((snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(isConcreteSpecimen)));
      doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(9); doc.setTextColor(BLUE);
      doc.text('Specimen(s) :', x, y); y += 12;
      if (specimens.length) {
        doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
        const lines = doc.splitTextToSize(specimens.join(', '), colW);
        doc.text(lines, x, y); y += lines.length * 11 + 2;
      }
      return y;
    }
    case 'barcode':
      // THE path that actually runs whenever the admin has arranged the patient
      // block (patientColumnsJson set). It used to draw a DECORATIVE placeholder
      // — bars that encode nothing — plus a 12-char slice of the order GUID
      // underneath: the "random barcode with a random id below it". Now it is a
      // real Code-128 of the order number, with no digits beneath.
      return drawReportBarcode(doc, snap, x, y, Math.min(colW, 150));
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
    (snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(isConcreteSpecimen)
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
    (snap.tests ?? []).map(t => (t.sampleType ?? '').trim()).filter(isConcreteSpecimen)
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
/**
 * What the report's barcode encodes: the HUMAN order number and nothing else.
 *
 * Returns null rather than falling back to the order GUID or the report id.
 * Those fall-backs are why this bug kept coming back — they scan to something,
 * so nothing looked broken, but the code printed was an unreadable random
 * string instead of the visit's order number. A null here means "draw no
 * barcode and say so", which is loud and fixable.
 *
 * `OrderLookupService.ResolveAsync` matches this value exactly, so scanning it
 * opens the order at the front desk.
 */
export function reportBarcodeValue(snap: ReportSnapshot): string | null {
  const n = snap.order?.orderNumber?.trim();
  return n ? n : null;
}

/** Draw the report barcode: plain Code-128, no digits beneath it.
 *  12mm tall / full column so the narrow bar clears the 0.25mm ISO floor —
 *  the old 7.8mm box scanned unreliably even when the value was right. */
function drawReportBarcode(doc: jsPDF, snap: ReportSnapshot, x: number, y: number, w: number): number {
  const value = reportBarcodeValue(snap);
  if (!value) {
    // Deliberately draw NOTHING. A decorative placeholder used to be drawn
    // here, which is indistinguishable from a real code and encodes nothing.
    console.warn('[report-pdf] no order number on the snapshot — barcode omitted');
    return y;
  }
  return drawRealBarcode(doc, value, x, y, w, BARCODE_H) ? y + BARCODE_H + BARCODE_GAP : y;
}

/**
 * Superscript redraw hooks for an autoTable.
 *
 * Units such as ×10⁹/L reach the PDF as "×10^9/L" because jsPDF's built-in
 * fonts are cp1252 and have no ⁹. These two hooks turn the caret form back
 * into a real raised digit: `willDrawCell` blanks the affected cell AFTER
 * layout (so column widths are unchanged) and `didDrawCell` redraws it with
 * the digits smaller and lifted. Cells with no superscript are never touched.
 */
type SupCell = { text: string; styles: Record<string, unknown> };
type CellHookArg = {
  section: string; column: { index: number }; row: { index: number };
  cell: { x: number; y: number; width: number; height: number; text?: string[]; styles?: Record<string, unknown> };
};

function stashSuperscriptCell(store: Map<string, SupCell>, d: CellHookArg): void {
  const raw = Array.isArray(d.cell.text) ? d.cell.text.join(' ') : String(d.cell.text ?? '');
  const safe = pdfSafeText(raw);
  if (!hasSuperscript(safe)) return;
  store.set(`${d.section}:${d.row.index}:${d.column.index}`, { text: safe, styles: d.cell.styles ?? {} });
  d.cell.text = [''];
}

/**
 * Reference-range cells arrive as "13–17\nAdult Male" — the band, then the
 * patient group it applies to. When sex/age matched nothing, EVERY band comes
 * through instead ("Adult Male 13–17\nAdult Female 12–15\n…"), because naming
 * one would assert something the data doesn't support.
 *
 * The number must stay the thing a clinician reads first, so the qualifier
 * lines are drawn smaller and grey. Same trick as the superscript hooks: blank
 * the cell after layout (column widths and row heights are already computed
 * from the full text, so nothing shifts) and repaint it line by line.
 */
type QualCell = { lines: string[]; styles: Record<string, unknown> };

function stashQualifiedRangeCell(
  store: Map<string, QualCell>, d: CellHookArg, rangeColIdx: number
): void {
  if (d.section !== 'body' || d.column.index !== rangeColIdx) return;
  const lines = (Array.isArray(d.cell.text) ? d.cell.text : [String(d.cell.text ?? '')])
    .map(l => pdfSafeText(l));
  if (lines.length < 2) return;                       // plain single-band cell
  store.set(`${d.row.index}:${d.column.index}`, { lines, styles: d.cell.styles ?? {} });
  d.cell.text = [''];
}

function drawQualifiedRangeCell(
  doc: jsPDF, store: Map<string, QualCell>, d: CellHookArg
): void {
  const q = store.get(`${d.row.index}:${d.column.index}`);
  if (!q) return;
  const st = q.styles as { fontSize?: number; cellPadding?: number };
  const fs = typeof st.fontSize === 'number' ? st.fontSize : 9;
  const padL = typeof st.cellPadding === 'number' ? st.cellPadding : 4;
  const lh = fs * 1.15;
  // Vertically centre the whole stack in the cell autotable already sized.
  let y = d.cell.y + (d.cell.height - lh * q.lines.length) / 2 + fs * 0.9;

  // Every line is an EQUAL tier from the source sheet (owner's order
  // 2026-08-17: print the references as authored, aligned) — same size,
  // same left edge, uniformly dim. The old first-line-bigger treatment was
  // for "matched value + qualifier" pairs, which no longer print.
  q.lines.forEach(line => {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(fs);
    doc.setTextColor(TEXT_DIM);
    if (hasSuperscript(line)) {
      drawTextWithSuperscripts(doc, line, d.cell.x + padL, y, fs);
    } else {
      doc.text(line, d.cell.x + padL, y);
    }
    y += lh;
  });
  doc.setFontSize(fs);
  doc.setTextColor(BLACK);
}

function drawSuperscriptCell(doc: jsPDF, store: Map<string, SupCell>, d: CellHookArg): void {
  const sup = store.get(`${d.section}:${d.row.index}:${d.column.index}`);
  if (!sup) return;
  const st = sup.styles as { fontSize?: number; fontStyle?: string; textColor?: unknown; cellPadding?: number };
  const fs = typeof st.fontSize === 'number' ? st.fontSize : 9;
  doc.setFont(PDF_FONT, st.fontStyle === 'bold' ? 'bold' : 'normal');
  doc.setFontSize(fs);
  const tc = st.textColor;
  doc.setTextColor(typeof tc === 'string' ? tc
    : Array.isArray(tc) ? `#${(tc as number[]).map(n => n.toString(16).padStart(2, '0')).join('')}`
    : BLACK);
  const padL = typeof st.cellPadding === 'number' ? st.cellPadding : 4;
  drawTextWithSuperscripts(doc, sup.text, d.cell.x + padL, d.cell.y + d.cell.height / 2 + fs * 0.35, fs);
}

/** Render a REAL Code-128 barcode (via JsBarcode on an offscreen canvas) and
 *  place it on the page. Returns false when generation fails (invalid value /
 *  no DOM) so the caller can fall back to the decorative placeholder. */
function drawRealBarcode(doc: jsPDF, value: string, x: number, y: number, w: number, h: number): boolean {
  const v = (value ?? '').trim();
  if (!v || typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, v, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 60 });
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h);
    return true;
  } catch {
    return false;
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
  /** Admin-configured conditional row colour (engine palette hex) — painted
   *  verbatim on the result cell; NOT gated by the theme's flagStyle. */
  color?: string | null;
  /** Admin-configured conditional bold (condition `then.bold`). */
  bold?: boolean;
  /** Text-typed cell values keyed by column name (e.g. description) so the
   *  columnar renderer can fill admin text columns instead of leaving them
   *  permanently blank. */
  texts?: Record<string, string>;
  /** This value's EFFECTIVE method (snapshot `valueMethods`, else the test's). */
  method?: string;
}

/** The effective method of one value: the snapshot's per-value
 *  `valueMethods` (keys match parameter names; case-insensitive), else the
 *  test-level `method`. */
function methodForValue(
  t: { method?: string | null; valueMethods?: Record<string, string> | null },
  paramName: string | null | undefined,
): string | undefined {
  const vm = t.valueMethods;
  if (vm && paramName) {
    const hit = vm[paramName] ?? Object.entries(vm).find(([k]) => k.toLowerCase() === paramName.toLowerCase())?.[1];
    if ((hit ?? '').trim()) return hit!.trim();
  }
  return (t.method ?? '').trim() || undefined;
}

/** Sub-line text for a group's methods: one method → "Hexokinase"; values
 *  measured differently → "Hexokinase (Glucose) · ISE (Sodium, Potassium)". */
function methodLineOf(rows: PanelRowData[]): string | undefined {
  const byMethod = new Map<string, string[]>();
  for (const r of rows) {
    if (r.kind !== 'param' || !r.method) continue;
    const arr = byMethod.get(r.method) ?? [];
    if (r.name) arr.push(r.name);
    byMethod.set(r.method, arr);
  }
  if (byMethod.size === 0) return undefined;
  if (byMethod.size === 1) return [...byMethod.keys()][0];
  return [...byMethod].map(([m, names]) => names.length ? `${m} (${names.join(', ')})` : m).join(' · ');
}

/** Classify an engine row colour: the per-test layout conditions emit
 *  red #C0392B (abnormal-high), orange #E87722 (warn) and green #1D9E75
 *  (explicit normal). Green must never read as abnormal. */
function colorSeverity(hex: string | null | undefined): 'high' | 'warn' | 'normal' | null {
  const c = (hex ?? '').toLowerCase();
  if (!c) return null;
  if (c.includes('c0392b') || c.includes('dc26') || c.includes('ef44') || c.includes('b91c') || c.includes('red')) return 'high';
  if (c.includes('e87722') || c.includes('f97316') || c.includes('orange')) return 'warn';
  if (c.includes('1d9e75') || c.includes('16a34a') || c.includes('22c55e') || c.includes('green')) return 'normal';
  return null;
}

interface PanelGroup {
  testName: string;
  /** Department name — drives per-department section grouping + its columns. */
  department?: string;
  /** The resolved per-department column layout for this test (incl. linkedNext
   *  merges). Empty ⇒ the renderer falls back to the default layout. */
  columns?: ReportColumn[];
  /** True when `columns` is the test's OWN override (Test Master → Report
   *  columns) rather than the department flatten. Cascade rule: a profile's
   *  override wins for its whole block; a member's override applies only
   *  when the test is ordered standalone. */
  columnsOverridden?: boolean;
  /** The department's columns — present only when overridden, so the profile
   *  merge can fall back when a member's override must be ignored. */
  deptColumns?: ReportColumn[];
  specimen?: string;
  method?: string;
  /** Values measured by DIFFERENT methods (per-value `valueMethods`): the
   *  sub-line names each method with its values; the Method column prints
   *  per row. Undefined when one method covers the whole group. */
  methodLine?: string;
  code?: string;
  shortName?: string;
  section?: string;
  referralLab?: string | null;
  /** undefined ⇒ treated as in NABL scope (no claim either way). */
  inScope?: boolean;
  /** The tube's sample ID — surfaced on the department band. */
  sampleId?: string;
  /** Every tube a compiled PROFILE block spans (its members can sit in
   *  different tubes — e.g. EDTA + fluoride + serum). The band prints them all. */
  sampleIds?: string[];
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
    columnsOverridden: layout?.hasColumnOverride || undefined,
    deptColumns: layout?.departmentColumns ?? undefined,
    specimen: ((t.sampleType ?? layout?.sampleType) ?? '').trim() || undefined,
    method: (t.method ?? '').trim() || undefined,
    code: (t.code ?? '').trim() || undefined,
    shortName: (t.shortName ?? '').trim() || undefined,
    section: (t.section ?? '').trim() || undefined,
    referralLab: (t.referralLab ?? '').trim() || undefined,
    inScope: t.nablScope,
    rows: [],
  };

  const gridSections = (layout?.sections ?? []).filter(s => s.isVisible && s.type === 'grid');
  if (gridSections.length > 0) {
    // Value lookups search override ∪ department columns: a column the
    // override drops still has its cells resolved (the engine unions them),
    // and a profile block may render this member against DEPARTMENT columns.
    // Without an override, departmentColumns is absent and this is exactly
    // layout.columns — byte-identical behavior.
    const cols = [...layout!.columns, ...(layout!.departmentColumns ?? [])];
    const srcOf = (type: string): ReportColumn | undefined => cols.find(c => c.type === type);
    const resultSrc = srcOf('result'), rangeSrc = srcOf('range'), unitSrc = srcOf('unit');
    const hiddenNames = new Set((t as { hidden?: string[] | null }).hidden ?? []);
    const savedValues = (t.result?.['values'] ?? undefined) as Record<string, SavedFlag> | undefined;
    for (const sec of gridSections) {
      for (const r of sec.rows ?? []) {
        // Per-report picker: the tech unticked this value for THIS order.
        if (!r.isMerged && r.parameterName && hiddenNames.has(r.parameterName)) continue;
        if (r.isMerged) {
          const note = (r.mergeContent ?? '').trim();
          if (note) group.rows.push({ kind: 'note', note });
          continue;
        }
        const rc = coerceResultCell(resultSrc ? r.cells[resultSrc.name] : '');
        // The flag is the one mw SAVED with the result — the snapshot's
        // per-value verdict (layouts are resolved with SCALAR values, so the
        // cell rarely carries it) or an enriched cell. Single source: a row
        // colour only stands in when there is no saved verdict at all. Only
        // real abnormality letters print — 'N' (normal) must never leak onto
        // the row ("92 mg/dL N"). Same whitelist as the legacy path.
        const sv = r.parameterName ? savedFlagOf({ flagged: savedValues }, r.parameterName) : undefined;
        const hasSaved = (!!sv && typeof sv === 'object' && 'flag' in sv) || !!rc.saved;
        const savedCode = sv && typeof sv === 'object' && 'flag' in sv ? flagCodeOf(sv.flag) : flagCodeOf(rc.flag);
        const savedLetter = savedCode === 'N' ? '' : savedCode;
        const label = hasSaved ? '' : flagLabel(r);
        const letter = hasSaved ? savedLetter
          : ((label === 'High' ? 'H' : label === 'Low' ? 'L' : '') || savedLetter);
        const resultText = rc.value || (resultSrc ? String(r.cells[resultSrc.name] ?? '') : '');
        // Admin colour semantics: red/orange = abnormal; green is an explicit
        // "normal" marker and must NOT trip the abnormal styling.
        const sev = colorSeverity(r.color);
        // Collect the admin's text-typed cells (description etc.) so the
        // columnar renderer can print them.
        const texts: Record<string, string> = {};
        for (const c of cols) {
          if (c.type !== 'text') continue;
          const cellVal = coerceCellText(r.cells[c.name]);
          if (cellVal) texts[c.name] = cellVal;
        }
        group.rows.push({
          kind: 'param',
          name: r.title || humanize(r.parameterName ?? ''),
          result: resultText,
          range: coerceCellText(rangeSrc ? r.cells[rangeSrc.name] : ''),
          // Prefer the Unit column when present; otherwise fall back to the
          // parameter's own unit so EVERY department shows it (e.g. "11.4 g/dL")
          // — but never grow a unit onto a qualitative result ("Normal mg/dL").
          unit: coerceCellText(unitSrc ? r.cells[unitSrc.name] : '')
            || (looksNumeric(resultText) ? (r.unit ?? '') : ''),
          flag: letter,
          isLow: letter === 'L',
          abnormal: hasSaved ? !!letter : (sev === 'high' || sev === 'warn' || !!letter),
          color: r.color ?? null,
          bold: !!r.isBold,
          texts: Object.keys(texts).length ? texts : undefined,
          method: methodForValue(t, r.parameterName),
        });
      }
    }
    // A configured layout whose grid resolved to ZERO param rows (e.g. an
    // accidentally saved empty grid — HEM011, 2026-09-19 RCA) must never
    // erase entered results from the report: fall through to the legacy
    // values map instead of returning an empty panel that the profile
    // merge silently drops.
    if (group.rows.some(r => r.kind === 'param')) return applyValueMethods(group);
  }

  // Legacy values map.
  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string; description?: string }> | undefined;
  for (const [paramName, v] of Object.entries(values ?? {})) {
    const flag = (v?.flag ?? '').toUpperCase();
    const letter = ['H', 'L', 'C', 'A'].includes(flag) ? flag : '';
    group.rows.push({
      // Text columns (Description) read from the value payload when present.
      texts: v?.description ? { description: v.description } : undefined,
      kind: 'param',
      name: humanize(paramName),
      result: String(v?.value ?? '—'),
      range: v?.range ?? '',
      unit: v?.unit ?? '',
      flag: letter,
      isLow: flag === 'L',
      abnormal: !!letter,
      method: methodForValue(t, paramName),
    });
  }
  return applyValueMethods(group);
}

/** Per-value methods decide the group's method treatment: one method across
 *  every printed value → that method (sub-line + first-row column, the
 *  classic look); different methods → no single claim (`method` cleared), a
 *  `methodLine` naming each method with its values, and the Method column
 *  printing per row. */
function applyValueMethods(group: PanelGroup): PanelGroup {
  const distinct = new Set(group.rows.filter(r => r.kind === 'param' && r.method).map(r => r.method));
  if (distinct.size === 1) {
    group.method = [...distinct][0];
    group.methodLine = undefined;
  } else if (distinct.size > 1) {
    group.method = undefined;
    group.methodLine = methodLineOf(group.rows);
  }
  return group;
}

/** A thin uppercase section heading + rule — used for the
 *  "Tests not under NABL scope" segregation band. */
function renderScopeHeading(
  doc: jsPDF,
  text: string,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  rightText?: string | null
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 60) { y = newPage(doc, practice); }
  // Department band — the strongest heading inside the body (Drlogy pattern:
  // clear department separation carries the whole multi-department report).
  doc.setFont(PDF_FONT, 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(theme.primary);
  doc.text(text, MARGIN_X, y + 12);
  if (rightText) {
    // e.g. "Sample ID: 26001" — ties the department block to its tube(s).
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(rightText, A4.w - MARGIN_X, y + 12, { align: 'right' });
  }
  doc.setDrawColor(theme.primary);
  doc.setLineWidth(1);
  doc.line(MARGIN_X, y + 17, A4.w - MARGIN_X, y + 17);
  return y + 23;
}

/** Distinct sample IDs a department block prints on its band, in first-seen
 *  order: every tube behind its groups — a compiled profile contributes ALL
 *  the tubes its members were drawn in, not just its first member's. */
export function departmentSampleIds(groups: { sampleId?: string; sampleIds?: string[] }[]): string[] {
  const ids = groups.flatMap(g => g.sampleIds?.length ? g.sampleIds : (g.sampleId ? [g.sampleId] : []));
  return [...new Set(ids.map(s => s.trim()).filter(Boolean))];
}

/** Render panel groups grouped into per-DEPARTMENT sections — each department's
 *  tests render in their own block under THAT department's column layout (with
 *  its merges), so one report can show different columns per department. */
function renderContinuousTable(
  doc: jsPDF,
  groups: PanelGroup[],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  _title: string | null,
  deptSigs?: Map<string, ReportSignature[]>,
  deferLastSigs?: { sigs: ReportSignature[] | null }
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
    // admin opted into department banding or page breaks). The department's
    // sample ID(s) print right-aligned on the same band.
    if (dept && (multiDept || theme.groupByDepartment || theme.departmentPageBreak)) {
      const ids = departmentSampleIds(dg);
      const right = ids.length ? `Sample ID: ${ids.join(', ')}` : null;
      y = renderScopeHeading(doc, dept.toUpperCase(), y + 4, practice, right);
    }
    const sigs = deptSigs?.get(dept);
    const isLast = rendered === order.length - 1;
    // Hold back the room this department's signatures need (plus the
    // End-of-Report line when they are the deferred final block) so the table
    // breaks EARLY and the signatures land under the last rows they belong to.
    const reserve = signatureBlockHeight(sigs) + (isLast && deferLastSigs && sigs?.length ? 26 : 0);
    // Partition the department's groups into consecutive RUNS sharing an
    // effective column set — a group with its own column override renders
    // in its own table run. With zero overrides there is exactly ONE run
    // whose columns are deptColumns(dg), i.e. the historical single call.
    const base = deptColumns(dg);
    const runs: { cols: ReportColumn[]; key: string; groups: PanelGroup[]; overridden: boolean }[] = [];
    for (const g of dg) {
      const over = !!(g.columnsOverridden && g.columns?.length);
      const cols = over ? effectiveColumns(g.columns!) : base;
      const key = JSON.stringify(cols);
      const last = runs[runs.length - 1];
      if (last && last.key === key) last.groups.push(g);
      else runs.push({ cols, key, groups: [g], overridden: over });
    }
    for (let ri = 0; ri < runs.length; ri++) {
      // The signature reserve belongs to the department's LAST run only —
      // earlier runs may fill their pages fully.
      const runReserve = ri === runs.length - 1 ? reserve : 0;
      // A full blank line of air on either side of a faint grey hairline
      // between runs, so the eye clearly sees where one table ends and the
      // next (different columns) begins.
      if (ri > 0) {
        y += 12;
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(MARGIN_X, y, A4.w - MARGIN_X, y);
        y += 12;
      }
      // An override run renders the admin's configured columns EXACTLY — a
      // just-added column with no data yet must still print (that column IS
      // the point of the override); the empty-column economy applies only
      // to the department's shared table.
      y = renderColumnarTable(doc, runs[ri].groups, runs[ri].cols, y, practice, dept || null, runReserve,
        runs[ri].overridden);
    }
    // This department's OWN technician + consultant sign at the end of its
    // block — never the global set, never the downloader. The report's LAST
    // department defers its signatures to after the End-of-Report marker.
    if (sigs?.length) {
      if (isLast && deferLastSigs) deferLastSigs.sigs = sigs;
      else {
        // Sign-off sits at the FOOT of the department's last page, directly
        // above the footer strip — not floating under the last row with a
        // blank half-page beneath (the page-2 bug in REPORT-49289714).
        const anchored = Math.max(y, A4.h - FOOTER_RESERVE - signatureBlockHeight(sigs));
        y = drawInlineSignatures(doc, sigs, anchored, practice);
        // The signatures close this department's page; the next department
        // opens clean rather than squeezing under a sign-off. When the theme
        // already breaks per department, ITS break at the loop top is the one
        // and only feed — adding ours too produced a fully blank page
        // (REPORT-49289714-2 page 3).
        if (rendered < order.length - 1 && !theme.departmentPageBreak) y = newPage(doc, practice);
      }
    }
    rendered++;
  }
  return y;
}

/** Vertical space one signature block needs: 12pt lead + 74pt of
 *  image/name/title/reg per row, wrapped 3-up and capped at 7 signatories.
 *  Callers RESERVE this in the table's bottom margin so the signatures can
 *  never be orphaned onto a page of their own. */
/** One signature row: 12pt lead + 74pt of image/name/title/reg. */
const SIG_BLOCK_H = 86;
/** The page's REAL footer band: hairline at h-30, generated-on at h-18, the
 *  disclaimer stacking up to ≈h-58. Signatures anchor to THIS — anchoring to
 *  MARGIN_BOTTOM (the 150pt table floor) parked them ~100pt above the
 *  disclaimer with a dead band beneath, which is not how a lab report ends. */
const FOOTER_RESERVE = 64;

function signatureBlockHeight(sigs: ReportSignature[] | null | undefined): number {
  const n = Math.min(sigs?.length ?? 0, 7);
  if (n === 0) return 0;
  return Math.ceil(n / 3) * 86;
}

/** Signature columns drawn INLINE at the end of a department block (image +
 *  name + title, spread evenly). Callers reserve the space up-front, so the
 *  page-break here is only a last-resort guard. */
function drawInlineSignatures(
  doc: jsPDF,
  sigs: ReportSignature[],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  const all = sigs.slice(0, 7).filter(s => s.name || s.signatureUrl);
  if (all.length > 3) {
    // Wrap: rows of 3, drawn top-down.
    let yy = startY;
    for (let i = 0; i < all.length; i += 3) {
      yy = drawInlineSignatures(doc, all.slice(i, i + 3), yy, practice);
    }
    return yy;
  }
  const list = all;
  if (list.length === 0) return startY;
  let y = startY + 12;
  // The block spans 74pt below y; signatures live INSIDE the table's bottom
  // reserve by design, so only break when the block would collide with the
  // actual footer strip (disclaimer + generated-on).
  if (y + 74 > A4.h - FOOTER_RESERVE) { y = newPage(doc, practice) + 6; }
  const colW = (A4.w - 2 * MARGIN_X) / list.length;
  const baseY = y + 30;
  list.forEach((s, i) => {
    const px = MARGIN_X + i * colW + colW / 2;
    const sigSrc = s.signatureUrl
      ? (s.signatureUrl.startsWith('data:') ? s.signatureUrl : IMG_CACHE[s.signatureUrl])
      : null;
    if (sigSrc) {
      try { doc.addImage(sigSrc, 'PNG', px - 35, baseY - 20, 70, 24, undefined, 'FAST'); }
      catch { drawSigScribble(doc, px, baseY + 4); }
    } else {
      drawSigScribble(doc, px, baseY + 4);
    }
    if (s.name) {
      doc.setFont(PDF_FONT, 'bold');
      doc.setFontSize(9.5);
      doc.setTextColor(BLACK);
      doc.text(s.name, px, baseY + 16, { align: 'center' });
    }
    if (s.title) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(TEXT_DIM);
      doc.text(`(${s.title})`, px, baseY + 27, { align: 'center' });
    }
    if (s.regNo) {
      doc.setFont(PDF_FONT, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(TEXT_DIM);
      doc.text(`Reg. ${s.regNo}`, px, baseY + 37, { align: 'center' });
    }
  });
  return baseY + 44;
}

/** The single pipeline every column source passes through before rendering:
 *  sort by order, guarantee an Investigation (name) lead column so the
 *  parameter name always shows, apply the default Result→Unit link. */
function effectiveColumns(src: ReportColumn[]): ReportColumn[] {
  let cfg = src.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (!cfg.some(c => c.type === 'name')) {
    cfg = [{ id: 'rc-name', name: 'name', label: 'Investigation', order: 0, width: 30, type: 'name', locked: false }, ...cfg];
  }
  return applyDefaultResultUnitLink(cfg);
}

/** Resolve the BASE column layout for one department's groups — the
 *  department flatten. A group carrying its own per-test override must never
 *  define its neighbours' table, so the pick is: first NON-overridden group
 *  with columns → first overridden group's department set → defaults. With
 *  zero overrides this is exactly the historical first-group-wins pick. */
function deptColumns(groups: PanelGroup[]): ReportColumn[] {
  const src = groups.find(g => g.columns && g.columns.length && !g.columnsOverridden)?.columns
    ?? groups.find(g => g.columnsOverridden && g.deptColumns?.length)?.deptColumns
    ?? DEFAULT_RESULT_COLUMNS;
  return effectiveColumns(src);
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
  practice: NonNullable<ReportPdfInput['practice']>,
  deptLabel: string | null = null,
  /** Extra bottom margin held back for whatever follows this table on the same
   *  page — the department's signature block. Without it autoTable fills to
   *  MARGIN_BOTTOM and the signatures get pushed onto an empty page. */
  reserveBottom = 0,
  /** True when `cfg` is a test's/profile's OWN column override (a break-out
   *  run): configured columns print exactly as arranged — even empty ones —
   *  and every group gets its heading band so the odd-width table reads as
   *  its own titled block. */
  overriddenRun = false
): number {
  if (groups.length === 0) return startY;
  if (startY > A4.h - MARGIN_BOTTOM - reserveBottom - 70) { startY = newPage(doc, practice); }

  const usable = A4.w - 2 * MARGIN_X;
  type VCol = { members: ReportColumn[]; label: string; weight: number; hasResult: boolean; textOnly: boolean; nameOnly: boolean };
  let vcols: VCol[] = [];
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
  // Drop columns that would be COMPLETELY empty for this department block
  // (e.g. an unused Description column) — a blank column wastes a fifth of
  // the page and makes the table look ragged. Name/result always stay.
  const memberHasContent = (m: ReportColumn): boolean => {
    switch (m.type) {
      case 'name': case 'result': return true;
      case 'unit':  return groups.some(g => g.rows.some(r => r.kind === 'param' && !!(r.unit ?? '').trim() && looksNumeric(r.result)));
      case 'range': return groups.some(g => g.rows.some(r => r.kind === 'param' && !!(r.range ?? '').trim()));
      case 'flag':  return groups.some(g => g.rows.some(r => r.kind === 'param' && !!(r.flag ?? '').trim()));
      case 'method':     return groups.some(g => !!(g.method ?? '').trim() || g.rows.some(r => !!r.method));
      case 'specimen':   return groups.some(g => !!(g.specimen ?? '').trim());
      case 'code':       return groups.some(g => !!(g.code ?? '').trim());
      case 'short_name': return groups.some(g => !!(g.shortName ?? '').trim());
      case 'section':    return groups.some(g => !!(g.section ?? '').trim());
      case 'text':
      default:
        if (m.locked && (m.lockedValue ?? '').trim()) return true;
        if (m.name === 'specimen') return groups.some(g => !!(g.specimen ?? '').trim());
        return groups.some(g => g.rows.some(r => r.kind === 'param' && !!(r.texts?.[m.name] ?? '').trim()));
    }
  };
  // Admin live-preview and override runs keep EVERY configured column
  // visible (structure fidelity beats economy — an override's just-added
  // column must show even before it has data); the department's shared
  // table still drops empties.
  if (!PREVIEW_KEEP_EMPTY_COLS && !overriddenRun) vcols = vcols.filter(vc => vc.members.some(memberHasContent));
  const hasResultCol = vcols.some(c => c.hasResult);
  const totalWeight = vcols.reduce((s, c) => s + c.weight, 0) || 1;
  const colWidths = vcols.map(c => (c.weight / totalWeight) * usable);
  const COLSPAN = vcols.length;
  const resultColIdx = Math.max(0, vcols.findIndex(c => c.hasResult));
  // -1 when the layout has no reference column at all, which the hook treats
  // as "never matches" — no special-casing needed at the call site.
  const rangeColIdx = vcols.findIndex(c => c.members.some(m => m.type === 'range'));

  type Cell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const head: Cell[][] = [vcols.map(c => ({ content: c.label, styles: { halign: 'left' } }))];

  const body: Cell[][] = [];
  // Parallel to `body` — carries the arrow indicator to draw in the result
  // column for abnormal rows (jsPDF standard fonts can't render ↑/↓ glyphs,
  // so we draw a small triangle in didDrawCell). null = no arrow on that row.
  const bodyMeta: Array<{ arrow: 'up' | 'down'; color: string; text: string; bold: boolean } | null> = [];
  // Cells needing raised-superscript redraw, keyed section:row:col.
  const supCells = new Map<string, SupCell>();
  const qualCells = new Map<string, QualCell>();
  for (const g of groups) {
    // A single-analyte test renders COMPACT: one plain row, no bold panel band
    // and no Method sub-line — the band + method treatment is reserved for
    // multi-parameter panels/profiles (CBC, LFT…). This matches the classic
    // report style: a 20-test biochem order reads as 20 rows, not 20 panels.
    // This holds in an override run too (owner 2026-09-19): the run's own
    // column-header strip is the block's heading — a band would just repeat
    // the name the Investigation cell already prints.
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
      const methodText = g.methodLine ?? g.method;
      if (methodText) sub.push(`Method: ${methodText}`);
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
      // 'A' (qualitative abnormal — e.g. a non-normal dropdown option) gets
      // the same ▲ treatment as a numeric High: bold + up-triangle after the
      // result text. Only 'C' keeps its letter — critical must read as text.
      const useArrow = theme.flagIndicator === 'arrow' && (r.flag === 'H' || r.flag === 'L' || r.flag === 'A');
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
          // Never grow a unit onto a qualitative result ("Normal mg/dL").
          case 'unit':   return looksNumeric(r.result) ? (r.unit ?? '').trim() : '';
          case 'range':  return (r.range ?? '').trim();
          case 'flag':   return (r.flag ?? '').trim();
          // Test-level sources print once per test block (first row).
          // One method for the block → printed once (first row); values
          // measured by different methods → each row prints its own.
          case 'method':     return (g.method ?? '').trim()
            ? (isFirst ? (g.method ?? '').trim() : '')
            : (r.method ?? '').trim();
          case 'specimen':   return isFirst ? (g.specimen ?? '').trim() : '';
          case 'code':       return isFirst ? (g.code ?? '').trim() : '';
          case 'short_name': return isFirst ? (g.shortName ?? '').trim() : '';
          case 'section':    return isFirst ? (g.section ?? '').trim() : '';
          case 'text':
          default:
            if (m.locked) return (m.lockedValue ?? '').trim();
            // A 'specimen' text column shows the group's specimen once.
            if (m.name === 'specimen') return isFirst ? (g.specimen ?? '').trim() : '';
            // Admin text cells (e.g. Description) resolved by the layout engine.
            return (r.texts?.[m.name] ?? '').trim();
        }
      };

      // Explicit admin row colour (condition chips) paints the ACTUAL hex on
      // the result cell — not gated by the theme's flagStyle, because the
      // admin chose it per-row on purpose. Green (= explicit normal) never
      // colours or bolds anything.
      const rowSev = colorSeverity(r.color);
      const adminColor = (rowSev === 'high' || rowSev === 'warn') ? (r.color as string) : null;

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
          if (adminColor) { styles['textColor'] = adminColor; styles['fontStyle'] = 'bold'; }
        }
        // Conditional bold (condition `then.bold`) — bolds name + result.
        if (r.bold && (vc.nameOnly || vc.hasResult)) styles['fontStyle'] = 'bold';
        return { content: txt, styles };
      });
      body.push(cells);
      // Remember the result text so the arrow can sit right AFTER it — the
      // result cell is wide, and anchoring the glyph to the cell's far edge
      // parked it visually beside the Reference column.
      const resultCellText = hasResultCol
        ? (cells[vcols.findIndex(vc => vc.hasResult)]?.content ?? '')
        : '';
      bodyMeta.push((useArrow && hasResultCol)
        ? { arrow: r.isLow ? 'down' : 'up',
            color: theme.flagStyle === 'bold_color' ? abnColor : BLACK,
            text: String(resultCellText),
            bold: !isNormal && theme.flagIndicator !== 'none' }
        : null);
    }
  }

  // When the table spills onto further pages, stamp "<DEPT> — continued" above
  // the repeated column header — otherwise a reader on page 2 can't tell which
  // department the rows belong to.
  let tablePagesSeen = 0;

  autoTable(doc, {
    startY,
    head: head as unknown as Array<Array<string | Cell>>,
    body: body as unknown as Array<Array<string | Cell>>,
    margin: { left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM + reserveBottom, top: 56 },
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    didDrawPage: () => {
      tablePagesSeen++;
      if (tablePagesSeen > 1 && deptLabel) {
        doc.setFont(PDF_FONT, 'bold');
        doc.setFontSize(9);
        doc.setTextColor(theme.primary);
        doc.text(`${deptLabel.toUpperCase()} — CONTINUED`, MARGIN_X, 42);
        doc.setDrawColor(HAIR);
        doc.setLineWidth(0.5);
        doc.line(MARGIN_X, 46, A4.w - MARGIN_X, 46);
      }
    },
    columnStyles: Object.fromEntries(
      colWidths.map((w, i) => [i, { cellWidth: w, halign: 'left' }])
    ) as unknown as Record<number, { cellWidth: number }>,
    // Arrow indicator: draw a small ▲/▼ triangle at the right of the result
    // cell for abnormal rows (standard PDF fonts can't render ↑/↓ glyphs).
    // Units like ×10⁹/L survive as "×10^9/L" (cp1252 has no ⁹). Blank those
    // cells here — AFTER layout, so column widths are unaffected — and redraw
    // them with real raised digits in didDrawCell below.
    willDrawCell: (d: CellHookArg) => {
      // Order matters: a qualified range cell is claimed here first, so the
      // superscript hook doesn't also blank it and fight over the redraw.
      stashQualifiedRangeCell(qualCells, d, rangeColIdx);
      stashSuperscriptCell(supCells, d);
    },
    didDrawCell: (d: { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; width: number; height: number; styles?: Record<string, unknown> } }) => {
      drawQualifiedRangeCell(doc, qualCells, d as CellHookArg);
      drawSuperscriptCell(doc, supCells, d as CellHookArg);
      if (d.section !== 'body' || d.column.index !== resultColIdx) return;
      const m = bodyMeta[d.row.index];
      if (!m) return;
      const s = 3.2;
      // Place the glyph just after the printed value (measured in the same
      // font the cell used), clamped inside the cell.
      doc.setFont(PDF_FONT, m.bold ? 'bold' : 'normal');
      doc.setFontSize(9 * theme.fontScale);
      const tw = doc.getTextWidth(m.text);
      const cx = Math.min(d.cell.x + 6 + tw + 8, d.cell.x + d.cell.width - 9);
      // Align to the FIRST text line, not the cell middle — a multi-band
      // reference stack makes the row tall, and a centred glyph floated
      // below "500 mg/dL" instead of sitting beside it.
      const fs = 9 * theme.fontScale;
      const cy = d.cell.y + 4 + fs * 0.42;
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
        y = renderImageSection(doc, sec, y, practice);
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
  const hiddenNames = new Set((t as { hidden?: string[] | null }).hidden ?? []);
  const rows = (sec.rows ?? []).filter(r =>
    r.isMerged || !r.parameterName || !hiddenNames.has(r.parameterName));
  if (rows.length === 0) return startY;
  const bodyRows = rows.filter(r => !r.isMerged);
  let y = startY;

  // Section label — the admin names sections in the layout editor ("Results",
  // "Differential count"…); the preview shows it, so the PDF must too.
  const secLabel = (sec.label ?? '').trim();
  if (secLabel) {
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(secLabel.toUpperCase(), MARGIN_X, y + 8);
    y += 12;
  }

  // Lay the table out against the TEST'S OWN resolved columns — the admin's
  // per-department config (order, labels, widths, linked columns, text columns)
  // is authoritative, exactly like the continuous table. A leading
  // Investigation (name) column is synthesized when the layout has none.
  const cfgCols = applyDefaultResultUnitLink(
    (layout.columns?.length ? layout.columns : DEFAULT_RESULT_COLUMNS)
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  );
  const hasNameCol = cfgCols.some(c => c.type === 'name');

  // Merge linkedNext runs into virtual columns (same rules as the continuous
  // table: the run keeps the first member's label; widths add up).
  type VCol = { members: ReportColumn[]; label: string; weight: number; hasResult: boolean; isName: boolean };
  const vcols: VCol[] = [];
  for (let i = 0; i < cfgCols.length; i++) {
    const members: ReportColumn[] = [cfgCols[i]];
    while (cfgCols[i]?.linkedNext && i + 1 < cfgCols.length) { members.push(cfgCols[++i]); }
    vcols.push({
      members,
      label: members[0].label || '',
      weight: members.reduce((s, m) => s + (m.width || 0), 0) || 1,
      hasResult: members.some(m => m.type === 'result'),
      isName: members.every(m => m.type === 'name'),
    });
  }
  if (!hasNameCol) {
    vcols.unshift({
      members: [{ id: 'g-name', name: 'name', label: 'Investigation', order: 0, width: 34, type: 'name', locked: false }],
      label: 'Investigation', weight: 34, hasResult: false, isName: true,
    });
  }

  const usable = A4.w - 2 * MARGIN_X;
  const totalWeight = vcols.reduce((s, c) => s + c.weight, 0) || 1;
  const colWidths = vcols.map(c => (c.weight / totalWeight) * usable);
  const totalCols = vcols.length;

  type RowCell = { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const head: RowCell[][] = [
    vcols.map(c => ({
      content: c.label,
      styles: { halign: alignFor(c.members[0].type) as 'left' | 'right' | 'center' },
    })),
  ];

  // Prefer the snapshot's sampleType; fall back to the layout's.
  const rawSampleTypeLine = ((t.sampleType ?? layout.sampleType) ?? '').trim();
  const sampleTypeLine = isConcreteSpecimen(rawSampleTypeLine) ? rawSampleTypeLine : '';

  const body: RowCell[][] = rows.map((r): RowCell[] => {
    if (r.isMerged) {
      return [{
        content: r.mergeContent ?? '',
        colSpan: totalCols,
        styles: { fillColor: '#f8fafc', textColor: TEXT, fontStyle: 'italic', halign: 'center', fontSize: 8.5 },
      }];
    }
    const isFirstBodyRow = bodyRows.length > 0 && bodyRows[0].id === r.id;
    const paramTitle = r.title || humanize(r.parameterName ?? '');
    const resultCol = cfgCols.find(c => c.type === 'result');
    const resultText = resultCol ? coerceCellText(r.cells[resultCol.name]) : '';
    // Engine condition colour: red/orange abnormal paints the row; green is an
    // explicit normal marker — never coloured.
    const sev = colorSeverity(r.color);
    const rowColor = (sev === 'high' || sev === 'warn') ? (r.color as string) : null;

    const cellValue = (m: ReportColumn): string => {
      switch (m.type) {
        case 'name':
          return isFirstBodyRow && sampleTypeLine ? `${paramTitle}\n${sampleTypeLine}` : paramTitle;
        case 'result': return resultText;
        // The row's own unit cell wins; the parameter unit is the fallback,
        // but never onto a qualitative result ("Normal mg/dL").
        case 'unit': {
          const cell = coerceCellText(r.cells[m.name]);
          return cell || (looksNumeric(resultText) ? (r.unit ?? '') : '');
        }
        case 'flag': return '';
        case 'range':
        case 'text':
        default:
          if (m.locked && m.lockedValue) return m.lockedValue;
          return coerceCellText(r.cells[m.name]);
      }
    };

    return vcols.map(vc => {
      const txt = vc.members.map(cellValue).filter(Boolean).join(' ');
      const styles: Record<string, unknown> = { halign: alignFor(vc.members[0].type) };
      if (vc.isName) { styles['fontStyle'] = 'bold'; styles['textColor'] = rowColor ?? BLACK; styles['fontSize'] = 9; }
      else if (vc.hasResult) {
        styles['fontStyle'] = 'bold';
        styles['textColor'] = rowColor ?? BLACK;
        if (rowColor) {
          const tag = flagLabel(r);
          if (tag) return { content: `${txt}    ${tag}`, styles };
        }
      } else {
        // Range / unit / text muted so the result stands out — but an
        // abnormal row's colour carries across the whole row.
        styles['textColor'] = rowColor ?? TEXT_DIM;
      }
      if (r.isBold) styles['fontStyle'] = 'bold';
      return { content: txt, styles };
    });
  });

  const columnStyles: Record<number, { cellWidth: number; halign?: string }> = {};
  vcols.forEach((c, i) => { columnStyles[i] = { cellWidth: colWidths[i], halign: alignFor(c.members[0].type) }; });

  autoTable(doc, {
    startY: y,
    head: head as unknown as Array<Array<string | RowCell>>,
    body: body as unknown as Array<Array<string | RowCell>>,
    margin: { left: MARGIN_X, right: MARGIN_X },
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
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
    // Tighter rows than the old 6/6 padding — a 20-row department block
    // should read as one dense professional table, not a spaced-out list.
    cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
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
    // Column headers sit BELOW the data in the visual hierarchy — smaller
    // than the body values, with a firm rule underneath (Drlogy pattern).
    fontSize: 8.5 * theme.fontScale,
    halign: 'left' as const,
    cellPadding: { top: 3, right: 6, bottom: 6, left: 6 },
    lineColor: HAIR,
    lineWidth: bordered
      ? 0.4
      : ({ top: 0, right: 0, bottom: 0.7, left: 0 } as unknown as number),
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

function renderImageSection(
  doc: jsPDF, sec: ResolvedSection, startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  return drawImagesBlock(doc, sec.imageUrls ?? [], startY, practice);
}

/** Draw attached images for real — two per row, aspect kept, hairline
 *  frames, page-break aware. URLs missing from IMG_CACHE degrade to the
 *  old italic placeholder so the report never silently loses information. */
function drawImagesBlock(
  doc: jsPDF, urls: string[], startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  heading?: string
): number {
  if (urls.length === 0) return startY;
  const usable = urls.filter(u => IMG_CACHE[u]);
  let y = startY;
  if (heading) {
    doc.setFont(PDF_FONT, 'bolditalic');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(heading.toUpperCase(), MARGIN_X, y + 10);
    y += 16;
  }
  if (usable.length === 0) {
    doc.setFont(PDF_FONT, 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(`[ ${urls.length} attached image${urls.length === 1 ? '' : 's'} ]`, MARGIN_X, y + 11);
    return y + 18;
  }
  const gap = 12;
  const maxW = (A4.w - 2 * MARGIN_X - gap) / 2;
  const maxH = 180;
  let x = MARGIN_X;
  let rowH = 0;
  for (const u of usable) {
    const data = IMG_CACHE[u];
    let w = maxW, h = maxH;
    try {
      const props = doc.getImageProperties(data);
      const sc = Math.min(maxW / props.width, maxH / props.height, 1);
      w = Math.max(40, props.width * sc);
      h = Math.max(40, props.height * sc);
    } catch { continue; }
    if (x + w > A4.w - MARGIN_X + 1) { x = MARGIN_X; y += rowH + gap; rowH = 0; }
    if (y + h > A4.h - MARGIN_BOTTOM) { y = newPage(doc, practice); x = MARGIN_X; rowH = 0; }
    try {
      doc.addImage(data, x, y, w, h);
      doc.setDrawColor(HAIR);
      doc.setLineWidth(0.5);
      doc.rect(x, y, w, h);
    } catch { continue; }
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  return y + rowH + 8;
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
  const rawSampleType = (t.sampleType ?? '').trim();
  const sampleTypeLine = isConcreteSpecimen(rawSampleType) ? rawSampleType : '';
  const hiddenNames = new Set((t as { hidden?: string[] | null }).hidden ?? []);
  const entries = (values ? Object.entries(values) : [])
    .filter(([paramName]) => !hiddenNames.has(paramName));

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

  const legacySup = new Map<string, SupCell>();
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
    // This fallback table has its own Unit column, so it needs the same
    // raised-superscript treatment as the main results table.
    willDrawCell: (d: CellHookArg) => stashSuperscriptCell(legacySup, d),
    didDrawCell: (d: CellHookArg) => drawSuperscriptCell(doc, legacySup, d),
  } as unknown as Parameters<typeof autoTable>[1]);
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

// ──────────────────────────────────────────────────────────────
// Microbiology — Culture & Sensitivity
// ──────────────────────────────────────────────────────────────

interface PdfAst { name?: string; interpretation?: string }

interface PdfOrganism { name?: string; antibiotics?: PdfAst[] }
interface PdfStageSnap {
  key?: string; label?: string; caseLabel?: string | null;
  values?: { fields?: Array<{ name?: string; title?: string; value?: string }>; notes?: string };
}
interface PdfCulture {
  specimen?: string; gramStain?: string; colonyCount?: string; noGrowth?: boolean;
  organisms?: PdfOrganism[]; resistancePattern?: string; intrinsicResistance?: string;
  clinicalNotes?: string; infectionControlAdvice?: string;
}

function renderCultureSection(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  layout?: import('../models/report-layout.model').ResolvedReportLayout,
): number {
  let y = startY;
  if (y > A4.h - MARGIN_BOTTOM - 90) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? 'Culture & Sensitivity', y);
  // Sample ID rides the heading line right-aligned — the same tie-back every
  // other department block prints, which the culture section was missing.
  if ((t.sampleId ?? '').trim()) {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(TEXT_DIM);
    doc.text(`Sample ID: ${t.sampleId}`, A4.w - MARGIN_X, y + 14, { align: 'right' });
  }
  // 34, not 26: the heading's hairline sits at y+22 and the first label's
  // cap-height reached up into it ("SPECIMEN:" printed struck-through).
  y += 34;

  const c = (t.result?.['values'] as PdfCulture | undefined) ?? {};
  // Report-row visibility: keys the lab unticked at the bench / sign-out are
  // hidden on the PATIENT PDF only — the bench record keeps everything.
  const hiddenList = (t.result?.['hidden'] as string[] | undefined) ?? [];
  const isRowHidden = (k: string): boolean => hiddenList.includes(k);

  const line = (label: string, value?: string): void => {
    if (y > A4.h - MARGIN_BOTTOM - 30) { y = newPage(doc, practice); }
    doc.setFont(PDF_FONT, 'bold'); doc.setFontSize(8.5); doc.setTextColor(BLACK);
    doc.text(`${label.toUpperCase()}:`, MARGIN_X, y);
    doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(value && value.trim() ? value : '—', A4.w - 2 * MARGIN_X - 4);
    doc.text(lines, MARGIN_X, y + 11);
    y += 11 + lines.length * 11 + 4;
  };

  // ── Composition helpers (shared by the classic and layout-driven paths) ──
  const stageSnaps = (t.result?.['stages'] as PdfStageSnap[] | undefined) ?? [];
  /** One bench stage's ROOT findings as prose ("Pus Cells: Many; …; note"),
   *  honoring the per-row hide keys. Branch (subculture) stages are
   *  bench-only. */
  const stageText = (key: string, opts?: { skipOrganisms?: boolean }): string => {
    const st = stageSnaps.find(x => x.key === key && !x.caseLabel);
    if (!st) return '';
    const bits = (st.values?.fields ?? [])
      .filter(f => (f.value ?? '').trim() && !isRowHidden(`stage:${key}:${f.name}`))
      .filter(f => !(opts?.skipOrganisms && (f.name ?? '').toLowerCase().includes('organism')))
      .map(f => `${f.title || f.name}: ${f.value}`);
    const notes = (st.values?.notes ?? '').trim();
    if (notes && !isRowHidden(`stage:${key}:notes`)) bits.push(notes);
    return bits.join('; ');
  };
  // Keep hidden keys using ORIGINAL organism indexes; numbering stays
  // sequential over what actually prints.
  const organisms = (c.organisms ?? [])
    .map((o, i) => ({ o, i }))
    .filter(({ o, i }) => !isRowHidden(`org:${i}`)
      && ((o.name ?? '').trim() || (o.antibiotics ?? []).some(a => (a.name ?? '').trim())));
  const orgLabel = (o: PdfOrganism, i: number): string => (o.name ?? '').trim() || `Isolate ${i + 1}`;
  const organismNames = organisms.map(({ o }, n) => `${n + 1}. ${orgLabel(o, n)}`).join('   ');
  const hasAstOrganisms = (c.organisms ?? []).some(o => (o.name ?? '').trim());

  /** The specimen actually SELECTED for this case. Falls back to the test's
   *  own specimen only when it's a concrete one — an unselected specimen
   *  must not print at all (see isConcreteSpecimen). */
  const specimenText = (): string => {
    const chosen = (c.specimen ?? '').trim();
    if (chosen) return chosen;
    const fromTest = (t.sampleType ?? '').trim();
    return isConcreteSpecimen(fromTest) ? fromTest : '';
  };

  /** Text for one culture data source — '' means "skip the line". */
  const sourceText = (src: string): string => {
    switch (src) {
      case 'specimen':    return specimenText();
      case 'gramStain':   return isRowHidden('gramStain') ? '' : ((c.gramStain ?? '').trim() || stageText('gram'));
      case 'growth':      return stageText('growth');
      case 'id':          return stageText('id', { skipOrganisms: hasAstOrganisms });
      case 'colonyCount': return isRowHidden('colonyCount') ? '' : (c.colonyCount ?? '').trim();
      case 'organisms':   return organismNames || 'No significant growth';
      case 'note':        return ((t.result?.['note'] as string | undefined) ?? '').trim();
      case 'resistancePattern':      return isRowHidden(src) ? '' : (c.resistancePattern ?? '').trim();
      case 'intrinsicResistance':    return isRowHidden(src) ? '' : (c.intrinsicResistance ?? '').trim();
      case 'clinicalNotes':          return isRowHidden(src) ? '' : (c.clinicalNotes ?? '').trim();
      case 'infectionControlAdvice': return isRowHidden(src) ? '' : (c.infectionControlAdvice ?? '').trim();
      default: return '';
    }
  };
  const DEFAULT_LABELS: Record<string, string> = {
    specimen: 'Specimen', gramStain: 'Gram stain', growth: 'Growth',
    id: 'Organism identification', colonyCount: 'Colony count',
    organisms: 'Organism(s) isolated', note: 'Summary',
    resistancePattern: 'Resistance pattern', intrinsicResistance: 'Intrinsic resistance',
    clinicalNotes: 'Clinical notes', infectionControlAdvice: 'Infection control advice',
  };

  const interpWord = (v?: string): { txt: string; color: string } => {
    const u = (v ?? '').toUpperCase();
    if (u === 'S') return { txt: 'S', color: '#16a34a' };
    if (u === 'R') return { txt: 'R', color: FLAG_RED };
    if (u === 'I') return { txt: 'M', color: '#d97706' };
    return { txt: '—', color: BLACK };
  };

  /** The AST block: per-organism antimicrobial tables + the S/R/M legend.
   *  Under noGrowth it prints the classic "no growth" result line. */
  const astBlock = (): void => {
    if (c.noGrowth) {
      line('Result', 'No growth after 48 hours of aerobic incubation.');
      return;
    }
    for (let idx = 0; idx < organisms.length; idx++) {
      const { o: org, i: origIdx } = organisms[idx];
      if (y > A4.h - MARGIN_BOTTOM - 60) { y = newPage(doc, practice); }
      const rows = reportedAstRows(org.antibiotics ?? [], origIdx, hiddenList)
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
  };

  // ── LAYOUT-DRIVEN path: the admin arranged culture sections in the SAME
  //    Test Master layout editor every other test uses. Only taken when the
  //    layout actually holds culture sections — so untouched tests (and every
  //    non-culture test, which never reaches this renderer) keep the exact
  //    classic output below. ──
  const cultureSecs = (layout?.sections ?? []).filter(sec => sec.isVisible !== false);
  if (cultureSecs.some(sec => sec.type === 'culture_line' || sec.type === 'culture_ast')) {
    for (const sec of cultureSecs) {
      if (sec.type === 'culture_line') {
        const src = (sec.content ?? '').trim();       // engine passes `source` via content
        const txt = sourceText(src);
        if (txt) line(sec.label || DEFAULT_LABELS[src] || src, txt);
      } else if (sec.type === 'culture_ast') {
        astBlock();
      } else if (sec.type === 'paragraph' && (sec.content ?? '').trim()) {
        if (y > A4.h - MARGIN_BOTTOM - 30) { y = newPage(doc, practice); }
        doc.setFont(PDF_FONT, 'normal'); doc.setFontSize(9); doc.setTextColor(BLACK);
        const lines = doc.splitTextToSize((sec.content ?? '').trim(), A4.w - 2 * MARGIN_X) as string[];
        doc.text(lines, MARGIN_X, y);
        y += lines.length * 11 + 6;
      }
      // grid/chart/image sections are not meaningful inside the culture
      // block — ignored rather than guessed at.
    }
    return y;
  }

  // ── CLASSIC path (no customized layout): the reference C&S format.
  //    Note: the legacy values.gramStain line and the bench gram STAGE line
  //    are printed independently (pre-layout behaviour, spec-locked) — the
  //    either/or collapse in sourceText('gramStain') is layout-mode only. ──
  const specimenLine = sourceText('specimen');
  if (specimenLine) line('Specimen', specimenLine);
  if (!isRowHidden('gramStain') && (c.gramStain ?? '').trim()) line('Gram stain', c.gramStain ?? '');
  const colony = sourceText('colonyCount');
  if (colony) line('Colony count', colony);
  const gramStage = stageText('gram');
  if (gramStage) line('Gram stain', gramStage);
  const growth = sourceText('growth');
  if (growth) line('Growth', growth);
  const idLine = sourceText('id');
  if (idLine) line('Organism identification', idLine);

  if (c.noGrowth) {
    line('Result', 'No growth after 48 hours of aerobic incubation.');
    return y;
  }

  line('Organism(s) isolated', sourceText('organisms'));
  astBlock();

  for (const src of ['resistancePattern', 'intrinsicResistance', 'clinicalNotes', 'infectionControlAdvice']) {
    const v = sourceText(src);
    if (v) line(DEFAULT_LABELS[src], v);
  }
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

function drawEndOfReport(doc: jsPDF, snap: ReportSnapshot, startY: number): number {
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
  return y;
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
  // When the snapshot carries PER-DEPARTMENT signatories, each department
  // block already signs itself inline — skip the repeated page-bottom row
  // entirely (the disclaimer/date strip below still draws).
  // Signatures NEVER print in the page footer — they sign at the end of each
  // department's section (per-department signatories / tester+validator).
  const sigs: ReportSignature[] = [];

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
  // Plain page number ("1", "2", "3" …).
  doc.text(String(pageNo), A4.w - MARGIN_X, A4.h - 18, { align: 'right' });

  // Blue band at the bottom (Drlogy "Sample Collection" strip) — the LAB's
  // contact number (home-collection line), never the patient's phone.
  // Admin toggles via template.showSampleCollectionBand.
  const collectPhone = (practice.phone ?? '').trim();
  if (theme.showSampleBand && collectPhone) {
    doc.setFillColor(BLUE);
    doc.rect(0, A4.h - 12, A4.w, 12, 'F');
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor('#ffffff');
    doc.text(`Sample Collection  ${collectPhone}`, A4.w / 2, A4.h - 3.5, { align: 'center' });
  }

  // Optional Powered-by footnote (last page only). With the Sample
  // Collection band on, it sits centred on the date/page-number strip
  // instead of the very edge (which the band occupies).
  if (theme.showPoweredBy && pageNo === pageTotal) {
    doc.setFont(PDF_FONT, 'italic');
    doc.setFontSize(7);
    doc.setTextColor(TEXT_DIM);
    const bandOn = theme.showSampleBand && (practice.phone ?? '').trim();
    doc.text('Powered by Prefrontal LMS', A4.w / 2, bandOn ? A4.h - 18 : A4.h - 4, { align: 'center' });
  }

  // Optional watermark — a COMBINATION of the lab's logo (faint, centred)
  // and the admin's watermark text angled across it. Page 1 only.
  if (theme.watermarkText && pageNo === 1) {
    const wm = theme.watermarkText;
    const op = theme.watermarkOpacity;
    const cx = A4.w / 2;
    const cy = A4.h / 2;

    // Logo half of the combination — real alpha via GState so the image
    // ghosts instead of covering results. Skipped silently when no logo is
    // cached or the jsPDF build lacks GState.
    const wmLogo = WM_LOGO_URL ? IMG_CACHE[WM_LOGO_URL] : null;
    if (wmLogo) {
      try {
        const anyDoc = doc as unknown as {
          saveGraphicsState?: () => void;
          restoreGraphicsState?: () => void;
          setGState?: (g: unknown) => void;
          GState?: new (o: { opacity: number }) => unknown;
        };
        if (anyDoc.saveGraphicsState && anyDoc.setGState && anyDoc.GState) {
          const size = 220;
          anyDoc.saveGraphicsState();
          anyDoc.setGState(new anyDoc.GState({ opacity: Math.min(op * 1.6, 0.16) }));
          doc.addImage(wmLogo, 'PNG', cx - size / 2, cy - size / 2, size, size, undefined, 'FAST');
          anyDoc.restoreGraphicsState?.();
        }
      } catch { /* logo watermark is best-effort — text below still prints */ }
    }

    // Text half — jsPDF has no direct text alpha without GState; emulate via
    // a very light grey computed from the opacity.
    const lighten = (1 - op) * 255;
    const grey = Math.round(lighten).toString(16).padStart(2, '0');
    const wmColor = `#${grey}${grey}${grey}`;
    doc.setFont(PDF_FONT, 'bold');
    doc.setFontSize(48);
    doc.setTextColor(wmColor);
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
/** `saved` = the cell is mw's enriched wrapper ({ value, flag, … }) — its
 *  flag is THE verdict (single source), even when blank/'N'. */
function coerceResultCell(raw: unknown): { value: string; flag: string; saved?: boolean } {
  const s = (raw == null ? '' : String(raw)).trim();
  if (s.startsWith('{') && s.includes('"value"')) {
    try {
      const o = JSON.parse(s) as { value?: unknown; flag?: string };
      return { value: o.value == null ? '' : String(o.value), flag: (o.flag ?? '').toUpperCase(), saved: 'flag' in o };
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
  // The layout engine's condition palette is red #C0392B / orange #E87722 /
  // green #1D9E75 — colorSeverity understands those AND the legacy theme hexes.
  const sev = colorSeverity(r.color);
  if (sev === 'high' || sev === 'warn') return 'High';
  const c = r.color.toLowerCase();
  if (c.includes('2563') || c.includes('3b82') || c.includes('blue')) return 'Low';
  return '';
}

/** True when a result reads as a number ("92", "<0.5", "5.2", "-3", "≈7") —
 *  used to decide whether appending the unit makes sense. Qualitative results
 *  ("Normal", "Reactive", "Present") must never grow a unit. */
function looksNumeric(result: string | null | undefined): boolean {
  return /^[<>≈~=]?\s*-?[\d.]/.test((result ?? '').trim());
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

/** The AST rows a culture report prints for one organism: named rows whose
 *  report tick is on (key `ast:<original organism index>:<drug>` absent from
 *  the case's hidden list). A plate organism's unticked panel drugs stay off
 *  the patient PDF this way. */
export function reportedAstRows<T extends { name?: string | null }>(rows: T[], origIdx: number, hidden: string[] | null | undefined): T[] {
  const h = new Set(hidden ?? []);
  return rows.filter(a => (a.name ?? '').trim() && !h.has(`ast:${origIdx}:${a.name}`));
}
