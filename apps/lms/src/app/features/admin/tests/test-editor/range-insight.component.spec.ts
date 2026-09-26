import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { RangeInsightComponent } from './range-insight.component';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';

const WBC = {
  name: 'wbc', unit: '10³/µL',
  referenceRanges: [
    { segment: 'm', sex: 'M', min: 4, max: 11, criticalLow: 3.5, criticalHigh: 20 },
    { segment: 'f', sex: 'F', min: 4.5, max: 11, criticalHigh: 25 },
  ],
};

const SECTIONS = [
  { id: 'g', type: 'grid', order: 1, rows: [{ parameter_name: 'wbc', conditions: [
    { if: { parameter: 'wbc', operator: 'flag', value: 'critical_high' }, then: { cells: { description: 'Urgent — call the clinician' } } },
    { if: { parameter: 'wbc', operator: 'flag', value: 'high_any' }, then: { cells: { description: 'Raised' } } },
  ] }] },
  { id: 'p', type: 'paragraph', order: 2, template: 'Repeat in 2 weeks.', conditions: [
    { if: { parameter: 'wbc', operator: 'flag', value: 'high_only' }, then: { show: true } },
    { else: true, then: { show: false } },
  ] },
];

async function make() {
  TestBed.configureTestingModule({
    providers: [{ provide: ReportLayoutService, useValue: { getTestLayout: vi.fn(async () => ({ sections: SECTIONS })) } }],
  });
  const f = TestBed.createComponent(RangeInsightComponent);
  f.componentRef.setInput('param', WBC);
  f.componentRef.setInput('testId', 't1');
  f.componentRef.setInput('paramName', 'wbc');
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  return f;
}

describe('pf-range-insight — the range bar + try a value', () => {
  it('draws one bar per band with its zones, ticks and captions', async () => {
    const f = await make();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelectorAll('.rin__band').length).toBe(2);
    const first = el.querySelectorAll('.rin__band')[0];
    expect([...first.querySelectorAll('.rin__zone')].map(z => z.getAttribute('data-level')))
      .toEqual(['critical_low', 'low', 'normal', 'high', 'critical_high']);
    expect([...first.querySelectorAll('.rin__tick')].map(t => t.textContent!.trim())).toEqual(['≥ 3.5', '≥ 4', '> 11', '> 20']);
    expect(first.querySelector('.rin__cap')!.textContent).toContain('Below 3.5 10³/µL → Critical low');
    expect(el.querySelector('.rin__whotext')!.textContent).toContain('Men');
  });

  it('the tester picks the band by sex, flags like production and names the conditions that fire', async () => {
    const f = await make();
    const c = f.componentInstance;
    c.sex.set('F');
    c.valueText.set('22');
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(c.tried()!.bandIndex).toBe(1);
    expect(el.querySelector('.rin__flag')!.textContent!.trim()).toBe('High');
    expect(el.querySelector('.rin__band--on .rin__n')!.textContent).toContain('Range 2');
    expect(c.fired()).toEqual([
      { where: 'Description', what: 'says “Raised” (line 2).' },
      { where: 'Block 2 · Sentence “Repeat in 2 weeks.”', what: 'prints.' },
    ]);
    c.sex.set('M');
    f.detectChanges();
    expect(c.tried()!.level).toBe('critical_high');
    expect(c.fired()).toEqual([
      { where: 'Description', what: 'says “Urgent — call the clinician” (line 1).' },
      { where: 'Block 2 · Sentence “Repeat in 2 weeks.”', what: 'is hidden.' },
    ]);
    expect(el.querySelector('.rin__vtext')!.textContent).toContain('stored as C');
  });

  it('range errors sit under the band they belong to', async () => {
    const f = await make();
    f.componentRef.setInput('param', { ...WBC, referenceRanges: [{ segment: 'x', min: 11, max: 4 }] });
    f.detectChanges();
    const issue = (f.nativeElement as HTMLElement).querySelector('.rin__band .rin__issue--err');
    expect(issue!.textContent).toContain('Normal high: Normal to (4) is below Normal from (11).');
  });
});
