import { buildReportPdf } from './report-pdf';
import { reportFlag, reportFlagWord, reportRangeBounds } from './report-flag';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Owner rule (2026-09-26): the patient REPORT never shows "C" or "Critical" —
 * critical is internal. A critical-high prints as H, a critical-low as L, with
 * the same indicator (letter / arrow / none) and colours as H / L.
 * mw stores only 'C' for a critical, so direction comes from the value vs the
 * row's printed reference range. Renders the REAL pipeline and reads the
 * content stream back (same technique as report-pdf-symbols.spec.ts).
 */

const HIGH_RGB = '0.863 0.149 0.149 rg'; // #dc2626
const LOW_RGB = '0.145 0.388 0.922 rg';  // #2563eb

type Tpl = Record<string, unknown> | null;

/** Two criticals: random glucose 600 (CH 500) and fasting glucose 1.0 (CL 40). */
const VALUES = {
  'Glucose Random': { value: '600', flag: 'C', unit: 'mg/dL', range: '70 - 140 mg/dL' },
  'Glucose Fasting': { value: '1.0', flag: 'C', unit: 'mg/dL', range: '70 - 99 mg/dL' },
};

const GRID: Record<string, ResolvedReportLayout> = {
  glu: {
    testId: 'glu', testName: 'Glucose', departmentName: 'Biochemistry', configured: true,
    columns: [
      { id: 'c1', name: 'result', label: 'Result', order: 1, width: 40, type: 'result', locked: false },
      { id: 'c2', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
      { id: 'c3', name: 'range', label: 'Reference range', order: 3, width: 40, type: 'range', locked: false },
    ],
    sections: [{ id: 'g1', type: 'grid', order: 1, isVisible: true, rows: [
      { id: 'r1', parameterName: 'Glucose Random', isMerged: false, unit: 'mg/dL',
        cells: { result: '600', unit: 'mg/dL', range: '70 - 140 mg/dL' } },
      { id: 'r2', parameterName: 'Glucose Fasting', isMerged: false, unit: 'mg/dL',
        cells: { result: '1.0', unit: 'mg/dL', range: '70 - 99 mg/dL' } },
    ] }],
  } as unknown as ResolvedReportLayout,
};

/** No grid section → the legacy values-map rows of the continuous table. */
const PLAIN: Record<string, ResolvedReportLayout> = {
  glu: { testId: 'glu', testName: 'Glucose', departmentName: 'Biochemistry', columns: [], configured: true, sections: [] } as unknown as ResolvedReportLayout,
};

function render(layouts: Record<string, ResolvedReportLayout>, template: Tpl = null, flagged = true): string {
  const snap = {
    patient: { displayName: 'Test Patient', age: 40, sex: 'F' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000009', createdAt: '2026-09-26T00:00:00Z' },
    type: 'final',
    tests: [{
      testId: 'glu', name: 'Glucose', department: 'Biochemistry', sampleType: 'Plasma',
      result: { values: VALUES, ...(flagged ? { flags: { critical: true } } : {}) },
    }],
  };
  const doc = buildReportPdf({ report: { id: 'r1', createdAt: '2026-09-26T00:00:00Z', data: JSON.stringify(snap) },
    resolvedLayouts: layouts, template } as never);
  return Buffer.from(doc.output('arraybuffer')).toString('latin1');
}

/** Every string drawn with Tj, in order. */
function drawn(pdf: string): string[] {
  return [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)].map(m => m[1]);
}

/** The content-stream slice from the run that draws `text` back to the prior BT. */
function colourBefore(pdf: string, text: string): string {
  const m0 = new RegExp(`\\(${text.replace('.', '\\.')}( mg/dL)?\\) Tj`).exec(pdf);
  const i = m0 ? m0.index : -1;
  expect(i).toBeGreaterThan(-1);
  const seg = pdf.slice(Math.max(0, i - 300), i);
  const m = [...seg.matchAll(/([\d.]+ [\d.]+ [\d.]+) rg/g)];
  return m.length ? `${m[m.length - 1][1]} rg` : '';
}

function noCritical(runs: string[]): void {
  const joined = runs.join('|');
  expect(joined).not.toMatch(/critical/i);
  expect(runs.some(r => /(^|\s)C$/.test(r.trim()))).toBe(false);
  expect(runs).not.toContain('C');
}

describe('reportFlag — criticals map to H / L, never C', () => {
  it('uses a stored direction when the code carries one', () => {
    expect(reportFlag('CH', 'x', null)).toEqual({ flag: 'H', isLow: false, abnormal: true });
    expect(reportFlag('ll', 'x', null)).toEqual({ flag: 'L', isLow: true, abnormal: true });
    expect(reportFlag('critical_low', 5, null).flag).toBe('L');
  });

  it('resolves C against the printed range bounds', () => {
    expect(reportFlag('C', '600', '70 - 140 mg/dL')).toEqual({ flag: 'H', isLow: false, abnormal: true });
    expect(reportFlag('C', '1.0', '70–99 mg/dL')).toEqual({ flag: 'L', isLow: true, abnormal: true });
    expect(reportFlag('C', '< 0.5', { low: 1, high: 5 }).flag).toBe('L');
    expect(reportFlag('C', '900', 'Normal: 70–99\nPrediabetes: 100–125\nDiabetes: ≥126').flag).toBe('H');
    expect(reportFlag('C', '250', '< 200').flag).toBe('H');
    expect(reportFlag('C', '10', '> 40').flag).toBe('L');
  });

  it('undetermined direction: H only above the midpoint, else no letter — never C', () => {
    expect(reportFlag('C', '90', '70 - 100').flag).toBe('H');
    expect(reportFlag('C', '75', '70 - 100')).toEqual({ flag: '', isLow: false, abnormal: true });
    expect(reportFlag('C', 'Reactive', '70 - 100')).toEqual({ flag: '', isLow: false, abnormal: true });
    expect(reportFlag('C', '600', null)).toEqual({ flag: '', isLow: false, abnormal: true });
    expect(reportFlag('C', '600', 'see note').flag).toBe('');
  });

  it('H / L / A pass through; N and unknown codes print nothing', () => {
    expect(reportFlag('h', '1', null).flag).toBe('H');
    expect(reportFlag('L', '1', null).isLow).toBe(true);
    expect(reportFlag('A', 'Reactive', null).flag).toBe('A');
    expect(reportFlag('N', '1', null)).toEqual({ flag: '', isLow: false, abnormal: false });
    expect(reportFlag('', '1', null).abnormal).toBe(false);
  });

  it('classic words are High / Low — never Critical', () => {
    expect(reportFlagWord(reportFlag('C', '600', '70-140').flag)).toBe('High');
    expect(reportFlagWord(reportFlag('C', '1', '70-99').flag)).toBe('Low');
  });

  it('reportRangeBounds reads the first band', () => {
    expect(reportRangeBounds('70 - 140 mg/dL')).toEqual({ low: 70, high: 140 });
    expect(reportRangeBounds('Up to 40 U/L')).toEqual({ high: 40 });
    expect(reportRangeBounds('≥ 60')).toEqual({ low: 60 });
    expect(reportRangeBounds('')).toBeNull();
  });
});

describe('report PDF — no C / Critical for critical values', () => {
  it('layout grid, letter mode: critical-high prints H, critical-low prints L', () => {
    const runs = drawn(render(GRID));
    noCritical(runs);
    expect(runs.some(r => /^600( mg\/dL)?  H$/.test(r))).toBe(true);
    expect(runs.some(r => /^1\.0( mg\/dL)?  L$/.test(r))).toBe(true);
  });

  it('layout grid, arrow + colour mode: up arrow in high colour, down arrow in low colour', () => {
    const pdf = render(GRID, { flagIndicator: 'arrow', flagStyle: 'bold_color' });
    const runs = drawn(pdf);
    noCritical(runs);
    // No letter — the arrow is drawn instead.
    expect(runs.some(r => /^600( mg\/dL)?$/.test(r))).toBe(true);
    expect(runs.some(r => /^1\.0( mg\/dL)?$/.test(r))).toBe(true);
    expect(runs.some(r => /^600\b.*\s(H|C)$/.test(r))).toBe(false);
    // Result text in the theme's high / low colours.
    expect(colourBefore(pdf, '600')).toBe(HIGH_RGB);
    expect(colourBefore(pdf, '1.0')).toBe(LOW_RGB);
    // Two filled triangles: one high-coloured, one low-coloured.
    // jsPDF writes the triangle fill colour at 2 decimals, then m / l / l.
    const tri = [...pdf.matchAll(/([\d.]+ [\d.]+ [\d.]+) rg\s+[\d.]+ ([\d.]+) m\s+[\d.]+ ([\d.]+) l\s+[\d.]+ ([\d.]+) l/g)];
    const hi = tri.find(m => m[1] === '0.86 0.15 0.15');
    const lo = tri.find(m => m[1] === '0.15 0.39 0.92');
    expect(hi).toBeTruthy();
    expect(lo).toBeTruthy();
    // PDF y grows upward: up arrow's apex (3rd point) is ABOVE its base.
    expect(Number(hi![4])).toBeGreaterThan(Number(hi![2]));
    expect(Number(lo![4])).toBeLessThan(Number(lo![2]));
  });

  it('none mode: no letters, no arrows, no C', () => {
    const runs = drawn(render(GRID, { flagIndicator: 'none' }));
    noCritical(runs);
    expect(runs.some(r => /^600( mg\/dL)?$/.test(r))).toBe(true);
    expect(runs.some(r => /^600\b.*\s(H|C)$/.test(r))).toBe(false);
  });

  it('legacy values map (no grid): criticals print H / L', () => {
    const runs = drawn(render(PLAIN));
    noCritical(runs);
    expect(runs.some(r => /^600( mg\/dL)?  H$/.test(r))).toBe(true);
    expect(runs.some(r => /^1\.0( mg\/dL)?  L$/.test(r))).toBe(true);
  });

  it('no resolved layout at all: criticals print H / L', () => {
    const runs = drawn(render({}));
    noCritical(runs);
    expect(runs.some(r => /^600( mg\/dL)?  H$/.test(r))).toBe(true);
    expect(runs.some(r => /^1\.0( mg\/dL)?  L$/.test(r))).toBe(true);
  });
});
