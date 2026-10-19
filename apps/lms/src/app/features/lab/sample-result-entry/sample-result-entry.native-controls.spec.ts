import { SampleResultEntryComponent } from './sample-result-entry.component';

/**
 * The grid's 'date' parameter cell used a native `<input type="date">` —
 * now `pf-date`. Same "prototype.call" approach as the other
 * SampleResultEntry specs (methodologyOf, inputKindFor): no full mount.
 */
const P = SampleResultEntryComponent.prototype as any;

describe('SampleResultEntry.asDateStr', () => {
  it('passes a real string through; blank/undefined/non-string become null', () => {
    expect(P.asDateStr.call({}, '2026-09-26')).toBe('2026-09-26');
    expect(P.asDateStr.call({}, '')).toBeNull();
    expect(P.asDateStr.call({}, undefined)).toBeNull();
    expect(P.asDateStr.call({}, 42)).toBeNull();
  });
});

describe('SampleResultEntry — Enter-advance includes the kit date field', () => {
  it('getAllFocusableInputs selects the kit date input (.pf-date__in) alongside the others', () => {
    // Read the private method's own source rather than mounting the whole
    // screen — it is a declarative querySelectorAll() string.
    const src = (P.getAllFocusableInputs as (...a: unknown[]) => unknown).toString();
    expect(src).toContain('.pf-sre__gdate .pf-date__in');
    expect(src).toContain('input.pf-sre__ginput');
    expect(src).toContain('.pf-sre__gselect .pf-dd__trigger');
  });
});
