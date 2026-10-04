import type { ReportTemplate } from '../models/report.model';
import { parseTemplateMeta } from './report-header-layout';

/**
 * REPORT THEMES — the typography of the printed report as ONE token table.
 *
 * Every text the report renderer (report-pdf.ts, report-abnormal-summary.ts)
 * draws names an ELEMENT ("labName", "result", "pageNumber" …) and reads its
 * font, size and weight from the active theme's table — no literal font size
 * lives at a draw site any more. Colours stay template-driven (primary /
 * accent / body text / flag colours); a theme sets type only.
 *
 *  - `classic` — the report as it has always printed: the template's own
 *    Helvetica / Times / Courier and "font size" S / M / L (fontScale). Its
 *    table holds exactly the sizes the renderer used before the tokens
 *    existed, so an untouched template prints byte-identically
 *    (report-theme-classic.spec.ts + report-header-legacy.spec.ts).
 *  - `source-sans` — "Modern — Source Sans 3", built to the owner's
 *    typography spec (2026-09-30). Every face is embedded Source Sans 3
 *    (report-fonts.ts); the template's font family / size are ignored — the
 *    spec is exact.
 *
 * The choice rides the report template's `metadata` JSON (`reportTheme`) —
 * one template per tenant, no DB column, served to every viewer, so every
 * surface (viewer, download, print, WhatsApp / public link, reprints) renders
 * the tenant's theme. Absent / unknown = classic.
 */

export type ReportThemeId = 'classic' | 'source-sans';

/** A text weight. 'semibold' exists only in embedded fonts; the built-in PDF
 *  fonts have no semibold and draw it bold. */
export type TypeWeight = 'normal' | 'italic' | 'semibold' | 'bold' | 'bolditalic';

export interface TypeToken {
  /** Size in pt. */
  size: number;
  weight: TypeWeight;
  /** Multiply by the template's font scale (S 0.9 / M 1 / L 1.1). Classic only. */
  scale?: boolean;
  /** Baseline-to-baseline distance (pt) of wrapped lines, where the element wraps. */
  lineHeight?: number;
}

/** Every element of the report that draws text. */
export type TypeEl =
  // ── Letterhead ──
  | 'labName' | 'labNameMinimal'
  | 'taglinePipes' | 'taglinePlain'
  | 'labContact' | 'labContactLine' | 'labContactMinimal' | 'labAddress' | 'headerExtraLine'
  | 'website' | 'nablChip' | 'nablNumber'
  // ── Patient strip ──
  | 'patientName' | 'patientNameColumn'
  | 'demoLabel' | 'demoValue' | 'mrnLabel' | 'mrnValue'
  | 'patientCaption' | 'patientCaptionColumn' | 'patientList'
  | 'regLabel' | 'regValue' | 'barcodeText' | 'qrCaption'
  | 'customFieldLabel' | 'customFieldValue' | 'fieldLabel' | 'fieldValue'
  | 'gridLabel' | 'gridValue' | 'stackLabel' | 'stackValue'
  // ── Results ──
  | 'deptName' | 'deptMeta' | 'deptContinued'
  | 'columnHead' | 'tableBody'
  | 'panelName' | 'panelContinued'
  | 'testName' | 'result' | 'resultAbnormal' | 'unit' | 'range'
  | 'methodology' | 'specimen' | 'referral' | 'cellText' | 'methodColumn' | 'specimenColumn' | 'narrativeResult'
  | 'description' | 'interpretation' | 'interpretationLabel' | 'note'
  | 'techNote'
  | 'testHeading' | 'sectionLabel' | 'narrativeName' | 'narrative' | 'narrativeMerged'
  | 'imagesHeading' | 'imagesPlaceholder' | 'chartAxis' | 'trendHeading'
  // ── Microbiology ──
  | 'cultureLabel' | 'cultureValue' | 'astDrug' | 'astResult' | 'astLegend'
  // ── Abnormal summary ──
  | 'summaryTitle' | 'summaryText' | 'summaryIntro' | 'summaryDept' | 'summaryPanel'
  // ── Close, sign-off, footer ──
  | 'endMarker'
  | 'signatureName' | 'signatureTitle' | 'signatureReg' | 'signatureStatement'
  | 'disclaimer' | 'footerText' | 'reportId' | 'generated' | 'pageNumber'
  | 'sampleBand' | 'poweredBy' | 'watermark';

export interface ReportTypeTheme {
  id: ReportThemeId;
  /** Embedded family for every weight; null = the template's built-in font. */
  embedded: 'SourceSans3' | null;
  tokens: Readonly<Record<TypeEl, TypeToken>>;
  /** Department heading rule (pt). */
  deptRule: number;
  /** Structure the type needs beyond sizes. Classic: all off — the old paper.
   *  - flowHeader: the letterhead flows like an edited layout — long address
   *    lines wrap, the accent bar and the patient block sit BELOW the tallest
   *    letterhead text, and a lab name too wide for its line shrinks to fit.
   *  - splitLabels: patient "Label : value" pairs print the label regular and
   *    the value semibold (Classic prints some as one plain string).
   *  - splitSubLines: a panel's Method / Specimen / Tested-at lines are
   *    separate rows, each in its own style (Classic: one italic cell). */
  flowHeader: boolean;
  splitLabels: boolean;
  splitSubLines: boolean;
}

const t = (size: number, weight: TypeWeight, extra: Partial<TypeToken> = {}): TypeToken => ({ size, weight, ...extra });
const S = { scale: true } as const;

/** CLASSIC — the sizes the renderer has always used (do not change: the
 *  Classic fingerprint specs pin them to the byte). */
const CLASSIC_TOKENS: Record<TypeEl, TypeToken> = {
  labName: t(18, 'bold', S), labNameMinimal: t(16, 'bold', S),
  taglinePipes: t(9, 'bold'), taglinePlain: t(9, 'normal', S),
  labContact: t(9, 'normal', S), labContactLine: t(8, 'normal', S), labContactMinimal: t(9, 'normal', S),
  labAddress: t(8, 'normal', S), headerExtraLine: t(8, 'normal', S),
  website: t(8, 'bold'), nablChip: t(8, 'bold'), nablNumber: t(6.5, 'normal'),

  patientName: t(13, 'bold'), patientNameColumn: t(12, 'bold'),
  demoLabel: t(9, 'normal'), demoValue: t(9, 'bold'), mrnLabel: t(9, 'normal'), mrnValue: t(9, 'normal'),
  patientCaption: t(9.5, 'bold'), patientCaptionColumn: t(9, 'bold'), patientList: t(9, 'normal'),
  regLabel: t(8.5, 'normal'), regValue: t(8.5, 'bold'), barcodeText: t(8, 'normal'), qrCaption: t(6.5, 'normal'),
  customFieldLabel: t(8.5, 'bold', S), customFieldValue: t(8.5, 'normal', S),
  fieldLabel: t(9, 'bold'), fieldValue: t(9, 'normal'),
  gridLabel: t(6.5, 'bold'), gridValue: t(9.5, 'normal'), stackLabel: t(9, 'bold'), stackValue: t(9.5, 'normal'),

  deptName: t(10.5, 'bold'), deptMeta: t(8.5, 'normal'), deptContinued: t(9, 'bold'),
  columnHead: t(8.5, 'bold', S), tableBody: t(9, 'normal', S),
  panelName: t(9.5, 'bold'), panelContinued: t(9.5, 'bold'),
  testName: t(9, 'bold', S), result: t(9, 'normal', S), resultAbnormal: t(9, 'bold', S),
  unit: t(9, 'normal', S), range: t(9, 'normal', S),
  methodology: t(8, 'italic'), specimen: t(8, 'italic'), referral: t(8, 'italic'), cellText: t(8, 'normal'),
  methodColumn: t(9, 'normal', S), specimenColumn: t(9, 'normal', S), narrativeResult: t(9, 'bold', S),
  description: t(8.5, 'normal', S), interpretation: t(8.5, 'normal', S), interpretationLabel: t(8.5, 'bold', S),
  note: t(8.5, 'italic'),
  techNote: t(8.5, 'normal', S),
  testHeading: t(13, 'bold'), sectionLabel: t(8.5, 'bold'), narrativeName: t(9, 'bold'), narrative: t(9, 'normal'),
  narrativeMerged: t(8.5, 'italic'),
  imagesHeading: t(8.5, 'bolditalic'), imagesPlaceholder: t(8.5, 'italic'), chartAxis: t(8, 'normal'),
  trendHeading: t(10, 'bold'),

  cultureLabel: t(8.5, 'bold'), cultureValue: t(9, 'normal'),
  astDrug: t(9, 'normal', S), astResult: t(9, 'bold', S), astLegend: t(7.5, 'normal'),

  summaryTitle: t(11, 'bold'), summaryText: t(8.5, 'normal'), summaryIntro: t(8, 'italic'),
  summaryDept: t(9.5, 'bold', S), summaryPanel: t(9, 'bold', S),

  endMarker: t(9, 'normal'),
  signatureName: t(9.5, 'bold'), signatureTitle: t(8, 'normal'), signatureReg: t(7.5, 'normal'),
  signatureStatement: t(7, 'italic', { lineHeight: 8.5 }),
  disclaimer: t(7, 'italic', { lineHeight: 8.5 }), footerText: t(7.5, 'normal'),
  reportId: t(8, 'normal'), generated: t(8, 'normal'), pageNumber: t(8, 'normal'),
  sampleBand: t(8.5, 'bold'), poweredBy: t(7, 'italic'), watermark: t(48, 'bold'),
};

/**
 * MODERN — Source Sans 3, the owner's spec. Where the spec gives a range the
 * midpoint rounded to 0.5 pt is used (x.25 midpoints round UP, i.e. to the
 * range's top: 8.5–9 → 9). "Semibold/Bold" = Semibold, and Bold where the
 * report already emphasises (abnormal result, the tech's bold override).
 * Elements the spec does not name take the value of their nearest spec
 * sibling (noted per line).
 */
const SOURCE_SANS_TOKENS: Record<TypeEl, TypeToken> = {
  labName: t(21, 'bold'), labNameMinimal: t(21, 'bold'),                    // Lab name 20–22 Bold
  taglinePipes: t(9.5, 'semibold'), taglinePlain: t(9.5, 'semibold'),      // Tagline 9–10 Semibold
  labContact: t(9, 'normal'), labContactLine: t(9, 'normal'),              // Address/contact 8.5–9
  labContactMinimal: t(9, 'normal'), labAddress: t(9, 'normal'), headerExtraLine: t(9, 'normal'),
  website: t(9, 'semibold'),                                               // (contact, on the accent pill)
  nablChip: t(8, 'bold'), nablNumber: t(7.5, 'normal'),                    // (badge; number ≈ barcode text)

  patientName: t(11.5, 'semibold'), patientNameColumn: t(11.5, 'semibold'), // Patient name 11–12 Semibold
  demoLabel: t(9.5, 'normal'), demoValue: t(10, 'semibold'),               // labels 9–10 / values 9.5–10
  mrnLabel: t(9.5, 'normal'), mrnValue: t(9.5, 'semibold'),                // MRN / Patient ID 9–10 Semibold
  patientCaption: t(9.5, 'semibold'), patientCaptionColumn: t(9.5, 'semibold'), // (label, emphasised)
  patientList: t(10, 'semibold'),                                          // (a demographic value)
  regLabel: t(9, 'normal'), regValue: t(9, 'normal'),                      // Registration details 8.5–9 Regular
  barcodeText: t(8, 'normal'),                                             // Barcode text 7.5–8
  qrCaption: t(8, 'normal'),                                               // (≈ barcode text)
  customFieldLabel: t(9.5, 'normal'), customFieldValue: t(10, 'semibold'), // (demographic label / value)
  fieldLabel: t(9.5, 'normal'), fieldValue: t(10, 'semibold'),
  gridLabel: t(9.5, 'normal'), gridValue: t(10, 'semibold'),
  stackLabel: t(9.5, 'normal'), stackValue: t(10, 'semibold'),

  deptName: t(13.5, 'bold'),                                               // Department name 13–14 Bold
  deptMeta: t(9, 'normal'),                                                // (sample IDs ≈ registration details)
  deptContinued: t(10, 'bold'),                                            // (department, repeated)
  columnHead: t(9.5, 'semibold'),                                          // Column headings 9–9.5 Semibold
  tableBody: t(9, 'normal'),                                               // (unit / range base)
  panelName: t(11, 'bold'), panelContinued: t(11, 'bold'),                 // Profile/package name 10.5–11 Bold
  testName: t(10, 'semibold'),                                             // Test name 9.5–10 Semibold
  result: t(10.5, 'semibold'), resultAbnormal: t(10.5, 'bold'),            // Result / Abnormal 10–10.5
  unit: t(9, 'normal'), range: t(9, 'normal'),                             // Unit, Reference range 8.5–9
  methodology: t(8.5, 'normal'),                                           // Methodology 8–8.5 Regular
  specimen: t(8.5, 'italic'),                                              // Specimen 8–8.5 Italic
  referral: t(8.5, 'normal'),                                              // (≈ methodology)
  cellText: t(8.5, 'normal'),                                              // (text columns ≈ description)
  methodColumn: t(8.5, 'normal'), specimenColumn: t(8.5, 'italic'),        // (the Method / Specimen columns)
  narrativeResult: t(10.5, 'semibold'),                                    // (a narrative test's result)
  description: t(8.5, 'normal'),                                           // Test description 8–8.5
  interpretation: t(9, 'normal'), interpretationLabel: t(9, 'semibold'),   // Profile interpretation 8.5–9
  note: t(8.5, 'italic'),                                                  // (tech observation ≈ description)
  techNote: t(9, 'normal'),                                                // (technician report note ≈ interpretation)
  testHeading: t(11, 'bold'),                                              // (standalone test title ≈ profile name)
  sectionLabel: t(9.5, 'semibold'),                                        // (≈ column heading)
  narrativeName: t(10, 'semibold'), narrative: t(9, 'normal'),             // (test name / interpretation)
  narrativeMerged: t(8.5, 'italic'),
  imagesHeading: t(9.5, 'semibold'), imagesPlaceholder: t(8.5, 'italic'), chartAxis: t(8.5, 'normal'),
  trendHeading: t(11, 'bold'),

  cultureLabel: t(9.5, 'semibold'),                                        // (≈ column heading)
  cultureValue: t(10, 'normal'),                                           // (a result, in prose)
  astDrug: t(10, 'semibold'), astResult: t(10.5, 'bold'),                  // (test name / abnormal result)
  astLegend: t(8.5, 'normal'),                                             // (≈ description)

  summaryTitle: t(12.5, 'bold'),                                           // Abnormal summary title 12–13 Bold
  summaryText: t(9, 'normal'), summaryIntro: t(9, 'normal'),               // Abnormal summary text 8.5–9
  summaryDept: t(10, 'bold'), summaryPanel: t(11, 'bold'),

  endMarker: t(8, 'semibold'),                                             // "End of Results" 8 Semibold
  signatureName: t(10, 'semibold'),                                        // Signature name 9.5–10 Semibold
  signatureTitle: t(8.5, 'normal'),                                        // Signature designation 8–8.5
  signatureReg: t(8, 'normal'),                                            // Registration number 8
  signatureStatement: t(8, 'normal', { lineHeight: 10 }),                // Digital signature statement 7.5–8
  disclaimer: t(7.5, 'normal', { lineHeight: 9.5 }),                      // Disclaimer 7–7.5 Regular
  footerText: t(7.5, 'normal'),                                            // (≈ disclaimer)
  reportId: t(8, 'normal'),                                                // Report ID 7.5–8
  generated: t(7.5, 'normal'),                                             // Generated timestamp 7–7.5
  pageNumber: t(8, 'normal'),                                              // Page number 7.5–8
  sampleBand: t(8.5, 'semibold'),                                          // (footer band ≈ contact)
  poweredBy: t(7, 'normal'),                                               // Powered by 7 Regular
  watermark: t(48, 'bold'),
};

export const CLASSIC_THEME: ReportTypeTheme = {
  id: 'classic', embedded: null, tokens: CLASSIC_TOKENS, deptRule: 1,
  flowHeader: false, splitLabels: false, splitSubLines: false,
};
export const SOURCE_SANS_THEME: ReportTypeTheme = {
  id: 'source-sans', embedded: 'SourceSans3', tokens: SOURCE_SANS_TOKENS,
  deptRule: 1.5,                                                           // Department divider 1–1.5 pt
  flowHeader: true, splitLabels: true, splitSubLines: true,
};

export const REPORT_TYPE_THEMES: Readonly<Record<ReportThemeId, ReportTypeTheme>> = {
  'classic': CLASSIC_THEME,
  'source-sans': SOURCE_SANS_THEME,
};

/** The picker's cards (report designer → Results table → Report theme). */
export const REPORT_THEME_OPTIONS: ReadonlyArray<{ value: ReportThemeId; label: string; desc: string }> = [
  { value: 'classic', label: 'Classic', desc: 'The report as it prints today — your chosen font family and size.' },
  { value: 'source-sans', label: 'Modern — Source Sans 3',
    desc: 'One clean typeface with a clear size scale: bold lab name and departments, semibold names and results, quiet units and ranges.' },
];

const IDS = Object.keys(REPORT_TYPE_THEMES) as ReportThemeId[];

/** The template's report theme — absent / unknown / junk = classic. */
export function readReportTheme(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): ReportThemeId {
  const v = parseTemplateMeta(tpl)['reportTheme'];
  return IDS.includes(v as ReportThemeId) ? (v as ReportThemeId) : 'classic';
}

/** Immutable: the template metadata with the theme set (other keys kept).
 *  Classic removes the key, so a lab that switches back stores nothing. */
export function writeReportTheme(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, id: ReportThemeId): string {
  const meta = parseTemplateMeta(tpl);
  if (id === 'classic') delete meta['reportTheme']; else meta['reportTheme'] = id;
  return JSON.stringify(meta);
}

/** The type theme a template prints with. */
export function reportTypeTheme(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): ReportTypeTheme {
  return REPORT_TYPE_THEMES[readReportTheme(tpl)];
}

/** A token's effective size under a font scale. */
export function tokenSize(tok: TypeToken, fontScale: number): number {
  return tok.scale ? tok.size * fontScale : tok.size;
}
