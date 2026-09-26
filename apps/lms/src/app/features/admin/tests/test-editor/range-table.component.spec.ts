import { TestBed } from '@angular/core/testing';
import { RangeTableComponent, ageOf, ageWords, naturalAge, ageToYears } from './range-table.component';
import type { InsightBand, InsightParam } from '../../../../shared/utils/range-insight';

function make(param: InsightParam, opts: { unit?: string; phone?: boolean } = {}) {
  TestBed.configureTestingModule({});
  const f = TestBed.createComponent(RangeTableComponent);
  const emitted: InsightBand[][] = [];
  f.componentRef.setInput('param', param);
  f.componentRef.setInput('unit', opts.unit ?? 'g/dL');
  f.componentInstance.phone.set(!!opts.phone);
  f.componentInstance.bandsChange.subscribe(b => {
    emitted.push(b);
    f.componentRef.setInput('param', { ...f.componentInstance.param()!, referenceRanges: b });
  });
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const rowEls = () => [...el.querySelectorAll<HTMLTableRowElement>('tbody tr.rtb__row')];
  /** One row as the eye reads it: age · normal from · normal to · crit below · crit above. */
  const read = (i = 0) => {
    const tr = rowEls()[i];
    const v = (label: string) => (tr.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null)?.value ?? null;
    return [tr.querySelector('.rtb__agebtn span')!.textContent!.trim(),
      v('Normal from'), v('Normal to'), v('Critical below'), v('Critical above')];
  };
  const type = (label: string, value: string, i = 0) => {
    const inp = rowEls()[i].querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    inp.value = value;
    inp.dispatchEvent(new Event('change'));
    f.detectChanges();
  };
  return { f, el, c: f.componentInstance, emitted, rowEls, read, type };
}

/** Haemoglobin (HEM011-like): six groups, days / years mixed, one legacy bad row. */
const HB: InsightBand[] = [
  { segment: 'newborn', sex: 'any', minAge: 0, maxAge: 0.0767, ageUnit: 'years', min: 14, max: 22, criticalLow: 7, criticalHigh: 20 },
  { segment: 'infant', sex: 'any', minAge: 0.0767, maxAge: 1, ageUnit: 'years', min: 9.5, max: 13.5, criticalLow: 7 },
  { segment: 'child', sex: 'any', minAge: 1, maxAge: 12, ageUnit: 'years', min: 11, max: 14.5 },
  { segment: 'teen', sex: 'any', minAge: 12, maxAge: 18, ageUnit: 'years', min: 12, max: 16 },
  { segment: 'adult_male', sex: 'M', minAge: 18, ageUnit: 'years', min: 13, max: 17, criticalLow: 7, criticalHigh: 20 },
  { segment: 'adult_female', sex: 'F', minAge: 18, ageUnit: 'years', min: 12, max: 16, criticalLow: 7, criticalHigh: 20 },
];

describe('pf-range-table — one compact table, one row per group', () => {
  it('builds ONE row per group from existing ranges (multi-band Haemoglobin)', () => {
    const { el, read, rowEls, c } = make({ unit: 'g/dL', referenceRanges: HB });
    expect(el.querySelectorAll('table.rtb__table')).toHaveLength(1);
    expect(rowEls()).toHaveLength(6);
    expect(read(0)).toEqual(['0–28 days', '14', '22', '7', '20']);
    expect(read(1)).toEqual(['28 days – 1 year', '9.5', '13.5', '7', '']);
    expect(read(2)).toEqual(['1–12 years', '11', '14.5', '', '']);
    expect(read(4)).toEqual(['18 years+', '13', '17', '7', '20']);
    expect(c.rows().map(r => r.who)).toEqual(['Anyone', 'Anyone', 'Anyone', 'Anyone', 'Male', 'Female']);
    expect(rowEls()[5].getAttribute('data-who')).toBe('Female · 18 years+');
    // No Low / High rows to type — they are derived from Normal.
    expect(el.textContent).not.toMatch(/Critical low|Result is/);
    // Unit once, in the Normal range header.
    expect(el.querySelectorAll('.rtb__unit')).toHaveLength(1);
    expect(el.querySelector('thead .rtb__unit')!.textContent).toBe('g/dL');
  });

  it('age units: fractional years display naturally, and edits convert back', () => {
    expect(naturalAge(0.0767)).toEqual({ n: 28, unit: 'days' });
    expect(naturalAge(0.5)).toEqual({ n: 6, unit: 'months' });
    expect(naturalAge(18)).toEqual({ n: 18, unit: 'years' });
    expect(ageWords({ n: 1, unit: 'months' }, { n: 12, unit: 'months' })).toBe('1–12 months');
    expect(ageWords({ n: 18, unit: 'years' }, null)).toBe('18 years+');
    expect(ageWords(null, null)).toBe('Any age');
    expect(ageOf({ minAge: 0, maxAge: 28, ageUnit: 'days' })).toEqual({ from: { n: 0, unit: 'days' }, to: { n: 28, unit: 'days' } });
    expect(ageToYears({ n: 6, unit: 'months' })).toBe(0.5);

    const { c, emitted, f, el } = make({ unit: 'g/dL', referenceRanges: HB });
    // Newborn 0–28 days → "to" 30: stored in days now (one unit both sides).
    c.toggleAge(0); f.detectChanges();
    const to = el.querySelector('input[aria-label="Age to"]') as HTMLInputElement;
    expect(to.value).toBe('28');
    to.value = '30'; to.dispatchEvent(new Event('change')); f.detectChanges();
    expect(emitted.at(-1)![0]).toEqual({ ...HB[0], minAge: 0, maxAge: 30, ageUnit: 'days' });
    // Mixed "28 days – 1 year" → to 2 years: stays years; the untouched "from" keeps its exact stored value.
    c.setAgeSide(c.rows()[1], 'to', '2', null);
    expect(emitted.at(-1)![1]).toEqual({ ...HB[1], minAge: 0.0767, maxAge: 2, ageUnit: 'years' });
    // A preset: Infant 1–12 months.
    c.setAge(2, { n: 1, unit: 'months' }, { n: 12, unit: 'months' });
    expect(emitted.at(-1)![2]).toMatchObject({ minAge: 1, maxAge: 12, ageUnit: 'months' });
    expect(c.rows()[2].age.text).toBe('1–12 months');
    // Blank "to" = and over.
    c.setAgeSide(c.rows()[3], 'to', '', null);
    expect(emitted.at(-1)![3]).toMatchObject({ minAge: 12, maxAge: null, ageUnit: 'years' });
    expect(c.rows()[3].age.text).toBe('12 years+');
  });

  it('untouched data is never rewritten; an edit changes only its own field', () => {
    const odd: InsightBand = { segment: 'adult_male', sex: 'M', minAge: 18, min: 13, max: 17, label: 'Adult Male', profileCode: 'X', unit: 'g/dL', maxOp: 'lte' };
    const { type, emitted } = make({ unit: 'g/dL', referenceRanges: [odd, HB[5]] });
    expect(emitted).toEqual([]);
    type('Normal to', '17');                              // same value → nothing emitted
    expect(emitted).toEqual([]);
    type('Normal to', '17.5');
    expect(emitted.at(-1)).toEqual([{ ...odd, max: 17.5 }, HB[5]]);
    expect(emitted.at(-1)![1]).toBe(HB[5]);              // the other band is the SAME object
    type('Normal to', 'abc');                             // not a number → nothing stored
    expect(emitted).toHaveLength(1);
    type('Normal to', '');                                // cleared → its ≤ goes with it
    expect(emitted.at(-1)![0]).toEqual({ ...odd, max: null, maxOp: null });
    type('Critical above', '21', 1);
    expect(emitted.at(-1)![1]).toEqual({ ...HB[5], criticalHigh: 21 });
  });

  it('validation is gentle: pre-existing bad data is a quiet icon, a NEW error is red on its row', () => {
    const { el, rowEls, type, c, f } = make({ unit: 'g/dL', referenceRanges: HB });
    // HEM011 newborn: critical above 20 sits inside Normal 14–22 — legacy, not shouted.
    expect(el.querySelectorAll('.rtb__msg')).toHaveLength(0);
    expect(el.querySelectorAll('.rtb__in--err')).toHaveLength(0);
    expect(rowEls()[0].querySelector('.rtb__warn')!.getAttribute('aria-label')).toMatch(/Saved like this before/);
    // A new mistake on another row is named on that row, with red boxes.
    type('Critical below', '12', 2);
    expect(c.rows()[2].error!.text).toBe('Critical below (12) can’t be inside Normal — make it 11 or less.');
    expect(el.querySelectorAll('.rtb__msg')).toHaveLength(1);
    expect([...rowEls()[2].querySelectorAll('.rtb__in--err')].map(i => i.getAttribute('aria-label')))
      .toEqual(['Normal from', 'Critical below']);
    // Removing a group above keeps the legacy row quiet (baseline shifts).
    c.removeBand(1); f.detectChanges();
    expect(c.rows()[0].error).toBeNull();
    expect(c.rows()[0].quiet.length).toBeGreaterThan(0);
  });

  it('text normals get a "Normal value" field in place of the numbers', () => {
    const { el, emitted } = make({ unit: '', referenceRanges: [{ segment: 'n', label: 'Negative' }] });
    const inp = el.querySelector('input[aria-label="Normal value"]') as HTMLInputElement;
    expect(inp.value).toBe('Negative');
    expect(el.querySelector('input[aria-label="Normal from"]')).toBeNull();
    inp.value = 'Non-reactive'; inp.dispatchEvent(new Event('change'));
    expect(emitted.at(-1)).toEqual([{ segment: 'n', label: 'Non-reactive' }]);
  });

  it('add / remove group', () => {
    const { el, emitted, rowEls, f } = make({ unit: 'g/dL', referenceRanges: [HB[5]] });
    (el.querySelector('tfoot .rtb__add') as HTMLButtonElement).click(); f.detectChanges();
    expect(rowEls()).toHaveLength(2);
    expect(emitted.at(-1)![1]).toEqual({ segment: 'normal', sex: 'any', min: 12, max: 16, criticalLow: 7, criticalHigh: 20 });
    (rowEls()[0].querySelector('.rtb__rm') as HTMLButtonElement).click(); f.detectChanges();
    expect(emitted.at(-1)).toHaveLength(1);
    expect(rowEls()).toHaveLength(1);
  });

  it('who: Anyone / Male / Female writes the band sex (a segment-only age is carried over)', () => {
    const { c, emitted } = make({ unit: 'g/dL', referenceRanges: [{ segment: 'Adult 18-60 years', min: 12, max: 16 }] });
    expect(c.rows()[0].age.text).toBe('18–60 years');
    c.setSex(0, 'F');
    expect(emitted.at(-1)![0]).toEqual({ segment: 'Adult 18-60 years', min: 12, max: 16, sex: 'F', minAge: 18, maxAge: 60, ageUnit: 'years' });
    expect(c.rows()[0].age.text).toBe('18–60 years');
  });

  it('criticals set once for the whole test show as a placeholder, not a value', () => {
    const { rowEls, el } = make({ unit: 'x', criticalLow: 5, referenceRanges: [{ segment: 'n', min: 10, max: 20 }] });
    const inp = rowEls()[0].querySelector('input[aria-label="Critical below"]') as HTMLInputElement;
    expect(inp.value).toBe('');
    expect(inp.placeholder).toBe('5');
    expect(el.textContent).toContain('Grey critical limits are set once for the whole test.');
  });

  it('try a value: one line — the flag production would give', () => {
    const { c, f, el } = make({ unit: 'g/dL', referenceRanges: HB });
    c.tryText.set('6'); c.trySex.set('F'); c.tryAge.set('35'); f.detectChanges();
    expect(el.querySelector('.rtb__vtext')!.textContent!.trim()).toBe('Critical low');
    c.tryText.set('12.5'); c.trySex.set('M'); f.detectChanges();
    expect(el.querySelector('.rtb__vtext')!.textContent!.trim()).toBe('Low');
    c.tryText.set('16'); c.tryAge.set('10'); c.tryUnit.set('days'); f.detectChanges();   // a newborn
    expect(el.querySelector('.rtb__vtext')!.textContent!.trim()).toBe('Normal');
  });

  it('phones: one compact card per group; tap to edit', () => {
    const { el, f, emitted } = make({ unit: 'g/dL', referenceRanges: [HB[5], { segment: 'n', max: 200 }] }, { phone: true });
    expect(el.querySelector('table')).toBeNull();
    const cards = [...el.querySelectorAll('.rtb__card')];
    expect(cards.map(c => c.querySelector('.rtb__l1')!.textContent!.trim())).toEqual(['Female · 18 years+', 'Anyone · Any age']);
    expect(cards.map(c => c.querySelector('.rtb__l2')!.textContent!.trim().replace(/\u00a0/g, ' '))).toEqual(['Normal 12 – 16 · Critical < 7 · > 20', 'Normal below 200']);
    (cards[0].querySelector('.rtb__cardhead') as HTMLButtonElement).click(); f.detectChanges();
    const body = el.querySelector('.rtb__card--open .rtb__cardbody')!;
    const inputs = body.querySelectorAll<HTMLInputElement>('.rtb__grid2 input');
    expect(inputs).toHaveLength(4);
    inputs[1].value = '15.5'; inputs[1].dispatchEvent(new Event('change')); f.detectChanges();
    expect(emitted.at(-1)![0]).toEqual({ ...HB[5], max: 15.5 });
  });
});
