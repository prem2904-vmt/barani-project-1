import { SampleResultEntryComponent } from './sample-result-entry.component';

/**
 * Test Master single-source — Stage 1 safety net for sample (tube-first)
 * result entry: methodology display, entry kind, and the all-bands range label.
 */
const P = SampleResultEntryComponent.prototype as any;

describe('SampleResultEntry.methodologyOf (Phase 0: hybrid)', () => {
  it('reads the parameter\'s own methodology, else an em dash when the test has none', () => {
    expect(P.methodologyOf.call({}, { name: 'na', methodology: 'ISE' })).toBe('ISE');
    expect(P.methodologyOf.call({}, { name: 'na' })).toBe('—');
    expect(P.methodologyOf.call({}, { name: 'na', methodology: '' })).toBe('—');
  });

  it('TARGET phase 0: hybrid — value.methodology ?? test.methodology (test-level default shows)', () => {
    // Needs the owning test passed in (or resolved) so the test-level default applies.
    expect(P.methodologyOf.call({}, { name: 'na' }, { methodology: 'Photometry' })).toBe('Photometry');
    expect(P.methodologyOf.call({}, { name: 'na', methodology: 'ISE' }, { methodology: 'Photometry' })).toBe('ISE');
    expect(P.methodologyOf.call({}, { name: 'na', methodology: '' }, { methodology: 'Photometry' })).toBe('Photometry');
  });
});

describe('SampleResultEntry.inputKindFor — shared entry-kind resolver (CURRENT)', () => {
  const kind = (p: any) => P.inputKindFor.call({}, p);
  it('numeric → number, select/options → select, own option rows → select, plain text → text', () => {
    expect(kind({ name: 'a', type: 'numeric' })).toBe('number');
    expect(kind({ name: 'a', type: 'select' })).toBe('select');
    expect(kind({ name: 'a', type: 'options' })).toBe('select');
    expect(kind({ name: 'a', type: 'text', optionRows: [{ value: 'Reactive' }] })).toBe('select');
    expect(kind({ name: 'a', type: 'text' })).toBe('text');
  });
  it('selectOptionsFor: active option rows win over options[]', () => {
    const p = { name: 'a', type: 'select', options: ['X'], optionRows: [{ value: 'A' }, { value: 'B', active: false }] };
    expect(P.selectOptionsFor.call({}, p)).toEqual(['A']);
  });
});

describe('SampleResultEntry.refLabelFor (CURRENT)', () => {
  it('ref_range text wins; else ONLY the patient\'s band; no match -> every band; else normalValue', () => {
    const who0 = { patientSexAge: () => ({ sex: null, age: null }) };
    const who = (sex: string | null) => ({ patientSexAge: () => ({ sex, age: sex ? 34 : null }) });
    expect(P.refLabelFor.call(who('F'), { name: 'a', ref_range: '< 5' })).toBe('< 5');
    const hb = { name: 'hb', unit: 'g/dL', referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] };
    const f = P.refLabelFor.call(who('F'), hb);
    expect(f).toContain('12–15');
    expect(f).not.toContain('13–17');
    const m = P.refLabelFor.call(who('M'), hb);
    expect(m).toContain('13–17');
    expect(m).not.toContain('12–15');
    const all = P.refLabelFor.call(who(null), hb);
    expect(all).toContain('13–17');
    expect(all).toContain('12–15');
    expect(P.refLabelFor.call(who0, { name: 'a', normalValue: 'Negative' })).toBe('Negative');
    expect(P.refLabelFor.call(who0, { name: 'a' })).toBe('');
  });
});
