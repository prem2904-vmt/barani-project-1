import { TestBed } from '@angular/core/testing';
import { ReportChartEditorComponent } from './report-chart-editor.component';
import type { ChartEditorContext } from '../../../shared/utils/report-chart/report-chart.sample';
import type { ReportChartSpec } from '../../../shared/utils/report-chart/report-chart.model';

const SERIES: ChartEditorContext = {
  ownerId: 'ogtt', series: true, params: [],
  timepoints: [0, 30, 60, 90, 120].map(o => ({ offsetMin: o, members: [{ testId: 't' + o, name: o ? `OGTT – ${o} Minutes` : 'Fasting Plasma Glucose',
    params: [{ name: 'G' + o, unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: o ? null : 70, max: o ? 140 : 99 }] }] }] })),
};
const DIFF: ChartEditorContext = {
  ownerId: 'diff', series: false, timepoints: [],
  params: [
    ...['neutrophils', 'lymphocytes', 'monocytes'].map(n => ({ name: n + '_pct', title: n, unit: '%', referenceRanges: [{ sex: 'any' as const, min: 10, max: 60 }] })),
    ...['neutrophils', 'lymphocytes', 'monocytes'].map(n => ({ name: n + '_abs', title: 'Abs ' + n, unit: '10³/µL', referenceRanges: [{ sex: 'any' as const, min: 1, max: 5 }] })),
  ],
};
const SERIES2: ChartEditorContext = {
  ...SERIES_BASE(),
};
function SERIES_BASE(): ChartEditorContext {
  return { ownerId: 'ogtt', series: true, params: [], timepoints: [0, 60, 120].map(o => ({ offsetMin: o, members: [{ testId: 't' + o, name: 'T' + o,
    params: [{ name: 'Glucose', unit: 'mg/dL', referenceRanges: [{ sex: 'any' as const, max: 140 }] }, { name: 'Insulin', unit: 'µIU/mL', referenceRanges: [{ sex: 'any' as const, max: 25 }] }] }] })) };
}
const LIPID: ChartEditorContext = {
  ownerId: 'lipid', series: false, timepoints: [],
  params: ['total_cholesterol', 'hdl', 'ldl'].map(n => ({ name: n, title: n.toUpperCase(), unit: 'mg/dL', referenceRanges: [{ sex: 'any', max: 200 }] })),
};

/** Every value in its own unit: never parts of one whole. */
const MIXED: ChartEditorContext = {
  ownerId: 'lft', series: false, timepoints: [],
  params: [{ name: 'alt', unit: 'U/L' }, { name: 'bil', unit: 'mg/dL' }, { name: 'alb', unit: 'g/dL' }],
};
/** Absolute counts only (no %): a pie of the counts. */
const COUNTS: ChartEditorContext = {
  ownerId: 'diff', series: false, timepoints: [],
  params: [
    ...DIFF.params.filter(p => p.unit !== '%'),
    { name: 'base_excess', unit: 'mmol/L', referenceRanges: [{ sex: 'any' as const, min: -2, max: 2 }] },
    { name: 'hb', unit: 'g/dL' },
  ],
};

function make(ctx: ChartEditorContext, value: unknown) {
  TestBed.configureTestingModule({ imports: [ReportChartEditorComponent] });
  const f = TestBed.createComponent(ReportChartEditorComponent);
  f.componentRef.setInput('context', ctx);
  f.componentRef.setInput('value', value);
  f.componentRef.setInput('title', 'Glucose curve');
  const emitted: ReportChartSpec[] = [];
  f.componentInstance.specChange.subscribe(s => emitted.push(s));
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, emitted };
}

describe('pf-report-chart-editor (Test Master chart block)', () => {
  it('previews a time-point chart from sample values, drawn as SVG', () => {
    const { el, f } = make(SERIES, { v: 1, kind: 'line', x: 'series' });
    expect(f.componentInstance.preview()!.xLabels).toEqual(['Fasting', '30 min', '60 min', '90 min', '120 min']);
    expect(el.querySelector('pf-report-chart svg')).toBeTruthy();
    expect(el.querySelectorAll('.rce__tp').length).toBe(5);
  });

  it('switching the type emits the whole normalised spec', () => {
    const { el, emitted } = make(SERIES, { v: 1, kind: 'line', x: 'series' });
    const bar = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Chart type"] .rce__kind')].find(b => b.querySelector('.rce__kname')?.textContent?.trim() === 'Bar')!;
    bar.click();
    expect(emitted.at(-1)).toMatchObject({ v: 1, kind: 'bar', x: 'series', refBand: true });
  });

  it('time points are unavailable for a test that is not a series', () => {
    const { el } = make(LIPID, { v: 1, kind: 'bar', x: 'parameters', parameters: ['hdl'] });
    const tp = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="X axis"] .nd-seg__item')].find(b => /Time points/.test(b.textContent ?? ''))!;
    expect(tp.disabled).toBe(true);
  });

  it('ticking a value keeps the test\'s own order', () => {
    const { f, emitted } = make(LIPID, { v: 1, kind: 'bar', x: 'parameters', parameters: ['ldl'] });
    f.componentInstance.toggleParam('total_cholesterol');
    expect(emitted.at(-1)!.parameters).toEqual(['total_cholesterol', 'ldl']);
  });

  it('adds a threshold line and ignores a non-number value edit', () => {
    const { f, emitted } = make(SERIES, { v: 1, kind: 'line', x: 'series', thresholds: [{ value: 140, label: 'IGT' }] });
    f.componentInstance.setThreshold(0, { value: 'abc' });
    expect(emitted).toHaveLength(0);
    f.componentInstance.setThreshold(0, { value: '200' });
    expect(emitted.at(-1)!.thresholds).toEqual([{ value: 200, label: 'IGT' }]);
  });

  it('shows a card for every chart type; the ones that do not fit are disabled with a one-line reason, listed last', () => {
    const { el } = make(MIXED, { v: 1, kind: 'bar', x: 'parameters', parameters: ['alt', 'bil'] });
    const cards = [...el.querySelectorAll<HTMLButtonElement>('.rce__kind')];
    expect(cards).toHaveLength(15);
    const pie = cards.find(c => c.querySelector('.rce__kname')?.textContent?.trim() === 'Pie')!;
    expect(pie.disabled).toBe(true);
    expect(pie.querySelector('.rce__kwhy')?.textContent).toMatch(/Parts of a whole/);
    const firstOff = cards.findIndex(c => c.disabled);
    expect(cards.slice(firstOff).every(c => c.disabled)).toBe(true);
    expect(cards.every(c => c.querySelector('pf-report-chart svg'))).toBe(true);     // a live thumbnail each
  });

  it('a gauge keeps one value; a pie only the % values; grouped bars pair each % with its absolute count', () => {
    const { f, emitted } = make(DIFF, { v: 1, kind: 'bar', x: 'parameters', parameters: ['neutrophils_pct', 'lymphocytes_pct', 'neutrophils_abs'] });
    f.componentInstance.setKind('gauge');
    expect(emitted.at(-1)).toMatchObject({ kind: 'gauge', parameters: ['neutrophils_pct'] });
    f.componentInstance.setKind('pie');
    expect(emitted.at(-1)).toMatchObject({ kind: 'pie', parameters: ['neutrophils_pct', 'lymphocytes_pct'] });
    f.componentRef.setInput('value', { v: 1, kind: 'bar', x: 'parameters', parameters: ['neutrophils_pct', 'lymphocytes_pct', 'monocytes_pct'] });
    f.componentInstance.setKind('groupedBar');
    expect(emitted.at(-1)!.sets).toEqual([{ label: '10³/µL', parameters: ['neutrophils_abs', 'lymphocytes_abs', 'monocytes_abs'] }]);
  });

  it('a pie of COUNTS: offered when 2+ values share one unit; ticks stay in that unit; the preview prints each share', () => {
    const { f, el, emitted } = make(COUNTS, { v: 1, kind: 'bar', x: 'parameters', parameters: ['hb', 'neutrophils_abs'] });
    const pie = [...el.querySelectorAll<HTMLButtonElement>('.rce__kind')].find(c => c.querySelector('.rce__kname')?.textContent?.trim() === 'Pie')!;
    expect(pie.disabled).toBe(false);
    f.componentInstance.setKind('pie');
    expect(emitted.at(-1)).toMatchObject({ kind: 'pie', parameters: ['neutrophils_abs', 'lymphocytes_abs', 'monocytes_abs'] });
    f.componentRef.setInput('value', emitted.at(-1));
    f.detectChanges();
    const c = f.componentInstance;
    expect(c.canPick({ name: 'lymphocytes_abs', unit: '10³/µL' })).toBe(true);
    expect(c.canPick({ name: 'hb', unit: 'g/dL' })).toBe(false);                 // another unit
    expect(c.canPick({ name: 'base_excess', unit: 'mmol/L' })).toBe(false);      // can be negative
    expect(el.textContent).toMatch(/% or counts/);
    const txt = [...el.querySelectorAll('.rce__preview pf-report-chart text, pf-report-chart text')].map(t => t.textContent);
    expect(txt).toContain('Share');
  });

  it('the % path is kept: a pie on a test with % and counts takes the % values', () => {
    const { f, emitted } = make(DIFF, { v: 1, kind: 'bar', x: 'parameters', parameters: ['neutrophils_abs'] });
    f.componentInstance.setKind('pie');
    expect(emitted.at(-1)!.parameters).toEqual(['neutrophils_pct', 'lymphocytes_pct', 'monocytes_pct']);
    f.componentRef.setInput('value', { v: 1, kind: 'bar', x: 'parameters', parameters: ['neutrophils_abs', 'lymphocytes_abs', 'neutrophils_pct'] });
    f.componentInstance.setKind('donut');                                     // 2+ counts chosen: kept
    expect(emitted.at(-1)!.parameters).toEqual(['neutrophils_abs', 'lymphocytes_abs']);
  });

  it('over time points, a combination chart gets its second line (the other unit)', () => {
    const { f, emitted } = make(SERIES2, { v: 1, kind: 'line', x: 'series' });
    f.componentInstance.setKind('combo');
    expect(emitted.at(-1)).toMatchObject({ kind: 'combo', lines: [{ unit: 'mg/dL' }, { unit: 'µIU/mL' }] });
  });

  it('a disabled type cannot be chosen', () => {
    const { f, emitted } = make(SERIES, { v: 1, kind: 'line', x: 'series' });
    f.componentInstance.setKind('pie');
    f.componentInstance.setKind('groupedBar');       // one value per time point
    expect(emitted).toHaveLength(0);
  });
});
