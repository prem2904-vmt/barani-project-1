import { buildReportPdf } from '../report-pdf';
import type { ResolvedReportLayout } from '../../models/report-layout.model';
import type { ReportChartSpec } from './report-chart.model';

/**
 * Made-up report snapshots for the chart specs — an OGTT-shaped timed series
 * and a lipid-shaped bar chart, with invented values (never patient data).
 */
export const PAGE_H = 841.89;

export const OGTT_SPEC: ReportChartSpec = {
  v: 1, kind: 'line', x: 'series', lines: [{ unit: 'mg/dL' }], xLabels: {},
  refBand: true, showValues: true, size: 'full', yMin: null, yMax: null,
  thresholds: [{ value: 140, label: 'IGT ≥ 140' }, { value: 200, label: 'Diabetes ≥ 200 at 2 h' }],
};

export const LIPID_SPEC: ReportChartSpec = {
  v: 1, kind: 'bar', x: 'parameters', refBand: true, showValues: true, size: 'full', yMin: null, yMax: null,
  parameters: ['total_cholesterol', 'hdl', 'ldl', 'vldl', 'triglycerides'],
  thresholds: [{ value: 200, label: 'Desirable < 200' }],
};

type Val = { value: unknown; flag?: string; unit?: string; range?: string; low?: number | null; high?: number | null };
const v = (value: unknown, low: number | null, high: number | null, flag = 'N'): Val =>
  ({ value, flag, unit: 'mg/dL', range: high != null && low != null ? `${low}–${high} mg/dL` : high != null ? `< ${high} mg/dL` : '', low, high });

/** The five OGTT draws (offset → [test id, name, band, value]); `null` value = missed. */
export function ogttTests(values: Array<number | null>, opts: { secondLine?: Array<number | null> } = {}) {
  const pts: Array<[number, string, string, number | null, number | null]> = [
    [0, 'zfast', 'Zfasting Glucose', 70, 99],
    [30, 'z30', 'Zogtt 30 Minutes', null, 200],
    [60, 'z60', 'Zogtt 60 Minutes', null, 180],
    [90, 'z90', 'Zogtt 90 Minutes', null, 160],
    [120, 'z120', 'Zogtt 120 Minutes', null, 140],
  ];
  return pts.map(([off, id, name, lo, hi], i) => {
    const val = values[i];
    const flag = val == null ? '' : (hi != null && val > hi) ? 'H' : (lo != null && val < lo) ? 'L' : 'N';
    const values2: Record<string, Val> = {};
    if (val != null) values2[name] = v(val, lo, hi, flag);
    const ins = opts.secondLine?.[i];
    if (ins != null) values2['Zinsulin'] = { value: ins, flag: 'N', unit: 'µIU/mL', low: 2, high: 25 };
    return {
      testId: id, name, department: 'Biochemistry', sampleType: 'Fluoride plasma',
      packageTestId: 'zogtt', profileTestId: 'zogtt', packageType: 'profile', packageName: 'ZORAL GLUCOSE TOLERANCE', profileName: 'ZORAL GLUCOSE TOLERANCE',
      repeatOffsetMin: off, status: val == null ? 'pending' : 'validated',
      result: val == null && ins == null ? null : { values: values2 },
    };
  });
}

export function lipidTest(vals: { tc: number; hdl: number; ldl: number; vldl: number; tg: number }) {
  return {
    testId: 'zlipid', name: 'Zlipid Profile', department: 'Biochemistry', sampleType: 'Serum', packageTestId: null,
    result: { values: {
      total_cholesterol: v(vals.tc, null, 200, vals.tc > 200 ? 'H' : 'N'),
      hdl: v(vals.hdl, 40, 60, vals.hdl < 40 ? 'L' : 'N'),
      ldl: v(vals.ldl, null, 100, vals.ldl > 100 ? 'H' : 'N'),
      vldl: v(vals.vldl, 2, 30, 'N'),
      triglycerides: v(vals.tg, null, 150, vals.tg > 150 ? 'H' : 'N'),
    } },
  };
}

export const LIPID_TITLES: Record<string, string> = {
  total_cholesterol: 'Total Cholesterol', hdl: 'HDL Cholesterol', ldl: 'LDL Cholesterol',
  vldl: 'VLDL Cholesterol', triglycerides: 'Triglycerides',
};

const COLS = [
  { id: 'c-result', name: 'result', label: 'Result', order: 1, width: 30, type: 'result', locked: false },
  { id: 'c-unit', name: 'unit', label: 'Unit', order: 2, width: 20, type: 'unit', locked: false },
  { id: 'c-range', name: 'range', label: 'Reference Range', order: 3, width: 30, type: 'range', locked: false },
];

const gridFor = (id: string, name: string, rows: Array<[string, string, string, string?]>) => ({
  testId: id, testName: name, departmentName: 'Biochemistry', columns: COLS, configured: true,
  sections: [{ id: 'g-' + id, type: 'grid', order: 1, isVisible: true, rows: rows.map(([p, title, result, range]) => ({
    id: 'r-' + p, parameterName: p, title, isMerged: false, cells: { result, unit: 'mg/dL', range: range ?? '' } })) }],
});

export function buildChartReport(opts: {
  tests: Array<Record<string, unknown>>;
  chartOwner: 'zogtt' | 'zlipid';
  spec: ReportChartSpec;
  title?: string;
  /** Tall filler tests before the chart (pushes it near a page foot). */
  fillers?: number;
  flagStyle?: 'bold' | 'bold_color';
  hidden?: boolean;
  patientName?: string;
}) {
  const fillers = Array.from({ length: opts.fillers ?? 0 }, (_, i) => ({
    testId: 'zf' + i, name: `Zfiller ${i}`, department: 'Biochemistry', packageTestId: null,
    result: { values: { [`Zfiller ${i}`]: v(50 + i, 10, 90) } },
  }));
  const tests = [...fillers, ...opts.tests];
  const layouts: Record<string, ResolvedReportLayout> = {};
  for (const f of fillers) layouts[f.testId] = gridFor(f.testId, f.name, [[f.name, f.name, String(50), '10–90 mg/dL']]) as never;
  for (const t of opts.tests) {
    const vals = ((t['result'] as { values?: Record<string, Val> } | null)?.values) ?? {};
    layouts[t['testId'] as string] = gridFor(t['testId'] as string, t['name'] as string,
      Object.entries(vals).map(([k, x]) => [k, LIPID_TITLES[k] ?? k, String(x.value), x.range ?? ''])) as never;
  }
  const chartSec = { id: 'chart1', type: 'chart', label: opts.title ?? 'Zglucose curve', isVisible: true, trend: opts.spec };
  if (opts.chartOwner === 'zogtt') {
    layouts['zogtt'] = { testId: 'zogtt', testName: 'ZORAL GLUCOSE TOLERANCE', departmentName: 'Biochemistry', columns: COLS,
      sections: opts.hidden ? [] : [chartSec] } as never;
  } else {
    const l = layouts['zlipid'] as unknown as { sections: unknown[] };
    if (!opts.hidden) l.sections.push(chartSec);
  }
  const snap = {
    type: 'final',
    patient: { displayName: opts.patientName ?? 'Zpatient Sample', age: 42, sex: 'Female' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000777', createdAt: '2026-09-30T06:00:00Z' },
    tests,
  };
  return buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-30T09:10:00Z', data: JSON.stringify(snap) },
    template: opts.flagStyle ? { flagStyle: opts.flagStyle } as never : null,
    resolvedLayouts: layouts,
  } as never);
}

export type Run = { page: number; text: string; x: number; top: number };

/** Every Tj text run with its page and top-down y (Standard-14 fonts write
 *  literal text in the content stream). */
export function textRuns(doc: ReturnType<typeof buildReportPdf>): Run[] {
  const pages = (doc as unknown as { internal: { pages: Array<string[] | null> } }).internal.pages;
  const out: Run[] = [];
  pages.forEach((lines, page) => {
    if (!lines) return;
    let x = 0, y = 0;
    for (const raw of lines) {
      const line = String(raw);
      for (const m of line.matchAll(/(-?[\d.]+) (-?[\d.]+) Td|\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
        if (m[1] !== undefined) { x = Number(m[1]); y = Number(m[2]); continue; }
        out.push({ page, text: m[3], x, top: PAGE_H - y });
      }
    }
  });
  return out;
}
