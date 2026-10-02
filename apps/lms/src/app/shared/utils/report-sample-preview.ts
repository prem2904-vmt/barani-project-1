import type { ReportSignature, ReportTemplate } from '../models/report.model';
import type { PageLayoutBox, ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';
import { preloadReportImages, type ReportPdfInput } from './report-pdf';
import { resolveReportLayouts } from './report-layouts';
import { sampleSeriesValues } from './report-chart/report-chart.sample';
import { PAGE_LAYOUT_SECTION_TYPE, analyzerSampleAsset, readPageLayout } from './report-profile-layout';

/**
 * The SAMPLE report a Test Master preview renders: a fabricated order
 * (patient, plausible values) resolved through the engine's /preview and
 * the real PDF pipeline. ONE builder for both surfaces that show it — the
 * test editor's Live preview (report-pdf-preview.component) and the profile
 * one-page layout designer's page — so the two can never disagree about
 * what the profile prints (owner 2026-10-02: the designer showed an empty
 * page while the Live preview showed the old table).
 */

/** A profile member fed to the preview so a PROFILE previews exactly as it
 *  prints: one fabricated snapshot row per member, resolved through the same
 *  layout pipeline the real report uses. */
export interface PreviewProfileMember {
  id: string;
  name: string;
  /** TestEntity.Parameters JSON (wrapper or bare array) — sample values are
   *  harvested from it so member results resolve to something visible. */
  parameters?: string | null;
  /** The member's OWN department (a package has none — its members print
   *  under theirs). Falls back to the previewed test's department. */
  department?: string | null;
  /** Timed-series draw (minutes from the first draw) — the preview row then
   *  carries it and plausible sample values, so a report chart over the time
   *  points shows (docs/REPORT-CHARTS.md). */
  offsetMin?: number | null;
  /** The member's catalogue key (CBC-family detection, analyzer linkage). */
  catalogKey?: string | null;
}

/** The sample patient every preview prints for (ranges resolve for her). */
export const SAMPLE_PATIENT = { sex: 'Female', age: 35 } as const;

interface ParamDef {
  name?: string;
  type?: string;
  referenceRanges?: Array<{ min?: number | null; max?: number | null; sex?: string | null; minAge?: number | null; maxAge?: number | null }>;
}

function paramDefs(raw: string | null | undefined): ParamDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.parameters) ? parsed.parameters : [];
    return (list as ParamDef[]).filter(p => !!(p?.name ?? '').trim());
  } catch { return []; }
}

/** Parameter names out of a TestEntity.Parameters JSON (wrapper or array). */
export function namesFromParametersJson(raw: string | null | undefined): string[] {
  return paramDefs(raw).map(p => (p.name ?? '').trim());
}

/** A plausible, NORMAL sample value for one parameter: the midpoint of the
 *  range that fits the sample patient (adult female), else of the first
 *  range with both bounds, else "1.0" — so the preview's result, unit and
 *  range cells all resolve and print (never a blank row). */
export function plausibleValue(p: ParamDef): string {
  const ranges = (p.referenceRanges ?? []).filter(r => r && (r.min != null || r.max != null));
  const age = SAMPLE_PATIENT.age;
  const fits = ranges.find(r => (!r.sex || /^f/i.test(r.sex)) && (r.minAge == null || age >= r.minAge) && (r.maxAge == null || age < r.maxAge))
    ?? ranges.find(r => r.min != null && r.max != null) ?? ranges[0];
  if (!fits) return '1.0';
  const lo = fits.min ?? null, hi = fits.max ?? null;
  const v = lo != null && hi != null ? (lo + hi) / 2 : lo != null ? lo * 1.1 : (hi as number) * 0.8;
  if (!isFinite(v)) return '1.0';
  const mag = Math.abs(v);
  const dp = mag >= 100 ? 0 : mag >= 10 ? 1 : mag >= 1 ? 2 : 3;
  return v.toFixed(dp);
}

/** Sample values for a member: plausible per-parameter numbers. */
export function sampleValuesFor(parametersJson: string | null | undefined, fallbackNames: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const defs = paramDefs(parametersJson);
  for (const p of defs) out[(p.name ?? '').trim()] = (p.type ?? 'numeric') === 'numeric' || p.referenceRanges?.length ? plausibleValue(p) : '1.0';
  for (const n of fallbackNames) if (n && !(n in out)) out[n] = '1.0';
  return out;
}

/** The SAMPLE analyzer graphs (synthetic look-alikes, never patient data)
 *  for every analyzer box a page layout places, as absolute URLs the
 *  report renderer's image preload can fetch. */
export function sampleAnalyzerImages(boxes: ReadonlyArray<PageLayoutBox>, baseHref: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of boxes) {
    if (b.kind !== 'analyzer' || !b.ref) continue;
    try { out[b.ref] = new URL(analyzerSampleAsset(b.ref), baseHref).href; } catch { /* bad base — skip */ }
  }
  return out;
}

export type PreviewEngineFn = (
  testId: string, values: Record<string, unknown>, imageUrls: string[],
  patient: { sex?: string | null; age?: number | null }, parametersJson: string | null,
) => Promise<ResolvedReportLayout>;

export interface SamplePreviewOptions {
  testId: string;
  testName: string;
  department: string;
  sampleType: string;
  /** Individual test: its parameter names (sample values are generated). */
  parameters: string[];
  /** Individual test: explicit typed values (replace the generated ones). */
  values?: Record<string, unknown> | null;
  parametersJson?: string | null;
  /** Non-empty = the target is a PROFILE: one snapshot row per member. */
  members: PreviewProfileMember[];
  columnsOverride?: ReportColumn[] | null;
  culture?: boolean;
  template: ReportTemplate | null;
  apiUrl: string;
  /** The engine call, already mapped to the effective row id. */
  preview: PreviewEngineFn;
  /** LIVE (unsaved) one-page layout for the TARGET profile — the designer's
   *  boxes as they are right now, patched over whatever the engine returned. */
  pageLayout?: { enabled: boolean; boxes: PageLayoutBox[] } | null;
  /** Base href the sample analyzer graphs resolve against (document.baseURI). */
  assetBase?: string | null;
  /** The department's REAL sign-off (signoff-preview) — the sample report
   *  then signs exactly as a real one: same people, designations, images,
   *  same block height. */
  signoff?: { signatures: ReportSignature[] } | null;
}

const SAMPLE_CULTURE = {
  microFormat: 'culture_sensitivity',
  values: {
    specimen: 'Urine',
    colonyCount: '>100,000 CFU/mL',
    organisms: [{ name: 'Escherichia coli', antibiotics: [
      { name: 'Amikacin', interpretation: 'S' },
      { name: 'Ciprofloxacin', interpretation: 'R' },
      { name: 'Meropenem', interpretation: 'S' },
    ]}],
    resistancePattern: 'Ampicillin-resistant; carbapenems retained.',
    clinicalNotes: 'Significant bacteriuria — correlate clinically.',
  },
  stages: [
    { key: 'gram', label: 'Gram / Direct smear', values: { fields: [
      { name: 'pus_cells', title: 'Pus Cells', value: 'Many' },
      { name: 'gram_negative_bacilli', title: 'Gram-negative bacilli', value: 'Many' },
    ], notes: 'GNB seen' } },
    { key: 'growth', label: 'Growth check', values: { fields: [
      { name: 'growth', title: 'Growth', value: 'Significant growth' },
    ] } },
  ],
};

/** Patch the target layout's page_layout section with the live boxes (or
 *  add one) — the resolved shape the renderer reads (`pageLayout` nested). */
function withLivePageLayout(layout: ResolvedReportLayout, live: { enabled: boolean; boxes: PageLayoutBox[] }): ResolvedReportLayout {
  const sec = { id: 'page-layout', type: PAGE_LAYOUT_SECTION_TYPE, isVisible: true,
    pageLayout: { type: PAGE_LAYOUT_SECTION_TYPE, v: 1, enabled: live.enabled, boxes: live.boxes } };
  const has = layout.sections.some(s => s.type === PAGE_LAYOUT_SECTION_TYPE);
  return {
    ...layout,
    sections: has
      ? layout.sections.map(s => (s.type === PAGE_LAYOUT_SECTION_TYPE ? { ...s, ...sec } : s))
      : [...layout.sections, sec as never],
  };
}

/** The fabricated report + resolved layouts, exactly as the PDF renderer
 *  receives them. Null when `superseded()` turns true mid-way. */
export async function buildSamplePreviewInput(
  o: SamplePreviewOptions, superseded: () => boolean = () => false,
): Promise<ReportPdfInput | null> {
  const testId = o.testId;
  const patient = SAMPLE_PATIENT;
  const preview = (id: string, vals: Record<string, unknown>, imgs: string[] = [], p?: { sex?: string | null; age?: number | null }) =>
    o.preview(id, vals, imgs, p ?? patient, id === testId ? (o.parametersJson ?? null) : null);
  let layouts: Record<string, ResolvedReportLayout> = {};
  let snapshotTests: Array<Record<string, unknown>>;

  if (o.members.length > 0) {
    const seriesVals = o.members.some(m => m.offsetMin != null) ? sampleSeriesValues(testId, o.members) : null;
    snapshotTests = o.members.map(m => ({
      ...(m.offsetMin != null ? { repeatOffsetMin: m.offsetMin } : {}),
      testId: m.id,
      name: m.name,
      department: m.department || o.department || 'Department',
      packageTestId: testId,
      profileTestId: testId,
      packageType: 'profile',
      packageName: o.testName,
      profileName: o.testName,
      sampleType: o.sampleType || undefined,
      result: { values: { ...sampleValuesFor(m.parameters), ...(seriesVals?.get(`${m.id}@${m.offsetMin}`) ?? {}) } },
    }));
    layouts = await resolveReportLayouts<ResolvedReportLayout>(
      (id, vals, _c, p) => preview(id, vals, [], p), snapshotTests as never, patient,
    );
  } else {
    const vals = o.values && Object.keys(o.values).length > 0
      ? o.values
      : sampleValuesFor(o.parametersJson, o.parameters);
    const resolved = await preview(testId, vals, [], patient);
    layouts = { [testId]: resolved };
    snapshotTests = [{
      testId,
      name: o.testName || resolved.testName,
      department: o.department || resolved.departmentName || 'Department',
      sampleType: o.sampleType || resolved.sampleType || undefined,
      result: o.culture ? SAMPLE_CULTURE : { values: vals },
    }];
  }
  if (superseded()) return null;

  // Live unsaved column edits: patch the TARGET layout so the preview is
  // what Save would produce.
  const override = o.columnsOverride;
  let target = layouts[testId];
  if (override && override.length > 0 && target) {
    target = layouts[testId] = {
      ...target,
      columns: override,
      hasColumnOverride: true,
      departmentColumns: target.hasColumnOverride ? (target.departmentColumns ?? null) : target.columns,
    };
  }
  // The real department sign-off, keyed by the department the rows print under.
  const signDept = String((snapshotTests[0] as { department?: string } | undefined)?.department ?? '');
  const deptSignatures = o.signoff?.signatures?.length ? [{ department: signDept, signatures: o.signoff.signatures }] : undefined;
  const snapshot = {
    ...(deptSignatures ? { deptSignatures } : {}),
    patient: { id: 'preview-patient', displayName: 'Sita Raman', age: patient.age, sex: patient.sex, phone: '9080706050' },
    order: {
      id: 'preview-order',
      trackToken: 'SAMPLE',
      orderNumber: 'LAB-2608-000042',
      createdAt: new Date().toISOString(),
      refDoctorName: 'Dr. A. Sharma',
      branchName: 'Preview',
    },
    type: 'final',
    tests: snapshotTests,
  };
  const baseInput = {
    report: { id: 'preview-' + testId, type: 'final', createdAt: new Date().toISOString(), data: JSON.stringify(snapshot) },
    template: o.template,
    resolvedLayouts: layouts,
    previewKeepEmptyColumns: true,
  };
  const imageCache = await preloadReportImages(baseInput as ReportPdfInput, o.apiUrl);
  if (superseded()) return null;
  let input = { ...baseInput, imageCache } as ReportPdfInput;
  // Live one-page layout (the designer's unsaved boxes) for the target, with
  // SAMPLE graphs for its analyzer boxes.
  const saved = layouts[testId] ? readPageLayout(layouts[testId].sections) : null;
  const live = o.pageLayout ?? (saved?.enabled ? { enabled: true, boxes: saved.boxes } : null);
  if (live && layouts[testId] && o.members.length > 0) {
    input = applyLivePageLayout(input, testId, live, o.assetBase ?? null);
    input = await withSampleImagesLoaded(input, o.apiUrl);
    if (superseded()) return null;
  }
  return input;
}

/** The same sample report with the TARGET profile's one-page layout
 *  replaced by `live` (sync — no engine round trip; the designer calls this
 *  on every drag end) and SAMPLE graphs (synthetic look-alikes, never a real
 *  run) attached for its analyzer boxes. */
export function applyLivePageLayout(
  input: ReportPdfInput, testId: string, live: { enabled: boolean; boxes: PageLayoutBox[] }, assetBase: string | null,
): ReportPdfInput {
  const layouts = { ...(input.resolvedLayouts ?? {}) } as Record<string, ResolvedReportLayout>;
  const target = layouts[testId];
  if (!target) return input;
  layouts[testId] = withLivePageLayout(target, live);
  let data = input.report.data;
  if (live.enabled && assetBase) {
    try {
      const snap = JSON.parse(data ?? '{}') as { tests?: Array<Record<string, unknown>> };
      const imgs = sampleAnalyzerImages(live.boxes, assetBase);
      const tests: Array<Record<string, unknown>> = (snap.tests ?? []).map(t => ({ ...t, analyzerImages: null }));
      const first = tests.findIndex(t => t['profileTestId'] === testId || t['packageTestId'] === testId);
      if (first >= 0 && Object.keys(imgs).length) tests[first] = { ...tests[first], analyzerImages: imgs };
      // The sample sign-off for the signatures box (a real report prints the
      // department's own signatories).
      const dept = String(tests[first >= 0 ? first : 0]?.['department'] ?? '');
      const sigs = (snap as { deptSignatures?: unknown[] }).deptSignatures?.length ? {} : { deptSignatures: [{ department: dept, signatures: [
        { name: 'Lab Technologist', title: 'Sample signatory' }, { name: 'Consultant Pathologist', title: 'Sample signatory' },
      ] }] };
      data = JSON.stringify({ ...snap, ...sigs, tests });
    } catch { /* malformed sample snapshot — no sample graphs */ }
  }
  return { ...input, report: { ...input.report, data }, resolvedLayouts: layouts } as ReportPdfInput;
}

/** Fetch (once — they're cached on the input) any sample graph the
 *  snapshot now references that the image cache doesn't hold yet. */
export async function withSampleImagesLoaded(input: ReportPdfInput, apiUrl: string): Promise<ReportPdfInput> {
  const cache = input.imageCache ?? {};
  const missing: Record<string, string> = {};
  try {
    const snap = JSON.parse(input.report.data ?? '{}') as { tests?: Array<{ analyzerImages?: Record<string, string> | null }> };
    for (const t of snap.tests ?? []) for (const [code, url] of Object.entries(t.analyzerImages ?? {})) if (url && !cache[url]) missing[code] = url;
  } catch { return input; }
  if (!Object.keys(missing).length) return input;
  const fetched = await preloadReportImages({
    report: { id: 'sample-graphs', type: 'final', data: JSON.stringify({ tests: [{ analyzerImages: missing }] }) },
    template: null,
  } as ReportPdfInput, apiUrl);
  return { ...input, imageCache: { ...cache, ...fetched } } as ReportPdfInput;
}
