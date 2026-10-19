import { LIPID_SPEC, OGTT_SPEC, buildChartReport, lipidTest, ogttTests, textRuns, type Run } from './report-chart.spec-helpers';

/**
 * Report charts in the real PDF (buildReportPdf): the chart is VECTOR (its
 * labels are text runs in the content stream, no image), it prints the
 * snapshot's values, and it is never split across pages.
 */
const chartRuns = (runs: Run[], title: string): Run[] => {
  const t = runs.find(r => r.text === title);
  if (!t) return [];
  // Everything from the title down to the chart's last x label on that page.
  return runs.filter(r => r.page === t.page && r.top >= t.top - 1 && r.top <= t.top + 260);
};

describe('report chart — PDF', () => {
  it('prints an OGTT curve under the profile: title, time points, values, thresholds', () => {
    const doc = buildChartReport({ tests: ogttTests([92, 168, 155, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC });
    const runs = textRuns(doc);
    const chart = chartRuns(runs, 'Zglucose curve');
    const texts = chart.map(r => r.text);
    expect(texts).toEqual(expect.arrayContaining(['Zglucose curve', 'Fasting', '30 min', '60 min', '90 min', '120 min',
      '92', '168', '155', '131', '118', 'mg/dL', 'Normal range']));
    // Threshold labels — "≥" is drawn from the Symbol font (its own run, \263).
    const joined = texts.join('');
    expect(joined).toMatch(/IGT (≥|³|\\263) 140/);
    expect(joined).toMatch(/Diabetes (≥|³|\\263) 200 at 2 h/);
  });

  it('is drawn as vectors, not an embedded image', () => {
    const doc = buildChartReport({ tests: ogttTests([92, 168, 155, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC });
    const out = doc.output();
    expect(out).not.toMatch(/\/Subtype \/Image/);
  });

  it('a diabetic pattern marks the abnormal points (value + H)', () => {
    const doc = buildChartReport({ tests: ogttTests([128, 232, 268, 251, 224]), chartOwner: 'zogtt', spec: OGTT_SPEC });
    const texts = chartRuns(textRuns(doc), 'Zglucose curve').map(r => r.text);
    expect(texts).toEqual(expect.arrayContaining(['128 H', '232 H', '268 H', '251 H', '224 H']));
  });

  it('a missed time point prints "not measured" and the note', () => {
    const doc = buildChartReport({ tests: ogttTests([92, 168, null, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC });
    const texts = chartRuns(textRuns(doc), 'Zglucose curve').map(r => r.text);
    expect(texts).toContain('not measured');
    expect(texts).toContain('Not measured: 60 min.');
  });

  it('a lipid bar chart (not a series) prints its chosen values', () => {
    const doc = buildChartReport({ tests: [lipidTest({ tc: 232, hdl: 36, ldl: 150, vldl: 28, tg: 142 })], chartOwner: 'zlipid',
      spec: LIPID_SPEC, title: 'Zlipid fractions' });
    const texts = chartRuns(textRuns(doc), 'Zlipid fractions').map(r => r.text);
    expect(texts).toEqual(expect.arrayContaining(['Zlipid fractions', 'Total Cholesterol', 'HDL Cholesterol', 'Triglycerides',
      '232 H', '36 L', '28', '142']));
  });

  it('a hidden chart (print off) prints nothing', () => {
    const doc = buildChartReport({ tests: ogttTests([92, 168, 155, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC, hidden: true });
    expect(textRuns(doc).some(r => r.text === 'Zglucose curve')).toBe(false);
  });

  it('is never split across pages, wherever the page break falls', () => {
    let moved = 0;
    for (let fillers = 0; fillers <= 40; fillers += 2) {
      const doc = buildChartReport({ tests: ogttTests([92, 168, 155, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC, fillers });
      const runs = textRuns(doc);
      const title = runs.find(r => r.text === 'Zglucose curve');
      expect(title, `fillers=${fillers}`).toBeTruthy();
      const last = runs.find(r => r.text === 'Not measured' || r.text === '120 min');
      expect(last!.page, `fillers=${fillers}`).toBe(title!.page);
      // The whole block sits above the footer band.
      for (const r of runs.filter(r => r.page === title!.page && ['Fasting', '120 min', '92', '118'].includes(r.text))) {
        expect(r.top).toBeLessThan(841.89 - 40);
      }
      if (title!.page > 1) moved++;
    }
    expect(moved).toBeGreaterThan(0);          // the sweep really crossed a page break
  });

  it('a report with no chart block is unchanged (no chart text)', () => {
    const doc = buildChartReport({ tests: ogttTests([92, 168, 155, 131, 118]), chartOwner: 'zogtt', spec: OGTT_SPEC, hidden: true });
    const texts = textRuns(doc).map(r => r.text);
    expect(texts).not.toContain('Normal range');
    expect(texts).not.toContain('Fasting');
  });
});
