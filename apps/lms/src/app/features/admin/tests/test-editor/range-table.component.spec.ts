import { TestBed } from '@angular/core/testing';
import {
  RangeTableComponent, ageOf, ageToYears, ageWords, blankGroup, liftParamCriticals, naturalAge, toSimpleGroup, unitPieces,
} from './range-table.component';
import type { InsightBand, InsightParam } from '../../../../shared/utils/range-insight';

const L = 'L — below this prints L (low)';
const H = 'H — above this prints H (high)';
const CL = 'CL — below this is critical';
const CH = 'CH — above this is critical';
const TXT = 'Report text — prints exactly as typed; Enter starts a new line';

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
  const inp = (label: string, i = 0) => rowEls()[i].querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  /** One row as the eye reads it: age · L · H · CL · CH · report text (or its placeholder). */
  const read = (i = 0) => [rowEls()[i].querySelector('.rtb__agebtn span')!.textContent!.trim(),
    inp(L, i).value, inp(H, i).value, inp(CL, i).value, inp(CH, i).value, inp(TXT, i).value || `(${inp(TXT, i).placeholder})`];
  const type = (label: string, value: string, i = 0) => {
    const x = inp(label, i);
    x.value = value;
    x.dispatchEvent(new Event('change'));
    f.detectChanges();
  };
  return { f, el, c: f.componentInstance, emitted, rowEls, read, type, inp };
}

/** Haemoglobin in the simple shape. */
const HB: InsightBand[] = [
  { sex: 'any', minAge: 0, maxAge: 28, ageUnit: 'days', min: 14, max: 22, criticalLow: 7, criticalHigh: 25, reportText: null },
  { sex: 'any', minAge: 28, maxAge: 365, ageUnit: 'days', min: 9.5, max: 13.5, criticalLow: 7, criticalHigh: 20, reportText: null },
  { sex: 'any', minAge: 1, maxAge: 18, ageUnit: 'years', min: 11, max: 14.5, criticalLow: null, criticalHigh: null, reportText: '11 – 14.5 g/dL' },
  { sex: 'M', minAge: 18, maxAge: null, ageUnit: 'years', min: 13, max: 17, criticalLow: 7, criticalHigh: 20, reportText: '13 – 17 g/dL' },
  { sex: 'F', minAge: 18, maxAge: null, ageUnit: 'years', min: 12, max: 16, criticalLow: 7, criticalHigh: 20, reportText: '12 – 16 g/dL' },
];

describe('pf-range-table — Who | Age | L | H | CL | CH | Report text | ×', () => {
  it('one row per group, the eight columns, the unit once in the header', () => {
    const { el, read, rowEls, c } = make({ unit: 'g/dL', referenceRanges: HB });
    expect(el.querySelectorAll('table.rtb__table')).toHaveLength(1);
    expect([...el.querySelectorAll('thead th')].map(t => t.textContent!.trim()))
      .toEqual(['Who', 'Age', 'Lg/dL', 'H', 'CL', 'CH', 'Report texttype {u} for the unit', 'Remove']);
    expect(el.querySelectorAll('.rtb__unit')).toHaveLength(1);
    expect(rowEls()).toHaveLength(5);
    expect(read(0)).toEqual(['0–28 days', '14', '22', '7', '25', '(14–22 g/dL)']);
    expect(read(3)).toEqual(['18 years+', '13', '17', '7', '20', '13 – 17 g/dL']);
    expect(c.rows().map(r => r.who)).toEqual(['Anyone', 'Anyone', 'Anyone', 'Male', 'Female']);
    expect(rowEls()[4].getAttribute('data-who')).toBe('Female · 18 years+');
    // Nothing else: no chips, bands, footnotes, grid.
    expect(el.querySelectorAll('.rtb__flag, .rtb__chip, .rtb__warn, .rtb__note, .rtb__msg')).toHaveLength(0);
  });

  it('typing a limit / report text stores the simple shape; others keep their object', () => {
    const { type, emitted } = make({ unit: 'g/dL', referenceRanges: HB });
    type(H, '16.5', 4);
    expect(emitted.at(-1)![4]).toEqual({ ...HB[4], max: 16.5 });
    expect(emitted.at(-1)![0]).toBe(HB[0]);
    type(TXT, '  Adult women 12 – 16.5 g/dL ', 4);
    expect(emitted.at(-1)![4].reportText).toBe('Adult women 12 – 16.5 g/dL');
    type(TXT, '', 4);
    expect(emitted.at(-1)![4].reportText).toBeNull();
    // A blank box clears that side; a non-number is refused and restored.
    type(CL, '', 3);
    expect(emitted.at(-1)![3].criticalLow).toBeNull();
    const n = emitted.length;
    type(L, 'abc', 3);
    expect(emitted).toHaveLength(n);
  });

  it('an edited legacy group drops segment / label / ops and keeps printing the same words', () => {
    const legacy: InsightBand = { segment: 'adult_male', min: 13, max: 17, maxOp: 'lt', label: 'Adult men' };
    const { type, emitted } = make({ unit: 'g/dL', criticalLow: 7, referenceRanges: [legacy] });
    type(H, '17.5');
    expect(emitted.at(-1)![0]).toEqual({
      sex: 'M', minAge: 18, maxAge: null, ageUnit: 'years', min: 13, max: 17.5,
      criticalLow: 7, criticalHigh: null, reportText: 'Adult men: 13–17 g/dL',
    });
  });

  it('every problem is ONE plain line under its row — including ones already saved', () => {
    const { el, rowEls, type, c } = make({ unit: 'g/dL', referenceRanges: [
      { sex: 'any', minAge: 0, maxAge: 28, ageUnit: 'days', min: 14, max: 22, criticalHigh: 20 },   // legacy: CH inside
      { sex: 'M', minAge: 18, min: 13, max: 17 },
    ] });
    expect(c.rows()[0].error).toBe('CH (20) must not be below H (22).');
    expect(el.querySelectorAll('.rtb__msg')).toHaveLength(1);
    expect(rowEls()[0].classList).toContain('rtb__row--err');
    type(L, '18', 1);
    expect(c.rows()[1].error).toBe('L (18) must not be above H (17).');
    expect(el.querySelectorAll('.rtb__msg')).toHaveLength(2);
  });

  it('+ Add group appends a blank Anyone group (which overlaps until Who / Age are set)', () => {
    const { el, f, emitted, c } = make({ unit: 'g/dL', referenceRanges: [HB[3]] });
    (el.querySelector('.rtb__add') as HTMLButtonElement).click(); f.detectChanges();
    expect(emitted.at(-1)![1]).toEqual(blankGroup());
    expect(c.rows()[1].error).toContain('Overlaps group 1 (Male · 18 years+)');
    c.setSex(1, 'F'); f.detectChanges();
    expect(c.rows()[1].error).toBeNull();
  });

  it('the age editor writes natural units; removing a group works', () => {
    const { c, f, emitted, el } = make({ unit: 'g/dL', referenceRanges: HB });
    c.setAgeSide(c.rows()[2], 'to', '12', null); f.detectChanges();
    expect(emitted.at(-1)![2]).toMatchObject({ minAge: 1, maxAge: 12, ageUnit: 'years' });
    c.removeBand(0); f.detectChanges();
    expect(emitted.at(-1)).toHaveLength(4);
    expect(el.querySelectorAll('tbody tr.rtb__row')).toHaveLength(4);
  });

  it('try a value — one small line', () => {
    const { c, f, el } = make({ unit: 'g/dL', referenceRanges: HB });
    c.tryText.set('6.5'); c.trySex.set('F'); c.tryAge.set('35'); f.detectChanges();
    expect(el.querySelector('.rtb__verdict')!.textContent!.trim()).toBe('→ Critical low');
    c.tryText.set('16'); f.detectChanges();
    expect(el.querySelector('.rtb__verdict')!.textContent!.trim()).toBe('→ Normal');   // on H = not flagged
  });

  it('phones: one card per group — "Female · 18 years+" then the report text; tap to edit', () => {
    const { el, f, emitted } = make({ unit: 'g/dL', referenceRanges: [HB[4], { sex: 'any', max: 200 }] }, { phone: true });
    expect(el.querySelector('table')).toBeNull();
    const cards = [...el.querySelectorAll('.rtb__card')];
    expect(cards.map(x => x.querySelector('.rtb__l1')!.textContent!.trim())).toEqual(['Female · 18 years+', 'Anyone · Any age']);
    expect(cards.map(x => x.querySelector('.rtb__l2')!.textContent!.trim())).toEqual(['12 – 16 g/dL', '≤ 200 g/dL']);
    (cards[0].querySelector('.rtb__cardhead') as HTMLButtonElement).click(); f.detectChanges();
    const body = el.querySelector('.rtb__card--open .rtb__cardbody')!;
    const nums = body.querySelectorAll<HTMLInputElement>('.rtb__grid2 input');
    expect(nums).toHaveLength(4);
    nums[1].value = '15.5'; nums[1].dispatchEvent(new Event('change')); f.detectChanges();
    expect(emitted.at(-1)![0]).toEqual({ ...HB[4], max: 15.5 });
    expect(body.querySelector(`textarea[aria-label="${TXT}"]`)).not.toBeNull();
  });
});

const GLU = 'Normal: 70–99\nPrediabetes: 100–125\nDiabetes: ≥126 mg/dL';

describe('pf-range-table — a multi-line Report text', () => {
  it('the Report text is a one-row textarea; Enter is a new line, never a blur / save', () => {
    const { inp, emitted } = make({ unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: 70, max: 99, reportText: null }] });
    const ta = inp(TXT) as unknown as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.rows).toBe(1);
    expect(ta.placeholder).toBe('70–99 mg/dL');                    // the auto fallback stays
    ta.focus();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    ta.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);                     // the browser inserts the newline
    expect(document.activeElement).toBe(ta);                        // …and focus stays (no blur-to-save)
    expect(emitted).toHaveLength(0);                                // nothing saved on Enter
  });

  it('stores a plain string with \\n; CRLF → LF, trailing spaces and blank lines trimmed', () => {
    const { type, emitted, inp, f } = make({ unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: 70, max: 99, reportText: null }] });
    type(TXT, 'Normal: 70–99  \r\nPrediabetes: 100–125\r\nDiabetes: ≥126 mg/dL\r\n\r\n  ');
    expect(emitted.at(-1)![0].reportText).toBe(GLU);
    f.detectChanges();
    expect(inp(TXT).value).toBe(GLU);
    // Re-typing the same text (a CR-only paste) is not a change.
    const n = emitted.length;
    type(TXT, 'Normal: 70–99\rPrediabetes: 100–125\rDiabetes: ≥126 mg/dL\n');
    expect(emitted).toHaveLength(n);
  });

  it('auto-grows with its text up to the max height, then scrolls', () => {
    const { inp } = make({ unit: 'mg/dL', referenceRanges: [{ sex: 'any', min: 70, max: 99, reportText: null }] });
    const ta = inp(TXT) as unknown as HTMLTextAreaElement;
    let sh = 20;
    Object.defineProperty(ta, 'scrollHeight', { configurable: true, get: () => sh });
    Object.defineProperty(ta, 'offsetHeight', { configurable: true, get: () => 2 });
    Object.defineProperty(ta, 'clientHeight', { configurable: true, get: () => 0 });
    ta.style.maxHeight = '116px';
    ta.value = 'one'; ta.dispatchEvent(new Event('input'));
    expect(ta.style.height).toBe('22px');
    expect(ta.style.overflowY).toBe('hidden');
    sh = 74; ta.value = 'one\ntwo\nthree'; ta.dispatchEvent(new Event('input'));
    expect(ta.style.height).toBe('76px');                           // grew to three lines
    sh = 300; ta.value = 'a\nb\nc\nd\ne\nf\ng\nh'; ta.dispatchEvent(new Event('input'));
    expect(ta.style.height).toBe('116px');                          // capped (~5 rows)…
    expect(ta.style.overflowY).toBe('auto');                        // …then it scrolls
  });

  it('the table shows the saved lines; the phone card keeps its line breaks', () => {
    const band = { sex: 'any' as const, min: 70, max: 99, reportText: GLU };
    const desk = make({ unit: 'mg/dL', referenceRanges: [band] });
    expect(desk.inp(TXT).value).toBe(GLU);
    TestBed.resetTestingModule();
    const phone = make({ unit: 'mg/dL', referenceRanges: [band] }, { phone: true });
    const l2 = phone.el.querySelector('.rtb__l2') as HTMLElement;
    expect(l2.textContent).toBe(GLU);
    expect(getComputedStyle(l2).whiteSpace).toBe('pre-line');
  });
});

describe('simple-shape helpers', () => {
  it('liftParamCriticals: test-wide CL / CH move into each group (own values win)', () => {
    const p = liftParamCriticals({ criticalLow: 7, criticalHigh: 20, referenceRanges: [{ min: 1 }, { min: 2, criticalHigh: 30 }] });
    expect(p.referenceRanges).toEqual([
      { min: 1, criticalLow: 7, criticalHigh: 20 }, { min: 2, criticalLow: 7, criticalHigh: 30 },
    ]);
    expect('criticalLow' in p).toBe(false);
    const none = { criticalLow: 7, referenceRanges: [] };
    expect(liftParamCriticals(none)).toBe(none);
  });
  it('toSimpleGroup resolves a legacy segment and keeps an authored label as the report text', () => {
    expect(toSimpleGroup({ segment: 'child 1-12 years', min: 11, max: 14 }, null, 'g/dL')).toEqual({
      sex: 'any', minAge: 1, maxAge: 12, ageUnit: 'years', min: 11, max: 14,
      criticalLow: null, criticalHigh: null, reportText: null,
    });
    expect(toSimpleGroup({ segment: 'n', label: 'Negative' }, null, '').reportText).toBe('Negative');
  });
});

describe('natural-unit ages', () => {
  it('years → the unit a person would say', () => {
    expect(naturalAge(0.0767)).toEqual({ n: 28, unit: 'days' });
    expect(naturalAge(0.5)).toEqual({ n: 6, unit: 'months' });
    expect(naturalAge(18)).toEqual({ n: 18, unit: 'years' });
    expect(ageToYears({ n: 6, unit: 'months' })).toBe(0.5);
  });
  it('age words', () => {
    expect(ageWords(null, null)).toBe('Any age');
    expect(ageWords({ n: 18, unit: 'years' }, null)).toBe('18 years+');
    expect(ageWords(null, { n: 1, unit: 'years' })).toBe('up to 1 year');
    expect(ageWords({ n: 28, unit: 'days' }, { n: 1, unit: 'years' })).toBe('28 days – 1 year');
    expect(ageOf({ minAge: 0, maxAge: 28, ageUnit: 'days' })).toEqual({ from: { n: 0, unit: 'days' }, to: { n: 28, unit: 'days' } });
  });
});

describe('pf-range-table — {u} = the value\'s unit', () => {
  const RBC = { sex: 'M' as const, minAge: 18, min: 4.5, max: 5.9, reportText: '4.5 – 5.9 {u}' };

  it('stores the token; "Prints as" shows the unit filled in as a chip', () => {
    const { el, inp } = make({ unit: '×10¹²/L', referenceRanges: [RBC] });
    expect(inp(TXT).value).toBe('4.5 – 5.9 {u}');                   // stored WITH the token
    const prev = el.querySelector('.rtb__prev') as HTMLElement;
    expect(prev.textContent!.replace(/\s+/g, ' ').trim()).toBe('Prints as 4.5 – 5.9 ×10¹²/L');
    expect(prev.querySelector('.rtb__uchip')!.textContent).toBe('×10¹²/L');
    expect(inp(TXT).title).toBe('4.5 – 5.9 ×10¹²/L');
  });

  it('the preview follows every keystroke (before blur) and a Unit change at once', () => {
    const { el, inp, f, emitted } = make({ unit: 'g/dL', referenceRanges: [{ sex: 'any', min: 12, max: 16, reportText: null }] });
    expect(el.querySelector('.rtb__prev')).toBeNull();                 // no token, no preview
    const ta = inp(TXT);
    ta.value = 'Normal: 12–16 {U}\nLow: <12 {u}'; ta.dispatchEvent(new Event('input')); f.detectChanges();
    expect(emitted).toHaveLength(0);                                   // typing is not a save
    const txt = () => (el.querySelector('.rtb__prevtxt') as HTMLElement).textContent;
    expect(txt()).toBe('Normal: 12–16 g/dL\nLow: <12 g/dL');
    f.componentRef.setInput('param', { ...f.componentInstance.param()!, unit: 'mmol/L' }); f.detectChanges();
    expect(txt()).toBe('Normal: 12–16 mmol/L\nLow: <12 mmol/L');
    ta.dispatchEvent(new Event('change')); f.detectChanges();
    expect(emitted.at(-1)![0].reportText).toBe('Normal: 12–16 {U}\nLow: <12 {u}');
  });

  it('the phone card prints the filled text; the placeholder stays the auto fallback', () => {
    const { el } = make({ unit: '×10¹²/L', referenceRanges: [RBC, { sex: 'F', min: 4, max: 5.2, reportText: null }] }, { phone: true });
    expect([...el.querySelectorAll('.rtb__l2')].map(x => x.textContent)).toEqual(['4.5 – 5.9 ×10¹²/L', '4–5.2 ×10¹²/L']);
  });

  it('unitPieces: text and unit chips; no unit drops the token', () => {
    expect(unitPieces('a {u}\nb {u}', 'g/dL')).toEqual([
      { t: 'a ', unit: false }, { t: 'g/dL', unit: true }, { t: '\nb ', unit: false }, { t: 'g/dL', unit: true },
    ]);
    expect(unitPieces('70–99 {u}', '')).toEqual([{ t: '70–99', unit: false }]);
  });
});
