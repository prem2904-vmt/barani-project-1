import { buildReportPdf, buildReportPdfWithLayout, printBoldNames } from './report-pdf';
import { PAGE, detectIssues, setItem, writeHeaderLayout } from './report-header-layout';
import type { ReportColumn, ResolvedReportLayout } from '../models/report-layout.model';
import type { ReportTemplate } from '../models/report.model';
import { LEGACY_SNAPSHOT, silenceJsdomCanvas } from './report-header-legacy.spec-helpers';

/**
 * Owner 2026-09-30. Renders REAL PDFs and reads the content stream back
 * (pattern: report-notes-rule / report-option-bold specs).
 *
 *  1. "Print in bold": a value the tech marked (snapshot `result.bold`) is
 *     drawn in the SAME bold font an abnormal value uses — in the value cell
 *     only; a normal unmarked value stays regular; an abnormal value is bold
 *     with or without the mark (the mark only ADDS bold).
 *  2. Banner header style with the band switched OFF: no band is painted,
 *     the lab name turns dark ink (it was white on the band), the text moves
 *     up to the top margin; the untouched Banner keeps its band.
 */
silenceJsdomCanvas();

const col = (name: string, label: string, type: string, order: number, width = 30): ReportColumn =>
  ({ id: `c-${name}`, name, label, order, width, type, locked: false } as ReportColumn);
const COLS = [col('name', 'Test', 'name', 0), col('result', 'Result', 'result', 1), col('range', 'Reference range', 'range', 2)];

type V = { value: string; flag?: string; range?: string; unit?: string };
const VALUES: Record<string, V> = {
  Haemoglobin: { value: '13.5', flag: 'N', range: '13.0 - 17.0', unit: 'g/dL' },
  PCV: { value: '41.2', flag: 'N', range: '40 - 50', unit: '%' },
  MCV: { value: '101.7', flag: 'H', range: '80 - 100', unit: 'fL' },
};

/** Render a CBC-like result; `grid` = through a resolved layout (the usual
 *  path), else the legacy values map. */
function render(bold: string[] | undefined, grid: boolean): string {
  const layout = {
    testId: 't1', testName: 'Haemogram', departmentName: 'Haematology', columns: COLS,
    sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: Object.entries(VALUES).map(([n, v]) => ({
      parameterName: n, title: n, isMerged: false, unit: v.unit, cells: { name: n, result: v.value, range: v.range },
    })) }],
  } as unknown as ResolvedReportLayout;
  const snap = {
    patient: { displayName: 'Test Patient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000001', createdAt: '2026-09-30T00:00:00Z' },
    type: 'final',
    tests: [{ testId: 't1', name: 'Haemogram', department: 'Haematology', sampleType: 'EDTA',
      result: { values: VALUES, ...(bold ? { bold } : {}) } }],
  };
  const doc = buildReportPdf({
    report: { id: 'r1', createdAt: '2026-09-30T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: grid ? { t1: layout } : {},
    template: null,
  } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** The font resource ("/F2") a text run is drawn in. */
function fontOf(pdf: string, text: string): string {
  const at = pdf.indexOf(`(${text}`);
  expect(at).toBeGreaterThan(-1);
  const all = [...pdf.slice(0, at).matchAll(/\/(F\d+) [\d.]+ Tf/g)];
  return all.at(-1)![1];
}
/** Which base font a resource name maps to ("Helvetica-Bold"). */
function baseFontOf(pdf: string, res: string): string {
  const obj = new RegExp(`/${res} (\\d+) 0 R`).exec(pdf)![1];
  const body = new RegExp(`\\n${obj} 0 obj\\s*<<([\\s\\S]*?)>>`).exec(pdf)![1];
  return /\/BaseFont \/([A-Za-z-]+)/.exec(body)![1];
}
const isBold = (pdf: string, text: string) => /Bold/.test(baseFontOf(pdf, fontOf(pdf, text)));

describe('report — "print in bold" per value', () => {
  for (const grid of [true, false]) {
    const path = grid ? 'layout grid' : 'legacy values map';
    it(`${path}: the marked normal value prints in the bold font; unmarked normal stays regular`, () => {
      const pdf = render(['Haemoglobin'], grid);
      expect(isBold(pdf, '13.5')).toBe(true);
      expect(isBold(pdf, '41.2')).toBe(false);
      // Same font as an abnormal value (the one styling path).
      expect(fontOf(pdf, '13.5')).toBe(fontOf(pdf, '101.7'));
    });

    it(`${path}: without a mark nothing extra is bold; an abnormal value is bold either way`, () => {
      const pdf = render(undefined, grid);
      expect(isBold(pdf, '13.5')).toBe(false);
      expect(isBold(pdf, '101.7')).toBe(true);
      expect(isBold(render(['MCV'], grid), '101.7')).toBe(true);   // the mark never un-bolds
    });
  }

  it('only the VALUE cell is bolded — the reference range stays regular', () => {
    const pdf = render(['Haemoglobin'], true);
    expect(isBold(pdf, '13.0 - 17.0')).toBe(false);
  });

  it('reads the snapshot list defensively', () => {
    expect([...printBoldNames({ result: { bold: ['Hb', 3, '', 'PCV'] } })]).toEqual(['Hb', 'PCV']);
    expect(printBoldNames({ result: { bold: 'Hb' } }).size).toBe(0);
    expect(printBoldNames({}).size).toBe(0);
  });
});

// ── Banner on / off ────────────────────────────────────────────────────

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function bannerTpl(bandOff: boolean, logoPosition: 'left' | 'center' | 'right' = 'left'): ReportTemplate {
  const t = {
    id: 't', tenantId: 'x', labName: 'Micro World Diagnostics', tagline: 'Accurate | Caring | Instant',
    address: '14 Gandhi Road, Chennai 600017', phone: '+91 98400 12345', email: 'lab@microworld.in',
    website: 'www.microworld.in', logoUrl: '/uploads/logo.png', nablAccredited: false,
    headerPreset: 'banner', logoPosition, logoSize: 'md', topAccentBar: true,
    primaryColor: '#1B3A6B', accentColor: '#0066CC', showPatientName: true, showAge: true, showRefDoctor: true,
    showOrderId: true, showAbhaId: false, showQrCode: true, showCollectionDate: true, showReportDate: true,
    showMethod: false, showInstrument: false, groupByDepartment: false, showCriticalFlag: true,
    showPathologistName: true, showSignature: true, showPoweredBy: true,
    disclaimer: 'Test results should be correlated clinically.', footerText: '',
  } as ReportTemplate;
  if (bandOff) t.metadata = writeHeaderLayout(t, setItem(null, 'banner', { hidden: true }));
  return t;
}
function bannerPdf(bandOff: boolean, logoPosition: 'left' | 'center' | 'right' = 'left') {
  const { doc, layout } = buildReportPdfWithLayout({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-20T06:00:00Z', data: LEGACY_SNAPSHOT },
    template: bannerTpl(bandOff, logoPosition), imageCache: { '/uploads/logo.png': PNG_1x1 },
  });
  return { pdf: Buffer.from(doc.output('arraybuffer')).toString('latin1'), layout };
}
const NAME = 'MICRO WORLD DIAGNOSTICS';
/** A full-page-width filled rectangle from the page top (the band). */
const BAND = /(?:^|\s)0\.? 841\.8\d* 595\.2\d* -\d+(?:\.\d*)? re\s+f/m;
/** The last fill colour set before a text run ("r g b rg" / "g"). */
function colourBefore(pdf: string, text: string): string {
  const at = pdf.indexOf(`(${text}`);
  const all = [...pdf.slice(0, at).matchAll(/((?:[\d.]+ ){3}rg|[\d.]+ g)\s/g)];
  return all.at(-1)![1].trim();
}
const isWhite = (c: string) => /^1(\.0*)? g$/.test(c) || /^1(\.0*)? 1(\.0*)? 1(\.0*)? rg$/.test(c);
/** Baseline y (page space, y down) of a text run. */
function runY(pdf: string, text: string): number {
  const m = new RegExp(`(-?[\\d.]+) (-?[\\d.]+) Td\\s*\\(${text.replace(/[()]/g, '\\$&')}\\) Tj`).exec(pdf)!;
  return PAGE.h - parseFloat(m[2]);
}

describe('report header — Banner style, band on / off', () => {
  it('untouched Banner: the band is painted and the name is white on it (backward compatible)', () => {
    const { pdf, layout } = bannerPdf(false);
    expect(BAND.test(pdf)).toBe(true);
    expect(layout.items.find(i => i.id === 'banner')!.hidden).toBeFalsy();
    expect(isWhite(colourBefore(pdf, NAME))).toBe(true);
  });

  it('band OFF: no band in the PDF, the name prints in dark ink, the header moves up to the margin', () => {
    const on = bannerPdf(false);
    const off = bannerPdf(true);
    expect(BAND.test(off.pdf)).toBe(false);
    expect(off.layout.items.find(i => i.id === 'banner')!.hidden).toBe(true);
    const c = colourBefore(off.pdf, NAME);
    expect(isWhite(c)).toBe(false);
    expect(isWhite(colourBefore(off.pdf, 'Accurate | Caring | Instant'))).toBe(false);
    // Text sits from the top margin and the contact line follows it closely
    // — the 54pt band's space collapses (nothing is pushed below it).
    const logo = off.layout.items.find(i => i.id === 'logo')!;
    expect(logo.y).toBeCloseTo(28, 1);
    const contactOff = off.layout.items.find(i => i.id === 'contact')!;
    const contactOn = on.layout.items.find(i => i.id === 'contact')!;
    expect(contactOff.box.y).toBeGreaterThan(logo.box.y + logo.box.h - 0.5);
    expect(runY(off.pdf, NAME)).toBeGreaterThan(28);
    expect(contactOff.box.y + contactOff.box.h).toBeLessThanOrEqual(off.layout.bodyTop);
    expect(contactOn).toBeTruthy();
  });

  for (const pos of ['left', 'center', 'right'] as const) {
    it(`band OFF, logo ${pos}: nothing overlaps and nothing spills into the body`, () => {
      const { layout } = bannerPdf(true, pos);
      expect(detectIssues(layout).filter(i => i.kind === 'overlap' || i.kind === 'body')).toEqual([]);
    });
  }
});
