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
const v = (value: unknown, low: number | null, high: number | null, flag = 'N', unit = 'mg/dL'): Val =>
  ({ value, flag, unit, range: high != null && low != null ? `${low}–${high} ${unit}` : high != null ? `< ${high} ${unit}` : '', low, high });
/** A value flagged against its band the way mw saves it (H / L / N). */
const fv = (value: number, low: number | null, high: number | null, unit: string): Val =>
  v(value, low, high, high != null && value > high ? 'H' : low != null && value < low ? 'L' : 'N', unit);

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

/** WBC differential: % (parts of a whole) and absolute counts. */
export function wbcDiffTest(pct: { neu: number; lym: number; mono: number; eos: number; baso: number },
  abs?: { neu: number; lym: number; mono: number; eos: number; baso: number }) {
  const values: Record<string, Val> = {
    neutrophils_pct: fv(pct.neu, 40, 75, '%'), lymphocytes_pct: fv(pct.lym, 20, 40, '%'), monocytes_pct: fv(pct.mono, 2, 10, '%'),
    eosinophils_pct: fv(pct.eos, 1, 6, '%'), basophils_pct: fv(pct.baso, 0, 2, '%'),
  };
  if (abs) Object.assign(values, {
    neutrophils_abs: fv(abs.neu, 2, 7, '10³/µL'), lymphocytes_abs: fv(abs.lym, 1, 3, '10³/µL'), monocytes_abs: fv(abs.mono, 0.2, 1, '10³/µL'),
    eosinophils_abs: fv(abs.eos, 0.02, 0.5, '10³/µL'), basophils_abs: fv(abs.baso, 0.02, 0.1, '10³/µL'),
  });
  return { testId: 'zdiff', name: 'Zdifferential Count', department: 'Haematology', sampleType: 'EDTA whole blood', packageTestId: null, result: { values } };
}
export const WBC_TITLES: Record<string, string> = {
  neutrophils_pct: 'Neutrophils', lymphocytes_pct: 'Lymphocytes', monocytes_pct: 'Monocytes', eosinophils_pct: 'Eosinophils', basophils_pct: 'Basophils',
  neutrophils_abs: 'Absolute Neutrophils', lymphocytes_abs: 'Absolute Lymphocytes', monocytes_abs: 'Absolute Monocytes',
  eosinophils_abs: 'Absolute Eosinophils', basophils_abs: 'Absolute Basophils',
};
export const WBC_PCT = ['neutrophils_pct', 'lymphocytes_pct', 'monocytes_pct', 'eosinophils_pct', 'basophils_pct'];
export const WBC_ABS = ['neutrophils_abs', 'lymphocytes_abs', 'monocytes_abs', 'eosinophils_abs', 'basophils_abs'];

/** HbA1c: one value against its band. */
export function hba1cTest(value: number) {
  return { testId: 'zhba1c', name: 'Zglycated Haemoglobin', department: 'Biochemistry', sampleType: 'EDTA whole blood', packageTestId: null,
    result: { values: { hba1c: fv(value, 4, 5.6, '%') } } };
}
export const HBA1C_TITLES: Record<string, string> = { hba1c: 'HbA1c' };

/** Liver function panel: values in different units. */
export function liverTest(x: { alt: number; ast: number; alp: number; ggt: number; bil: number; alb: number }) {
  return { testId: 'zlft', name: 'Zliver Function Test', department: 'Biochemistry', sampleType: 'Serum', packageTestId: null,
    result: { values: {
      alt: fv(x.alt, 0, 40, 'U/L'), ast: fv(x.ast, 0, 40, 'U/L'), alp: fv(x.alp, 44, 147, 'U/L'), ggt: fv(x.ggt, 8, 61, 'U/L'),
      bilirubin_total: fv(x.bil, 0.3, 1.2, 'mg/dL'), albumin: fv(x.alb, 3.5, 5, 'g/dL'),
    } } };
}
export const LFT_TITLES: Record<string, string> = {
  alt: 'ALT (SGPT)', ast: 'AST (SGOT)', alp: 'Alkaline Phosphatase', ggt: 'GGT', bilirubin_total: 'Total Bilirubin', albumin: 'Albumin',
};

/** Timed urine collection (a repetitive profile): albumin + other protein
 *  excreted per collection period, both in mg — parts that stack. */
const PERIODS = ['0–4 h', '4–8 h', '8–12 h', '12–24 h'];
export function urineProteinTests(alb: number[], other: number[]) {
  const offs = [0, 240, 480, 720];
  return offs.map((off, i) => ({
    testId: 'zup' + off, name: `Zurine Protein ${off / 60} h`, department: 'Biochemistry', sampleType: 'Timed urine',
    packageTestId: 'zupro', profileTestId: 'zupro', packageType: 'profile', packageName: 'ZSPLIT URINE PROTEIN', profileName: 'ZSPLIT URINE PROTEIN',
    repeatOffsetMin: off, status: 'validated',
    result: { values: { [`Urine albumin (${PERIODS[i]})`]: v(alb[i], null, null, 'N', 'mg'), [`Other urine protein (${PERIODS[i]})`]: v(other[i], null, null, 'N', 'mg') } },
  }));
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

const gridFor = (id: string, name: string, rows: Array<[string, string, string, string?, string?]>) => ({
  testId: id, testName: name, departmentName: 'Biochemistry', columns: COLS, configured: true,
  sections: [{ id: 'g-' + id, type: 'grid', order: 1, isVisible: true, rows: rows.map(([p, title, result, range, unit]) => ({
    id: 'r-' + p, parameterName: p, title, isMerged: false, cells: { result, unit: unit ?? 'mg/dL', range: (range ?? '').replace(/ \S+$/, '') } })) }],
});

export function buildChartReport(opts: {
  tests: Array<Record<string, unknown>>;
  chartOwner: string;
  /** Row titles for the grid (value name → title). */
  titles?: Record<string, string>;
  template?: Record<string, unknown>;
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
      Object.entries(vals).map(([k, x]) => [k, opts.titles?.[k] ?? LIPID_TITLES[k] ?? k, String(x.value), x.range ?? '', x.unit])) as never;
  }
  const chartSec = { id: 'chart1', type: 'chart', label: opts.title ?? 'Zglucose curve', isVisible: true, trend: opts.spec };
  if (!opts.tests.some(t => t['testId'] === opts.chartOwner)) {
    const member = opts.tests.find(t => t['profileTestId'] === opts.chartOwner);
    layouts[opts.chartOwner] = { testId: opts.chartOwner, testName: (member?.['profileName'] as string) ?? 'ZORAL GLUCOSE TOLERANCE',
      departmentName: 'Biochemistry', columns: COLS, sections: opts.hidden ? [] : [chartSec] } as never;
  } else {
    const l = layouts[opts.chartOwner] as unknown as { sections: unknown[] };
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
    template: opts.flagStyle || opts.template ? { ...(opts.flagStyle ? { flagStyle: opts.flagStyle } : {}), ...(opts.template ?? {}) } as never : null,
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

/** FNV-1a over the laid-out drawing operations (numbers rounded to 0.001). */
export function fingerprint(ops: unknown): string {
  const s = JSON.stringify(ops, (_k, v) => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

