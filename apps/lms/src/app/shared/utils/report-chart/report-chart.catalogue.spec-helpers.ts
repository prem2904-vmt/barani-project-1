/**
 * Realistic sample charts for every chart type (invented values, never
 * patient data): used by the catalogue specs and, with CHART_SHOTS_DIR set,
 * to write the owner's sample PDFs (report-chart.samples.spec.ts).
 */
import type { ReportChartSpec } from './report-chart.model';
import {
  HBA1C_TITLES, LFT_TITLES, LIPID_SPEC, LIPID_TITLES, OGTT_SPEC, WBC_ABS, WBC_PCT, WBC_TITLES,
  hba1cTest, lipidTest, liverTest, ogttTests, urineProteinTests, wbcDiffTest,
} from './report-chart.spec-helpers';

export interface CatalogueSample {
  name: string;
  title: string;
  spec: ReportChartSpec;
  tests: Array<Record<string, unknown>>;
  owner: string;
  titles?: Record<string, string>;
}

const base = { v: 1 as const, refBand: true, showValues: true, size: 'full' as const, yMin: null, yMax: null, thresholds: [] };
const URINE_SPEC: ReportChartSpec = {
  ...base, kind: 'stackedArea', x: 'series',
  lines: [{ unit: 'mg', match: 'albumin', label: 'Albumin' }, { unit: 'mg', match: 'other', label: 'Other protein' }],
  xLabels: { '0': '0–4 h', '240': '4–8 h', '480': '8–12 h', '720': '12–24 h' },
};
const WBC_SPEC: ReportChartSpec = { ...base, kind: 'pie', x: 'parameters', parameters: WBC_PCT };
const insulin = { secondLine: [8, 62, 74, 48, 22] };

export const CATALOGUE_SAMPLES: CatalogueSample[] = [
  { name: 'line', title: 'Glucose tolerance curve', owner: 'zogtt', spec: { ...OGTT_SPEC, kind: 'line' }, tests: ogttTests([118, 205, 232, 190, 162]) },
  { name: 'smooth', title: 'Glucose tolerance curve', owner: 'zogtt', spec: { ...OGTT_SPEC, kind: 'smooth' }, tests: ogttTests([88, 142, 128, 112, 104]) },
  { name: 'step', title: 'Glucose tolerance curve', owner: 'zogtt', spec: { ...OGTT_SPEC, kind: 'step' }, tests: ogttTests([94, 171, 158, 139, 126]) },
  { name: 'area', title: 'Glucose tolerance curve', owner: 'zogtt', spec: { ...OGTT_SPEC, kind: 'area' }, tests: ogttTests([88, 152, 168, 139, 121]) },
  { name: 'stacked-area', title: 'Urine protein by collection period', owner: 'zupro', spec: URINE_SPEC,
    tests: urineProteinTests([38, 52, 30, 95], [62, 70, 48, 140]) },
  { name: 'bar', title: 'Lipid fractions', owner: 'zlipid', spec: LIPID_SPEC, tests: [lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 })], titles: LIPID_TITLES },
  { name: 'hbar', title: 'Lipid fractions', owner: 'zlipid', spec: { ...LIPID_SPEC, kind: 'hbar' },
    tests: [lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 })], titles: LIPID_TITLES },
  { name: 'grouped-bar', title: 'WBC differential', owner: 'zdiff', titles: WBC_TITLES,
    spec: { ...base, kind: 'groupedBar', x: 'parameters', parameters: WBC_PCT, mainLabel: 'Percent',
      sets: [{ label: 'Absolute', parameters: WBC_ABS }] },
    tests: [wbcDiffTest({ neu: 78, lym: 15, mono: 5, eos: 1.5, baso: 0.5 }, { neu: 8.6, lym: 1.65, mono: 0.55, eos: 0.17, baso: 0.06 })] },
  { name: 'stacked-bar', title: 'Urine protein by collection period', owner: 'zupro', spec: { ...URINE_SPEC, kind: 'stackedBar' },
    tests: urineProteinTests([38, 52, 30, 95], [62, 70, 48, 140]) },
  { name: 'combo', title: 'Glucose and insulin response', owner: 'zogtt',
    spec: { ...OGTT_SPEC, kind: 'combo', lines: [{ unit: 'mg/dL', label: 'Glucose' }, { unit: 'µIU/mL', label: 'Insulin' }] },
    tests: ogttTests([96, 178, 164, 141, 122], insulin) },
  { name: 'dots', title: 'Glucose tolerance curve', owner: 'zogtt', spec: { ...OGTT_SPEC, kind: 'dots' }, tests: ogttTests([92, 168, null, 131, 118]) },
  { name: 'pie', title: 'WBC differential', owner: 'zdiff', titles: WBC_TITLES, spec: WBC_SPEC,
    tests: [wbcDiffTest({ neu: 78, lym: 15, mono: 5, eos: 1.5, baso: 0.5 })] },
  { name: 'donut', title: 'WBC differential', owner: 'zdiff', titles: WBC_TITLES, spec: { ...WBC_SPEC, kind: 'donut' },
    tests: [wbcDiffTest({ neu: 62, lym: 28, mono: 6, eos: 3, baso: 1 })] },
  { name: 'donut-counts', title: 'WBC differential (absolute counts)', owner: 'zdiff', titles: WBC_TITLES,
    spec: { ...WBC_SPEC, kind: 'donut', parameters: WBC_ABS },
    tests: [wbcDiffTest({ neu: 78, lym: 15, mono: 5, eos: 1.5, baso: 0.5 }, { neu: 8.6, lym: 1.65, mono: 0.55, eos: 0.17, baso: 0.06 })] },
  { name: 'radar', title: 'Liver panel', owner: 'zlft', titles: LFT_TITLES,
    spec: { ...base, kind: 'radar', x: 'parameters', parameters: ['alt', 'ast', 'alp', 'ggt', 'bilirubin_total', 'albumin'] },
    tests: [liverTest({ alt: 96, ast: 71, alp: 128, ggt: 88, bil: 1.6, alb: 3.8 })] },
  { name: 'gauge', title: 'HbA1c', owner: 'zhba1c', titles: HBA1C_TITLES,
    spec: { ...base, kind: 'gauge', x: 'parameters', parameters: ['hba1c'],
      thresholds: [{ value: 5.7, label: 'Prediabetes 5.7' }, { value: 6.5, label: 'Diabetes 6.5' }] },
    tests: [hba1cTest(7.8)] },
];
