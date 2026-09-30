import { TestBed } from '@angular/core/testing';
import { ReportChartEditorComponent } from './report-chart-editor.component';
import type { ChartEditorContext } from '../../../shared/utils/report-chart/report-chart.sample';
import type { ReportChartSpec } from '../../../shared/utils/report-chart/report-chart.model';

const SERIES: ChartEditorContext = {
  ownerId: 'ogtt', series: true, params: [],
  timepoints: [0, 30, 60, 90, 120].map(o => ({ offsetMin: o, members: [{ testId: 't' + o, name: o ? `OGTT – ${o} Minutes` : 'Fasting Plasma Glucose',
    params: [{ name: 'G' + o, unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: o ? null : 70, max: o ? 140 : 99 }] }] }] })),
};
const LIPID: ChartEditorContext = {
  ownerId: 'lipid', series: false, timepoints: [],
  params: ['total_cholesterol', 'hdl', 'ldl'].map(n => ({ name: n, title: n.toUpperCase(), unit: 'mg/dL', referenceRanges: [{ sex: 'any', max: 200 }] })),
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
    const bar = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Chart type"] .nd-seg__item')].find(b => /Bar/.test(b.textContent ?? ''))!;
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
});
