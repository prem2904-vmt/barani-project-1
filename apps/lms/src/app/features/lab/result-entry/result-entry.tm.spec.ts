import { signal } from '@angular/core';
import { ResultEntryComponent } from './result-entry.component';

/**
 * Test Master single-source — Stage 1 safety net for result entry.
 * Pins: entry kind (via the shared resolver), the live bench flag (band
 * criticals preferred, parameter fallback), the reference label, and the
 * per-VALUE-only methodology read. prototype.call on hand-built contexts.
 */
const P = ResultEntryComponent.prototype as any;

function ctx(values: Record<string, unknown> = {}, patient: any = { sex: 'F', age: 30 }) {
  const c: any = {
    _values: signal(values),
    _ot: signal({ subOrder: { order: { patient } } }),
    _fieldByName: () => new Map(),
  };
  c.inputKindFor = P.inputKindFor.bind(c);
  return c;
}

describe('ResultEntry — entry kind (CURRENT)', () => {
  const kind = (p: any) => P.inputKindFor.call(ctx(), p);
  it('numbers → numeric; select/options/choice → dropdown', () => {
    expect(kind({ name: 'a', type: 'numeric' })).toBe('numeric');
    expect(kind({ name: 'a', type: 'number' })).toBe('numeric');
    expect(kind({ name: 'a', type: 'select' })).toBe('dropdown');
    expect(kind({ name: 'a', type: 'options' })).toBe('dropdown');
    expect(kind({ name: 'a', type: 'choice' })).toBe('dropdown');
  });
  it('a text param WITH its own option rows is a dropdown, never a text box', () => {
    expect(kind({ name: 'a', type: 'text', optionRows: [{ value: 'Positive' }, { value: 'Negative' }] })).toBe('dropdown');
    expect(kind({ name: 'a', type: 'text' })).toBe('text');
  });
});

describe('ResultEntry.flagFor — live bench flag (CURRENT)', () => {
  const k = {
    name: 'k', type: 'numeric', unit: 'mmol/L', criticalLow: 2, criticalHigh: 8,
    referenceRanges: [{ min: 3.5, max: 5, criticalLow: 2.5, criticalHigh: 6.5 }],
  };
  const flag = (v: unknown, p: any = k) => P.flagFor.call(ctx({ [p.name]: v }), p);

  it('prefers BAND criticals over the parameter-level pair', () => {
    expect(flag('6.6')?.tone).toBe('critical');          // band 6.5 wins over param 8
    expect(flag('2.4')?.label).toBe('CL · below 2.5');
    expect(flag('6.6')?.label).toBe('CH · above 6.5');
  });
  it('falls back to parameter criticals when the band has none', () => {
    const p = { ...k, referenceRanges: [{ min: 3.5, max: 5 }] };
    expect(flag('6.6', p)?.tone).toBe('high');
    expect(flag('8.1', p)?.tone).toBe('critical');
  });
  it('low / high / normal and blanks', () => {
    expect(flag('3')?.tone).toBe('low');
    expect(flag('4')?.tone).toBe('normal');
    expect(flag('')).toBeNull();
    expect(flag('abc')).toBeNull();
  });
  it('an unchanged SAVED value shows mw\'s saved verdict, not a recompute', () => {
    const c = ctx({ k: '4' });
    c._ot = signal({ subOrder: { order: { patient: { sex: 'F', age: 30 } } },
      currentResult: JSON.stringify({ values: { k: '4' }, flagged: { k: { value: '4', flag: 'C' } } }) });
    expect(P.flagFor.call(c, k)).toEqual({ tone: 'critical', label: 'C' });   // legacy C badges as C
    c._ot = signal({ subOrder: { order: { patient: { sex: 'F', age: 30 } } },
      currentResult: JSON.stringify({ values: { k: '4' }, flagged: { k: { value: '4', flag: 'CL' } } }) });
    expect(P.flagFor.call(c, k)).toEqual({ tone: 'critical', label: 'CL' });  // new rows keep the direction
    c._values = signal({ k: '4.5' });          // retyped → live hint again
    expect(P.flagFor.call(c, k)?.tone).toBe('normal');
  });
  it('non-numeric params never flag at the bench', () => {
    expect(P.flagFor.call(ctx({ s: 'Positive' }), { name: 's', type: 'select' })).toBeNull();
  });
});

describe('ResultEntry.refLabel — printed-style range on the bench (CURRENT)', () => {
  it('normalValue wins; else the patient band + unit; else "critLow–critHigh"', () => {
    const c = ctx();
    expect(P.refLabel.call(c, { name: 'a', normalValue: 'Negative', referenceRanges: [{ min: 1, max: 2 }] })).toBe('Negative');
    expect(P.refLabel.call(c, { name: 'a', unit: 'g/dL', referenceRanges: [{ min: 12, max: 15, sex: 'F' }] })).toBe('12–15 g/dL');
    // Only the patient's own band (a woman) — never the male one beside it.
    const hb = { name: 'hb', unit: 'g/dL', referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] };
    expect(P.refLabel.call(c, hb)).toBe('12–15 g/dL');
    // No sex known -> no band matches on merit -> every band, as the report does.
    expect(P.refLabel.call(ctx({}, {}), hb)).toContain('13–17');
    expect(P.refLabel.call(c, { name: 'a', criticalLow: 1, criticalHigh: 9 })).toBe('1–9');
    expect(P.refLabel.call(c, { name: 'a' })).toBe('');
  });
});

describe('ResultEntry — methodology (Phase 0: hybrid)', () => {
  // The grid cell renders methodologyFor(p) — the value's own override, else
  // the TEST-level Methodology column (shared resolver).
  it('TARGET phase 0: hybrid methodology — effective = value.methodology ?? test.methodology', () => {
    // Expected shared resolver (e.g. shared/utils/methodology.ts effectiveMethodology(param, test)):
    //   ({ methodology: 'ISE' }, { methodology: 'Photometry' }) → 'ISE'
    //   ({},                      { methodology: 'Photometry' }) → 'Photometry'
    //   ({},                      {})                            → '—'
    // and BOTH result-entry and sample-result-entry render through it.
    expect(typeof P.methodologyFor).toBe('function');
    const test = { methodology: 'Photometry' };
    expect(P.methodologyFor.call({ _ot: signal({ test }) }, { name: 'a', methodology: 'ISE' })).toBe('ISE');
    expect(P.methodologyFor.call({ _ot: signal({ test }) }, { name: 'a' })).toBe('Photometry');
    expect(P.methodologyFor.call({ _ot: signal({ test: {} }) }, { name: 'a' })).toBe('—');
  });
});

describe('ResultEntry.calcChipFor — result entry still marks auto-calculated values', () => {
  const def = { kind: 'expr', expr: 'TC - HDL - TG/5', inputs: ['TC', 'HDL', 'TG'] };
  const vals: Record<string, number> = { TC: 210, HDL: 45, TG: 150 };
  const c = (over: Record<string, unknown> = {}) => ({
    _calcDef: () => def,
    calcTargetParam: () => ({ name: 'LDL Cholesterol' }),
    _calcOverridden: () => false,
    calcContext: () => ({ value: (r: string) => vals[r] ?? null }),
    ...over,
  });
  it('the formula target shows the Calculated chip; other fields show none', () => {
    expect(P.calcChipFor.call(c(), { name: 'LDL Cholesterol' })).toEqual({ kind: 'auto', label: 'Calculated' });
    expect(P.calcChipFor.call(c(), { name: 'HDL' })).toBeNull();
  });
  it('a tech override reads Manual', () => {
    expect(P.calcChipFor.call(c({ _calcOverridden: () => true }), { name: 'LDL Cholesterol' }))
      .toEqual({ kind: 'manual', label: 'Manual' });
  });
});
