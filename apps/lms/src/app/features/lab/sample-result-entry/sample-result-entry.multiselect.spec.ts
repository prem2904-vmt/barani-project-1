import { SampleResultEntryComponent } from './sample-result-entry.component';
import { isFilled } from './submit-all';
import { isMultiChoice, resolveParamEntryKind } from '../../../shared/utils/param-entry-kind';

/**
 * Multi-select result values (HEM059 Microfilaria Examination, 2026-09-28:
 * "Morphological Observation" and "Distribution / Motility" allow several
 * findings). The parameter is stored as type 'multiselect' with its own
 * option table; the tech's picks are stored as string[].
 */
const P = SampleResultEntryComponent.prototype as any;

const MORPH = {
  name: 'morphological_observation', title: 'Morphological Observation', type: 'multiselect',
  optionRows: [
    { code: 'MF03-01', value: 'Sheathed microfilaria', normal: false, active: true },
    { code: 'MF03-02', value: 'Unsheathed microfilaria', normal: false, active: true },
  ],
};

/** A `this` for the prototype methods: a values map + the setValue spy. */
function host(values: Record<string, Record<string, unknown>> = {}) {
  const h: any = {
    _vals: values,
    set: [] as unknown[],
    getValue(testId: string, name: string) { return h._vals[testId]?.[name] ?? ''; },
    setValue(testId: string, name: string, v: unknown) { h.set.push(v); (h._vals[testId] ??= {})[name] = v; },
  };
  return h;
}

describe('Multi-select parameters — detection', () => {
  it('multiselect in any spelling is a multi choice; it still renders as a choice list', () => {
    expect(isMultiChoice({ type: 'multiselect' })).toBe(true);
    expect(isMultiChoice({ type: 'Multi-Select' })).toBe(true);
    expect(isMultiChoice({ type: 'select' })).toBe(false);
    expect(isMultiChoice({ type: undefined })).toBe(false);
    expect(resolveParamEntryKind(MORPH)).toBe('select');
    expect(P.isMultiSelect.call({}, MORPH)).toBe(true);
    expect(P.isMultiSelect.call({}, { ...MORPH, type: 'select' })).toBe(false);
  });
});

describe('Multi-select parameters — values', () => {
  it('reads picks as a list; a legacy single string reads as one pick; blank = none', () => {
    expect(P.multiValuesOf.call(host({ t: { m: ['A', 'B'] } }), 't', 'm')).toEqual(['A', 'B']);
    expect(P.multiValuesOf.call(host({ t: { m: 'A' } }), 't', 'm')).toEqual(['A']);
    expect(P.multiValuesOf.call(host({ t: { m: '' } }), 't', 'm')).toEqual([]);
    expect(P.multiValuesOf.call(host(), 't', 'm')).toEqual([]);
  });

  it('stores the picks as string[] with blanks dropped', () => {
    const h = host();
    P.onMultiSelectChange.call(h, 't', 'm', ['Sheathed microfilaria', '', 'Unsheathed microfilaria']);
    expect(h.set).toEqual([['Sheathed microfilaria', 'Unsheathed microfilaria']]);
  });

  it('an empty list is not filled; one real pick is', () => {
    expect(isFilled([])).toBe(false);
    expect(isFilled(['', '  '])).toBe(false);
    expect(isFilled(['Sheathed microfilaria'])).toBe(true);
  });
});

describe('Multi-select parameters — live flag (mirrors mw: abnormal when ANY pick is not normal)', () => {
  const flag = (p: any, v: unknown) => P.qualitativeFlagFor.call(host({ t: { [p.name]: v } }), { id: 't' }, p);
  const judged = {
    ...MORPH,
    optionRows: [
      { value: 'No microfilariae observed', normal: true, active: true },
      { value: 'Motile microfilariae observed', normal: false, active: true },
    ],
  };

  it('no Normal rows = never flagged (descriptive findings)', () => {
    expect(flag(MORPH, ['Sheathed microfilaria'])).toBeNull();
  });

  it('all picks normal = no flag; any abnormal pick = Abnormal; nothing picked = no flag', () => {
    expect(flag(judged, ['No microfilariae observed'])).toBeNull();
    expect(flag(judged, ['No microfilariae observed', 'Motile microfilariae observed'])?.label).toBe('Abnormal');
    expect(flag(judged, [])).toBeNull();
  });

  it('single selects keep their behaviour', () => {
    const single = { ...judged, type: 'select' };
    expect(flag(single, 'No microfilariae observed')).toBeNull();
    expect(flag(single, 'Motile microfilariae observed')?.label).toBe('Abnormal');
    expect(flag(single, '')).toBeNull();
  });
});
