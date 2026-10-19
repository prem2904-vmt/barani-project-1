import {
  ASK_SPECIMEN_KEY, SPECIMEN_MODE_KEY, allowedSpecimensFor, asksSpecimen, chosenSpecimen, deskDefaultCode, findAllowed,
  fixedSpecimenOf, hasSpecimen, ownAsksSpecimen, specimenLinePrice, specimenLookupIds, specimenModeOf, tubeChosenSpecimen,
  tubeSpecimen, withSpecimenMode, type AllowedSpecimen, type TestSpecimenMap,
} from './micro-specimen';

/** The mode table — the TS twin of the server's SpecimenRules unit test. */
describe('micro-specimen — the one setting (specimenMode) with the legacy flags as fallback', () => {
  const cases: Array<[string | null, 'fixed' | 'choose' | 'none']> = [
    [JSON.stringify({ specimenMode: 'fixed' }), 'fixed'],
    [JSON.stringify({ specimenMode: 'choose' }), 'choose'],
    [JSON.stringify({ specimenMode: 'none' }), 'none'],
    [JSON.stringify({ specimenMode: ' Fixed ' }), 'fixed'],
    // The explicit setting wins over the legacy flags.
    [JSON.stringify({ specimenMode: 'none', microFormat: 'culture_sensitivity' }), 'none'],
    [JSON.stringify({ specimenMode: 'fixed', askSpecimen: true }), 'fixed'],
    // Legacy rows: askSpecimen / Culture & Sensitivity = choose.
    [JSON.stringify({ askSpecimen: true }), 'choose'],
    [JSON.stringify({ microFormat: 'culture_sensitivity', parameters: [] }), 'choose'],
    [JSON.stringify({ microFormat: 'microscopy_v11' }), 'none'],
    [JSON.stringify({ askSpecimen: false }), 'none'],
    // Garbage never asks.
    [JSON.stringify({ specimenMode: 'maybe' }), 'none'],
    [JSON.stringify({ askSpecimen: 'yes' }), 'none'],
    ['[1,2]', 'none'],
    ['{not json', 'none'],
    ['', 'none'],
    [null, 'none'],
  ];
  it.each(cases)('%s → %s', (parameters, expected) => {
    expect(specimenModeOf(parameters)).toBe(expected);
    // Only choose asks the desk; fixed and choose carry a specimen.
    expect(ownAsksSpecimen(parameters)).toBe(expected === 'choose');
    expect(hasSpecimen(parameters)).toBe(expected !== 'none');
  });

  it('withSpecimenMode writes the setting, drops the legacy flag and keeps every other key', () => {
    const json = withSpecimenMode(JSON.stringify({ askSpecimen: true, microFormat: 'staining_gram', parameters: [] }), 'fixed');
    const w = JSON.parse(json);
    expect(w[SPECIMEN_MODE_KEY]).toBe('fixed');
    expect(ASK_SPECIMEN_KEY in w).toBe(false);
    expect(w.microFormat).toBe('staining_gram');
    expect(w.parameters).toEqual([]);
    expect(specimenModeOf(json)).toBe('fixed');
    expect(JSON.parse(withSpecimenMode('{bad', 'none'))).toEqual({ specimenMode: 'none' });
  });

  it('a bundle asks when any member it carries chooses', () => {
    const gram = JSON.stringify({ specimenMode: 'choose' });
    const fixedBlood = JSON.stringify({ specimenMode: 'fixed' });
    const plain = JSON.stringify({ microFormat: 'microscopy_v11' });
    const rows: Record<string, { parameters: string }> = { g: { parameters: gram }, f: { parameters: fixedBlood }, p: { parameters: plain } };
    const lookup = (id: string) => rows[id];
    const withGram = { type: 'profile', parameters: JSON.stringify({ items: [{ testId: 'p' }, { testId: 'g' }] }) };
    const onlyFixed = { type: 'profile', parameters: JSON.stringify({ items: [{ testId: 'f' }, { testId: 'p' }] }) };
    expect(asksSpecimen(withGram, lookup)).toBe(true);
    expect(asksSpecimen(onlyFixed, lookup)).toBe(false);      // fixed members never ask the desk
    expect(asksSpecimen(withGram)).toBe(false);               // no member lookup: only the bundle's own row
  });
});

describe('micro-specimen — the chosen specimen downstream', () => {
  it('chosenSpecimen trims and treats blank as none', () => {
    expect(chosenSpecimen({ specimen: ' Urine ' })).toBe('Urine');
    expect(chosenSpecimen({ specimen: '  ' })).toBeNull();
    expect(chosenSpecimen(null)).toBeNull();
  });

  it('a tube holds its first line specimen, else the Test Master specimen', () => {
    expect(tubeSpecimen({ tests: [{ specimen: null, test: { sampleType: 'As applicable' } }, { specimen: 'Pus' }] })).toBe('Pus');
    expect(tubeSpecimen({ tests: [{ specimen: null, test: { sampleType: 'Stool' } }] })).toBe('Stool');
    expect(tubeChosenSpecimen({ tests: [{ specimen: null }] })).toBeNull();
  });
});

describe('micro-specimen — the desk: only the allowed list, the single default, the price', () => {
  const choose = JSON.stringify({ specimenMode: 'choose' });
  const a = { id: 'a', parameters: choose };
  const b = { id: 'b', parameters: choose };
  const f = { id: 'f', parameters: JSON.stringify({ specimenMode: 'fixed' }) };
  const plain = { id: 'p', parameters: '{}' };
  const byId = (id: string) => ({ a, b, f, p: plain } as Record<string, typeof a>)[id];
  const bundle = { id: 'pkg', parameters: JSON.stringify({ items: [{ testId: 'a' }, { testId: 'b' }, { testId: 'p' }] }) };
  const urine: AllowedSpecimen = { code: 'SPEC013', name: 'Urine', isDefault: true, container: 'urine' };
  const sputum: AllowedSpecimen = { code: 'SPEC005', name: 'Sputum', isDefault: false, price: 250 };
  const blood: AllowedSpecimen = { code: 'SPEC026', name: 'Blood', isDefault: false, container: 'blood_culture' };
  const master = [urine, sputum, blood];
  const map = (testId: string, specimens: AllowedSpecimen[]): TestSpecimenMap => ({ testId, specimens });

  it('the lookup asks about the test itself, or a bundle\'s choosing members (never a fixed one)', () => {
    expect(specimenLookupIds(a)).toEqual(['a']);
    expect(specimenLookupIds(f)).toEqual([]);
    expect(specimenLookupIds(bundle, byId)).toEqual(['a', 'b']);
    expect(specimenLookupIds(plain, byId)).toEqual([]);
  });

  it('the picker offers ONLY the allowed list; an empty list means the master; not loaded = nothing', () => {
    expect(allowedSpecimensFor(a, { a: map('a', [urine, sputum]) }, master).map(s => s.code)).toEqual(['SPEC013', 'SPEC005']);
    expect(allowedSpecimensFor(a, { a: map('a', []) }, master)).toEqual(master);
    expect(allowedSpecimensFor(a, {}, master)).toEqual([]);
    expect(allowedSpecimensFor(f, { f: map('f', [blood]) }, master)).toEqual([]);   // fixed: no picker
  });

  it('a bundle offers what EVERY choosing member allows', () => {
    const maps = { a: map('a', [urine, sputum]), b: map('b', [sputum, blood]) };
    expect(allowedSpecimensFor(bundle, maps, master, byId).map(s => s.code)).toEqual(['SPEC005']);
    expect(allowedSpecimensFor(bundle, { a: maps.a }, master, byId)).toEqual([]);   // b still loading
  });

  it('a single default preselects (by CODE); none or several do not', () => {
    expect(deskDefaultCode(a, { a: map('a', [urine, sputum]) })).toBe('SPEC013');
    expect(deskDefaultCode(a, { a: map('a', [{ ...urine, isDefault: false }, sputum]) })).toBeNull();
    expect(deskDefaultCode(a, { a: map('a', [urine, { ...sputum, isDefault: true }]) })).toBeNull();
    expect(deskDefaultCode(a, {})).toBeNull();
  });

  it('a bundle preselects only when every choosing member names the same default', () => {
    expect(deskDefaultCode(bundle, { a: map('a', [urine]), b: map('b', [urine, sputum]) }, byId)).toBe('SPEC013');
    expect(deskDefaultCode(bundle, { a: map('a', [urine]), b: map('b', [{ ...sputum, isDefault: true }]) }, byId)).toBeNull();
    expect(deskDefaultCode(bundle, { a: map('a', [urine]) }, byId)).toBeNull();
  });

  it('a stored value resolves by code first, then by name; the fixed specimen is the single default or the only row', () => {
    expect(findAllowed(master, 'spec005')?.name).toBe('Sputum');
    expect(findAllowed(master, ' blood ')?.code).toBe('SPEC026');
    expect(findAllowed(master, 'Pus')).toBeNull();
    expect(fixedSpecimenOf(map('f', [blood]))?.code).toBe('SPEC026');
    expect(fixedSpecimenOf(map('f', [urine, blood]))?.code).toBe('SPEC013');
    expect(fixedSpecimenOf(map('f', [{ ...urine, isDefault: false }, blood]))).toBeNull();
    expect(fixedSpecimenOf(null)).toBeNull();
  });

  it('a line bills at the specimen\'s own price when it has one, else the test price', () => {
    expect(specimenLinePrice(100, sputum)).toBe(250);
    expect(specimenLinePrice(100, urine)).toBe(100);
    expect(specimenLinePrice(100, null)).toBe(100);
  });
});
