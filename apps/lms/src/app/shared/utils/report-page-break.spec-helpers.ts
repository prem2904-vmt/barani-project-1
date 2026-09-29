import { buildReportPdf } from './report-pdf';
import { writeReportOption } from './report-header-layout';
import type { ResolvedReportLayout } from '../models/report-layout.model';

/**
 * Made-up report snapshots for the page-break specs: the SHAPE of the owner's
 * 2026-09-29 report (compact tests with tall multi-band reference ranges,
 * then profiles whose band lands near the foot of a page), with invented
 * names and values — never real patient data.
 */

export const PAGE_H = 841.89;

const col = (name: string, label: string, type: string, width: number) =>
  ({ id: 'c-' + name, name, label, order: 1, width, type, locked: false });
const COLS = [
  col('result', 'Result', 'result', 22), col('unit', 'Unit', 'unit', 14),
  col('range', 'Reference Range', 'range', 22), col('method', 'Methodology', 'method', 14),
];

/** A long multi-band reference, one band per line (the FBS/LDL shape). */
export const bands = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `Z${tag}${i} band ${i * 10}-${i * 10 + 9} units per litre`).join('\n');

export type FixtureTest = { id: string; name: string; range: string; profile?: string };

function layoutFor(t: FixtureTest): ResolvedReportLayout {
  return {
    testId: t.id, testName: t.name, departmentName: 'Biochemistry', columns: COLS, configured: true,
    sections: [{ id: 'g', type: 'grid', order: 1, isVisible: true, rows: [
      { id: 'r-' + t.id, parameterName: t.name, title: t.name, isMerged: false,
        cells: { result: '42', unit: 'mg/dL', range: t.range } },
    ] }],
  } as unknown as ResolvedReportLayout;
}

function snapTest(t: FixtureTest) {
  const prof = t.profile
    ? { packageTestId: t.profile, profileTestId: t.profile, packageType: 'profile',
        packageName: t.profile.toUpperCase(), profileName: t.profile.toUpperCase() }
    : { packageTestId: null };
  return {
    testId: t.id, name: t.name, department: 'Biochemistry', sampleType: 'Serum', method: 'Zmethod',
    result: { values: { [t.name]: { value: '42', flag: 'N', unit: 'mg/dL', range: t.range } } },
    ...prof,
  };
}

/** The owner's report, made up: two compact tests with tall ranges first,
 *  a lipid-like profile, then a vitamin-like profile of tall rows whose
 *  heading lands near the foot of a page. `fillers` moves the break;
 *  `shorts` nudges it one compact row at a time. */
export function fixture(fillers: number, vitamins = 5, shorts = 0): FixtureTest[] {
  const tests: FixtureTest[] = [
    { id: 'fbs', name: 'Zfirst Glucose', range: bands('FIRST', 4) },
    { id: 'pp', name: 'Zsecond Glucose', range: bands('SECOND', 4) },
  ];
  for (let i = 0; i < shorts; i++) tests.push({ id: 's' + i, name: `Zshort ${i}`, range: `ZSH${i}x0 band` });
  for (let i = 0; i < fillers; i++) tests.push({ id: 'l' + i, name: `Zlipid ${i}`, range: bands(`LIP${i}x`, 3), profile: 'lipidprof' });
  for (let i = 0; i < vitamins; i++) tests.push({ id: 'v' + i, name: `Zvitamin ${i}`, range: bands(`VIT${i}x`, 9), profile: 'vitprof' });
  return tests;
}

/** Only COMPACT single-analyte tests (no panel band anywhere), tall enough
 *  to spill over a page. */
export function compactFixture(n: number): FixtureTest[] {
  return Array.from({ length: n }, (_, i) => ({ id: 'c' + i, name: `Zsolo ${i}`, range: bands(`SOLO${i}x`, 5) }));
}

export function build(tests: FixtureTest[], opts: { letterpad?: boolean } = {}) {
  const snap = {
    type: 'final',
    patient: { displayName: 'Zpatient', age: 30, sex: 'M' },
    order: { id: 'o1', orderNumber: 'LAB-2609-000900', createdAt: '2026-09-29T06:00:00Z' },
    tests: tests.map(snapTest),
  };
  const layouts: Record<string, ResolvedReportLayout> = Object.fromEntries(tests.map(t => [t.id, layoutFor(t)]));
  for (const p of ['lipidprof', 'vitprof']) {
    layouts[p] = { testId: p, testName: p.toUpperCase(), departmentName: 'Biochemistry', columns: COLS, sections: [] } as unknown as ResolvedReportLayout;
  }
  const template = { metadata: writeReportOption({ metadata: null } as never, 'specimenLine', true) };
  return buildReportPdf({
    report: { id: 'r1', type: 'final', createdAt: '2026-09-29T06:10:00Z', data: JSON.stringify(snap) },
    template, resolvedLayouts: layouts, blankLetterhead: !!opts.letterpad,
  } as never);
}

export type Run = { page: number; text: string; x: number; top: number };

/** Every Tj text run with its page and TOP-down y (points), read back from
 *  the content streams (Standard-14 fonts write literal latin1 text). */
export function textRuns(doc: ReturnType<typeof build>): Run[] {
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
