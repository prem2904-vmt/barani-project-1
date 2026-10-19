import { buildChartData } from './report-chart.data';
import { LIPID_SPEC, LIPID_TITLES, OGTT_SPEC, buildChartReport, lipidTest, ogttTests, textRuns, type Run } from './report-chart.spec-helpers';

/**
 * Single source (ENGINEERING-RULES §1): the results table and the chart print
 * the SAME saved flag for the same result snapshot — the chart never judges a
 * value on its own, and adding a chart never takes a test's H / L off its
 * table row.
 */
function tableFlags(runs: Run[], names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const row = runs.find(r => r.text === n);
    if (!row) { out[n] = '?'; continue; }
    const same = runs.filter(r => r.page === row.page && Math.abs(r.top - row.top) < 2 && r.x > row.x);
    // The result cell prints "232 mg/dL  H" (or the letter as its own run).
    const letter = same.map(r => / (H|L)$|^(H|L)$/.exec(r.text.trim())).find(Boolean);
    out[n] = letter ? (letter[1] ?? letter[2]) : '';
  }
  return out;
}

describe('report chart — table and chart agree', () => {
  it('lipid: every value carries the same H / L in the table and on the chart', () => {
    const t = lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 });
    const doc = buildChartReport({ tests: [t], chartOwner: 'zlipid', spec: LIPID_SPEC, title: 'Zlipid fractions' });
    const runs = textRuns(doc);
    const chart = buildChartData(LIPID_SPEC, 't', 'zlipid', [t], LIPID_TITLES)!;
    const titles = LIPID_SPEC.parameters!.map(p => LIPID_TITLES[p]);
    const fromChart = Object.fromEntries(titles.map((n, i) => [n, chart.series[0].points[i].flag]));
    // The chart's own printed labels carry the letters too.
    const chartTexts = runs.filter(r => r.top > (runs.find(x => x.text === 'Zlipid fractions')?.top ?? 0)).map(r => r.text);
    expect(chartTexts).toEqual(expect.arrayContaining(['232 H', '36 L', '150 H', '28', '142']));
    expect(tableFlags(runs, titles)).toEqual(fromChart);
    expect(fromChart).toEqual({ 'Total Cholesterol': 'H', 'HDL Cholesterol': 'L', 'LDL Cholesterol': 'H', 'VLDL Cholesterol': '', Triglycerides: '' });
  });

  it('the chart marks only what the saved flag says (a value outside its band but saved N stays normal)', () => {
    const t = lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 });
    (t.result.values as Record<string, { flag: string }>)['total_cholesterol'].flag = 'N';
    const p = buildChartData(LIPID_SPEC, 't', 'zlipid', [t], LIPID_TITLES)!.series[0].points[0];
    expect(p).toMatchObject({ value: 232, flag: '', abnormal: false });
  });

  it('OGTT: the table rows and the curve agree', () => {
    const tests = ogttTests([132, 238, 176, 150, 131]);
    const runs = textRuns(buildChartReport({ tests, chartOwner: 'zogtt', spec: OGTT_SPEC }));
    const names = tests.map(t => t.name as string);
    const chart = buildChartData(OGTT_SPEC, 't', 'zogtt', tests)!;
    expect(tableFlags(runs, names)).toEqual(Object.fromEntries(names.map((n, i) => [n, chart.series[0].points[i].flag])));
  });
});
