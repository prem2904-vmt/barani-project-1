import { ASK_SPECIMEN_KEY, asksSpecimen, chosenSpecimen, deskDefaultSpecimen, ownAsksSpecimen, specimenLookupIds, tubeChosenSpecimen, tubeSpecimen, withAskSpecimen } from './micro-specimen';

describe('micro-specimen — which tests ask the desk for their specimen', () => {
  const culture = JSON.stringify({ microFormat: 'culture_sensitivity', parameters: [] });
  const gram = JSON.stringify({ microFormat: 'staining_gram', askSpecimen: true, parameters: [] });
  const plainMicro = JSON.stringify({ microFormat: 'microscopy_v11', parameters: [] });

  it('Culture & Sensitivity always asks (the original behaviour)', () => {
    expect(ownAsksSpecimen(culture)).toBe(true);
  });

  it('any other test asks when its askSpecimen switch is on', () => {
    expect(ownAsksSpecimen(gram)).toBe(true);
    expect(ownAsksSpecimen(plainMicro)).toBe(false);
  });

  it('never asks for unreadable / empty / non-object parameters', () => {
    expect(ownAsksSpecimen(null)).toBe(false);
    expect(ownAsksSpecimen('')).toBe(false);
    expect(ownAsksSpecimen('{not json')).toBe(false);
    expect(ownAsksSpecimen('[1,2]')).toBe(false);
    expect(ownAsksSpecimen(JSON.stringify({ askSpecimen: 'yes' }))).toBe(false);
  });

  it('a bundle asks when any member it carries asks', () => {
    const rows: Record<string, { parameters: string }> = { g: { parameters: gram }, p: { parameters: plainMicro } };
    const lookup = (id: string) => rows[id];
    const withGram = { type: 'profile', parameters: JSON.stringify({ items: [{ testId: 'p' }, { testId: 'g' }] }) };
    const without = { type: 'profile', parameters: JSON.stringify({ items: [{ testId: 'p' }, { testId: 'missing' }] }) };
    expect(asksSpecimen(withGram, lookup)).toBe(true);
    expect(asksSpecimen(without, lookup)).toBe(false);
    // Without a member lookup only the bundle's own switch counts.
    expect(asksSpecimen(withGram)).toBe(false);
  });

  it('withAskSpecimen sets / clears the switch and keeps every other wrapper key', () => {
    const on = JSON.parse(withAskSpecimen(plainMicro, true));
    expect(on[ASK_SPECIMEN_KEY]).toBe(true);
    expect(on.microFormat).toBe('microscopy_v11');
    expect(on.parameters).toEqual([]);
    const off = JSON.parse(withAskSpecimen(JSON.stringify(on), false));
    expect(ASK_SPECIMEN_KEY in off).toBe(false);
    expect(off.microFormat).toBe('microscopy_v11');
    expect(JSON.parse(withAskSpecimen('{bad', true))).toEqual({ askSpecimen: true });
  });
});

describe('micro-specimen — the chosen specimen downstream', () => {
  it('chosenSpecimen trims and treats blank as none', () => {
    expect(chosenSpecimen({ specimen: ' Urine ' })).toBe('Urine');
    expect(chosenSpecimen({ specimen: '  ' })).toBeNull();
    expect(chosenSpecimen(null)).toBeNull();
  });

  it('a tube holds its first chosen specimen, else the Test Master specimen', () => {
    expect(tubeSpecimen({ tests: [{ specimen: null, test: { sampleType: 'As applicable' } }, { specimen: 'Pus' }] })).toBe('Pus');
    expect(tubeSpecimen({ tests: [{ specimen: null, test: { sampleType: 'Stool' } }] })).toBe('Stool');
    expect(tubeChosenSpecimen({ tests: [{ specimen: null }] })).toBeNull();
  });
});

describe('micro-specimen — "there is no default" at the desk', () => {
  const ask = JSON.stringify({ askSpecimen: true });
  const a = { id: 'a', parameters: ask };
  const b = { id: 'b', parameters: ask };
  const plain = { id: 'p', parameters: '{}' };
  const byId = (id: string) => ({ a, b, p: plain } as Record<string, typeof a>)[id];
  const bundle = { id: 'pkg', parameters: JSON.stringify({ items: [{ testId: 'a' }, { testId: 'b' }, { testId: 'p' }] }) };

  it('a single mapped default preselects; none or several do not', () => {
    expect(deskDefaultSpecimen(a, { a: 'Urine' })).toBe('Urine');
    expect(deskDefaultSpecimen(a, { a: null })).toBeNull();
    expect(deskDefaultSpecimen(a, {})).toBeNull();
  });

  it('a bundle preselects only when every asking member names the same default', () => {
    expect(deskDefaultSpecimen(bundle, { a: 'Urine', b: 'Urine' }, byId)).toBe('Urine');
    expect(deskDefaultSpecimen(bundle, { a: 'Urine', b: 'Pus' }, byId)).toBeNull();
    expect(deskDefaultSpecimen(bundle, { a: 'Urine', b: null }, byId)).toBeNull();
  });

  it('the lookup asks about the test itself, or a bundle\'s asking members', () => {
    expect(specimenLookupIds(a)).toEqual(['a']);
    expect(specimenLookupIds(bundle, byId)).toEqual(['a', 'b']);
    expect(specimenLookupIds(plain, byId)).toEqual([]);
  });
});
