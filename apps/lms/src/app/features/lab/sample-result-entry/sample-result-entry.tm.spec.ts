import { SampleResultEntryComponent } from './sample-result-entry.component';

/**
 * Test Master single-source — Stage 1 safety net for sample (tube-first)
 * result entry: methodology display, entry kind, and the all-bands range label.
 */
const P = SampleResultEntryComponent.prototype as any;

describe('SampleResultEntry.methodologyOf (CURRENT: per-value only)', () => {
  it('reads the parameter\'s own methodology, else an em dash', () => {
    expect(P.methodologyOf.call({}, { name: 'na', methodology: 'ISE' })).toBe('ISE');
    expect(P.methodologyOf.call({}, { name: 'na' })).toBe('—');
    expect(P.methodologyOf.call({}, { name: 'na', methodology: '' })).toBe('—');
  });

  it.skip('TARGET phase 0: hybrid — value.methodology ?? test.methodology (test-level default shows)', () => {
    // Needs the owning test passed in (or resolved) so the test-level default applies.
    expect(P.methodologyOf.call({}, { name: 'na' }, { methodology: 'Photometry' })).toBe('Photometry');
    expect(P.methodologyOf.call({}, { name: 'na', methodology: 'ISE' }, { methodology: 'Photometry' })).toBe('ISE');
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
  it('ref_range text wins; else every band labelled; else normalValue', () => {
    expect(P.refLabelFor.call({}, { name: 'a', ref_range: '< 5' })).toBe('< 5');
    const all = P.refLabelFor.call({}, { name: 'hb', referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] });
    expect(all).toContain('13–17');
    expect(all).toContain('12–15');
    expect(all).toContain(' · ');
    expect(P.refLabelFor.call({}, { name: 'a', normalValue: 'Negative' })).toBe('Negative');
    expect(P.refLabelFor.call({}, { name: 'a' })).toBe('');
  });
});
