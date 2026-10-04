import { jsPDF } from 'jspdf';
import { drawTextWithSuperscripts, hasSuperscript, installPdfTextSanitizer, pdfSafeText } from './pdf-text';
import autoTable, { __createTable, __drawTable } from 'jspdf-autotable';
import JsBarcode from 'jsbarcode';
import {
  type PageLayoutBox,
  DEFAULT_RESULT_COLUMNS,
  ReportColumn,
  ResolvedReportLayout,
  ResolvedRow,
  ResolvedSection,
} from '../models/report-layout.model';
import { normalizeHeaderPreset, ReportSignature, ReportTemplate, type HeaderPreset } from '../models/report.model';
import { layoutSignatureBlock, SIG_IMG_H, SIG_IMG_W, SIG_ROW } from './report-signatures';
import { savedFlagOf, type SavedFlag } from './result-flag';
import { reportFlag, reportFlagWord } from './report-flag';
import { fillUnit, normalizeReportText } from './reference-range';
import { reportDisplayName } from './report-name';
import { fetchAssetBlob } from './upload-fetch';
import { collectAbnormalResults, renderAbnormalSummary, summaryTestValidated } from './report-abnormal-summary';
import { withResultsTables } from './results-table';
import { applyDefaultResultUnitLink } from './result-unit-link';
import { ORDER_QR_KEY, PATIENT_STRIP_QR_CAPTIONS, PROFILE_QR_KEY, isPatientStripQrKey, orderReportQrUrl, paintQr, patientProfileQrUrl } from './patient-strip-qr';
import { environment } from '../../../environments/environment';
import {
  Align, BackgroundImage, BgArea, HeaderField, ItemOverride, LayoutItem, LayoutRegion, MM, ReportLayoutResult,
  ResolvedBackground, BODY_GAP, anchorX, backgroundArea, backgroundPrints, backgroundRect, boxLeft, intersectBox,
  readHeaderLayout, BG_MAX_EDGE, downscaleSize, readReportOption } from './report-header-layout';
import { AgeStyle, formatAge } from './patient-age';
import { CLASSIC_THEME, ReportTypeTheme, TypeEl, TypeWeight, reportTypeTheme, tokenSize } from './report-theme';
import { SOURCE_SANS_FAMILY, installReportFonts, loadReportFonts } from './report-fonts';
import { renderReportChart, setReportChartContext, reportChartLead } from './report-chart/report-chart.report';
import { applyReportSequencing, readReportSequencing } from './report-sequencing';
import { drawReportNote, drawReportNoteLine, layoutReportNote, type NoteLayout, type NoteTypeset } from './report-note-pdf';
import {
  bodyArea, collapseMissingAnalyzerBoxes, manualRowsByBox, printableBoxes, readPageLayout, tableChain, type BodyArea as ProfileBodyArea,
} from './report-profile-layout';
import {
  drawAnalyzerImageBox, drawNotesBox,
} from './report-profile-layout.pdf';

/**
 * Render an A4 lab report PDF in the Classic template style — blue
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
 * table that mirrors the classic shape (Investigation · Result ·
 * Reference Value · Unit).
 */
export interface ReportPdfInput {
  /** Admin live-preview: keep every configured column visible even when empty. */
  previewKeepEmptyColumns?: boolean;
  /** Designer hook (profile one-page layout): told the EXACT body rect (pt)
   *  and page each one-page profile's boxes were placed in, so the designer
   *  lays its draggable outlines over the very pixels the PDF drew. Never
   *  set by a real report path. */
  /** Designer only: print every Custom-layout page even when it has nothing
   *  on it yet (a page just added), so the lab sees its letterhead. */
  keepEmptyLayoutPages?: boolean;
  onOnePageBody?: (info: { pkg: string; page: number; layoutPage?: number; boxId?: string; rowsPrinted?: number;
    body: { top: number; bottom: number; left: number; right: number; w: number; h: number };
    /** Where the results table really ended (pt), when it ended on this page;
     *  null = it ran onto the next page. */
    tableBottom?: number | null;
    /** The table's natural height (pt, head + rows at the box's row spacing, before any Fill). */
    tableNaturalH?: number | null }) => void;
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
   *  the renderer reads it instead of the hardcoded Classic defaults —
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
  /** PRINT ONLY — leave the header & footer areas blank (same margins as the
   *  template's letterpad reserves) so the body lands on the lab's pre-printed
   *  stationery. Set solely by a print entry point, after asking the user
   *  (`askPrintLetterhead`, when the template's `letterpadMode` is on). Every
   *  other render — preview, download, share, WhatsApp, the archived PDF, the
   *  public link — leaves it unset, so a digital report ALWAYS carries the
   *  lab's letterhead regardless of the letterpad setting. */
  blankLetterhead?: boolean;
  /** Public web origin the patient-strip QRs point at. Defaults to
   *  `environment.reportPublicBaseUrl` (never window.location.origin — that is
   *  capacitor://localhost in the native app). */
  publicBaseUrl?: string;
  /** Order tracking token for the patient-strip Order QR, for reports whose
   *  snapshot predates `order.trackToken`. The snapshot's own token wins. */
  orderTrackToken?: string | null;
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
  // Body font scale — 1.0 = current Classic size
  fontScale: number;
  // Layout
  headerPreset: HeaderPreset;
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

/** The snapshot's age at collection in `style` — the shared patient-age
 *  helper: adults print as before ("34 Years" / "34 yrs"), an infant as
 *  months / days ("8 Months", "12 days") — never "0 Years". */
function snapAge(snap: ReportSnapshot, style: AgeStyle): string {
  const p = snap.patient;
  if (!p) return '';
  const age = typeof p.age === 'string' ? (p.age.trim() === '' ? null : Number(p.age)) : p.age;
  return formatAge({ age: age ?? null, ageDisplay: p.ageDisplay ?? null, ageYears: p.ageYears ?? null }, style);
}

interface ReportSnapshot {
  patient?: {
    /** Patient id — the patient-strip Profile QR opens /p/{id}. */
    id?: string;
    displayName?: string;
    /** Whole years at collection (server: DOB-derived). */
    age?: number | string;
    /** "34 Y" / "8 M" / "12 D" at collection (server; newer snapshots). */
    ageDisplay?: string | null;
    /** Fractional band age at collection (server; newer snapshots). */
    ageYears?: number | null;
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
    /** Order tracking token (same as the invoice QR) — the patient-strip
     *  Order QR opens /track/{token} (status + soft-copy download). */
    trackToken?: string | null;
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
    /** Analyzer images (M51 histograms/scattergrams…), keyed by instrument
     *  image code — the profile ONE-PAGE layout's analyzer boxes read this
     *  (report-profile-layout.ts). Absent/empty for every test that carries
     *  none; doesn't affect `images` or the normal Images-block rendering. */
    analyzerImages?: Record<string, string> | null;
    /** Per-REPORT value picker: parameter names the tech unticked for this
     *  order — their rows never print (bench record keeps them). */
    hidden?: string[] | null;
    testId?: string;
    name?: string;
    department?: string;
    departmentCode?: string;
    /** The line's department id (mw snapshots from 2026-09-30) — the
     *  Sequencing match key; older snapshots match by code / name. */
    departmentId?: string | null;
    /** The tube's sample ID — shown on the department band. */
    sampleId?: string | null;
    /** The report profile's own test number (Sequencing → test number). */
    profileCode?: string | null;
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
    /** The technician's report note on THIS ordered line (markup — see
     *  report-note-markup.ts). Printed under its rows, before its
     *  interpretation. */
    techNote?: string | null;
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
  /** Technician notes above the line level (Lab settings → "Technician notes
   *  on report"): the whole order's (end of the report), each department
   *  section's (end of that section) and each profile block's. */
  techNotes?: {
    order?: string | null;
    departments?: Array<{ department?: string | null; departmentId?: string; note?: string | null }> | null;
    profiles?: Array<{ profileTestId?: string; name?: string | null; note?: string | null }> | null;
  } | null;
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
// Content floor: nothing in the body prints below A4.h - MARGIN_BOTTOM. It is
// the real footer band (date strip + the last page's disclaimer / footer
// text — see footerFloor) and NOTHING more: sign-off space is reserved only
// where a department actually signs (see renderColumnarTable), never on every
// page. It used to be a fixed 150pt, sized for a per-page signature row that
// no longer prints — ~86pt of every page was lost to it.
let MARGIN_BOTTOM = 150;
let HEADER_RESERVE = 70; // drawn letterhead height above the patient block
let LETTERPAD = false;   // pre-printed-letterpad mode: blank header/footer, body only
const MM_TO_PT = 2.834645669; // 1mm in PDF points (72dpi)

// ── Classic palette ───────────────────────────────────────────────
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
let ON_ONE_PAGE_BODY: ReportPdfInput['onOnePageBody'] | null = null; // designer hook only
let KEEP_EMPTY_LAYOUT_PAGES = false; // designer only
let CANON_COLS: { type: 'result' | 'range' | 'unit'; label: string }[] = [];
/** Lookup of pre-fetched image data URLs for the current render. Set
 *  inside buildReportPdf from input.imageCache. */
let IMG_CACHE: Record<string, string> = {};
/** Template logo URL for the page-1 watermark combination (set per build). */
let WM_LOGO_URL: string | null = null;
/** Letterhead + footer layout of the current render (set in buildReportPdfWithLayout). */
let LAYOUT: ReportLayoutResult | null = null;
/** The next added page opens with the letterhead (the department pages after
 *  the abnormal-results sheet) — it gets the first-page backgrounds too. */
let NEXT_PAGE_IS_FIRST = false;
/** Patient-strip QR targets for the current render (see patient-strip-qr.ts). */
let STRIP_QR: { base: string; trackToken: string | null } = { base: '', trackToken: null };

/** Technician department notes of the current render, keyed by the
 *  department name as printed (trimmed, upper-cased) — drawn at the end of
 *  that department's section; any not drawn there print after the results. */
let TECH_DEPT_NOTES = new Map<string, { name: string; note: string }>();

/** Per-render theme — frozen once at the start of buildReportPdf.
 *  Functions read from these closure-captured vars at draw time. */
let theme: ResolvedTheme = defaultTheme();

// ── Typography — the report theme's token table (report-theme.ts) ──────
// EVERY text draw below names its element and takes font / size / weight
// from TYPE; no draw site carries a literal font size. Classic's table holds
// the sizes this renderer always used (byte-identical paper); the Modern
// theme embeds Source Sans 3 (report-fonts.ts) when it is loaded.
let TYPE: ReportTypeTheme = CLASSIC_THEME;
/** The theme's embedded family is registered on the current document. */
let EMBEDDED = false;

/** [font name, jsPDF style] for a weight in the current theme. The built-in
 *  PDF fonts have no semibold (it draws bold); Source Sans has no bold
 *  italic (it draws bold). */
function faceOf(weight: TypeWeight): [string, string] {
  if (EMBEDDED) return [SOURCE_SANS_FAMILY, weight === 'bolditalic' ? 'bold' : weight];
  return [PDF_FONT, weight === 'semibold' ? 'bold' : weight];
}
function setFace(doc: jsPDF, weight: TypeWeight): void {
  const [f, st] = faceOf(weight);
  doc.setFont(f, st);
}
/** An element's size (pt) under the template's font scale. */
function tsz(el: TypeEl): number {
  return tokenSize(TYPE.tokens[el], theme.fontScale);
}
/** An element's weight. */
function twt(el: TypeEl): TypeWeight {
  return TYPE.tokens[el].weight;
}
/** Set the font + size an element prints in; returns the size. */
function typeset(doc: jsPDF, el: TypeEl): number {
  setFace(doc, twt(el));
  const size = tsz(el);
  doc.setFontSize(size);
  return size;
}
/** An element's jsPDF style name (autotable `fontStyle`). */
function styleOf(el: TypeEl): string {
  return faceOf(twt(el))[1];
}
/** autotable cell styles for an element: font, style and size. */
function cellType(el: TypeEl): { font: string; fontStyle: string; fontSize: number } {
  const [font, fontStyle] = faceOf(twt(el));
  return { font, fontStyle, fontSize: tsz(el) };
}

function defaultTheme(): ResolvedTheme {
  return {
    accent: '#0066CC', primary: '#1B3A6B', body: '#1a1a1a', divider: '#cccccc',
    tableHeaderBg: '#ffffff', tableHeaderText: '#000000',
    font: PDF_FONT, fontScale: 1,
    headerPreset: 'classic', logoPosition: 'left', logoSize: 'md', topAccentBar: true,
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
 *  renderer. Template values win; practice + Classic defaults fill gaps. */
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
  // back to the sane Classic defaults instead of breaking jsPDF's
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
  t.headerPreset    = normalizeHeaderPreset(tpl.headerPreset);
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
  rows.forEach((r, i) => {
    if (i % 2 === 0 && i > 0) y += 13;
    const x = MARGIN_X + (i % 2) * colW;
    const label = `${r.title}: `;
    typeset(doc, 'customFieldLabel');
    doc.setTextColor(BLACK);
    doc.text(label, x, y);
    typeset(doc, 'customFieldValue');
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
  return buildReportPdfWithLayout(input).doc;
}

/** The page chrome (letterhead + footer lines) exactly as `buildReportPdf`
 *  would place it — the report designer outlines these boxes over the
 *  rendered page. Same theme resolution, same seeds, same overrides. */
export function computeReportPageLayout(input: ReportPdfInput): ReportLayoutResult {
  const { practice, template } = prepareRender({ ...input, blankLetterhead: false });
  const doc = newReportDoc();
  installPdfTextSanitizer(doc);   // it also widens symbol glyphs — measure like the real render
  EMBEDDED = !!TYPE.embedded && installReportFonts(doc);
  return computeReportLayout(doc, practice, template?.logoUrl ?? null, template);
}

/** A fresh A4 document. An embedded-font theme writes only the fonts it
 *  used and deflates its streams (the embedded font subsets are ~80 KB a
 *  face uncompressed — compressed, the Modern report stays close to a
 *  Classic one); Classic keeps jsPDF's defaults (byte-identical output). */
function newReportDoc(): jsPDF {
  return TYPE.embedded
    ? new jsPDF({ unit: 'pt', format: 'a4', putOnlyUsedFonts: true, compress: true })
    : new jsPDF({ unit: 'pt', format: 'a4' });
}

/** Theme + images + practice merge + margins for one render (module state). */
function prepareRender(input: ReportPdfInput): { practice: NonNullable<ReportPdfInput['practice']>; template: ReportTemplate | null; snap: ReportSnapshot } {
  const { report, practice: rawPractice = {}, template = null, imageCache = {} } = input;
  // Calculated values print like any other value — no "(Calculated)"
  // marker on a test / profile name (see report-name.ts).
  // Report Sequencing (designer → Sequencing): the lab's department / test
  // order, applied to the snapshot BEFORE anything reads it — a no-op (same
  // array) for labs that never set it (report-sequencing.ts).
  const snap = sequenceSnapshot(cleanSnapshotNames(parseSnapshot(report.data)), template);
  IMG_CACHE = imageCache;

  // Merge template identity fields into the practice shape. The drawing
  // functions read from `practice.{name,address,phone,email,website,nablNumber}`
  // for legacy reasons; without this merge, edits to those fields in
  // the admin editor (which only passes `template`) wouldn't appear in
  // the live preview because every read fell back to the Classic defaults.
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
  TYPE = reportTypeTheme(template);
  EMBEDDED = false;
  // Per-report signatories (who validated / entered results) take precedence
  // over the admin template signature slots. Their signatureUrls are embedded
  // data URLs, so no prefetch is required.
  if (snap.signatures && snap.signatures.length > 0) theme.signatures = snap.signatures;

  // Blank-letterhead PRINT: skip the rendered header + footer and reserve
  // blank top/bottom space on every page (the lab's stationery occupies it),
  // printing only the results body. Driven ONLY by the per-print-job
  // `blankLetterhead` option — never by the template flag on its own, so no
  // digital output loses its letterhead. Reset to the normal defaults
  // otherwise (module-level margins persist across renders).
  LETTERPAD = !!input.blankLetterhead;
  STRIP_QR = {
    base: input.publicBaseUrl ?? environment.reportPublicBaseUrl ?? '',
    trackToken: snap.order?.trackToken || input.orderTrackToken || null,
  };
  PREVIEW_KEEP_EMPTY_COLS = !!input.previewKeepEmptyColumns;
  ON_ONE_PAGE_BODY = input.onOnePageBody ?? null;
  KEEP_EMPTY_LAYOUT_PAGES = !!input.keepEmptyLayoutPages;
  if (LETTERPAD) {
    MARGIN_TOP = Math.max(0, template?.letterpadHeaderMm ?? 45) * MM_TO_PT;
    MARGIN_BOTTOM = Math.max(20, template?.letterpadFooterMm ?? 30) * MM_TO_PT;
    HEADER_RESERVE = 0;
  } else {
    MARGIN_TOP = 28;
    MARGIN_BOTTOM = 150; // placeholder — replaced by footerFloor() once the footer layout is resolved
    HEADER_RESERVE = 70;
  }
  return { practice, template, snap };
}

/** Build the PDF and hand back the letterhead/footer layout it drew with. */
export function buildReportPdfWithLayout(input: ReportPdfInput): { doc: jsPDF; layout: ReportLayoutResult } {
  const report = input.report;
  const { practice, template, snap } = prepareRender(input);
  const doc = newReportDoc();
  // Built-in PDF fonts are cp1252-only: superscripts (×10⁹/L), subscripts
  // (CO₂) and Greek (β-hCG) would otherwise print as garbage. One wrapper on
  // doc.text covers every draw here AND inside jspdf-autotable. (An embedded
  // theme font prints them natively — the wrapper then passes text through.)
  installPdfTextSanitizer(doc);
  // The Modern theme's Source Sans 3 — when not loaded (preloadReportImages
  // loads it), the theme's sizes print in Helvetica rather than failing.
  EMBEDDED = !!TYPE.embedded && installReportFonts(doc);
  // Safety net (RCA 2026-09-27): a standalone test with values whose layout
  // has no results table gets the default one — every caller (report viewer,
  // queue, public link, test-editor live preview) prints the RESULT, never a
  // Sentence alone. Idempotent with resolveReportLayouts (results-table.ts).
  const resolvedLayouts = withResultsTables(input.resolvedLayouts ?? {}, snap.tests ?? []);
  // Letterhead + footer lines: one resolved layout drives the drawing below
  // AND the designer's outlines. An edited letterhead may be taller than the
  // old fixed reserve — the patient details start below it, never under it.
  const layout = computeReportLayout(doc, practice, template?.logoUrl ?? null, template);
  LAYOUT = layout;
  if (!LETTERPAD) HEADER_RESERVE = layout.bodyTop - MARGIN_TOP;
  if (!LETTERPAD) MARGIN_BOTTOM = footerFloor(layout);
  // Background images go down FIRST on every page they print on, so text,
  // the logo and the results always draw over them. Page 1 now; later pages
  // (ours or autotable's) as each is added.
  if (layout.backgrounds.some(b => !b.hidden && b.loaded)) {
    drawBackgrounds(doc, 1);
    const ev = (doc as unknown as { internal: { events: { subscribe(n: string, f: (p: { pageNumber?: number }) => void): unknown } } }).internal.events;
    ev.subscribe('addPage', () => drawBackgrounds(doc, NEXT_PAGE_IS_FIRST ? 1 : doc.getNumberOfPages()));
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
  TECH_DEPT_NOTES = new Map();
  // In the order the report prints its departments (the tests' order — the
  // lab's Sequencing when set), so the notes of sections without a table,
  // drawn after the results, follow the same sequence; then any others.
  const deptNotes = (snap.techNotes?.departments ?? [])
    .map(d => ({ name: (d.department ?? '').trim(), note: (d.note ?? '').trim() ? d.note! : '' }))
    .filter(d => d.name && d.note);
  const printOrder = [...new Set((snap.tests ?? []).map(t => (t.department ?? '').trim().toUpperCase()).filter(Boolean))];
  const rank = (n: string) => { const i = printOrder.indexOf(n.toUpperCase()); return i < 0 ? printOrder.length : i; };
  for (const d of [...deptNotes].sort((x, y) => rank(x.name) - rank(y.name))) {
    TECH_DEPT_NOTES.set(d.name.toUpperCase(), d);
  }
  drawLetterhead(doc);
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
  // Report charts plot from the snapshot's own values (report-chart.report.ts).
  setReportChartContext(tests, resolvedLayouts);
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
    // Sentences alone don't either: next to a results table they print as
    // full-width rows INSIDE it (owner 2026-09-28, like the Method line).
    // A report chart doesn't either: the test's values stay in the table
    // (with their saved H / L flags) and the chart prints after it (below).
    const narrative = !t.packageTestId
      && !!layout && layout.sections.some(s => s.isVisible && s.type !== 'grid' && s.type !== 'image' && !isReportChart(s))
      && !sentencesFitTable(layout);
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
    // A test's own Sentences ride in its rows only when it was ordered on
    // its own — a member's notes never print (see the profile merge below).
    const g = buildPanelGroup(t, t.testId ? resolvedLayouts[t.testId] : undefined,
      { sentences: !t.packageTestId });
    g.sampleId = t.sampleId ?? undefined;
    // The abnormal-results sheet lists validated values only.
    if (!summaryTestValidated(t)) for (const r of g.rows) r.unvalidated = true;
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
    if (!pkg) { insertTechNote(g.rows, techNoteRow(t.techNote, 'Note:')); g.rows.push(...obsRowsFor(t)); groups.push(g); continue; }
    // Stash this member's observations for the profile block (appended below).
    const memberObs = obsRowsFor(t);
    if (memberObs.length) {
      const arr = profileObs.get(pkg) ?? [];
      arr.push(...memberObs);
      profileObs.set(pkg, arr);
    }
    let merged = byPkg.get(pkg);
    if (merged && g.fromResults) merged.fromResults = true;
    if (merged && g.sampleId && !merged.sampleIds?.includes(g.sampleId)) {
      (merged.sampleIds ??= []).push(g.sampleId);
    }
    if (!merged) {
      // Method varies per member — a single method claim on the profile band
      // would be wrong, so the merged panel carries none.
      merged = { ...g, fromResults: g.fromResults, testName: pkgName || g.testName, method: undefined, methodLine: undefined, rows: [],
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
      // Its Sentences are among them — merged rows closing the block.
      const pkgNotes = (resolvedLayouts[pkg]
        ? buildPanelGroup({ ...t, testId: pkg, name: pkgName ?? '' } as typeof t, resolvedLayouts[pkg],
            { sentences: true }).rows
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
    // The member's own technician note sits right under ITS rows, named —
    // inside the profile block several members share one band.
    const memberNote = techNoteRow(t.techNote, `Note (${(g.testName || t.name || 'Test').trim()}):`);
    if (memberNote) merged.rows.push(memberNote);
  }
  // The profile block's methods come from its members' rows (each row carries
  // its value's effective method): one method for every member → "Method: X";
  // members measured differently → each method named with its values. The
  // band used to claim none, so a member's methodology never reached the
  // report (RCA 2026-09-28).
  for (const panel of byPkg.values()) applyValueMethods(panel);
  // The profile's technician note closes its member rows — before the
  // profile's own notes (interpretation), like a line note.
  for (const pn of snap.techNotes?.profiles ?? []) {
    const panel = pn.profileTestId ? byPkg.get(pn.profileTestId) : undefined;
    const row = techNoteRow(pn.note, 'Note:');
    if (panel && row) panel.rows.push(row);
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
  // A test / profile block whose every value was empty prints nothing at all
  // (no band, no notes) — and a department left with no block disappears
  // with it, since sections are built from these groups (owner 2026-10-03).
  dropValuelessGroups(groups);

  // ── Profile ONE-PAGE report layouts (owner, 2026-10-02) ─────────────────
  // A profile whose Printed-report tab has an ENABLED `page_layout` section
  // is pulled OUT of the normal continuous table entirely and rendered on
  // its own forced page by renderOnePageProfile() (below), side-by-side
  // table + charts + analyzer images + that department's signatures. A
  // profile without one (every profile before this feature, and any that
  // hasn't opted in) never enters this branch — `onePageBundles` stays
  // empty and `groups` is untouched, so the rest of this function runs
  // EXACTLY as it always has (byte-identical output; see
  // report-pdf.one-page-layout.spec.ts).
  // `before` = how many ordinary blocks precede the profile in REPORT
  // SEQUENCE order — the custom layout prints at that point (Custom layout,
  // owner 2026-10-02), not after everything.
  const onePageBundles: Array<{ pkg: string; group: PanelGroup; layout: ResolvedReportLayout; before: number }> = [];
  for (const [pkg, group] of byPkg) {
    const lay = resolvedLayouts[pkg];
    const pl = lay && readPageLayout(lay.sections);
    if (pl?.enabled && (pl.pages ?? []).some(pg => pg.boxes.length > 0)) onePageBundles.push({ pkg, group, layout: lay, before: 0 });
  }
  if (onePageBundles.length > 0) {
    const bundleOf = new Map<PanelGroup, (typeof onePageBundles)[number]>(onePageBundles.map(b => [b.group, b]));
    let ordinary = 0;
    for (const g of groups) { const b = bundleOf.get(g); if (b) b.before = ordinary; else ordinary++; }
    onePageBundles.sort((x, y) => groups.indexOf(x.group) - groups.indexOf(y.group));
    for (let i = groups.length - 1; i >= 0; i--) if (bundleOf.has(groups[i])) groups.splice(i, 1);
  }

  // The profile's own NARRATIVE blocks (images, charts) render once under
  // the profile's name, after the table. Its Sentences already closed the
  // profile's block in the table (above) — only a profile with no block
  // there (every member printed elsewhere) keeps them in this narrative.
  // Profiles have no row of their own in the snapshot, so stand one in from
  // a member.
  /** Layout a special entry renders with, when not its resolved one. */
  const specialLayout = new Map<object, ResolvedReportLayout>();
  const benchBundles = new Map<string, (typeof tests)[number]>();
  for (const t of tests) {
    const legacy = t.packageType == null;
    const b = t.profileTestId
      ?? (t.packageType === 'profile' ? t.packageTestId : null)
      ?? (legacy ? t.packageTestId : null);
    if (b && !benchBundles.has(b)) benchBundles.set(b, t);
  }
  const onePagePkgs = new Set(onePageBundles.map(b => b.pkg));
  for (const [pkg, member] of benchBundles) {
    // A one-page-layout profile draws its OWN chart/image boxes inside its
    // dedicated page (renderOnePageProfile, below) — never also here, or its
    // chart would print twice.
    if (onePagePkgs.has(pkg)) continue;
    const pl = resolvedLayouts[pkg];
    const inTable = byPkg.has(pkg);
    // Only when there is something to PRINT. A visible-but-empty paragraph
    // (the notes editor saves a blank one freely) used to sail through and
    // render the profile's name as a big lone heading after the table.
    const hasNarrative = pl?.sections.some(s =>
      s.isVisible && s.type !== 'grid' && (
        (s.type === 'paragraph' && !inTable && !!s.content?.trim()) ||
        (s.type === 'image' && (s.imageUrls?.length ?? 0) > 0) ||
        (s.type === 'chart' && (!!s.chart || !!s.trend))
      ));
    if (!hasNarrative) continue;
    const entry = { ...member, testId: pkg, packageTestId: null, profileTestId: null,
                   name: (member.profileTestId === pkg ? member.profileName : member.packageName)
                         || pl.testName || '' };
    if (inTable) specialLayout.set(entry, { ...pl, sections: pl.sections.filter(s => s.type !== 'paragraph') });
    special.push(entry);
  }

  // A standalone tabular test's report CHARTS print after the table, under
  // its name — its values stay in the table with their saved flags, so the
  // table and the chart show the same verdicts (docs/REPORT-CHARTS.md).
  for (const t of tabular) {
    if (t.packageTestId || !t.testId) continue;
    const lay = resolvedLayouts[t.testId];
    const charts = lay?.sections.filter(s => s.isVisible && isReportChart(s)) ?? [];
    if (!lay || charts.length === 0) continue;
    const entry = { ...t, images: null };            // a copy: not re-listed / re-imaged
    specialLayout.set(entry, { ...lay, sections: charts });
    special.push(entry);
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
  // "Show method line" (template.showMethod) gates the "Method: …" sub-line
  // under panel bands; off (the default) → never printed.
  if (!template?.showMethod) for (const g of groups) g.hideMethodLine = true;
  // "Show specimen line" (template metadata option) adds "Specimen: …".
  if (readReportOption(template, 'specimenLine')) for (const g of groups) g.showSpecimenLine = true;

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

  // ── Consolidated sheet: "Summary of abnormal results" as page 1 ──
  // (Lab settings switch → template metadata option.) The department pages
  // then open on a fresh page with the letterhead + patient block, exactly as
  // page 1 of the report reads without the sheet.
  if (readReportOption(template, 'abnormalSummary')) {
    const sheet = collectAbnormalResults([
      ...inScope, ...outScope,
      // Narrative tests print their grid values after the table — same rows.
      ...special.filter(t => tests.includes(t)
          && (t.result as { microFormat?: string } | null)?.microFormat !== 'culture_sensitivity')
        .map(t => {
          const g = buildPanelGroup(t, t.testId ? resolvedLayouts[t.testId] : undefined);
          if (!summaryTestValidated(t)) for (const r of g.rows) r.unvalidated = true;
          return g;
        }),
    ]);
    if (sheet.length > 0) {
      renderAbnormalSummary(doc, sheet, cursorY, {
        typeset, cellType, primary: theme.primary, black: BLACK, text: TEXT,
        dim: TEXT_DIM, hair: HAIR, flagStyle: theme.flagStyle, flagIndicator: theme.flagIndicator,
        abnormalColor: theme.abnormalColor, abnormalLowColor: theme.abnormalLowColor,
        pageW: A4.w, marginX: MARGIN_X, marginBottom: MARGIN_BOTTOM,
        continueTop: tablePageMargins().top,
        bodyStyles: tableBodyStyles(), headStyles: tableHeadStyles(), zebra: theme.zebraRows,
        ...summaryCellHooks(doc),
      });
      NEXT_PAGE_IS_FIRST = true;
      try { doc.addPage(); } finally { NEXT_PAGE_IS_FIRST = false; }
      drawLetterhead(doc);
      cursorY = drawCustomPatientFields(doc, snap, drawPatientBlock(doc, snap, report)) + 14;
    }
  }

  // ── Composition: ordinary blocks and Custom-layout profiles in REPORT
  // SEQUENCE order (owner 2026-10-02). A custom-layout profile starts on its
  // own page and prints its designed pages; the blocks after it start on a
  // fresh page. Each department signs ONCE, after its LAST item in the
  // report (an ordinary block's inline sign-off, or the profile's
  // signatures box) — never in an earlier segment.
  type Segment = { kind: 'groups'; groups: PanelGroup[]; scopeHeading?: boolean } | { kind: 'custom'; b: (typeof onePageBundles)[number] };
  const segments: Segment[] = [];
  {
    let taken = 0;
    for (const b of onePageBundles) {
      // Bundle positions are counted over ALL ordinary blocks; the in-scope
      // list is that order minus the out-of-scope ones.
      const upTo = groups.slice(0, b.before).filter(g => inScope.includes(g)).length;
      if (upTo > taken) segments.push({ kind: 'groups', groups: inScope.slice(taken, upTo) });
      segments.push({ kind: 'custom', b });
      taken = Math.max(taken, upTo);
    }
    if (inScope.length > taken) segments.push({ kind: 'groups', groups: inScope.slice(taken) });
    if (outScope.length > 0) segments.push({ kind: 'groups', groups: outScope, scopeHeading: true });
  }
  const deptOf = (g: PanelGroup) => (g.department ?? '').trim();
  const lastSegOfDept = new Map<string, number>();
  segments.forEach((sg, i) => {
    const ds = sg.kind === 'groups' ? sg.groups.map(deptOf) : [deptOf(sg.b.group)];
    for (const d of ds) lastSegOfDept.set(d, i);
  });
  const sigsOnlyFor = (i: number) => new Map([...deptSigs].filter(([d]) => lastSegOfDept.get(d) === i));
  let pageHasContent = false;
  segments.forEach((sg, i) => {
    const isFinal = i === segments.length - 1;
    if (sg.kind === 'groups') {
      if (i > 0 && segments[i - 1].kind === 'custom') {
        // Blocks after a custom layout open a fresh page that reads like the
        // layout's own pages: letterhead + patient block, then the results.
        NEXT_PAGE_IS_FIRST = false;
        doc.addPage();
        drawLetterhead(doc);
        cursorY = drawCustomPatientFields(doc, snap, drawPatientBlock(doc, snap, report)) + 14;
        pageHasContent = false;
      }
      if (sg.scopeHeading) cursorY = renderScopeHeading(doc, 'TESTS NOT UNDER NABL SCOPE', cursorY + 6, practice);
      cursorY = renderContinuousTable(doc, sg.groups, cursorY, practice, null, sigsOnlyFor(i), isFinal ? finalSigs : undefined);
      pageHasContent = true;
      return;
    }
    const dept = deptOf(sg.b.group);
    const sigs = deptSigs.get(dept) ?? [];
    const signHere = lastSegOfDept.get(dept) === i;
    const res = renderCustomLayout(doc, sg.b.pkg, sg.b.group, sg.b.layout, practice, snap, report, sigs,
      { topY: pageHasContent ? undefined : cursorY, signHere });
    cursorY = res.bottom;
    pageHasContent = true;
    // Last item of its department but no signatures box in the layout: the
    // sign-off still prints — below the End of Report when this is the
    // report's final item, else right under the layout.
    if (signHere && !res.signed && sigs.length) {
      if (isFinal) finalSigs.sigs = sigs;
      else cursorY = drawInlineSignatures(doc, sigs, cursorY + 8, practice);
    }
  });

  // Tech attachments for TABULAR tests — the columnar table has no
  // per-test section hook, so their shown images print here, labelled.
  // The Test Master's Images block is the print switch: hidden (all image
  // sections invisible) = lab-only traceability, nothing on the PDF.
  for (const t of tabular) {
    let imgs = (t as { images?: string[] | null }).images ?? [];
    // A one-page-layout profile's analyzer graphs print in their own boxes —
    // never a second time in this images block.
    const bundle = t.profileTestId ?? (t.packageType === 'profile' ? t.packageTestId : null) ?? (t.packageType == null ? t.packageTestId : null);
    if (bundle && onePagePkgs.has(bundle) && t.analyzerImages) {
      const graphs = new Set(Object.values(t.analyzerImages));
      imgs = imgs.filter(u => !graphs.has(u));
    }
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
    const layout = specialLayout.get(t) ?? (t.testId ? resolvedLayouts[t.testId] : undefined);
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
    // Its technician note (a narrative / culture test has no table row for it).
    if (tests.includes(t) && (t.techNote ?? '').trim()) {
      cursorY = drawTechNoteBlock(doc, t.techNote!, 'Note:', cursorY + 4, practice);
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

  // Department notes whose section never printed as a table (a culture /
  // narrative-only department), then the whole order's note — the last
  // words before the End-of-Report marker and the sign-off.
  for (const d of TECH_DEPT_NOTES.values()) {
    cursorY = drawTechNoteBlock(doc, d.note, `${titleCaseHeader(d.name)} note:`, cursorY + 6, practice);
  }
  TECH_DEPT_NOTES.clear();
  if ((snap.techNotes?.order ?? '').trim()) {
    cursorY = drawTechNoteBlock(doc, snap.techNotes!.order!, 'Overall note:', cursorY + 8, practice);
  }

  // ── "****End of Report****" line, plus — when the final department
  // defers its sign-off to below it — that signature block, decided as ONE
  // unit (owner's report 2026-10-01: a chart-and-table page with room to
  // spare still sent the sign-off alone to an almost-empty page 2, because
  // the marker's own 26pt reserve said yes while the signatures' separate,
  // later check said no — "****End of Report****" was left stranded on
  // page 1 instead of moving WITH its signatures). Reserving both up front
  // means a page break (when genuinely needed) carries the marker along,
  // and when the block fits — as it does whenever real free space remains —
  // nothing moves at all (no over-reservation on the common case). ────
  // drawEndOfReport always advances cursorY by exactly 12 (startY + 12, the
  // marker's own baseline step) — so the EXACT follow-on space it needs is
  // 12 + the signature block's measured height, plus the same SIGN_OFF_SLACK
  // every other sign-off reserve already carries (never a second, bigger
  // "just in case" buffer stacked on top — that would send reports to a
  // needless extra page on the common, fits-fine case).
  const deferredSigH = finalSigs.sigs?.length ? signatureBlockHeight(finalSigs.sigs) : 0;
  const eorReserve = deferredSigH > 0 ? 12 + deferredSigH + SIGN_OFF_SLACK : 26;
  if (cursorY > A4.h - MARGIN_BOTTOM - eorReserve) { cursorY = newPage(doc, practice); }
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
    // Height comes from the block itself (only the signatories present:
    // 1-4 are one row, 5-7 wrap into balanced rows) and the anchor rises to
    // fit them so the LAST row still lands on the footer band. The reserve
    // above already guarantees this fits on the CURRENT page — the guard
    // inside drawInlineSignatures is a last-resort only.
    const anchored = Math.max(cursorY, A4.h - MARGIN_BOTTOM - deferredSigH);
    cursorY = drawInlineSignatures(doc, finalSigs.sigs, anchored, practice);
  }

  // ── Signature footer + page numbers (every page, drawn last) ───
  // Skipped in letterpad mode — the blank MARGIN_BOTTOM reserve is where the
  // lab's own pre-printed footer/signatures sit.
  if (!LETTERPAD) drawSignatureFooter(doc, practice, snap);
  return { doc, layout };
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

/** Fetch a single image and re-encode it as a PNG data URL via canvas.
 *  jsPDF.addImage accepts PNG/JPEG data URLs directly but not raw URLs —
 *  hence the manual fetch + canvas pass. Re-encoding via canvas also
 *  normalises SVG/WEBP/JPEG into PNG so all uploaded formats work. */
async function fetchAsDataUrl(url: string, baseUrl: string, signed?: Record<string, string> | null,
                              /** Backgrounds: cap the longest side (px) and keep JPEGs as JPEG (a photo re-encoded as PNG is ~5× bigger). */
                              opts?: { maxEdge?: number; keepJpeg?: boolean }): Promise<string | null> {
  try {
    // Uploads are private: "/uploads/…" goes through the session (or the
    // public page's signed URL) — see shared/utils/upload-fetch.ts.
    const blob = await fetchAssetBlob(url, baseUrl, signed);
    if (!blob) return null;
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
      const nw = img.naturalWidth || 200, nh = img.naturalHeight || 200;
      const size = opts?.maxEdge ? downscaleSize(nw, nh, opts.maxEdge) : { w: nw, h: nh };
      canvas.width = size.w;
      canvas.height = size.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      if (size.w === nw && size.h === nh) ctx.drawImage(img, 0, 0);
      else ctx.drawImage(img, 0, 0, size.w, size.h);
      if (opts?.keepJpeg && /jpe?g/i.test(blob.type)) return canvas.toDataURL('image/jpeg', 0.88);
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
  baseUrl: string,
  /** Public report page only: stored path → signed URL (from its verify call). */
  signed?: Record<string, string> | null,
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
    for (const t of snap.tests ?? []) {
      for (const u of t.images ?? []) urls.add(u);
      for (const u of Object.values(t.analyzerImages ?? {})) if (u) urls.add(u);
    }
  } catch { /* malformed snapshot — images just won't preload */ }
  for (const l of Object.values(input.resolvedLayouts ?? {})) {
    for (const sec of l.sections ?? []) for (const u of sec.imageUrls ?? []) urls.add(u);
  }

  // Background images (report designer, template metadata): capped at A4 @ 300 dpi.
  const bgUrls = new Set((readHeaderLayout(tpl)?.backgrounds ?? []).map(b => b.url).filter(Boolean));

  const cache: Record<string, string> = {};
  await Promise.all([
    // The report theme's embedded fonts ride the same async step: every
    // entry point (viewer, download, print, public link, designer preview)
    // already awaits this before its sync render.
    prepareReportTheme(tpl),
    ...Array.from(new Set([...urls, ...bgUrls])).map(async u => {
      if (!u) return;
      const data = await fetchAsDataUrl(u, baseUrl, signed, bgUrls.has(u) ? { maxEdge: BG_MAX_EDGE, keepJpeg: true } : undefined);
      if (data) cache[u] = data; // key by original (relative) URL — what the template stores
    }),
  ]);
  return cache;
}

/** Load what the template's report theme needs before a (sync) render — the
 *  Modern theme's Source Sans 3 files, fetched once per session. Classic
 *  needs nothing and fetches nothing. Never throws. */
export async function prepareReportTheme(tpl: ReportTemplate | null | undefined): Promise<void> {
  if (reportTypeTheme(tpl).embedded) await loadReportFonts();
}

// ──────────────────────────────────────────────────────────────
// Letterhead — "LAB NAME" wordmark, address, phone, web band
// ──────────────────────────────────────────────────────────────

/** Renders the tagline by splitting on '|' and colouring each separator
 *  pipe with the accent colour (classic style). For taglines without
 *  pipes ("Accurate. On time.") it just renders as a single black line. */
function drawTagline(doc: jsPDF, tagline: string, x: number, y: number, size: number, style: TypeWeight) {
  setFace(doc, style);
  doc.setFontSize(size);
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

// ──────────────────────────────────────────────────────────────
// Letterhead + footer lines — ONE layout model
// ──────────────────────────────────────────────────────────────
// Each header style ("preset") SEEDS its elements at the exact positions it
// always used; the lab's overrides (report-header-layout.ts, stored in the
// template's metadata) are applied on top; the resolved items are then DRAWN
// here and OUTLINED by the report designer. A template with no layout saved
// draws byte-identically to the old per-preset functions
// (report-header-legacy.spec.ts). Measuring only sets the font (never a
// colour), so computing a layout writes nothing to the page.

/** Top of the letterhead (pt) — the normal, non-letterpad page margin. */
const LH_TOP = 28;
const FIELD_LABEL: Record<HeaderField, string> = { address: 'Address', phone: 'Phone', email: 'Email', website: 'Website' };

interface Seed {
  id: string;
  kind: LayoutItem['kind'];
  label: string;
  region?: LayoutRegion;
  x: number;
  y: number;
  align: Align;
  /** Box items: default left x for a given width (keeps a preset's centring). */
  defX?: (w: number) => number;
  /** Box items: default top y for a given height. */
  defY?: (h: number) => number;
  text?: string;
  fields?: HeaderField[];
  style?: 'normal' | 'bold' | 'italic' | 'semibold';
  size?: number;
  color?: string;
  tone?: LayoutItem['tone'];
  lineH?: number;
  reverse?: boolean;
  /** Legacy wrap width (the disclaimer always wrapped at the page width). */
  wrapDefault?: number;
  /** y is the LAST line's baseline (footer lines stack upward). */
  anchorBottom?: boolean;
  /** Legacy measuring quirks (centred tagline / website pill measured at another size). */
  measure?: { style: 'normal' | 'bold' | 'italic' | 'semibold'; size: number };
  /** Wrapping is the design (disclaimer) — not worth a note. */
  expectWrap?: boolean;
  w?: number;
  h?: number;
  url?: string | null;
  sub?: string;
}

type Resolved = LayoutItem & { defBox: LayoutItem['box'] };

function imageAspect(doc: jsPDF, url: string | null | undefined): number | null {
  const data = url ? IMG_CACHE[url] : null;
  if (!data) return null;
  try {
    const p = doc.getImageProperties(data);
    return p.width > 0 && p.height > 0 ? p.width / p.height : null;
  } catch { return null; }
}

function alignedLeft(align: Align, w: number): number {
  return align === 'center' ? (A4.w - w) / 2 : align === 'right' ? A4.w - MARGIN_X - w : MARGIN_X;
}

function finalizeBox(doc: jsPDF, s: Seed, o: ItemOverride, customized: boolean): Resolved {
  let w = s.w ?? 0, h = s.h ?? 0;
  let sizeValue = h / MM;
  const align = o.align ?? s.align;
  let fit: 'square' | 'natural' | undefined;
  if (s.kind === 'logo' || s.kind === 'nabl') {
    if (o.size) h = o.size * MM;
    w = h;
    if (s.kind === 'logo') {
      fit = o.fit ?? 'square';
      if (fit === 'natural') { const a = imageAspect(doc, s.url); if (a) w = Math.min(h * a, A4.w - 2 * MARGIN_X); }
    }
    sizeValue = h / MM;
  } else if (s.kind === 'bar' || s.kind === 'banner') {
    if (o.size) h = o.size * MM;
    sizeValue = h / MM;
  }
  const defLeft = s.defX ? s.defX(w) : s.x;
  const defTop = s.defY ? s.defY(h) : s.y;
  const movable = s.kind !== 'bar' && s.kind !== 'banner';
  const x = !movable ? s.x
    : o.x != null ? o.x * MM
    : (o.align && o.align !== s.align) ? alignedLeft(align, w) : defLeft;
  const y = s.kind === 'banner' ? 0 : o.y != null ? o.y * MM : defTop;
  const subH = s.kind === 'nabl' && s.sub ? 8 : 0;
  return {
    id: s.id, region: s.region ?? 'header', kind: s.kind, label: s.label,
    x, y, align, w, h, url: s.url, fit, sub: s.sub,
    box: { x, y, w, h: h + subH },
    defBox: { x: movable ? defLeft : s.x, y: defTop, w, h: h + subH },
    customized, sizeValue, sizeUnit: 'mm',
  };
}

function finalizeText(doc: jsPDF, s: Seed, o: ItemOverride, active: boolean, customized: boolean): Resolved {
  // A flowing theme (Modern) lays text out like an edited layout: wrapped
  // lines, the looser line height. Classic keeps the old per-style layout.
  active = active || TYPE.flowHeader;
  const align = o.align ?? s.align;
  const size = o.size ?? s.size ?? 9;
  const baseStyle = s.style ?? 'normal';
  const style = o.bold === undefined ? baseStyle : o.bold ? 'bold' : (baseStyle === 'bold' ? 'normal' : baseStyle);
  const quirk = o.size === undefined && o.bold === undefined && o.align === undefined && o.x === undefined ? s.measure : undefined;
  const x = o.x != null ? o.x * MM : (o.align && o.align !== s.align) ? anchorX(align) : s.x;
  const raw = s.text ?? '';
  const gw = (t: string) => doc.getTextWidth(t);
  setFace(doc, style);
  doc.setFontSize(size);

  let lines: string[];
  let splitLines = false;
  let wraps = false;
  let wrapW: number | null = null;
  let lineYs: number[] | undefined;
  const lineH = s.lineH ?? size * (active ? 1.2 : 1.15);
  if (s.tone === 'plain') {
    if (active) {
      const paras = raw.split(/\r?\n/).map(p => p.replace(/\s+$/, ''));
      const avail = align === 'center' ? 2 * Math.min(x - MARGIN_X, A4.w - MARGIN_X - x)
        : align === 'right' ? x - MARGIN_X : A4.w - MARGIN_X - x;
      wrapW = o.wrap !== undefined ? (o.wrap > 0 ? o.wrap * MM : null)
        : (s.wrapDefault ?? (avail > 24 ? avail : null));
      lines = [];
      for (const p of paras) {
        if (wrapW && gw(p) > wrapW + 0.01) lines.push(...(doc.splitTextToSize(p, wrapW) as string[]));
        else lines.push(p);
      }
      wraps = !s.expectWrap && lines.length > paras.length;
      splitLines = true;
    } else if (s.wrapDefault != null) {
      wrapW = s.wrapDefault;
      lines = doc.splitTextToSize(raw, s.wrapDefault) as string[];
      splitLines = true;
    } else {
      lines = [raw];
    }
  } else {
    lines = [raw];
  }

  // First baseline. Footer lines are seeded by their LAST baseline and stack up.
  let y: number;
  if (o.y != null) y = o.y * MM;
  else if (s.anchorBottom) {
    y = s.y - (lines.length - 1) * lineH;
    if (s.reverse && !active) {
      // Exactly the old loop's arithmetic (decrement from the bottom line).
      lineYs = new Array(lines.length);
      let e = s.y;
      for (let i = lines.length - 1; i >= 0; i--) { lineYs[i] = e; e -= lineH; }
    }
  } else y = s.y;

  // Width + where drawing starts.
  let w: number;
  let startX: number | undefined;
  let pillW: number | undefined;
  let box: LayoutItem['box'];
  if (s.tone === 'twoTone') {
    const t = raw.split(' ');
    w = gw(t[0] + ' ') + gw(t.slice(1).join(' '));
    startX = align === 'left' ? x : boxLeft(x, align, w);
  } else if (s.tone === 'pipes') {
    w = gw(raw.replace(/\|/g, ' | '));
    if (quirk && align === 'center') {
      setFace(doc, quirk.style); doc.setFontSize(quirk.size);
      startX = x - gw(raw.replace(/\|/g, ' | ')) / 2;
      setFace(doc, style); doc.setFontSize(size);
    } else startX = align === 'left' ? x : boxLeft(x, align, w);
  } else if (s.tone === 'pill') {
    w = gw(raw);
    let tw = w;
    if (quirk) { setFace(doc, quirk.style); doc.setFontSize(quirk.size); tw = gw(raw); }
    pillW = tw + 12;
    const k = size / 8;
    // Untouched: the old expression, so the rectangle lands on the same point.
    const rx = quirk && align === 'right' ? A4.w - MARGIN_X - pillW : boxLeft(x, align, tw) - 6;
    box = { x: rx, y: y - 8.5 * k, w: pillW, h: 12 * k };
  } else {
    w = Math.max(0, ...lines.flatMap(l => l.split('\n')).map(gw));
  }
  const nLines = s.tone === 'plain' && !splitLines ? raw.split('\n').length : lines.length;
  const left = startX ?? boxLeft(x, align, w);
  const top = y - size * 0.78;
  box ??= { x: left, y: top, w, h: (nLines - 1) * lineH + size * 1.02 };
  const defLeft = boxLeft(s.x, s.align, w);
  const defFirst = s.anchorBottom ? s.y - (lines.length - 1) * lineH : s.y;
  return {
    id: s.id, region: s.region ?? 'header', kind: 'text', label: s.label,
    x, y, align, text: raw, lines, fields: s.fields, style, size, color: s.color, tone: s.tone ?? 'plain',
    lineH, reverse: s.reverse, wrapW, wraps, splitLines, startX, pillW, lineYs,
    box, defBox: { x: defLeft, y: defFirst - size * 0.78, w, h: box.h },
    customized, sizeValue: size, sizeUnit: 'pt',
  };
}

/** Resolve the whole page chrome (letterhead + footer lines) for the current
 *  theme. Pure w.r.t. the page: only measures. */
function computeReportLayout(
  doc: jsPDF, practice: NonNullable<ReportPdfInput['practice']>, logoUrl: string | null,
  tpl: ReportTemplate | null | undefined,
): ReportLayoutResult {
  const cfg = readHeaderLayout(tpl);
  const active = !!cfg;
  // A flowing theme (Modern): the accent bar and the patient block clear the
  // tallest letterhead text, as in an edited layout (see ReportTypeTheme).
  const flow = active || TYPE.flowHeader;
  const ov = (id: string): ItemOverride => cfg?.items[id] ?? {};
  const items: Resolved[] = [];
  const add = (s: Seed): Resolved => {
    const o = ov(s.id);
    const customized = Object.keys(o).length > 0;
    const r = s.kind === 'text' ? finalizeText(doc, s, o, active, customized) : finalizeBox(doc, s, o, customized);
    if (o.hidden) r.hidden = true;
    items.push(r);
    return r;
  };
  const fs = theme.fontScale;
  const preset = theme.headerPreset;
  /** A letterhead element's weight, as a seed style. */
  const tstyle = (el: TypeEl) => twt(el) as NonNullable<Seed['style']>;
  /** The lab name in a flowing theme: the theme's size, shrunk (0.5pt steps,
   *  never below 16pt) to fit `maxW`; a name still too wide WRAPS onto more
   *  lines at 16pt (`wrapW`), pushing the rows under it down by `extra`.
   *  Where it cannot wrap (inside the Banner's band) it shrinks to 11pt.
   *  Classic never changes — its paper is pinned. A size the lab set in the
   *  designer always wins. */
  const fitName = (el: 'labName' | 'labNameMinimal', text: string, maxW: number, canWrap = true):
      { size: number; wrapW?: number; extra: number } => {
    let size = tsz(el);
    if (!TYPE.flowHeader || ov('name').size !== undefined) return { size, extra: 0 };
    setFace(doc, twt(el));
    doc.setFontSize(size);
    const floor = canWrap ? 16 : 11;
    while (size > floor && doc.getTextWidth(text) > maxW) { size -= 0.5; doc.setFontSize(size); }
    if (!canWrap || doc.getTextWidth(text) <= maxW) return { size, extra: 0 };
    const n = (doc.splitTextToSize(text, maxW) as string[]).length;
    return { size, wrapW: maxW, extra: (n - 1) * size * 1.2 };
  };
  const nablW = theme.nablAccredited && !ov('nabl').hidden ? 40 : 0;
  /** How much further down a taller lab name pushes the rows under it (the
   *  cap-height difference against the style's Classic size); 0 in Classic. */
  const nameGrow = (size: number, classicSize: number): number =>
    TYPE.flowHeader ? Math.max(0, Math.round((size - classicSize) * 0.7 * 2) / 2) : 0;
  /** Extra baseline drop for a line whose theme size exceeds Classic's. */
  const lead = (el: TypeEl, classicSize: number): number =>
    TYPE.flowHeader ? Math.max(0, tsz(el) - classicSize) : 0;
  const fullName = (practice.name ?? 'Prefrontal Pathology Lab').toUpperCase();
  const rightX = A4.w - MARGIN_X;
  const val = (f: HeaderField) => practice[f] ?? '';
  const nablSeed = (): Seed | null => theme.nablAccredited ? {
    id: 'nabl', kind: 'nabl', label: 'NABL badge', x: rightX - 30, y: LH_TOP - 2, align: 'right',
    defX: w => rightX - w, w: 30, h: 30, url: theme.nablLogoUrl || null, sub: theme.nablNumber || undefined,
  } : null;
  const joined = (id: string, def: HeaderField[], x: number, y: number, align: Align, size = tsz('labContactLine'),
                  wrapDefault?: number): void => {
    const fields = ov(id).fields ?? def;
    const text = fields.map(val).filter(Boolean).join('  ·  ');
    if (!text) return;
    const label = fields.filter(f => val(f)).map(f => FIELD_LABEL[f]).join(' · ');
    add({ id, kind: 'text', label, text, fields, x, y, align, style: twt('labContactLine') as Seed['style'], size, color: TEXT_DIM, tone: 'plain',
          wrapDefault, expectWrap: wrapDefault != null });
  };
  const bar = (): Resolved | null => {
    if (!theme.topAccentBar) return null;
    // Edited layouts: the bar sits UNDER the style's own text (a multi-line
    // address, Centered's contact lines) instead of striking through it.
    // Text the lab placed BELOW the bar's spot stays below it (dragging a
    // line under the bar is allowed); text above it pushes the bar down.
    let y = LH_TOP + 54;
    if (flow) {
      const texts = items
        .filter(i => i.kind === 'text' && !i.hidden)
        .map(i => (ov(i.id).x !== undefined || ov(i.id).y !== undefined ? { b: i.box, moved: true } : { b: i.defBox, moved: false }))
        .filter(t => !t.moved || t.b.y < LH_TOP + 54)
        .map(t => t.b.y + t.b.h + 4);
      y = Math.max(y, ...texts);
    }
    return add({ id: 'accentBar', kind: 'bar', label: 'Accent bar', x: MARGIN_X, y, w: A4.w - 2 * MARGIN_X, h: 4, align: 'left' });
  };
  const pill = (b: Resolved | null) => {
    if (!b || !practice.website) return;
    add({ id: 'website', kind: 'text', label: 'Website', text: practice.website, x: A4.w - MARGIN_X - 6, y: b.y + 5.5,
          align: 'right', style: tstyle('website'), size: tsz('website'), color: BLUE, tone: 'pill',
          measure: { style: 'normal', size: TYPE.tokens.website.size * fs } });
  };

  if (preset === 'centered') {
    const n = nablSeed(); if (n) add(n);
    const size = theme.logoSize === 'sm' ? 24 : theme.logoSize === 'lg' ? 40 : 32;
    const logo = add({ id: 'logo', kind: 'logo', label: 'Logo', x: (A4.w - size) / 2, y: LH_TOP, align: 'center',
                       defX: w => (A4.w - w) / 2, w: size, h: size, url: logoUrl });
    const lh = logo.defBox.h;
    const nm = fitName('labName', fullName, A4.w - 2 * MARGIN_X - 2 * nablW);
    // (+4: air between the logo and a taller name's cap line.)
    const g = nameGrow(nm.size, 18 * fs) + nm.extra + (TYPE.flowHeader ? 4 : 0);
    add({ id: 'name', kind: 'text', label: 'Lab name', text: fullName, x: A4.w / 2, y: LH_TOP + lh + 14 + g - nm.extra, align: 'center',
          style: tstyle('labName'), size: nm.size, color: BLACK, tone: 'plain', wrapDefault: nm.wrapW, expectWrap: !!nm.wrapW });
    add({ id: 'tagline', kind: 'text', label: 'Tagline', text: theme.tagline, x: A4.w / 2, y: LH_TOP + lh + 28 + g, align: 'center',
          style: tstyle('taglinePipes'), size: tsz('taglinePipes'), color: BLACK, tone: 'pipes',
          measure: { style: tstyle('taglinePipes'), size: TYPE.tokens.taglinePipes.size * fs } });
    joined('contact', ['phone', 'email', 'website'], A4.w / 2, LH_TOP + lh + 40 + g, 'center');
    if (practice.address) add({ id: 'address', kind: 'text', label: 'Address', text: practice.address, x: A4.w / 2,
          y: LH_TOP + lh + 50 + g + lead('labAddress', 8 * fs), align: 'center', style: tstyle('labAddress'), size: tsz('labAddress'),
          color: TEXT_DIM, tone: 'plain' });
    pill(bar());
  } else if (preset === 'banner') {
    const n = nablSeed();
    // The old banner painted the NABL badge BEFORE the blue band, so the band
    // hid it. Untouched templates keep that; an edited layout draws it on top.
    if (n && !flow) add(n);
    const band = add({ id: 'banner', kind: 'banner', label: 'Banner', x: 0, y: 0, w: A4.w, h: 54, align: 'left' });
    // The lab can switch the band OFF (a hidden override, like any element):
    // the header then reads like a normal letterhead — logo and name from
    // the top margin, the name in dark ink (white text would vanish on the
    // paper), the contact line right under them. Shown → byte-identical.
    const bandOn = !band.hidden;
    const bh = band.h ?? 54;
    const size = theme.logoSize === 'sm' ? 22 : theme.logoSize === 'lg' ? 36 : 28;
    const lp = theme.logoPosition;
    const lx = (w: number) => lp === 'right' ? A4.w - MARGIN_X - w : lp === 'center' ? (A4.w - w) / 2 : MARGIN_X;
    const logoY = (h: number) => bandOn ? (bh - h) / 2 : LH_TOP;
    const logo = add({ id: 'logo', kind: 'logo', label: 'Logo', x: lx(size), y: logoY(size), align: lp,
                       defX: lx, defY: logoY, w: size, h: size, url: logoUrl });
    const wmX = lp === 'center' ? (A4.w / 2) : (logo.defBox.x + logo.defBox.w + 10);
    const wmAlign: Align = lp === 'center' ? 'center' : 'left';
    // Band off: centred → the name sits UNDER the logo (Centered's rhythm);
    // left / right → beside it, on the Classic baselines.
    const nm = fitName('labName', fullName,
      (lp === 'center' ? A4.w - 2 * MARGIN_X - 2 * nablW : A4.w - MARGIN_X - wmX - nablW), !bandOn);
    const g = nameGrow(nm.size, 18 * fs);
    const nameY = bandOn ? 24 + g / 2 : lp === 'center' ? LH_TOP + logo.defBox.h + 14 + g : LH_TOP + 18 + g;
    const tagY = bandOn ? 40 + g / 2 : nameY + 14 + nm.extra;
    const contactY = bandOn ? bh + 10 + lead('labContactLine', 8 * fs)
      : Math.max(LH_TOP + 48, tagY + 12 + lead('labContactLine', 8 * fs), logo.defBox.y + logo.defBox.h + 10);
    add({ id: 'name', kind: 'text', label: 'Lab name', text: fullName, x: wmX, y: nameY, align: wmAlign,
          style: tstyle('labName'), size: nm.size, color: bandOn ? '#ffffff' : BLACK, tone: 'plain',
          wrapDefault: nm.wrapW, expectWrap: !!nm.wrapW });
    add({ id: 'tagline', kind: 'text', label: 'Tagline', text: theme.tagline, x: wmX, y: tagY, align: wmAlign,
          style: tstyle('taglinePlain'), size: tsz('taglinePlain'), color: bandOn ? '#ffffff' : TEXT_DIM, tone: 'plain' });
    // A flowing theme wraps the contact line clear of the NABL badge.
    joined('contact', ['address', 'phone', 'email'], MARGIN_X, contactY, 'left', undefined,
           TYPE.flowHeader && nablW ? A4.w - 2 * MARGIN_X - nablW : undefined);
    if (n && flow) add(n);
  } else if (preset === 'minimal') {
    const n = nablSeed(); if (n) add(n);
    const align: Align = theme.logoPosition === 'center' ? 'center' : theme.logoPosition === 'right' ? 'right' : 'left';
    const x = align === 'center' ? A4.w / 2 : align === 'right' ? A4.w - MARGIN_X : MARGIN_X;
    const nm = fitName('labNameMinimal', fullName, A4.w - 2 * MARGIN_X - (align === 'center' ? 2 * nablW : nablW));
    const g = nameGrow(nm.size, 16 * fs) + nm.extra;
    add({ id: 'name', kind: 'text', label: 'Lab name', text: fullName, x, y: LH_TOP + 14 + g - nm.extra, align,
          style: tstyle('labNameMinimal'), size: nm.size, color: BLACK, tone: 'plain', wrapDefault: nm.wrapW, expectWrap: !!nm.wrapW });
    add({ id: 'tagline', kind: 'text', label: 'Tagline', text: theme.tagline, x, y: LH_TOP + 26 + g, align,
          style: tstyle('taglinePlain'), size: tsz('taglinePlain'), color: TEXT_DIM, tone: 'plain' });
    // (Minimal's contact line inherits the tagline's 9pt — as it always did.)
    joined('contact', ['address', 'phone', 'email', 'website'], x, LH_TOP + 38 + g, align, tsz('labContactMinimal'));
  } else {
    // Classic: logo + two-tone wordmark left, phone/email right,
    // the address on its own line under the logo row, the accent bar.
    const size = theme.logoSize === 'sm' ? 24 : theme.logoSize === 'lg' ? 40 : 32;
    const logo = add({ id: 'logo', kind: 'logo', label: 'Logo', x: logoXFor(size), y: LH_TOP, align: theme.logoPosition,
                       defX: w => logoXFor(w), w: size, h: size, url: logoUrl });
    const wx = logo.hidden ? logo.defBox.x : logo.defBox.x + logo.defBox.w + 6;
    // The contact column (phone / email, right) is measured first so a long
    // lab name in a flowing theme shrinks before it runs into it.
    const nablOn = theme.nablAccredited && !ov('nabl').hidden && ov('nabl').x === undefined && ov('nabl').align === undefined;
    const contactRight = nablOn ? rightX - (30 + 8) : rightX;
    typeset(doc, 'labContact');
    const contactW = Math.max(0, ...[practice.phone, practice.email].filter(Boolean).map(v => doc.getTextWidth(v!)));
    const nm = fitName('labName', fullName, contactRight - (contactW ? contactW + 14 : 0) - wx);
    const g0 = nameGrow(nm.size, 18 * fs);
    const g = g0 + nm.extra;
    const wy = LH_TOP + 18 + g0;
    // A wrapped name prints in one ink (the two-tone split is a one-line look).
    add({ id: 'name', kind: 'text', label: 'Lab name', text: fullName, x: wx, y: wy, align: 'left',
          style: tstyle('labName'), size: nm.size, color: BLACK, tone: nm.wrapW ? 'plain' : 'twoTone',
          wrapDefault: nm.wrapW, expectWrap: !!nm.wrapW });
    add({ id: 'tagline', kind: 'text', label: 'Tagline', text: theme.tagline, x: wx, y: wy + 14 + nm.extra, align: 'left',
          style: tstyle('taglinePipes'), size: tsz('taglinePipes'), color: BLACK, tone: 'pipes' });
    const n = nablSeed();
    const nabl = n ? add(n) : null;
    const nablHolds = !!nabl && !nabl.hidden && ov('nabl').x === undefined && ov('nabl').align === undefined;
    const contactX = nablHolds ? rightX - (nabl!.defBox.w + 8) : rightX;
    if (practice.phone) add({ id: 'phone', kind: 'text', label: 'Phone', text: practice.phone, x: contactX, y: LH_TOP + 14,
          align: 'right', style: tstyle('labContact'), size: tsz('labContact'), color: BLACK, tone: 'plain' });
    if (practice.email) add({ id: 'email', kind: 'text', label: 'Email', text: practice.email, x: contactX, y: LH_TOP + 28,
          align: 'right', style: tstyle('labContact'), size: tsz('labContact'), color: BLACK, tone: 'plain' });
    if (practice.address) add({ id: 'address', kind: 'text', label: 'Address', text: practice.address, x: MARGIN_X,
          y: LH_TOP + 46 + g + lead('labAddress', 8 * fs), align: 'left', style: tstyle('labAddress'), size: tsz('labAddress'),
          color: TEXT_DIM, tone: 'plain' });
    pill(bar());
  }

  // ── Lab additions (edited layouts only): fields the style doesn't print on
  // their own, and free text lines (registration no., GSTIN…). They stack
  // under the letterhead until the lab drags them somewhere.
  if (active) {
    const placed = new Set<string>();
    for (const it of items) { it.fields?.forEach(f => placed.add(f)); if (it.id in FIELD_LABEL) placed.add(it.id); }
    let bottom = Math.max(LH_TOP, ...items.filter(i => i.kind !== 'banner').map(i => i.defBox.y + i.defBox.h));
    const stack = (id: string, label: string, text: string) => {
      const base = bottom + 10;
      add({ id, kind: 'text', label, text, x: MARGIN_X, y: base, align: 'left', style: tstyle('headerExtraLine'),
            size: tsz('headerExtraLine'), color: TEXT_DIM, tone: 'plain' });
      bottom = base + Math.max(3, (text.split('\n').length - 1) * tsz('headerExtraLine') * 1.2 + 3);
    };
    for (const f of Object.keys(FIELD_LABEL) as HeaderField[]) {
      if (ov(f).added && !placed.has(f) && val(f)) stack(f, FIELD_LABEL[f], val(f));
    }
    (cfg!.lines ?? []).forEach((l, i) => { if (l.text.trim()) stack('line:' + l.id, l.text.split('\n')[0].trim() || `Text line ${i + 1}`, l.text); });
  }

  // ── Footer lines (last page), stacked up from just above the date strip.
  let extraY = A4.h - 40;
  if (theme.disclaimer) {
    const dlh = TYPE.tokens.disclaimer.lineHeight ?? tsz('disclaimer') * 1.2;
    const d = add({ id: 'disclaimer', region: 'footer', kind: 'text', label: 'Disclaimer', text: theme.disclaimer, x: MARGIN_X,
                    y: extraY, align: 'left', style: tstyle('disclaimer'), size: tsz('disclaimer'), color: TEXT_DIM, tone: 'plain', lineH: dlh,
                    reverse: true, wrapDefault: A4.w - 2 * MARGIN_X, anchorBottom: true, expectWrap: true });
    if (!d.hidden) {
      for (let i = 0; i < (d.lines?.length ?? 1); i++) extraY -= dlh;
      extraY -= 2;
    }
  }
  if (theme.footerText) {
    add({ id: 'footerText', region: 'footer', kind: 'text', label: 'Footer text', text: theme.footerText, x: MARGIN_X,
          y: extraY, align: 'left', style: tstyle('footerText'), size: tsz('footerText'), color: TEXT_DIM, tone: 'plain', anchorBottom: true });
  }

  const header = items.filter(i => i.region === 'header' && !i.hidden);
  const headerBottom = Math.max(LH_TOP, ...header.map(i => i.box.y + i.box.h));
  const legacyTop = LH_TOP + 70;
  const bodyTopAuto = !cfg || cfg.bodyTop == null;
  const bodyTop = !flow ? legacyTop
    : cfg?.bodyTop != null ? cfg.bodyTop * MM
    : Math.max(legacyTop, headerBottom + BODY_GAP);
  const lp = tpl?.letterpadMode
    ? { top: Math.max(0, tpl.letterpadHeaderMm ?? 45) * MM, bottom: A4.h - Math.max(20, Math.max(0, tpl.letterpadFooterMm ?? 30) * MM) }
    : null;
  // defBox is internal — the published items are plain LayoutItems.
  const out: LayoutItem[] = items.map(({ defBox: _d, ...rest }) => rest);
  return { preset, active, items: out, headerBottom, bodyTop, bodyTopAuto, letterpad: lp,
           backgrounds: resolveBackgrounds(doc, cfg?.backgrounds ?? [], bodyTop) };
}

const BG_AREA_LABEL: Record<BgArea, string> = { page: 'Page background', header: 'Header background', footer: 'Footer background' };

/** Place each background image on the page (see backgroundRect). */
function resolveBackgrounds(doc: jsPDF, bgs: BackgroundImage[], bodyTop: number): ResolvedBackground[] {
  return bgs.map((bg, index) => {
    const data = IMG_CACHE[bg.url];
    let img: { w: number; h: number } | null = null;
    if (data) {
      try { const p = doc.getImageProperties(data); img = { w: p.width, h: p.height }; } catch { img = null; }
    }
    const clip = backgroundArea(bg.area, bodyTop);
    const rect = backgroundRect(bg, clip, img);
    const same = bgs.filter(b => b.area === bg.area).length > 1;
    return {
      id: bg.id, index, url: bg.url, area: bg.area, fit: bg.fit, opacity: bg.opacity, pages: bg.pages,
      label: BG_AREA_LABEL[bg.area] + (same ? ` ${bgs.filter((b, i) => b.area === bg.area && i <= index).length}` : ''),
      onLetterhead: !!bg.onLetterhead, hidden: !!bg.hidden, scale: bg.scale ?? 100,
      moved: bg.x !== undefined || bg.y !== undefined,
      rect, clip, box: intersectBox(rect, clip), loaded: !!img,
    };
  });
}

/** Draw the backgrounds that print on THIS page, clipped to their area and
 *  faded by their opacity, inside their own graphics state (nothing leaks).
 *  Called before anything else is drawn on the page → always behind. */
function drawBackgrounds(doc: jsPDF, page: number) {
  const bgs = LAYOUT?.backgrounds ?? [];
  if (!bgs.length) return;
  const d = doc as unknown as {
    saveGraphicsState(): void; restoreGraphicsState(): void; setGState?(g: unknown): void;
    GState?: new (o: { opacity: number }) => unknown; clip(): void; discardPath(): void;
  };
  for (const bg of bgs) {
    if (!backgroundPrints(bg, page, LETTERPAD)) continue;
    const data = IMG_CACHE[bg.url];
    const fmt = /^data:image\/jpe?g/i.test(data) ? 'JPEG' : 'PNG';
    d.saveGraphicsState();
    try {
      doc.rect(bg.clip.x, bg.clip.y, bg.clip.w, bg.clip.h, null as unknown as string);
      d.clip();
      d.discardPath();
      if (bg.opacity < 1 && d.setGState && d.GState) d.setGState(new d.GState({ opacity: bg.opacity }));
      doc.addImage(data, fmt, bg.rect.x, bg.rect.y, bg.rect.w, bg.rect.h, 'bg-' + bg.id, 'FAST');
    } catch { /* a background never breaks the report */ }
    d.restoreGraphicsState();
  }
}

/** Draw one resolved element. Hidden ones are skipped. */
function drawLayoutItem(doc: jsPDF, it: LayoutItem) {
  if (it.hidden) return;
  switch (it.kind) {
    case 'banner':
      doc.setFillColor(BLUE);
      doc.rect(0, 0, A4.w, it.h ?? 54, 'F');
      return;
    case 'bar':
      doc.setFillColor(BLUE);
      doc.rect(it.x, it.y, it.w ?? 0, it.h ?? 4, 'F');
      return;
    case 'logo':
      drawLogo(doc, it.url ?? null, it.x, it.y, it.w ?? 0, it.h ?? 0);
      return;
    case 'nabl':
      drawNablBadge(doc, it.x, it.y, it.h ?? 30, it.url ?? null, it.sub ?? '');
      return;
    case 'text':
      drawTextItem(doc, it);
  }
}

function drawTextItem(doc: jsPDF, it: LayoutItem) {
  const size = it.size ?? 9, style = it.style ?? 'normal', text = it.text ?? '';
  if (it.tone === 'pipes') { drawTagline(doc, text, it.startX ?? it.x, it.y, size, style); return; }
  if (it.tone === 'pill') {
    doc.setFillColor('#ffffff');
    doc.rect(it.box.x, it.box.y, it.pillW ?? it.box.w, it.box.h, 'F');
  }
  setFace(doc, style);
  doc.setFontSize(size);
  doc.setTextColor(it.color ?? BLACK);
  if (it.tone === 'twoTone') {
    const t = text.split(' ');
    const first = t[0];
    const rest = t.slice(1).join(' ');
    const x = it.startX ?? it.x;
    doc.text(first, x, it.y);
    const firstW = doc.getTextWidth(first + ' ');
    doc.setTextColor(BLUE);
    doc.text(rest, x + firstW, it.y);
    return;
  }
  const opts = it.align !== 'left' ? { align: it.align } : undefined;
  if (!it.splitLines) {
    if (opts) doc.text(text, it.x, it.y, opts); else doc.text(text, it.x, it.y);
    return;
  }
  const lines = it.lines ?? [text];
  const lh = it.lineH ?? size * 1.2;
  const yAt = (i: number) => it.lineYs?.[i] ?? it.y + i * lh;
  if (it.reverse) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (opts) doc.text(lines[i], it.x, yAt(i), opts); else doc.text(lines[i], it.x, yAt(i));
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (opts) doc.text(lines[i], it.x, yAt(i), opts); else doc.text(lines[i], it.x, yAt(i));
    }
  }
}

function drawLetterhead(doc: jsPDF) {
  // Pre-printed letterpad: draw nothing — the blank MARGIN_TOP reserve is the
  // space the lab's own printed letterhead occupies.
  if (LETTERPAD || !LAYOUT) return;
  for (const it of LAYOUT.items) if (it.region === 'header') drawLayoutItem(doc, it);
}

/** Left x of the Classic logo for its logoPosition (the old rule, kept:
 *  right/centre reserve ~200pt for the wordmark beside it). */
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
function drawLogo(doc: jsPDF, logoUrl: string | null, x: number, y: number, w: number, h: number) {
  const cached = logoUrl && IMG_CACHE[logoUrl];
  if (cached) {
    try {
      doc.addImage(cached, 'PNG', x, y, w, h, undefined, 'FAST');
      return;
    } catch { /* fall through to placeholder */ }
  }
  drawLogoPlaceholderAt(doc, x, y, h);
}

/** Draw the NABL accreditation badge (the uploaded badge image, else a green
 *  "NABL" text chip) with the accreditation number beneath it. */
function drawNablBadge(doc: jsPDF, x: number, topY: number, size: number, url: string | null, number: string) {
  const k = size / 30;
  const cached = url && IMG_CACHE[url];
  if (cached) {
    try { doc.addImage(cached, 'PNG', x, topY, size, size, undefined, 'FAST'); }
    catch { /* fall through to the text chip */ }
  } else {
    doc.setDrawColor('#10b981');
    doc.setFillColor('#ecfdf5');
    doc.roundedRect(x, topY + 5 * k, size, 15 * k, 3 * k, 3 * k, 'FD');
    setFace(doc, twt('nablChip'));
    doc.setFontSize(tsz('nablChip') * k);
    doc.setTextColor('#059669');
    doc.text('NABL', x + size / 2, topY + 15.5 * k, { align: 'center' });
  }
  if (number) {
    typeset(doc, 'nablNumber');
    doc.setTextColor(TEXT_DIM);
    doc.text(number, x + size / 2, topY + size + 6, { align: 'center' });
  }
}

/** Placeholder disc + plus at an explicit (x, y), drawn when no logo upload
 *  exists (or the bytes failed to decode). */
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
  let nameSize = typeset(doc, 'patientName');
  while (nameSize > 8 && doc.getTextWidth(patientName) > nameMaxW) { nameSize -= 0.5; doc.setFontSize(nameSize); }
  doc.setTextColor(BLACK);
  doc.text(patientName, x1, y);
  y += 16;
  doc.setTextColor(BLACK);
  if (snapAge(snap, 'Years')) {
    drawPair(doc, 'Age : ', snapAge(snap, 'Years'), x1, y, 'demoLabel', 'demoValue');
    y += 12;
  }
  if (snap.patient?.sex) {
    drawPair(doc, 'Sex : ', snap.patient.sex, x1, y, 'demoLabel', 'demoValue');
    y += 12;
  }
  const mrn = (snap.patient?.mrn ?? '').trim();
  if (mrn) {
    drawPair(doc, 'MRN : ', mrn, x1, y, 'mrnLabel', 'mrnValue');
  }

  // ── Col 2 — Specimens collected + Ref doctor ──
  const x2 = MARGIN_X + col1W + 10;
  y = top + 18;
  typeset(doc, 'patientCaption');
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
  typeset(doc, 'patientList');
  doc.setTextColor(BLACK);
  if (specimens.length > 0) {
    const text = specimens.join(', ');
    const lines = doc.splitTextToSize(text, col2W - 20);
    doc.text(lines, x2, y);
    y += lines.length * 11 + 6;
  } else if (snap.patient?.phone) {
    drawPair(doc, 'Phone: ', snap.patient.phone, x2, y, 'demoLabel', 'demoValue');
    y += 14;
  }

  if (snap.order?.refDoctorName) {
    typeset(doc, 'demoLabel');
    doc.setTextColor(BLACK);
    doc.text('Ref. By: ', x2, y);
    const refW = doc.getTextWidth('Ref. By: ');
    typeset(doc, 'demoValue');
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

  doc.setTextColor(BLACK);
  const drawTimeLine = (label: string, value: string) => {
    if (!value) return;
    typeset(doc, 'regLabel');
    doc.text(label, x3, y);
    const labelW = doc.getTextWidth(label);
    typeset(doc, 'regValue');
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
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      // Two QRs placed one after the other sit side by side when they fit —
      // stacked they would double the strip's height.
      const next = keys[k + 1];
      if (isPatientStripQrKey(key) && next && isPatientStripQrKey(next) && next !== key) {
        y = drawPatientQrPair(doc, [key, next], x, colW - 16, y, snap);
        k++;
        continue;
      }
      y = drawPatientItem(doc, key, x, colW - 16, y, snap, report);
    }
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
  typeset(doc, 'demoLabel'); doc.setTextColor(BLACK);
  doc.text(label, x, y);
  const lw = doc.getTextWidth(label);
  typeset(doc, 'demoValue');
  doc.text(v, x + lw, y);
  return y + 12;
}

/** A patient "Label : value" line. Classic prints it as ONE plain string in
 *  the label's style (as it always did); a theme with `splitLabels` prints
 *  the label regular and the value in the value's (semibold) style. */
function drawPair(doc: jsPDF, label: string, value: string, x: number, y: number, labelEl: TypeEl, valueEl: TypeEl): void {
  typeset(doc, labelEl);
  if (!TYPE.splitLabels) { doc.text(`${label}${value}`, x, y); return; }
  doc.text(label, x, y);
  const lw = doc.getTextWidth(label);
  typeset(doc, valueEl);
  doc.text(value, x + lw, y);
}

function drawPatientItem(
  doc: jsPDF, key: string, x: number, colW: number, y: number,
  snap: ReportSnapshot, report: ReportPdfInput['report']
): number {
  switch (key) {
    case 'name':
      typeset(doc, 'patientNameColumn'); doc.setTextColor(BLACK);
      doc.text(snap.patient?.displayName ?? '—', x, y);
      return y + 16;
    case 'age':
      if (!snapAge(snap, 'Years')) return y;
      doc.setTextColor(BLACK);
      drawPair(doc, 'Age : ', snapAge(snap, 'Years'), x, y, 'demoLabel', 'demoValue'); return y + 12;
    case 'sex':
      if (!snap.patient?.sex) return y;
      doc.setTextColor(BLACK);
      drawPair(doc, 'Sex : ', snap.patient.sex, x, y, 'demoLabel', 'demoValue'); return y + 12;
    case 'mrn': {
      const mrn = (snap.patient?.mrn ?? '').trim(); if (!mrn) return y;
      doc.setTextColor(BLACK);
      drawPair(doc, 'MRN : ', mrn, x, y, 'mrnLabel', 'mrnValue'); return y + 12;
    }
    case 'phone':
      if (!snap.patient?.phone) return y;
      doc.setTextColor(BLACK);
      drawPair(doc, 'Phone : ', snap.patient.phone, x, y, 'demoLabel', 'demoValue'); return y + 12;
    case 'orderid': {
      // The human order number (LAB-2608-000049) — not a slice of the GUID,
      // which is what staff were being asked to read out loud.
      const oid = snap.order?.orderNumber?.trim() || (snap.order?.id ?? '').slice(0, 8);
      if (!oid) return y;
      doc.setTextColor(BLACK);
      drawPair(doc, 'Order : ', oid, x, y, 'mrnLabel', 'mrnValue'); return y + 12;
    }
    case 'refdoctor': {
      if (!snap.order?.refDoctorName) return y;
      typeset(doc, 'demoLabel'); doc.setTextColor(BLACK);
      doc.text('Ref. By: ', x, y);
      const rw = doc.getTextWidth('Ref. By: ');
      typeset(doc, 'demoValue'); doc.text(snap.order.refDoctorName, x + rw, y);
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
      typeset(doc, 'patientCaptionColumn'); doc.setTextColor(BLUE);
      doc.text('Specimen(s) :', x, y); y += 12;
      if (specimens.length) {
        typeset(doc, 'patientList'); doc.setTextColor(BLACK);
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
    case PROFILE_QR_KEY:
    case ORDER_QR_KEY:
      return drawPatientQrPair(doc, [key], x, colW, y, snap);
    case 'registered': return drawPatientTimeItem(doc, 'Registered on: ', formatShort(snap.order?.createdAt), x, y);
    case 'collected':  return drawPatientTimeItem(doc, 'Collected on: ',  formatShort(snap.order?.createdAt), x, y);
    case 'reported':   return drawPatientTimeItem(doc, 'Reported on: ',   formatShort(report.createdAt), x, y);
    default: {
      const fld = theme.patientFields.find(f => f.name === key);
      const val = parsePatientAttributes(snap)[key];
      if (val == null || String(val).trim() === '') return y;
      const label = `${fld?.title ?? key}: `;
      typeset(doc, 'fieldLabel'); doc.setTextColor(BLACK);
      doc.text(label, x, y);
      typeset(doc, 'fieldValue'); doc.setTextColor(TEXT_DIM);
      doc.text(String(val), x + doc.getTextWidth(label), y);
      return y + 12;
    }
  }
}

/** Patient-strip QR size (pt). ~20 mm — comfortably scannable from paper. */
const STRIP_QR_SIZE = 58;
const STRIP_QR_GAP = 10;

/** The URL a patient-strip QR key encodes for this report, or null when the
 *  data it needs is missing (no patient id / no tracking token). */
export function patientStripQrValue(key: string, snap: ReportSnapshot, base: string, trackToken: string | null): string | null {
  if (key === PROFILE_QR_KEY) return patientProfileQrUrl(base, snap.patient?.id);
  if (key === ORDER_QR_KEY) return orderReportQrUrl(base, trackToken);
  return null;
}

/** Draw one or two patient-strip QRs in a row, each with its caption beneath.
 *  A QR whose value is missing costs no space. Returns the new y. */
function drawPatientQrPair(doc: jsPDF, keys: string[], x: number, colW: number, y: number, snap: ReportSnapshot): number {
  const items = keys
    .map(k => ({ k, v: patientStripQrValue(k, snap, STRIP_QR.base, STRIP_QR.trackToken) }))
    .filter((i): i is { k: string; v: string } => !!i.v);
  if (!items.length) return y;
  // Side by side when both fit the column; otherwise one per row.
  const size = Math.max(40, Math.min(STRIP_QR_SIZE, colW));
  const perRow = items.length > 1 && size * 2 + STRIP_QR_GAP <= colW ? 2 : 1;
  const top = y - 8;   // y is a text baseline; the QR's top edge sits at the cap line
  let rowTop = top;
  for (let i = 0; i < items.length; i += perRow) {
    items.slice(i, i + perRow).forEach((it, j) => {
      const qx = x + j * (size + STRIP_QR_GAP);
      paintQr(doc, it.v, qx, rowTop, size);
      typeset(doc, 'qrCaption'); doc.setTextColor(BLACK);
      doc.text(PATIENT_STRIP_QR_CAPTIONS[it.k] ?? '', qx + size / 2, rowTop + size + 7, { align: 'center' });
    });
    rowTop += size + 12;
  }
  return rowTop + 8;
}

function drawPatientTimeItem(doc: jsPDF, label: string, value: string, x: number, y: number): number {
  if (!value) return y;
  typeset(doc, 'regLabel'); doc.setTextColor(BLACK);
  doc.text(label, x, y);
  const lw = doc.getTextWidth(label);
  typeset(doc, 'regValue'); doc.text(value, x + lw, y);
  return y + 11;
}

/** Patient-block: 4-column labelled grid (compact, label-above-value).
 *  Two rows of four cells each. No vertical separators — the labels
 *  themselves act as visual anchors. Best when the lab wants a more
 *  "form" feel than the classic 3-column block. */
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
    snapAge(snap, 'yrs'),
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
      typeset(doc, 'gridLabel');
      doc.setTextColor(TEXT_DIM);
      doc.text(cells[r][c].label, x, y);
      typeset(doc, 'gridValue');
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
    snapAge(snap, 'yrs'),
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
    typeset(doc, 'stackLabel');
    doc.setTextColor(TEXT_DIM);
    doc.text(`${row.label} :`, MARGIN_X, y);
    typeset(doc, 'stackValue');
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

/** The one key a blank-then-repaint stash is filed under. It MUST carry the
 *  section: autotable numbers the head row 0 and body row 0 alike, and the
 *  repeated column header of every continuation page is drawn AFTER body row
 *  0 has been stashed. Keyed by row:col alone, the first result's reference
 *  bands were repainted into the "Reference Range" header cell of page 2+
 *  (owner's report 2026-09-29, "our major bug"). */
const cellKey = (d: CellHookArg): string => `${d.section}:${d.row.index}:${d.column.index}`;

function stashSuperscriptCell(store: Map<string, SupCell>, d: CellHookArg): void {
  const raw = Array.isArray(d.cell.text) ? d.cell.text.join(' ') : String(d.cell.text ?? '');
  const safe = pdfSafeText(raw, { keepSymbols: true, native: EMBEDDED });
  if (!hasSuperscript(safe)) return;
  store.set(cellKey(d), { text: safe, styles: d.cell.styles ?? {} });
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
    .map(l => pdfSafeText(l, { keepSymbols: true, native: EMBEDDED }));
  if (lines.length < 2) return;                       // plain single-band cell
  store.set(cellKey(d), { lines, styles: d.cell.styles ?? {} });
  d.cell.text = [''];
}

function drawQualifiedRangeCell(
  doc: jsPDF, store: Map<string, QualCell>, d: CellHookArg
): void {
  if (d.section !== 'body') return;
  const q = store.get(cellKey(d));
  if (!q) return;
  // Painted once, for THIS cell: the stash never outlives the cell it was
  // blanked for, so nothing can leak onto a later page.
  store.delete(cellKey(d));
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
    setFace(doc, twt('range'));
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
  const sup = store.get(cellKey(d));
  if (!sup) return;
  store.delete(cellKey(d));
  const st = sup.styles as { fontSize?: number; fontStyle?: string; textColor?: unknown; cellPadding?: number };
  const fs = typeof st.fontSize === 'number' ? st.fontSize : 9;
  // Classic redraws in its regular / bold face; an embedded theme in the
  // cell's own style (semibold, italic …).
  if (EMBEDDED) doc.setFont(SOURCE_SANS_FAMILY, String(st.fontStyle ?? 'normal'));
  else doc.setFont(PDF_FONT, st.fontStyle === 'bold' ? 'bold' : 'normal');
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
  /** The value's parameter name (param rows) — a Custom layout's manual row
   *  assignment keys on it. */
  rowKey?: string;
  /** A technician report note (markup) — a full-width row painted with real
   *  bold / italic / underline and lists (report-note-pdf.ts). */
  techNote?: string;
  /** Its bold opening label ("Note:", "Note (SGOT):"). */
  techLabel?: string;
  /** The row's test is not validated yet — kept off the abnormal-results sheet. */
  unvalidated?: boolean;
  name?: string;
  result?: string;
  range?: string;
  unit?: string;
  /** Display letter: 'H' | 'L' | 'A' | '' — never 'C' (reportFlag). */
  flag?: string;
  isLow?: boolean;
  abnormal?: boolean;
  note?: string;
  /** This note row is one of the test's Sentence (paragraph) blocks — printed
   *  as a full-width row INSIDE the results table, like the Method line. */
  sentence?: boolean;
  /** The admin's own name for that block ("Interpretation") — printed bold
   *  at the start of the row. Absent for an unnamed / default-named block. */
  sentenceLabel?: string;
  /** Admin-configured conditional row colour (engine palette hex) — painted
   *  verbatim on the result cell; NOT gated by the theme's flagStyle. */
  color?: string | null;
  /** Admin-configured conditional bold (condition `then.bold`). */
  bold?: boolean;
  /** The tech's "print in bold" pick for this value (snapshot `result.bold`)
   *  — bolds the RESULT cell exactly like an abnormal value; it only adds
   *  bold, never removes the abnormal styling. */
  printBold?: boolean;
  /** Text-typed cell values keyed by column name (e.g. description) so the
   *  columnar renderer can fill admin text columns instead of leaving them
   *  permanently blank. */
  texts?: Record<string, string>;
  /** The value's resolved Description text (the engine resolves it — and a
   *  "depends on the result" line — even when the table has no Description
   *  column). With no such column it prints as a full-width row directly
   *  under this value's row (owner 2026-09-28, like the Sentence row). */
  description?: string;
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

/** The tech's "print in bold" value names on a test's snapshot
 *  (`result.bold`, written at result entry by the B toggle). */
export function printBoldNames(t: { result?: Record<string, unknown> | null }): Set<string> {
  const raw = t.result?.['bold'];
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
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
  /** Built from a REAL saved result (a report, not an editor preview): a
   *  value-less row is omitted, and a block left with no value is dropped
   *  (owner 2026-10-03: "if no value, don't show it in the report"). */
  fromResults?: boolean;
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
  /** The template's "Show method line" switch is off — no "Method: …"
   *  sub-line under the panel band (a configured Method column still prints). */
  hideMethodLine?: boolean;
  /** The template's "Show specimen line" option is on — print
   *  "Specimen: …" in the panel sub-line (next to the method). */
  showSpecimenLine?: boolean;
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

/** Block names that are just the editor's default for a Sentence — never
 *  printed as a label (only a name the admin chose is). */
const DEFAULT_SENTENCE_NAMES = /^(sentence|paragraph)$/i;

/** A resolved paragraph (Sentence) section → its full-width table row, or
 *  null when there is nothing to print. The engine has already applied the
 *  block's conditions and placeholders and dropped hidden blocks. */
function sentenceRow(sec: ResolvedSection): PanelRowData | null {
  if (sec.type !== 'paragraph' || !sec.isVisible) return null;
  const text = (sec.content ?? '').replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '');
  if (!text.trim()) return null;
  const label = (sec.label ?? '').trim();
  return { kind: 'note', note: text, sentence: true,
    sentenceLabel: label && !DEFAULT_SENTENCE_NAMES.test(label) ? label : undefined };
}

/** A value row's Description cell (key matched case-insensitively), line
 *  breaks normalised and kept; '' when blank. */
function descriptionText(cells: Record<string, unknown> | undefined): string {
  if (!cells) return '';
  const key = Object.keys(cells).find(k => k.toLowerCase() === 'description');
  return key ? coerceCellText(cells[key]).replace(/\r\n?/g, '\n') : '';
}

/** Does this column config carry a Description column? Its text then prints
 *  in that column only — never again as a row under the value. */
function hasDescriptionColumn(cfg: ReportColumn[]): boolean {
  return cfg.some(c => (c.name ?? '').trim().toLowerCase() === 'description');
}

/** Can this test's Sentences print as merged rows of the results table? Yes
 *  when its layout has a results table and nothing else that needs its own
 *  block (a chart, culture lines…). Narrative-only layouts (the values are
 *  written out in the Sentences — histopathology) keep their narrative page. */
function sentencesFitTable(layout: ResolvedReportLayout | undefined): boolean {
  if (!layout || layout.valuesInNarrative) return false;
  const vis = layout.sections.filter(s => s.isVisible);
  return vis.some(s => s.type === 'grid')
    && vis.every(s => s.type === 'grid' || s.type === 'image' || s.type === 'paragraph');
}

/** Extract a test's parameter rows into a panel group for the continuous
 *  table. Uses the resolved grid layout when present, else the legacy
 *  `result.values` map.
 *
 *  `sentences`: also emit the layout's Sentence blocks as full-width note
 *  rows, in print order — a Sentence above the results table lands before
 *  the rows, one below it after them. Off for a member ordered through a
 *  profile/package (notes follow what was ORDERED). */
/** A report cell with NO value: null / undefined / an empty (or whitespace)
 *  string / a multi-pick with nothing in it. A dash is a RESULT the user
 *  typed and always prints (review 2026-10-03). */
export function isBlankReportValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.every(x => isBlankReportValue(x));
  return String(v).trim() === '';
}

/** Drop (in place) every block built from real results that has no value
 *  row left. Preview blocks and blocks with any value are untouched. */
export function dropValuelessGroups<T extends { fromResults?: boolean; rows: { kind?: string }[] }>(groups: T[]): T[] {
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g.fromResults && !g.rows.some(r => r.kind === 'param')) groups.splice(i, 1);
  }
  return groups;
}

function buildPanelGroup(
  t: NonNullable<ReportSnapshot['tests']>[number],
  layout: ResolvedReportLayout | undefined,
  opts: { sentences?: boolean } = {}
): PanelGroup {
  // A real report (a saved result exists) never prints a value-less row; an
  // editor preview (no saved result) keeps every row as a placeholder.
  const fromResults = !!t.result;
  const group: PanelGroup = {
    fromResults,
    testName: t.name ?? reportDisplayName(layout?.testName) ?? 'Test',
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

  const visibleSecs = (layout?.sections ?? []).filter(s => s.isVisible);
  const gridSections = visibleSecs.filter(s => s.type === 'grid');
  // Sentences above the first results table print BEFORE the rows; every
  // other one follows its position (after the table by default).
  const firstGrid = visibleSecs.findIndex(s => s.type === 'grid');
  const leading: PanelRowData[] = [];
  const trailing: PanelRowData[] = [];
  const sentenceOf = new Map<ResolvedSection, PanelRowData>();
  if (opts.sentences) {
    visibleSecs.forEach((sec, i) => {
      const row = sentenceRow(sec);
      if (!row) return;
      sentenceOf.set(sec, row);
      (firstGrid >= 0 && i < firstGrid ? leading : trailing).push(row);
    });
  }
  group.rows.push(...leading);
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
    const boldNames = printBoldNames(t);
    const savedValues = (t.result?.['values'] ?? undefined) as Record<string, SavedFlag> | undefined;
    for (const sec of visibleSecs.slice(firstGrid)) {
      if (sec.type !== 'grid') {
        const row = sentenceOf.get(sec);
        if (row) group.rows.push(row);
        continue;
      }
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
        // The preview has no saved result — mw puts the row's flag on the row.
        const rowFlag = r.flag != null ? r.flag : undefined;
        const hasSaved = (!!sv && typeof sv === 'object' && 'flag' in sv) || !!rc.saved || rowFlag !== undefined;
        const savedRaw = sv && typeof sv === 'object' && 'flag' in sv ? sv.flag
          : rc.saved ? rc.flag : (rowFlag ?? rc.flag);
        const resultText = rc.value || (resultSrc ? String(r.cells[resultSrc.name] ?? '') : '');
        // No value → no row (owner 2026-10-03).
        if (fromResults && isBlankReportValue(resultText)) continue;
        // Range / unit print what was SAVED with the result (the snapshot's
        // per-value `range` / `unit`, frozen at sign-off) — the layout's cell
        // is the live Test Master and only stands in for a value saved
        // without them (legacy reports; frozen for good once the report's
        // PDF is stored). Audit H1: a released report must not change when
        // the Test Master is edited later.
        const savedObj = sv && typeof sv === 'object' ? sv as SavedFlag : undefined;
        const savedRange = (savedObj?.range ?? '').toString().trim();
        const savedUnit = (savedObj?.unit ?? '').toString().trim();
        const rangeText = rangeCellText(
          rangeSrc ? (savedRange || coerceCellText(r.cells[rangeSrc.name])) : '', savedUnit || r.unit);
        // Reports never print C / Critical (owner 2026-09-26: critical is
        // internal) — a critical maps to H / L by its direction.
        const saved = reportFlag(savedRaw, resultText, rangeText || (sv as SavedFlag | undefined)?.range);
        const label = hasSaved ? '' : flagLabel(r);
        const labelLetter = label === 'High' ? 'H' : label === 'Low' ? 'L' : '';
        const letter = hasSaved ? saved.flag : (labelLetter || saved.flag);
        const isLow = hasSaved ? saved.isLow : (labelLetter ? labelLetter === 'L' : saved.isLow);
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
          rowKey: r.parameterName || undefined,
          name: reportDisplayName(r.title) || humanize(r.parameterName ?? ''),
          result: resultText,
          range: rangeText,
          // Prefer the Unit column when present; otherwise fall back to the
          // parameter's own unit so EVERY department shows it (e.g. "11.4 g/dL")
          // — but never grow a unit onto a qualitative result ("Normal mg/dL").
          unit: (unitSrc ? (savedUnit || coerceCellText(r.cells[unitSrc.name])) : '')
            || (looksNumeric(resultText) ? (savedUnit || r.unit || '') : ''),
          flag: letter,
          isLow,
          abnormal: hasSaved ? saved.abnormal : (sev === 'high' || sev === 'warn' || !!letter || saved.abnormal),
          color: r.color ?? null,
          bold: !!r.isBold,
          printBold: !!r.parameterName && boldNames.has(r.parameterName),
          texts: Object.keys(texts).length ? texts : undefined,
          description: descriptionText(r.cells) || undefined,
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
    // Falling through: the trailing Sentences go back after the legacy rows.
    group.rows = group.rows.filter(r => !trailing.includes(r));
  }

  // Legacy values map.
  const values = t.result?.['values'] as Record<string, { value?: unknown; flag?: string; range?: string; unit?: string; description?: string }> | undefined;
  // Per-report picker applies here too (as in renderLegacyTest): an unticked
  // value never prints — nor lands on the abnormal-results sheet.
  const hiddenLegacy = new Set((t as { hidden?: string[] | null }).hidden ?? []);
  const boldLegacy = printBoldNames(t);
  for (const [paramName, v] of Object.entries(values ?? {})) {
    if (hiddenLegacy.has(paramName)) continue;
    // No value → no row (owner 2026-10-03).
    if (isBlankReportValue(v?.value)) continue;
    // Criticals print as H / L — never C (report rule; see report-flag.ts).
    const rf = reportFlag(v?.flag, v?.value, v?.range);
    group.rows.push({
      // Text columns (Description) read from the value payload when present.
      texts: v?.description ? { description: v.description } : undefined,
      description: descriptionText({ description: v?.description }) || undefined,
      kind: 'param',
      rowKey: paramName,
      name: humanize(paramName),
      result: String(v?.value ?? '—'),
      range: rangeCellText(v?.range, v?.unit),
      unit: v?.unit ?? '',
      flag: rf.flag,
      isLow: rf.isLow,
      abnormal: rf.abnormal,
      printBold: boldLegacy.has(paramName),
      method: methodForValue(t, paramName),
    });
  }
  group.rows.push(...trailing);
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
  // Department band — the strongest heading inside the body (classic pattern:
  // clear department separation carries the whole multi-department report).
  // A taller department name (Modern) sits lower on the same rule rhythm.
  const grow = TYPE.flowHeader ? Math.max(0, Math.round((tsz('deptName') - 10.5) * 0.7)) : 0;
  typeset(doc, 'deptName');
  doc.setTextColor(theme.primary);
  doc.text(text, MARGIN_X, y + 12 + grow);
  if (rightText) {
    // e.g. "Sample ID: 26001" — ties the department block to its tube(s).
    typeset(doc, 'deptMeta');
    doc.setTextColor(TEXT_DIM);
    doc.text(rightText, A4.w - MARGIN_X, y + 12 + grow, { align: 'right' });
  }
  doc.setDrawColor(theme.primary);
  doc.setLineWidth(TYPE.deptRule);
  doc.line(MARGIN_X, y + 17 + grow, A4.w - MARGIN_X, y + 17 + grow);
  return y + 23 + grow;
}

/** The panel/profile title band — "COMPLETE BLOOD COUNT" etc. — SAME fill,
 *  text colour and type token (`panelName`) as the band renderColumnarTable
 *  draws as the first row of a multi-parameter panel's block (owner,
 *  2026-10-02: the one-page profile's own section context must read like
 *  the continuous report's, not a bare box arrangement with no heading). */
function drawPanelNameBand(doc: jsPDF, text: string, x: number, y: number, w: number): number {
  const label = (text ?? '').trim();
  if (!label) return y;
  const size = typeset(doc, 'panelName');
  const h = Math.max(16, Math.round(size * 1.6 + 7));
  doc.setFillColor('#eef2f7');
  doc.rect(x, y, w, h, 'F');
  doc.setTextColor(theme.primary);
  doc.text(label.toUpperCase(), x + 6, y + h / 2 + size * 0.33, { baseline: 'alphabetic' });
  return y + h;
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
    // Only the signatories actually present count (7 configured, 2 resolved →
    // one row of 2), and a department with none reserves nothing.
    const sigH = signatureBlockHeight(sigs);
    // This department's technician note prints after its last table run,
    // before its sign-off — the sign-off reserve makes room for it too.
    const deptNote = TECH_DEPT_NOTES.get(dept.toUpperCase());
    if (deptNote) TECH_DEPT_NOTES.delete(dept.toUpperCase());
    const deptNoteLabel = deptNote ? `${titleCaseHeader(deptNote.name)} note:` : '';
    const deptNoteH = deptNote ? techNoteBlockHeight(doc, deptNote.note, deptNoteLabel) : 0;
    const reserve = sigH > 0 ? sigH + SIGN_OFF_SLACK + deptNoteH + (isLast && deferLastSigs ? 26 : 0) : 0;
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
    if (deptNote) y = drawTechNoteBlock(doc, deptNote.note, deptNoteLabel, y + 2, practice);
    // This department's OWN technician + consultant sign at the end of its
    // block — never the global set, never the downloader. The report's LAST
    // department defers its signatures to after the End-of-Report marker.
    if (sigH > 0 && sigs) {
      if (isLast && deferLastSigs) deferLastSigs.sigs = sigs;
      else {
        // Sign-off sits at the FOOT of the department's last page, directly
        // above the footer strip — not floating under the last row with a
        // blank half-page beneath (the page-2 bug in REPORT-49289714).
        const anchored = Math.max(y, A4.h - MARGIN_BOTTOM - sigH);
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

// ── Profile ONE-PAGE report layout (owner, 2026-10-02) ──────────────────

/** Every analyzer image code attached to ANY member line of this profile
 *  bundle, merged into one map — the connector routes an M51 image onto
 *  whichever member line matches its analyte (RouteTarget), so the box
 *  doesn't care which specific line carried it. */
function profileAnalyzerImages(snap: ReportSnapshot, pkg: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of snap.tests ?? []) {
    const legacy = t.packageType == null;
    const b = t.profileTestId ?? (t.packageType === 'profile' ? t.packageTestId : null) ?? (legacy ? t.packageTestId : null);
    if (b !== pkg) continue;
    for (const [code, url] of Object.entries(t.analyzerImages ?? {})) if (url) out[code] = url;
  }
  return out;
}

/** The one-page table box's columns: the SAME effective set the continuous
 *  report would print for this profile (its own override, else its
 *  department's — `effectiveColumns` / `deptColumns`), minus the ones the lab
 *  switched off in the designer (by column name or type). The name and
 *  result columns always print. */
function onePageTableColumns(group: PanelGroup, box: PageLayoutBox): ReportColumn[] {
  const base = group.columnsOverridden && group.columns?.length ? effectiveColumns(group.columns) : deptColumns([group]);
  const off = new Set((box.columns ?? []).filter(c => !c.visible).map(c => c.name));
  return base.filter(c => c.type === 'name' || c.type === 'result' || !(off.has(c.name) || off.has(c.type)));
}

/** Render one profile's CUSTOM LAYOUT (owner 2026-10-02): the designer's
 *  pages, each opening with the Report template's letterhead + patient block
 *  (and footer, drawn for every page at the end), the profile's boxes in the
 *  body between them:
 *   · the results table is the report's OWN renderColumnarTable aimed at a
 *     box. AUTO mode: rows flow through the table boxes in page order — each
 *     box takes the whole rows that fit, the rest continue in the next
 *     ("continued") box; the last box lets any remainder run on (never a cut
 *     row). MANUAL mode: each box prints the rows chosen for it; a row in no
 *     box prints in the last one (a result is never dropped);
 *   · a missing analyzer graph hides its box; a page left with nothing to
 *     print is dropped;
 *   · the department signs here only when `signHere` (this profile is the
 *     department's LAST item in the report) and the layout has a signatures
 *     box — otherwise that box is left out.
 *  `topY`: the open page is still blank below the patient block — reuse it
 *  for the first page instead of forcing an empty one.
 *  Returns the y under the printed content (End of Report goes there) and
 *  whether the department signed. */
function renderCustomLayout(
  doc: jsPDF, pkg: string, group: PanelGroup, layout: ResolvedReportLayout,
  practice: NonNullable<ReportPdfInput['practice']>, snap: ReportSnapshot, report: ReportPdfInput['report'],
  deptSigs: ReportSignature[], opts: { topY?: number; signHere: boolean },
): { bottom: number; signed: boolean } {
  const pl = readPageLayout(layout.sections);
  const pages = pl?.pages ?? [];
  const images = profileAnalyzerImages(snap, pkg);
  const availCodes = new Set(Object.keys(images));
  const labelFont = EMBEDDED ? SOURCE_SANS_FAMILY : PDF_FONT;
  const floor = A4.h - footerFloor(LAYOUT);
  const chain = tableChain(pages);
  const lastTableId = chain[chain.length - 1]?.box.id;
  const manual = pl?.tableMode === 'manual';
  const rowKeys = group.rows.filter(r => r.kind === 'param' && r.rowKey).map(r => r.rowKey!);

  // MANUAL: each table box's rows (a note row rides with the value above it).
  const manualRows = new Map<string, PanelRowData[]>();
  if (manual && chain.length) {
    const byBox = manualRowsByBox(chain, rowKeys);
    let owner = chain[0].box.id;
    for (const r of group.rows) {
      if (r.kind === 'param') {
        owner = [...byBox.entries()].find(([, set]) => r.rowKey && set.has(r.rowKey))?.[0]
          ?? (r.rowKey ? lastTableId! : owner);
      }
      const list = manualRows.get(owner) ?? [];
      list.push(r);
      manualRows.set(owner, list);
    }
  }
  let remaining = group.rows;                       // AUTO: rows not printed yet
  const tableRowsFor = (box: PageLayoutBox): PanelRowData[] => (manual ? (manualRows.get(box.id) ?? []) : remaining);

  let opened = 0, signed = false, bottom = opts.topY ?? MARGIN_TOP, lastPdfPage = doc.getNumberOfPages();
  // The signatures box signs only if NO results print after it (a table
  // that continues on a later page): decided after all pages, then drawn on
  // its own page (jsPDF setPage) — else the sign-off follows the profile.
  let pendingSig: { pdfPage: number; layoutPage: number; x: number; y: number; w: number } | null = null;
  let lastTableLayoutPage = -1;
  for (let i = 0; i < pages.length; i++) {
    const live = printableBoxes(pages[i].boxes);
    const hasContent = live.some(b =>
      (b.kind === 'table' && tableRowsFor(b).length > 0) ||
      (b.kind === 'analyzer' && !!b.ref && availCodes.has(b.ref)) ||
      (b.kind === 'chart' && layout.sections.some(sx => sx.id === b.ref && sx.type === 'chart' && !!sx.trend)) ||
      (b.kind === 'notes' && !!(b.text ?? b.label ?? '').trim()) ||
      (b.kind === 'signatures' && opts.signHere && !signed && deptSigs.length > 0));
    if (!hasContent && !KEEP_EMPTY_LAYOUT_PAGES) continue; // a page with nothing to print is dropped

    let y: number;
    if (opened === 0 && opts.topY != null) {
      y = opts.topY;                                 // the open page is still blank — use it
    } else {
      NEXT_PAGE_IS_FIRST = false;
      doc.addPage();
      drawLetterhead(doc);
      y = drawCustomPatientFields(doc, snap, drawPatientBlock(doc, snap, report)) + 10;
    }
    const dept = (group.department ?? '').trim();
    if (opened === 0 && dept) {
      const ids = departmentSampleIds([group]);
      y = renderScopeHeading(doc, dept.toUpperCase(), y, practice, ids.length ? `Sample ID: ${ids.join(', ')}` : null);
    }
    const name = group.testName || layout.testName || '';
    y = drawPanelNameBand(doc, opened === 0 ? name : `${name.toUpperCase()} — CONTINUED`, MARGIN_X, y + 2, A4.w - 2 * MARGIN_X) + 6;
    opened++;
    const body: ProfileBodyArea = bodyArea(y, floor);
    const bodyPage = doc.getNumberOfPages();
    try { ON_ONE_PAGE_BODY?.({ pkg, page: bodyPage, layoutPage: i, body: { ...body } }); } catch { /* designer hook only */ }

    const { boxes } = collapseMissingAnalyzerBoxes(live, availCodes, body);
    let pageBottom = body.top, tableEnd = 0;
    // Tables last: a table that runs on must not push the other boxes off this page.
    const ordered = [...boxes.filter(b => b.kind !== 'table'), ...boxes.filter(b => b.kind === 'table').sort((a, b2) => a.y - b2.y)];
    for (const box of ordered) {
      const r = { x: body.left + box.x * MM, y: body.top + box.y * MM, w: box.w * MM, h: box.h * MM };
      switch (box.kind) {
        case 'table': {
          const rows = tableRowsFor(box);
          if (!rows.length) break;
          const fit = !manual && box.id !== lastTableId;
          const out = { consumed: rows.length };
          const sized = { natural: 0 };
          const end = renderColumnarTable(doc, [{ ...group, rows }], onePageTableColumns(group, box), r.y, practice, null, 0, false,
            { x: r.x, w: r.w, bottom: body.bottom, hideBand: true, dropEmpty: true, ...(fit ? { fitH: r.h, out } : {}),
              boxH: r.h, vAlign: box.vAlign ?? 'top', rowGap: ROW_SPACING_PT[box.rowSpacing ?? 'normal'] ?? 0, sized });
          if (!manual) remaining = remaining.slice(out.consumed);
          lastTableLayoutPage = i;
          tableEnd = Math.max(tableEnd, end - 6);
          try {
            ON_ONE_PAGE_BODY?.({ pkg, page: bodyPage, layoutPage: i, body: { ...body }, boxId: box.id, rowsPrinted: out.consumed,
              tableBottom: doc.getNumberOfPages() === bodyPage ? end - 6 : null, tableNaturalH: sized.natural || null });
          } catch { /* designer hook only */ }
          break;
        }
        case 'analyzer': {
          const url = box.ref ? images[box.ref] : undefined;
          drawAnalyzerImageBox(doc, box, body, url ? IMG_CACHE[url] : undefined, TEXT, labelFont);
          pageBottom = Math.max(pageBottom, r.y + r.h);
          break;
        }
        case 'chart': {
          const sec = layout.sections.find(sx => sx.id === box.ref && sx.type === 'chart' && sx.trend);
          if (sec) {
            renderReportChart(doc, sec, group.testName ?? '', r.y, chartTheme(),
              { x: r.x, contentWidth: r.w, floor: r.y + r.h, newPage: () => r.y });
            pageBottom = Math.max(pageBottom, r.y + r.h);
          }
          break;
        }
        case 'signatures':
          if (opts.signHere && !pendingSig && deptSigs.length) pendingSig = { pdfPage: bodyPage, layoutPage: i, x: r.x, y: r.y, w: r.w };
          break;
        case 'notes': {
          const text = (box.text ?? box.label ?? '').trim();
          if (text) { drawNotesBox(doc, box, body, text, TEXT, labelFont); pageBottom = Math.max(pageBottom, r.y + r.h); }
          break;
        }
      }
    }
    // The End of Report goes under what actually printed — never the
    // signatures box, which the layout pins where the lab placed it.
    lastPdfPage = doc.getNumberOfPages();
    bottom = lastPdfPage === bodyPage ? Math.max(pageBottom, tableEnd) : tableEnd;
  }
  if (pendingSig && pendingSig.layoutPage >= lastTableLayoutPage) {
    const cur = doc.getNumberOfPages();
    doc.setPage(pendingSig.pdfPage);
    drawInlineSignatures(doc, deptSigs, pendingSig.y, practice, { x: pendingSig.x, w: pendingSig.w });
    doc.setPage(cur);
    signed = true;
  }
  // Safety net: rows no table box printed (no table box at all) still print.
  if (!manual && remaining.length && (!chain.length || opened === 0)) {
    let y = opened === 0 && opts.topY != null ? opts.topY : bottom + 8;
    if (opened > 0 && y > floor - 60) y = newPage(doc, practice);
    bottom = renderColumnarTable(doc, [{ ...group, rows: remaining }], onePageTableColumns(group, {} as PageLayoutBox), y, practice, null, 0, false);
  }
  return { bottom, signed };
}

// ── Technician report notes (owner 2026-09-30) ───────────────────
// A note row inside the results table (line / profile) or a free block that
// breaks across pages line by line (department / whole order). Type from
// the theme's `techNote` token; bold / italic runs in the theme's faces.

function noteTypeset(): NoteTypeset {
  const size = tsz('techNote');
  return {
    size,
    lineHeight: size * 1.32,
    face: (doc, st) => setFace(doc, st.b && st.i ? 'bolditalic' : st.b ? 'bold' : st.i ? 'italic' : twt('techNote')),
  };
}

/** The table row for a technician note, or null when there is none. */
function techNoteRow(note: string | null | undefined, label: string): PanelRowData | null {
  return (note ?? '').trim() ? { kind: 'note', techNote: note!, techLabel: label } : null;
}

/** Put a line's note right after its results (last value / description),
 *  ahead of its Sentences and other notes — "before its interpretation". */
function insertTechNote(rows: PanelRowData[], row: PanelRowData | null): void {
  if (!row) return;
  let at = -1;
  rows.forEach((r, i) => { if (r.kind === 'param') at = i; });
  if (at < 0) {
    // No values yet: after any lead Sentence rows, before the closing ones.
    rows.push(row);
    return;
  }
  rows.splice(at + 1, 0, row);
}

function techNoteBlockHeight(doc: jsPDF, note: string, label: string): number {
  return layoutReportNote(doc, note, A4.w - 2 * MARGIN_X - 12, noteTypeset(), label).height + 4;
}

/** A free-standing note block from `startY`, wrapping across pages line by
 *  line (never clipped at the footer). Returns the y below it. */
function drawTechNoteBlock(
  doc: jsPDF, note: string, label: string, startY: number, practice: NonNullable<ReportPdfInput['practice']>,
): number {
  const t = noteTypeset();
  // Aligned with the results tables' text (their 6 pt cell padding).
  const lay = layoutReportNote(doc, note, A4.w - 2 * MARGIN_X - 12, t, label);
  if (!lay.lines.length) return startY;
  const floor = A4.h - MARGIN_BOTTOM;
  // Keep at least the first two lines together with the block's start.
  let top = startY;
  if (top + Math.min(lay.height, t.lineHeight * 2) > floor) top = newPage(doc, practice);
  let base = top + t.size * 0.8;
  let prevDy = 0;
  for (const line of lay.lines) {
    base += line.dy - prevDy;
    prevDy = line.dy;
    if (base + t.size * 0.3 > floor) { base = newPage(doc, practice) + t.size * 0.8; }
    drawReportNoteLine(doc, line, MARGIN_X + 6, base, t, TEXT);
  }
  return base + t.size * 0.4 + 4;
}

/** Room kept between a table's last row and its sign-off: renderColumnarTable
 *  returns finalY + 6, so a reserve of exactly the block height would miss by
 *  those points and push the block onto a page of its own. */
const SIGN_OFF_SLACK = 8;

/** The body's floor on every page = the real footer band. The date strip
 *  (hairline at h-30, "Generated on" at h-18) needs 40pt; the LAST page also
 *  stacks the disclaimer / footer text up from there (movable in the
 *  designer), so the floor clears the highest of those + 6pt air. One floor
 *  for every page — autoTable's bottom margin cannot vary per page and the
 *  last page is only known once the body is laid out. Footer items dragged up
 *  into the body are the designer's choice and do not raise the floor. */
export function footerFloor(layout: Pick<ReportLayoutResult, 'items'> | null | undefined): number {
  let top = A4.h - 40;
  for (const it of layout?.items ?? []) {
    if (it.region !== 'footer' || it.hidden || it.box.y < A4.h * 0.7) continue;
    top = Math.min(top, it.box.y);
  }
  return Math.ceil(A4.h - top + 6);
}

/** Height (pt) of the sign-off block the PRESENT signatories need — 0 when
 *  there are none, so nothing is reserved. See report-signatures.ts. */
function signatureBlockHeight(sigs: ReportSignature[] | null | undefined): number {
  return layoutSignatureBlock(sigs, MARGIN_X, A4.w - 2 * MARGIN_X).height;
}

/** Draw `text` centred on `cx`, shrinking the font (down to 6.5pt) until it
 *  fits the slot — never truncated, never spilling into the next signatory. */
function drawFittedCentre(doc: jsPDF, text: string, cx: number, y: number, el: TypeEl, maxW: number): void {
  let fs = typeset(doc, el);
  while (fs > 6.5 && doc.getTextWidth(text) > maxW) { fs -= 0.5; doc.setFontSize(fs); }
  doc.text(text, cx, y, { align: 'center' });
}

/** The sign-off block drawn INLINE at the end of a department (or below the
 *  End-of-Report marker): only the signatories present, laid out by count
 *  (1 → right, 2 → left/right, 3 → L/C/R, 4 → even; 5-7 wrap into balanced
 *  rows). Callers reserve the exact height up-front, so the page break here
 *  is only a last-resort guard — and it moves the WHOLE block, never splits
 *  it across pages. */
function drawInlineSignatures(
  doc: jsPDF,
  sigs: ReportSignature[],
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>,
  /** Profile one-page layout: the same sign-off, inside the signatures box
   *  (left `x`, width `w`) — never moved to another page. */
  region: { x: number; w: number } | null = null,
): number {
  const left = region ? region.x : MARGIN_X;
  const usable = region ? region.w : A4.w - 2 * MARGIN_X;
  const probe = layoutSignatureBlock(sigs, left, usable, 0);
  if (probe.rows.length === 0) return startY;
  let top = startY;
  if (!region && top + probe.height > A4.h - MARGIN_BOTTOM) { top = newPage(doc, practice) + 6; }
  const block = layoutSignatureBlock(sigs, left, usable, top);
  const textW = block.slotW - 6;
  for (const row of block.rows) {
    const baseY = row.top + SIG_ROW.base;
    const hasTitle = row.slots.some(s => !!(s.sig.title ?? '').trim());
    const titleY = baseY + SIG_ROW.name + SIG_ROW.title;
    const regY = baseY + SIG_ROW.name + (hasTitle ? SIG_ROW.title : 0) + SIG_ROW.reg;
    for (const { sig: s, cx: px } of row.slots) {
      const sigSrc = s.signatureUrl
        ? (s.signatureUrl.startsWith('data:') ? s.signatureUrl : IMG_CACHE[s.signatureUrl])
        : null;
      if (sigSrc) {
        try { doc.addImage(sigSrc, 'PNG', px - SIG_IMG_W / 2, baseY - 20, SIG_IMG_W, SIG_IMG_H, undefined, 'FAST'); }
        catch { drawSigScribble(doc, px, baseY + 4); }
      } else {
        drawSigScribble(doc, px, baseY + 4);
      }
      if ((s.name ?? '').trim()) {
        doc.setTextColor(BLACK);
        drawFittedCentre(doc, s.name!.trim(), px, baseY + SIG_ROW.name, 'signatureName', textW);
      }
      if ((s.title ?? '').trim()) {
        doc.setTextColor(TEXT_DIM);
        drawFittedCentre(doc, `(${s.title!.trim()})`, px, titleY, 'signatureTitle', textW);
      }
      if ((s.regNo ?? '').trim()) {
        doc.setTextColor(TEXT_DIM);
        drawFittedCentre(doc, `Reg. ${s.regNo!.trim()}`, px, regY, 'signatureReg', textW);
      }
    }
  }
  return top + block.height;
}

/** The single pipeline every column source passes through before rendering:
 *  sort by order, guarantee an Investigation (name) lead column so the
 *  parameter name always shows, apply the default Result→Unit link. */
function effectiveColumns(src: ReportColumn[]): ReportColumn[] {
  // The Result→Unit default runs on the columns AS CONFIGURED (before the
  // synthesized name column) so it can tell an explicit unpin apart.
  const cfg = applyDefaultResultUnitLink(src.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  if (!cfg.some(c => c.type === 'name')) {
    return [{ id: 'rc-name', name: 'name', label: 'Investigation', order: 0, width: 30, type: 'name', locked: false }, ...cfg];
  }
  return cfg;
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

// ── Sentence rows inside the results table ──────────────────────
// A named Sentence opens with its name in bold ("Interpretation: …"). A cell
// has one font, so — like the superscript cells — the text autotable laid
// out is blanked just before drawing and repainted: the label bold, the rest
// of the line and every following line in the cell's own font. Autotable's
// own wrapped lines are reused, so row height and page splits never shift.
type SentenceCell = { label: string; lines: string[]; x: number; y: number; fs: number; lh: number; color: unknown };
type SentenceHookArg = {
  section: string; row: { index: number }; column: { index: number };
  cell: { text: string[] | string; x: number; y: number; styles: { fontSize?: number; textColor?: unknown };
          padding(side: string): number };
  doc: jsPDF;
};

function stashSentenceCell(store: Map<number, SentenceCell>, d: SentenceHookArg, label: string): void {
  const lines = Array.isArray(d.cell.text) ? [...d.cell.text] : [String(d.cell.text ?? '')];
  const fs = typeof d.cell.styles.fontSize === 'number' ? d.cell.styles.fontSize : 8.5;
  store.set(d.row.index, {
    label, lines, fs, color: d.cell.styles.textColor,
    lh: fs * (d.doc.getLineHeightFactor?.() ?? 1.15),
    x: d.cell.x + d.cell.padding('left'),
    // autotable's own top-aligned first baseline (autoTableText).
    y: d.cell.y + d.cell.padding('top') + fs * (2 - 1.15),
  });
  d.cell.text = [];
}

function drawSentenceCell(doc: jsPDF, store: Map<number, SentenceCell>, d: SentenceHookArg): void {
  if (d.section !== 'body') return;
  const c = store.get(d.row.index);
  if (!c) return;
  store.delete(d.row.index);
  doc.setFontSize(c.fs);
  const color = typeof c.color === 'string' ? c.color : TEXT;
  c.lines.forEach((line, i) => {
    const y = c.y + i * c.lh;
    if (i === 0 && line.startsWith(c.label)) {
      setFace(doc, twt('interpretationLabel'));
      doc.setTextColor(BLACK);
      doc.text(c.label, c.x, y);
      const lw = doc.getTextWidth(c.label);
      setFace(doc, twt('interpretation'));
      doc.setTextColor(color);
      const rest = line.slice(c.label.length).replace(/^\s+/, '');
      if (rest) doc.text(rest, c.x + lw + doc.getTextWidth(' '), y);
      return;
    }
    setFace(doc, twt('interpretation'));
    doc.setTextColor(color);
    doc.text(line, c.x, y);
  });
}

/** Autotable has no keep-with-next. Just before drawing row i, look ahead: if
 *  row i+1 is glued to what follows and would be the LAST thing on this page
 *  (its chain can't start here), push i+1 to the next page too — temporarily
 *  taller than what is left and unsplittable — and restore it once it draws
 *  there. A chain is i+1 plus every row glued to the one before it: a panel
 *  band, its Method/Specimen line and its first result; a value and its
 *  description; a test's last row and its Sentence. Rows never split
 *  (rowPageBreak 'avoid'), so every row of the chain must fit whole. */
type KeepRow = { index: number; height: number; cells: Record<string, { height: number }> };
type KeepHookArg = {
  row: KeepRow; cursor: { y: number } | null;
  table: { body: KeepRow[]; settings: { rowPageBreak: string; margin: { bottom: number } } };
};
const KEEP_HELD = new WeakMap<object, { height: number; cells: number[]; rowPageBreak: string }>();

/** Height of the rows glued to row `j` (j+1 … the first row not itself glued
 *  to its successor), 0 when nothing follows. */
function chainAfter(body: KeepRow[], j: number, keepWithNext: Set<number>): number {
  let need = 0;
  for (let k = j + 1; k < body.length; k++) {
    need += body[k].height;
    if (!keepWithNext.has(k)) break;
  }
  return need;
}

function keepRowsTogether(doc: jsPDF, d: KeepHookArg, keepWithNext: Set<number>): void {
  const held = KEEP_HELD.get(d.row);
  if (held) {
    KEEP_HELD.delete(d.row);
    d.row.height = held.height;
    Object.values(d.row.cells).forEach((c, k) => { c.height = held.cells[k]; });
    d.table.settings.rowPageBreak = held.rowPageBreak;
  }
  const i = d.row.index;
  const j = i + 1;
  if (i < 0 || !d.cursor || !keepWithNext.has(j)) return;
  const next = d.table.body[j];
  if (!next || !d.table.body[j + 1]) return;
  const bottom = doc.internal.pageSize.getHeight() - d.table.settings.margin.bottom;
  const top = d.cursor.y + d.row.height;           // where row j would start
  const need = chainAfter(d.table.body, j, keepWithNext);
  if (top + next.height > bottom || top + next.height + need <= bottom) return;
  // Never on a page that could not hold the chain anyway.
  if (next.height + need > bottom - 80) return;
  const cells = Object.values(next.cells);
  KEEP_HELD.set(next, { height: next.height, cells: cells.map(c => c.height), rowPageBreak: d.table.settings.rowPageBreak });
  const h = bottom - top + 1;
  next.height = h;
  cells.forEach(c => { c.height = h; });
  d.table.settings.rowPageBreak = 'avoid';
}

/** The theme element a results-table column prints in (by its first member's
 *  type). Classic: the Method / Specimen columns print as body text. */
function columnElement(m: ReportColumn): TypeEl {
  switch (m.type) {
    case 'name': return 'testName';
    case 'result': return 'result';
    case 'unit': return 'unit';
    case 'range': return 'range';
    case 'method': return 'methodColumn';
    case 'specimen': return 'specimenColumn';
    case 'text': return m.name === 'specimen' ? 'specimenColumn' : 'tableBody';
    default: return 'tableBody';
  }
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
  /** Room the department's sign-off block needs under this table's LAST row.
   *  Held back only on the page where the table ends (see fitSignOff) — the
   *  table's earlier pages fill to the normal floor. Without it autoTable
   *  fills to MARGIN_BOTTOM and the signatures get pushed onto an empty page. */
  reserveBottom = 0,
  /** True when `cfg` is a test's/profile's OWN column override (a break-out
   *  run): configured columns print exactly as arranged — even empty ones —
   *  and every group gets its heading band so the odd-width table reads as
   *  its own titled block. */
  overriddenRun = false,
  /** Profile one-page layout: draw this SAME table (theme, fonts, rules,
   *  flags, superscripts — nothing restyled) inside a box instead of across
   *  the page: left edge `x`, width `w`, rows stop at `bottom` (overflow
   *  still continues on the next page — never cut). `hideBand` leaves out
   *  the panel band (the one-page block prints it full width above);
   *  `dropEmpty` drops columns with no content even in the admin preview. */
  region: { x: number; w: number; bottom: number; hideBand?: boolean; dropEmpty?: boolean;
            /** Custom layout, auto-continue: print only the rows that FIT the
             *  box's height (`boxH`, pt) — whole rows, never a cut row — and
             *  report how many of the group's rows were used in `out`. */
            fitH?: number; out?: { consumed: number };
            /** The box's height (pt) and where the rows sit in it when they
             *  need less: 'fill' spreads them evenly, 'center' centres them. */
            boxH?: number; vAlign?: 'top' | 'fill' | 'center' | null;
            /** Extra space per row (pt; negative = tighter) — the box's row spacing. */
            rowGap?: number;
            /** Out: the natural height (head + rows, before Fill), pt. */
            sized?: { natural: number } } | null = null,
): number {
  if (groups.length === 0) return startY;
  if (!region && startY > A4.h - MARGIN_BOTTOM - 70) { startY = newPage(doc, practice); }

  const LEFT = region ? region.x : MARGIN_X;
  const usable = region ? region.w : A4.w - 2 * MARGIN_X;
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
  if ((!PREVIEW_KEEP_EMPTY_COLS || region?.dropEmpty) && !overriddenRun) vcols = vcols.filter(vc => vc.members.some(memberHasContent));
  const hasResultCol = vcols.some(c => c.hasResult);
  const hasMethodCol = vcols.some(c => c.members.some(m => m.type === 'method'));
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
  /** Body row index → the bold label its Sentence row opens with. */
  const sentenceLabels = new Map<number, string>();
  /** Body row index → a technician note's layout (painted in didDrawCell). */
  const techCells = new Map<number, NoteLayout>();
  /** Body rows that must share a page with the NEXT row: a test's last row
   *  and the Sentence under it, or a Sentence and the row it introduces. */
  const keepWithNext = new Set<number>();
  /** Body row kinds, parallel to `body` (glue decisions). */
  const bodyKind: Array<'param' | 'sentence' | 'desc' | 'other'> = [];
  /** Body row → index into `groups` (continuation heading). */
  const groupOfRow: number[] = [];
  /** Group index → its panel band's body row (compact tests have none). */
  const bandRowOf = new Map<number, number>();
  /** No Description column in this table → each value's description prints
   *  as a full-width row right under that value's row (P1, D1, P2, P3, D3). */
  const descAsRow = !hasDescriptionColumn(cfg);
  /** Body row → the index of its source row in the group (-1 = a band /
   *  sub-line) — so a box-fitted table can report whole rows used. */
  const srcOfBody: number[] = [];
  let curSrc = -1;
  const markSrc = (next: number) => { while (srcOfBody.length < body.length) srcOfBody.push(curSrc); curSrc = next; };
  for (const g of groups) {
    // A single-analyte test renders COMPACT: one plain row, no bold panel band
    // and no Method sub-line — the band + method treatment is reserved for
    // multi-parameter panels/profiles (CBC, LFT…). This matches the classic
    // report style: a 20-test biochem order reads as 20 rows, not 20 panels.
    // This holds in an override run too (owner 2026-09-19): the run's own
    // column-header strip is the block's heading — a band would just repeat
    // the name the Investigation cell already prints.
    // A test's Sentences don't count: they are merged rows under (or above)
    // the one analyte row, not parameters.
    // Nor does a technician note (a row under the value, never a band).
    const coreRows = g.rows.filter(r => !r.sentence && !r.techNote);
    const compact = coreRows.length === 1 && coreRows[0].kind === 'param' && !g.referralLab;
    const groupStart = body.length;

    if (!compact && !region?.hideBand) {
      // Panel / profile header band — bold, full width.
      bandRowOf.set(groups.indexOf(g), body.length);
      body.push([{
        content: g.testName.toUpperCase(),
        colSpan: COLSPAN,
        styles: { fillColor: '#eef2f7', textColor: theme.primary, ...cellType('panelName'), halign: 'left' },
      }]);
      bodyMeta.push(null);
      bodyKind.push('other');

      // Method / Specimen / referral-lab sub-lines (ISO 15189 7.4.1.6 for
      // referrals) — one per line, in that order (owner, 2026-09-28: with both
      // switches on, Method then Specimen, never run together on one line).
      const sub: Array<{ text: string; el: TypeEl }> = [];
      const methodText = g.hideMethodLine ? undefined : (g.methodLine ?? g.method);
      if (methodText) sub.push({ text: `Method: ${methodText}`, el: 'methodology' });
      const specimenText = g.showSpecimenLine ? (g.specimen ?? '').trim() : '';
      if (specimenText) sub.push({ text: `Specimen: ${specimenText}`, el: 'specimen' });
      if (g.referralLab) sub.push({ text: `Tested at: ${g.referralLab}`, el: 'referral' });
      // Classic: one italic cell, a line each. A theme that styles them
      // apart (Modern: method regular, specimen italic) gives each its row.
      const subRows = !sub.length ? [] : TYPE.splitSubLines ? sub : [{ text: sub.map(l => l.text).join('\n'), el: 'methodology' as TypeEl }];
      for (const line of subRows) {
        body.push([{
          content: line.text,
          colSpan: COLSPAN,
          styles: { ...cellType(line.el), textColor: TEXT_DIM, fillColor: '#ffffff', halign: 'left',
                    ...(TYPE.splitSubLines ? { cellPadding: { top: 2, right: 6, bottom: 2, left: 6 } } : {}) },
        }]);
        bodyMeta.push(null);
        bodyKind.push('other');
      }
      // The band and its sub-line(s) open the panel WITH its first row —
      // never stranded at the foot of a page while every result sits on
      // the next (owner's report 2026-09-29: "VITAMIN PROFILE 1 / Specimen:
      // Serum" closed page 2 alone).
      for (let i = groupStart; i < body.length; i++) keepWithNext.add(i);
    }

    let firstParam = true;
    let srcIdx = -1;
    for (const r of g.rows) {
      markSrc(++srcIdx);
      if (r.sentence) {
        // The test's Sentence → ONE full-width row (every column merged),
        // readable body text in the template's font and body colour; the
        // admin's line breaks are kept. A named block opens with its name in
        // bold ("Interpretation: …", like "Method: …") — drawn in the hooks.
        const label = r.sentenceLabel;
        if (label) sentenceLabels.set(body.length, `${label}:`);
        body.push([{
          content: label ? `${label}: ${r.note ?? ''}` : (r.note ?? ''),
          colSpan: COLSPAN,
          styles: { fillColor: '#ffffff', textColor: TEXT, ...cellType('interpretation'), halign: 'left', valign: 'top' },
        }]);
        bodyMeta.push(null);
        bodyKind.push('sentence');
        continue;
      }
      if (r.techNote) {
        // Technician note: sized from its own layout, painted in didDrawCell
        // (a cell has one font; the note mixes bold / italic / underline).
        const lay = layoutReportNote(doc, r.techNote, usable - 12, noteTypeset(), r.techLabel);
        techCells.set(body.length, lay);
        body.push([{
          content: '',
          colSpan: COLSPAN,
          styles: { fillColor: '#ffffff', textColor: TEXT, ...cellType('techNote'), halign: 'left', valign: 'top',
                    minCellHeight: lay.height + 8 },
        }]);
        bodyMeta.push(null);
        // Glued to the row above (the test's last result) like a description.
        bodyKind.push('desc');
        continue;
      }
      if (r.kind === 'note') {
        body.push([{
          content: r.note ?? '',
          colSpan: COLSPAN,
          styles: { fillColor: '#f8fafc', textColor: TEXT, ...cellType('note'), halign: 'left' },
        }]);
        bodyMeta.push(null);
        bodyKind.push('other');
        continue;
      }
      // A 'N' (normal) flag is never abnormal — keep it plain black, never
      // bold/coloured, even if the row carried a stray colour.
      const isNormal = !r.abnormal || r.flag === 'N';
      const abnColor = r.isLow ? theme.abnormalLowColor : theme.abnormalColor;
      // Letter mode appends the flag letter to the result; arrow mode draws a
      // triangle (didDrawCell). 'none' → no glyph/arrow.
      // 'A' (qualitative abnormal — e.g. "Reactive" from a dropdown) is BOLD
      // only: no ▲/▼ and no letter (owner 2026-09-27 — a direction means
      // nothing for a text answer). A critical already arrives as H / L
      // (reportFlag) — the report never prints C / Critical.
      const useArrow = theme.flagIndicator === 'arrow' && (r.flag === 'H' || r.flag === 'L');
      const glyph = (r.flag && r.flag !== 'A' && !useArrow && theme.flagIndicator !== 'none') ? r.flag : '';
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
        const styles: Record<string, unknown> = { halign: 'left', textColor: TEXT_DIM, ...cellType(columnElement(vc.members[0])) };
        if (vc.nameOnly) { Object.assign(styles, cellType('testName')); styles['textColor'] = BLACK; }
        else if (vc.textOnly) { Object.assign(styles, cellType('cellText')); }
        if (vc.hasResult) {
          if (glyph) txt = txt ? `${txt}  ${glyph}` : glyph;
          styles['textColor'] = BLACK;
          // The value's emphasis: regular (Modern: semibold) → the SAME
          // bold for an abnormal value, a non-Normal option, an admin row
          // colour and the tech's "print in bold" pick.
          let emphasised = false;
          if (!isNormal && theme.flagIndicator !== 'none') {
            emphasised = true;
            if (theme.flagStyle === 'bold_color') styles['textColor'] = abnColor;
          }
          // A chosen option that is NOT ticked Normal (mw saves 'A' — only
          // when its option list has at least one Normal) always prints bold,
          // whatever the indicator setting (owner 2026-09-26).
          if (r.flag === 'A') emphasised = true;
          if (adminColor) { styles['textColor'] = adminColor; emphasised = true; }
          // The tech's "print in bold" pick: the SAME value-cell bold as an
          // abnormal value (colour untouched — it adds emphasis, not a flag).
          if (r.printBold) emphasised = true;
          Object.assign(styles, cellType(emphasised || r.bold ? 'resultAbnormal' : 'result'));
        }
        // Conditional bold (condition `then.bold`) — bolds name + result.
        if (r.bold && vc.nameOnly) styles['fontStyle'] = faceOf('bold')[1];
        return { content: txt, styles };
      });
      body.push(cells);
      bodyKind.push('param');
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
            bold: (!isNormal && theme.flagIndicator !== 'none') || r.flag === 'A' || !!r.printBold }
        : null);
      // Its description, when the table has no column for it: ONE merged
      // row directly under the value, styled like the Sentence row.
      const desc = descAsRow ? (r.description ?? '').trim() : '';
      if (desc) {
        body.push([{
          content: desc,
          colSpan: COLSPAN,
          styles: { fillColor: '#ffffff', textColor: TEXT, ...cellType('description'), halign: 'left', valign: 'top' },
        }]);
        bodyMeta.push(null);
        bodyKind.push('desc');
      }
      // A COMPACT single-value test has no panel band, so it has nowhere for
      // the "Method: …" sub-line — with "Show method line" on it prints as a
      // small line right under its row instead (RCA 2026-09-28: Calcium's
      // methodology never reached the report). A Method column already
      // carries it, so no second copy then.
      const compactMethod = compact && r.kind === 'param' && !g.hideMethodLine && !hasMethodCol
        ? (g.methodLine ?? g.method ?? r.method ?? '').trim() : '';
      if (compactMethod) {
        body.push([{
          content: `Method: ${compactMethod}`,
          colSpan: COLSPAN,
          styles: { ...cellType('methodology'), textColor: TEXT_DIM, fillColor: '#ffffff', halign: 'left' },
        }]);
        bodyMeta.push(null);
        // 'desc' = a row that belongs to the value above: kept on its page.
        bodyKind.push('desc');
      }
    }
    // Keep each Sentence on the page of the row it belongs to: the one it
    // follows (a test's last row) or, above the table, the one it introduces.
    // A description row always stays with the value row above it.
    for (let i = groupStart; i < body.length; i++) {
      if (bodyKind[i] === 'desc') { keepWithNext.add(i - 1); continue; }
      if (bodyKind[i] !== 'sentence') continue;
      if (i > groupStart && (bodyKind[i - 1] === 'param' || bodyKind[i - 1] === 'desc')) keepWithNext.add(i - 1);
      else if (bodyKind[i + 1] === 'param') keepWithNext.add(i);
    }
    while (groupOfRow.length < body.length) groupOfRow.push(groups.indexOf(g));
  }

  const sentenceCells = new Map<number, SentenceCell>();

  // When the table spills onto further pages, stamp "<DEPT> — continued" above
  // the repeated column header — otherwise a reader on page 2 can't tell which
  // department the rows belong to.
  markSrc(-1);
  let tablePagesSeen = 0;
  const margin = region
    ? { ...tablePageMargins(), left: region.x, right: A4.w - region.x - region.w, bottom: Math.max(MARGIN_BOTTOM, A4.h - region.bottom) }
    : tablePageMargins();

  // ── Panel heading on continuation pages ──────────────────────────
  // A page that opens MID-panel repeats the band as "<PANEL> — CONTINUED"
  // between the column header and its first row (owner's report 2026-09-29:
  // page 3 had three vitamins under no heading). autotable repeats only the
  // head, and which row opens a page is known only when that row draws — so
  // the head carries one band-height row that autotable never paints
  // (willDrawCell returns false), and the first body row of every page
  // either paints the continued band into that space or gives it back by
  // moving the cursor up. The band's own row opening a page needs no repeat.
  const CONT_ROW = head.length;
  head.push([{
    content: '',
    colSpan: COLSPAN,
    styles: { fillColor: false, lineWidth: 0, ...cellType('panelContinued'), halign: 'left',
              cellPadding: { top: 4, right: 6, bottom: 4, left: 6 } },
  }]);
  let contH = 0;
  let pageOpened = -1;
  let lastRealRow = 0;
  const openPage = (d: CellHookArg & { cursor: { y: number } | null; pageNumber: number }) => {
    if (d.pageNumber === pageOpened || !d.cursor) return;
    pageOpened = d.pageNumber;
    // A row taller than a page continues as a remainder row with index -1.
    const idx = d.row.index >= 0 ? d.row.index : lastRealRow;
    const gi = groupOfRow[idx];
    const bandRow = bandRowOf.get(gi);
    const top = d.cursor.y - contH;
    if (d.pageNumber > 1 && bandRow !== undefined && bandRow !== idx) {
      // autotable has ALREADY applied this cell's styles and paints its
      // rect/text with whatever fill, font and colour are current once the
      // hook returns — so the band's paint state is put back afterwards.
      const fill = doc.getFillColor(), font = doc.getFont(), size = doc.getFontSize(), color = doc.getTextColor();
      doc.setFillColor('#eef2f7');
      doc.rect(LEFT, top, usable, contH, 'F');
      const bandSize = typeset(doc, 'panelContinued');
      doc.setTextColor(theme.primary);
      // autotable's own top-aligned first baseline for the band's font.
      doc.text(`${groups[gi].testName.toUpperCase()} — CONTINUED`, LEFT + 6, top + 4 + bandSize * 0.85);
      doc.setFillColor(fill);
      doc.setFont(font.fontName, font.fontStyle);
      doc.setFontSize(size);
      doc.setTextColor(color);
    } else {
      d.cursor.y = top;
      d.cell.y = top;
    }
  };

  const table = __createTable(doc, {
    startY,
    head: head as unknown as Array<Array<string | Cell>>,
    body: body as unknown as Array<Array<string | Cell>>,
    margin,
    // A row never splits mid-cell across pages: one that does not fit moves
    // WHOLE to the next page (only a row taller than a page still splits).
    rowPageBreak: 'avoid',
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    didDrawPage: () => {
      tablePagesSeen++;
      if (tablePagesSeen > 1 && deptLabel) {
        typeset(doc, 'deptContinued');
        doc.setTextColor(theme.primary);
        doc.text(`${deptLabel.toUpperCase()} — CONTINUED`, LEFT, margin.top - 14);
        doc.setDrawColor(HAIR);
        doc.setLineWidth(0.5);
        doc.line(LEFT, margin.top - 10, LEFT + usable, margin.top - 10);
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
    // Returning false skips autotable's own painting of that cell.
    willDrawCell: (d: CellHookArg): false | undefined => {
      if (d.section === 'head' && d.row.index === CONT_ROW) return false;
      if (d.section === 'body' && d.column.index === 0) {
        openPage(d as Parameters<typeof openPage>[0]);
        if (d.row.index >= 0) lastRealRow = d.row.index;
        fitSignOff(d as unknown as Parameters<typeof fitSignOff>[0], reserveBottom);
        keepRowsTogether(doc, d as unknown as KeepHookArg, keepWithNext);
      }
      if (d.section === 'body' && sentenceLabels.has(d.row.index)) {
        stashSentenceCell(sentenceCells, d as unknown as SentenceHookArg, sentenceLabels.get(d.row.index)!);
        return undefined;
      }
      // Order matters: a qualified range cell is claimed here first, so the
      // superscript hook doesn't also blank it and fight over the redraw.
      stashQualifiedRangeCell(qualCells, d, rangeColIdx);
      stashSuperscriptCell(supCells, d);
      return undefined;
    },
    didDrawCell: (d: { section: string; column: { index: number }; row: { index: number }; cell: { x: number; y: number; width: number; height: number; styles?: Record<string, unknown> } }) => {
      drawSentenceCell(doc, sentenceCells, d as unknown as SentenceHookArg);
      if (d.section === 'body' && techCells.has(d.row.index)) {
        const t = noteTypeset();
        drawReportNote(doc, techCells.get(d.row.index)!, d.cell.x + 6, d.cell.y + 4 + t.size * 0.8, t, TEXT);
      }
      drawQualifiedRangeCell(doc, qualCells, d as CellHookArg);
      drawSuperscriptCell(doc, supCells, d as CellHookArg);
      if (d.section !== 'body' || d.column.index !== resultColIdx) return;
      const m = bodyMeta[d.row.index];
      if (!m) return;
      const s = 3.2;
      // Place the glyph just after the printed value (measured in the same
      // font the cell used), clamped inside the cell.
      const fs = typeset(doc, m.bold ? 'resultAbnormal' : 'result');
      const tw = doc.getTextWidth(m.text);
      const cx = Math.min(d.cell.x + 6 + tw + 8, d.cell.x + d.cell.width - 9);
      // Align to the FIRST text line, not the cell middle — a multi-band
      // reference stack makes the row tall, and a centred glyph floated
      // below "500 mg/dL" instead of sitting beside it.
      const cy = d.cell.y + 4 + fs * 0.42;
      doc.setFillColor(m.color);
      if (m.arrow === 'up') doc.triangle(cx - s, cy + s, cx + s, cy + s, cx, cy - s, 'F');
      else doc.triangle(cx - s, cy - s, cx + s, cy - s, cx, cy + s, 'F');
    },
  } as unknown as Parameters<typeof autoTable>[1]);
  contH = table.head[CONT_ROW]?.height ?? 0;
  const floor = A4.h - MARGIN_BOTTOM;
  // The column header on its own; the continuation reserve is given back.
  const headH = table.getHeadHeight(table.columns) - contH;
  // The header and the first glued chain (a panel band, its sub-line and
  // its first result) open the table together — keepRowsTogether only
  // looks ahead from a row already drawn, so row 0 is decided here.
  // Row spacing (Custom layout table box) — before the fit, so the rows a
  // box holds are counted at the spacing it prints.
  if (region?.rowGap) for (const row of table.body) setRowHeight(row, Math.max(4, row.height + region.rowGap));
  if (region?.fitH != null && region.out) {
    // Whole rows that fit the box (head included); never split one source
    // row's body rows (a value + its description) across two boxes.
    const rows = table.body as Array<{ height: number }>;
    let used = headH, cut = 0;
    while (cut < rows.length && used + rows[cut].height <= region.fitH + 0.5) { used += rows[cut].height; cut++; }
    while (cut > 0 && cut < rows.length && srcOfBody[cut] >= 0 && srcOfBody[cut] === srcOfBody[cut - 1]) cut--;
    const firstSrc = srcOfBody.findIndex(x => x >= 0);
    if (cut <= firstSrc && firstSrc >= 0) {
      // Not even one row fits: print the first row anyway (a box never swallows a result).
      cut = firstSrc + 1;
      while (cut < rows.length && srcOfBody[cut] === srcOfBody[firstSrc]) cut++;
    }
    if (cut < rows.length) {
      (table as unknown as { body: unknown[] }).body = table.body.slice(0, cut);
      region.out.consumed = Math.max(0, ...srcOfBody.slice(0, cut).filter(x => x >= 0).map(x => x + 1));
    } else {
      region.out.consumed = groups[0]?.rows.length ?? 0;
    }
  }
  if (region) {
    const natural = headH + table.body.reduce((a, r) => a + r.height, 0);
    if (region.sized) region.sized.natural = natural;
    // Top / Fill / Center inside the box — only when every row fits it here.
    const extra = (region.boxH ?? 0) - natural;
    if (extra > 1 && table.body.length > 0 && startY + region.boxH! <= region.bottom + 0.5) {
      if (region.vAlign === 'center') table.settings.startY = startY + extra / 2;
      else if (region.vAlign === 'fill') {
        const add = extra / table.body.length;
        for (const row of table.body) setRowHeight(row, row.height + add);
      }
    }
  }
  if (!region && table.body.length > 0) {
    const lead = headH + table.body[0].height + chainAfter(table.body, 0, keepWithNext);
    if (startY + lead > floor && lead <= floor - margin.top) {
      startY = table.settings.startY = newPage(doc, practice);
    }
  }
  // A small table that fits here but whose sign-off does not, and that cannot
  // hand even its header + first rows to the next page without leaving them
  // stranded, moves to the next page WHOLE — table and signatures together.
  if (reserveBottom > 0 && table.body.length > 0) {
    const end = startY + headH + table.body.reduce((a, r) => a + r.height, 0);
    const lead = headH + table.body.slice(0, 2).reduce((a, r) => a + r.height, 0);
    if (end <= floor && end + reserveBottom > floor && startY + lead > floor - reserveBottom) {
      table.settings.startY = newPage(doc, practice);
    }
  }
  __drawTable(doc, table);
  return table.finalY! + 6;
}

/** Custom layout table box row spacing → extra pt per row ('normal' = the theme's own). */
export const ROW_SPACING_PT: Record<'compact' | 'normal' | 'relaxed', number> = { compact: -2, normal: 0, relaxed: 5 };

/** Set an autotable body row's height (and its cells', which autotable paints from). */
function setRowHeight(row: { height: number; cells: Record<string, unknown> }, h: number): void {
  row.height = h;
  for (const cell of Object.values(row.cells)) (cell as { height: number }).height = h;
}

/** Keep a department's sign-off on the page its results END on — without
 *  reserving it on every page the table spans (which cost multi-page reports
 *  the full block height on each page). Just before drawing body row i, look
 *  at where the table would end if the rest ran on here: if the rest fits but
 *  the sign-off under it would not, raise the floor by the sign-off's height
 *  so autoTable carries the last rows to the next page with the signatures;
 *  otherwise keep the normal floor. Runs before keepRowsTogether (which reads
 *  the floor) and ignores a row it temporarily inflated. */
function fitSignOff(d: KeepHookArg & { cell: { y: number } }, reserve: number): void {
  if (reserve <= 0) return;
  const h = (r: KeepRow) => KEEP_HELD.get(r)?.height ?? r.height;
  let end = d.cell.y + h(d.row);
  for (let j = d.row.index + 1; j < d.table.body.length; j++) end += h(d.table.body[j]);
  const floor = A4.h - MARGIN_BOTTOM;
  d.table.settings.margin.bottom = end <= floor && end + reserve > floor ? MARGIN_BOTTOM + reserve : MARGIN_BOTTOM;
}

// ──────────────────────────────────────────────────────────────
// Per-test renderers — classic table style (plain header + hairline)
// ──────────────────────────────────────────────────────────────

function renderResolvedTest(
  doc: jsPDF,
  t: NonNullable<ReportSnapshot['tests']>[number],
  layout: ResolvedReportLayout,
  startY: number,
  practice: NonNullable<ReportPdfInput['practice']>
): number {
  let y = startY;
  // A block that OPENS with a chart keeps its heading on the chart's page.
  const lead = reportChartLead(doc, layout, chartTheme());
  if (y > A4.h - MARGIN_BOTTOM - Math.max(70, lead + 30)) { y = newPage(doc, practice); }

  drawTestHeading(doc, t.name ?? reportDisplayName(layout.testName) ?? 'Test', y);
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
        y = sec.trend
          ? renderReportChart(doc, sec, t.testId ?? '', y, chartTheme(),
              { x: MARGIN_X, contentWidth: A4.w - 2 * MARGIN_X, floor: A4.h - MARGIN_BOTTOM, newPage: () => newPage(doc, practice) })
          : renderChartSection(doc, sec, y);
        break;
    }
    y += 4;
  }
  return y;
}

/** Classic-style centered uppercase test name. */
function drawTestHeading(doc: jsPDF, name: string, y: number) {
  typeset(doc, 'testHeading');
  doc.setTextColor(BLACK);
  doc.text(name.toUpperCase(), A4.w / 2, y + 14, { align: 'center' });
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 22, A4.w - MARGIN_X, y + 22);
}

/** Resolved grid section → classic 4-column shape.
 *
 *  Empty columns are dropped automatically; a synthesized "Investigation"
 *  column is prepended whenever the layout doesn't already include a
 *  parameter-name column. Bold result cells get red/blue inline color
 *  when the engine's conditions paint the row.
 *
 *  Specimen / sample type (per-test) is rendered as a small dim
 *  italic line BENEATH the test name in the parameter cell, not as a
 *  separate column — matching the classic layout ("CREATININE, SERUM" with
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
    typeset(doc, 'sectionLabel');
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
        styles: { fillColor: '#f8fafc', textColor: TEXT, ...cellType('narrativeMerged'), halign: 'center' },
      }];
    }
    const isFirstBodyRow = bodyRows.length > 0 && bodyRows[0].id === r.id;
    const paramTitle = reportDisplayName(r.title) || humanize(r.parameterName ?? '');
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
      if (vc.isName) { Object.assign(styles, cellType('narrativeName')); styles['textColor'] = rowColor ?? BLACK; }
      else if (vc.hasResult) {
        Object.assign(styles, cellType(rowColor || r.isBold ? 'resultAbnormal' : 'narrativeResult'));
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
      if (r.isBold) styles['fontStyle'] = faceOf('bold')[1];
      return { content: txt, styles };
    });
  });

  const columnStyles: Record<number, { cellWidth: number; halign?: string }> = {};
  vcols.forEach((c, i) => { columnStyles[i] = { cellWidth: colWidths[i], halign: alignFor(c.members[0].type) }; });

  autoTable(doc, {
    startY: y,
    head: head as unknown as Array<Array<string | RowCell>>,
    body: body as unknown as Array<Array<string | RowCell>>,
    margin: tablePageMargins(),
    rowPageBreak: 'avoid',
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: columnStyles as unknown as Record<number, { cellWidth: number }>,
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
}

/** The report's superscript-unit + multi-band range cell hooks, for the
 *  abnormal-results sheet's table (report-abnormal-summary.ts). */
function summaryCellHooks(doc: jsPDF) {
  const sup = new Map<string, SupCell>();
  const qual = new Map<string, QualCell>();
  return {
    willDrawCell: (d: unknown, rangeColIdx: number) => {
      stashQualifiedRangeCell(qual, d as CellHookArg, rangeColIdx);
      stashSuperscriptCell(sup, d as CellHookArg);
    },
    didDrawCell: (d: unknown) => {
      drawQualifiedRangeCell(doc, qual, d as CellHookArg);
      drawSuperscriptCell(doc, sup, d as CellHookArg);
    },
  };
}

/** Page margins for every results table: the body floor (footer band) and,
 *  on continuation pages, a top that clears the letterhead — in letterpad
 *  mode the lab's PRE-PRINTED header (45 mm by default), where a fixed 56pt
 *  put the repeated column header over the stationery. The "— CONTINUED"
 *  stamp sits 14pt above this top. */
function tablePageMargins(): { left: number; right: number; top: number; bottom: number } {
  return { left: MARGIN_X, right: MARGIN_X, bottom: MARGIN_BOTTOM, top: LETTERPAD ? MARGIN_TOP + 24 : 56 };
}

/** Shared body styles for both grid + legacy tables. Honours the
 *  template's font family, font scale, and divider colour, and switches
 *  to bordered lines when tableStyle === 'bordered'. */
function tableBodyStyles() {
  const bordered = theme.tableStyle === 'bordered';
  return {
    font: faceOf(twt('tableBody'))[0],
    fontSize: tsz('tableBody'),
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
    fontStyle: styleOf('columnHead') as 'bold',
    // Column headers sit BELOW the data in the visual hierarchy — smaller
    // than the body values, with a firm rule underneath (classic pattern).
    fontSize: tsz('columnHead'),
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
  typeset(doc, 'narrative');
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
    typeset(doc, 'imagesHeading');
    doc.setTextColor(TEXT_DIM);
    doc.text(heading.toUpperCase(), MARGIN_X, y + 10);
    y += 16;
  }
  if (usable.length === 0) {
    typeset(doc, 'imagesPlaceholder');
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

/** A Test Master report-chart block (not the legacy single-value gauge). */
function isReportChart(s: ResolvedSection): boolean {
  return s.type === 'chart' && !!s.trend;
}

/** The report theme values a chart block needs (report-chart.pdf.ts). The
 *  chart prints in the theme's family: Source Sans 3 when the Modern theme
 *  embedded it. `face` is the ONE weight → face resolver the tables use
 *  (faceOf), so a bold italic chart label maps to a registered face too. */
function chartTheme() {
  return { font: EMBEDDED ? SOURCE_SANS_FAMILY : PDF_FONT, face: (w: TypeWeight) => faceOf(w) as [string, string],
    fontScale: theme.fontScale, accent: BLUE, text: TEXT, ink: BLACK, dim: TEXT_DIM,
    hair: HAIR, abnormalColored: theme.flagStyle === 'bold_color',
    abnormalColor: theme.abnormalColor, abnormalLowColor: theme.abnormalLowColor };
}

function renderChartSection(doc: jsPDF, sec: ResolvedSection, startY: number): number {
  const chart = sec.chart;
  // A chart with no parameter (a report-chart block read by an older server)
  // has nothing to gauge.
  if (!chart || chart.max <= chart.min || !chart.parameter) return startY;

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

  typeset(doc, 'chartAxis');
  doc.setTextColor(TEXT_DIM);
  doc.text(String(chart.min), barX, barY + barH + 12);
  if (chart.value !== null && chart.value !== undefined) {
    doc.text(String(chart.value), barX + barW / 2, barY + barH + 12, { align: 'center' });
  }
  doc.text(String(chart.max), barX + barW, barY + barH + 12, { align: 'right' });

  return barY + barH + 18;
}

/** Legacy renderer — used when a test has no admin-configured layout.
 *  Classic 4-column shape: Investigation · Result · Reference Value · Unit.
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
    .filter(([paramName]) => !hiddenNames.has(paramName))
    // No value → no row (owner 2026-10-03).
    .filter(([, v]) => !isBlankReportValue(v?.value));

  if (entries.length > 0) {
    entries.forEach(([paramName, v], i) => {
      // Criticals read High / Low — never "Critical" (report rule).
      const rf = reportFlag(v?.flag, v?.value, v?.range);
      const flagText = reportFlagWord(rf.flag);
      const valueText = String(v?.value ?? '—');
      const investContent = (i === 0 && sampleTypeLine)
        ? `${humanize(paramName)}\n${sampleTypeLine}`
        : humanize(paramName);
      const resultStyles: Record<string, unknown> = {
        ...cellType('narrativeResult'),
        textColor: flagText === 'Low' ? FLAG_BLUE : (flagText || rf.abnormal) ? FLAG_RED : BLACK,
      };
      tableRows.push([
        { content: investContent, styles: { ...cellType('testName'), textColor: BLACK } },
        { content: flagText ? `${valueText}    ${flagText}` : valueText, styles: resultStyles },
        { content: rangeCellText(v?.range, v?.unit) || '—' },
        { content: v?.unit ?? '—' },
      ]);
    });
  } else {
    tableRows.push([{ content: 'No parameters recorded.', styles: { halign: 'center', fontStyle: styleOf('note'), textColor: TEXT_DIM } }]);
  }

  const legacySup = new Map<string, SupCell>();
  autoTable(doc, {
    startY: y,
    head: [['Investigation', 'Result', 'Reference Value', 'Unit']],
    body: tableRows as unknown as Array<Array<string | LCell>>,
    margin: tablePageMargins(),
    rowPageBreak: 'avoid',
    theme: 'plain',
    styles: tableBodyStyles(),
    headStyles: tableHeadStyles(),
    bodyStyles: { fillColor: '#ffffff' },
    alternateRowStyles: theme.zebraRows ? { fillColor: '#f8fafc' } : undefined,
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 130, fontStyle: styleOf('narrativeResult') },
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
    typeset(doc, 'deptMeta');
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
    typeset(doc, 'cultureLabel'); doc.setTextColor(BLACK);
    doc.text(`${label.toUpperCase()}:`, MARGIN_X, y);
    typeset(doc, 'cultureValue');
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
            { content: a.name ?? '', styles: { ...cellType('astDrug') } },
            { content: w.txt, styles: { ...cellType('astResult'), textColor: w.color, halign: 'center' } },
          ];
        });
      if (rows.length === 0) continue;
      autoTable(doc, {
        startY: y,
        head: [[`Antimicrobial for ${orgLabel(org, idx)}`, 'Interpretation']],
        body: rows as unknown as Array<Array<string>>,
        margin: tablePageMargins(),
        rowPageBreak: 'avoid',
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
    typeset(doc, 'astLegend'); doc.setTextColor(TEXT_DIM);
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
        typeset(doc, 'narrative'); doc.setTextColor(BLACK);
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
// "****End of Report****"
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
  typeset(doc, 'trendHeading');
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
  typeset(doc, 'endMarker');
  doc.setTextColor(BLACK);
  // No "Thanks for Reference" line (owner, 2026-09-28) — only the marker.
  // Admin-configurable marker — defaults to "****End of Report****".
  // Preliminary reports get an explicit "PRELIMINARY" wrapper.
  const marker = snap.isPartial
    ? `**** End of Preliminary Report ****`
    : theme.endOfReportText;
  doc.text(marker, A4.w / 2, y, { align: 'center' });
  return y;
}

// ──────────────────────────────────────────────────────────────
// Page footer — runs on every page. Signatures NEVER print here: they sign
// at the end of each department's block / below the End-of-Report marker
// (drawInlineSignatures). The old per-page three-column signature row (at
// h-118) is gone, and with it the 150pt floor it forced on every page.
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
  // Disclaimer + footer text — full-width in the band above the date strip.
  // Only on the last page so it doesn't repeat ad nauseam on multi-page
  // reports.
  if (pageNo === pageTotal) {
    // Disclaimer + footer text: resolved by the layout model (stacked up
    // from just above the date strip; movable in the report designer).
    for (const it of LAYOUT?.items ?? []) if (it.region === 'footer') drawLayoutItem(doc, it);
  }

  // Bottom strip: "Generated on : <date>" on the left, "Page N of M" on the right
  doc.setDrawColor(HAIR);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, A4.h - 30, A4.w - MARGIN_X, A4.h - 30);

  typeset(doc, 'generated');
  doc.setTextColor(BLACK);
  doc.text(`Generated on :  ${formatShort(new Date().toISOString())}`, MARGIN_X, A4.h - 18);
  // Plain page number ("1", "2", "3" …).
  typeset(doc, 'pageNumber');
  doc.text(String(pageNo), A4.w - MARGIN_X, A4.h - 18, { align: 'right' });

  // Blue band at the bottom (classic "Sample Collection" strip) — the LAB's
  // contact number (home-collection line), never the patient's phone.
  // Admin toggles via template.showSampleCollectionBand.
  const collectPhone = (practice.phone ?? '').trim();
  if (theme.showSampleBand && collectPhone) {
    doc.setFillColor(BLUE);
    doc.rect(0, A4.h - 12, A4.w, 12, 'F');
    typeset(doc, 'sampleBand');
    doc.setTextColor('#ffffff');
    doc.text(`Sample Collection  ${collectPhone}`, A4.w / 2, A4.h - 3.5, { align: 'center' });
  }

  // Optional Powered-by footnote (last page only). With the Sample
  // Collection band on, it sits centred on the date/page-number strip
  // instead of the very edge (which the band occupies).
  if (theme.showPoweredBy && pageNo === pageTotal) {
    typeset(doc, 'poweredBy');
    doc.setTextColor(TEXT_DIM);
    const bandOn = theme.showSampleBand && (practice.phone ?? '').trim();
    doc.text('Powered by Prefrontal', A4.w / 2, bandOn ? A4.h - 18 : A4.h - 4, { align: 'center' });
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
    typeset(doc, 'watermark');
    doc.setTextColor(wmColor);
    doc.text(wm, cx, cy, { align: 'center', angle: 30 });
  }
}

/** Add a new page and redraw the per-page furniture (letterhead etc.
 *  are not repeated — classic reports keep the body pages clean and
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

/** Reorder a column list into the conventional classic lab-report
 *  arrangement: result first, then reference range (right next to the
 *  value so the eye can compare them), then unit. Text/flag columns
 *  preserve their original relative position around the typed core. */
function classicOrderedColumns(cols: ReportColumn[]): ReportColumn[] {
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

/** Classic-style column header label. Renames the server's "Reference
 *  range" to "Reference Value" (the conventional lab-report term);
 *  falls back to title-casing the layout's original label for anything
 *  custom. */
function classicLabelFor(c: ReportColumn): string {
  if (c.type === 'range') return 'Reference Value';
  return titleCaseHeader(c.label);
}

function titleCaseHeader(label: string): string {
  // Classic reports use title case ("Investigation", "Result", "Reference Value", "Unit").
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

/** A reference cell's text with its line breaks as authored: a typed report
 *  text ("Normal: 70–99\nPrediabetes: 100–125\nDiabetes: ≥126") prints one
 *  line per line — autotable splits the cell on "\n" and
 *  drawQualifiedRangeCell paints each line. CRLF → LF; trailing blank lines
 *  and spaces dropped so they never add empty rows. mw already fills `{u}`;
 *  a token that still slipped through prints as the row's unit. */
export function rangeCellText(raw: string | null | undefined, unit?: string | null): string {
  return normalizeReportText(fillUnit(raw, unit)) ?? '';
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

/** "hemoglobin_a1c" → "Hemoglobin A1c". Report-facing, so a
 *  "(Calculated)" marker is dropped too (see report-name.ts). */
function humanize(s: string): string {
  if (!s) return '—';
  if (/\s/.test(s) || /^[A-Z]/.test(s)) return reportDisplayName(s);
  return reportDisplayName(s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, c => c.toUpperCase()));
}

/** Report copy of the snapshot with patient-facing names cleaned: a
 *  calculated test prints as "LDL Cholesterol", never "LDL Cholesterol
 *  (Calculated)". Keys (testId, parameter names, hidden[]) are untouched. */
function cleanSnapshotNames(snap: ReportSnapshot): ReportSnapshot {
  if (!Array.isArray(snap.tests)) return snap;
  return {
    ...snap,
    tests: snap.tests.map(t => t ? {
      ...t,
      name: reportDisplayName(t.name),
      packageName: reportDisplayName(t.packageName),
      profileName: reportDisplayName(t.profileName),
    } : t),
  };
}

/** The snapshot with its tests in the lab's print sequence. Untouched (the
 *  same object) when the template sets no sequencing. */
function sequenceSnapshot(snap: ReportSnapshot, template: ReportTemplate | null): ReportSnapshot {
  if (!Array.isArray(snap.tests)) return snap;
  const tests = applyReportSequencing(snap.tests, readReportSequencing(template));
  return tests === snap.tests ? snap : { ...snap, tests };
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
