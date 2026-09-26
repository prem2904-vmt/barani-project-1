import { TestBed } from '@angular/core/testing';
import { RangeTableComponent } from './range-table.component';
import type { InsightBand, InsightParam } from '../../../../shared/utils/range-insight';

function make(param: InsightParam, unit = 'g/dL') {
  TestBed.configureTestingModule({});
  const f = TestBed.createComponent(RangeTableComponent);
  const emitted: InsightBand[][] = [];
  f.componentRef.setInput('param', param);
  f.componentRef.setInput('unit', unit);
  f.componentInstance.bandsChange.subscribe(b => {
    emitted.push(b);
    f.componentRef.setInput('param', { ...f.componentInstance.param()!, referenceRanges: b });
  });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rows = (band = 0) => [...el.querySelectorAll('.rtb__band')[band].querySelectorAll('tbody tr:not(.rtb__msgrow)')].map(tr => {
    const cells = tr.querySelectorAll('td');
    const txt = (td: Element) => (td.querySelector('input') as HTMLInputElement | null)?.value ?? td.textContent!.trim();
    return [tr.querySelector('th')!.textContent!.trim(), txt(cells[0]), txt(cells[1])];
  });
  const type = (sel: string, value: string, band = 0) => {
    const inp = el.querySelectorAll('.rtb__band')[band].querySelector(sel) as HTMLInputElement;
    inp.value = value;
    inp.dispatchEvent(new Event('change'));
    f.detectChanges();
  };
  return { f, el, c: f.componentInstance, emitted, rows, type };
}

const women: InsightBand = { segment: 'f', sex: 'F', minAge: 18, ageUnit: 'years', min: 9.9, max: 14.3, criticalLow: 7, criticalHigh: 20 };

describe('pf-range-table — reference ranges as a plain interpretation table', () => {
  it('renders the five rows from an existing band, with the group and unit in the header', () => {
    const { el, rows } = make({ unit: 'g/dL', referenceRanges: [women] });
    expect(rows()).toEqual([
      ['Critical low', '—', '7'],
      ['Low', '7', '9.9'],
      ['Normal', '9.9', '14.3'],
      ['High', '14.3', '20'],
      ['Critical high', '20', '—'],
    ]);
    expect(el.querySelector('.rtb__unit')!.textContent).toBe('g/dL');
    expect(el.querySelector('.rtb__edges')!.textContent).toBe('Exactly on a limit: 7 is Low · 9.9 is Normal · 14.3 is Normal · 20 is High.');
    expect(el.querySelector('.rtb__band')!.getAttribute('aria-label')).toBe('Reference range for Women aged 18 years and over');
  });

  it('limits are LINKED: editing Low "to" moves Normal "from" (one stored value)', () => {
    const { rows, type, emitted } = make({ unit: 'g/dL', referenceRanges: [women] });
    type('input[aria-label="Low to"]', '10.5');
    expect(emitted.at(-1)![0]).toEqual({ ...women, min: 10.5 });
    expect(rows()[2]).toEqual(['Normal', '10.5', '14.3']);
    type('input[aria-label="High from"]', '15');
    expect(rows()[2]).toEqual(['Normal', '10.5', '15']);
    expect(emitted.at(-1)![0].max).toBe(15);
  });

  it('unused rows are hidden; "+ Add critical limits" brings them back, typing stores them', () => {
    const { el, rows, type, emitted, f } = make({ unit: 'x', referenceRanges: [{ segment: 'n', min: 4, max: 11 }] });
    expect(rows().map(r => r[0])).toEqual(['Low', 'Normal', 'High']);
    const add = [...el.querySelectorAll('.rtb__quiet')].find(b => b.textContent!.includes('Add critical limits')) as HTMLButtonElement;
    add.click(); f.detectChanges();
    expect(rows().map(r => r[0])).toEqual(['Critical low', 'Low', 'Normal', 'High', 'Critical high']);
    expect(emitted).toEqual([]);                        // nothing stored until a number is typed
    type('input[aria-label="Critical low to"]', '2');
    expect(emitted.at(-1)![0]).toEqual({ segment: 'n', min: 4, max: 11, criticalLow: 2 });
  });

  it('one-sided "below 140": Normal — to 140, High 140 to —; the edge rule sets the stored op', () => {
    const { el, rows, emitted, f } = make({ unit: 'mg/dL', referenceRanges: [{ segment: 'n', max: 140 }] });
    expect(rows()).toEqual([['Normal', '—', '140'], ['High', '140', '—']]);
    expect(el.querySelector('.rtb__edges')!.textContent).toBe('Exactly on a limit: 140 is High.');
    (([...el.querySelectorAll('.rtb__quiet')].find(b => b.textContent === 'Edge rule')) as HTMLButtonElement).click();
    f.detectChanges();
    (el.querySelector('.rtb__edge .rtb__segi') as HTMLButtonElement).click();   // "Normal"
    f.detectChanges();
    expect(emitted.at(-1)).toEqual([{ segment: 'n', max: 140, maxOp: 'lte' }]);
    expect(el.querySelector('.rtb__edges')!.textContent).toBe('Exactly on a limit: 140 is Normal.');
  });

  it('a written normal ("Negative") shows as "Normal value"', () => {
    const { el } = make({ unit: '', referenceRanges: [{ segment: 'n', label: 'Negative' }] });
    expect(el.querySelector('.rtb__textrow')!.textContent).toContain('Normal value');
    expect((el.querySelector('.rtb__in--text') as HTMLInputElement).value).toBe('Negative');
    expect(el.querySelector('.rtb__table')).toBeNull();
  });

  it('round-trip: untouched bands are never re-written; an edit changes only its own field', () => {
    const odd: InsightBand = { segment: 'adult_male', sex: 'M', minAge: 18, min: 13, max: 17, label: 'Adult Male', profileCode: 'X', unit: 'g/dL' };
    const { type, emitted } = make({ unit: 'g/dL', referenceRanges: [odd, women] });
    expect(emitted).toEqual([]);
    type('input[aria-label="Normal to"]', '17.5');
    expect(emitted.at(-1)).toEqual([{ ...odd, max: 17.5 }, women]);
  });

  it('validation speaks the table: a message on the row it concerns', () => {
    const { el } = make({ unit: 'x', referenceRanges: [{ segment: 'n', min: 3.5, max: 5, criticalHigh: 4 }] });
    const msgs = [...el.querySelectorAll('.rtb__msgrow')].map(m => m.textContent!.trim());
    expect(msgs).toEqual(['High must end above where it starts (5) — Critical high must start above Normal.']);
  });

  it('validation: Normal running backwards is named on the Normal row', () => {
    const { el } = make({ unit: 'x', referenceRanges: [{ segment: 'n', min: 11, max: 4 }] });
    expect(el.querySelector('.rtb__msgrow')!.textContent!.trim()).toBe('Normal must end above where it starts (11).');
  });

  it('try a value: one line — the flag production would give', () => {
    const { c, f, el } = make({ unit: 'g/dL', referenceRanges: [women, { segment: 'm', sex: 'M', minAge: 18, min: 12.3, max: 17 }] });
    c.tryText.set('6'); c.trySex.set('F'); c.tryAge.set('35'); f.detectChanges();
    expect(el.querySelector('.rtb__verdict')!.textContent).toBe('Critical low');
    c.tryText.set('12'); c.trySex.set('M'); f.detectChanges();
    expect(el.querySelector('.rtb__verdict')!.textContent).toBe('Low');
  });

  it('groups: who / age selects write the band; add + remove', () => {
    const { c, emitted } = make({ unit: 'g/dL', referenceRanges: [women] });
    c.setSex(0, 'M');
    expect(emitted.at(-1)![0].sex).toBe('M');
    c.setAge(0, 'child');
    expect(emitted.at(-1)![0]).toMatchObject({ minAge: 1, maxAge: 12, ageUnit: 'years' });
    c.addBand();
    expect(emitted.at(-1)!.length).toBe(2);
    c.removeBand(1);
    expect(emitted.at(-1)!.length).toBe(1);
  });
});
