import { aliasByCatalogKey, memberDisplayName, memberInfoIndex } from './profile-member-names';

describe('profile-member-names', () => {
  // The server answers with the authored id (memberId) AND the resolved row's id (testId).
  const infos = memberInfoIndex([
    { memberId: 'master-crp', testId: 'ovr-crp', catalogKey: 'K-CRP', name: 'CRP', status: 'active' },
    { memberId: 'nokey', testId: 'nokey', catalogKey: null, status: 'missing' },
  ]);

  it('aliases a stored master id to the list row with the same catalog key', () => {
    const local = { id: 'local-crp', name: 'C-Reactive Protein', catalogKey: 'K-CRP' };
    const byId = new Map([[local.id, local]]);
    const out = aliasByCatalogKey(byId, ['master-crp', 'nokey', 'local-crp'], infos);
    expect(out.get('master-crp')).toBe(local);
    expect(out.has('nokey')).toBe(false);
    expect(out.get('local-crp')).toBe(local);
    expect(byId.size).toBe(1);   // input untouched
  });

  it('indexes by the authored id first, the resolved id second; an older server pairs by position', () => {
    expect(infos.get('master-crp')?.name).toBe('CRP');
    expect(infos.get('ovr-crp')?.name).toBe('CRP');
    const old = memberInfoIndex([{ testId: 'ovr-a', name: 'A' }, { testId: 'ovr-b', name: 'B' }], ['m-a', 'm-b']);
    expect(old.get('m-b')?.name).toBe('B');
    // lengths differ (an item without an id): no guessing
    expect(memberInfoIndex([{ testId: 'x' }], ['a', 'b']).has('a')).toBe(false);
  });

  it('names: list row, family line, server row, then a plain reason', () => {
    expect(memberDisplayName({ local: { name: 'Hb' }, state: 'loaded' })).toBe('Hb');
    expect(memberDisplayName({ familyName: 'Casts', state: 'loaded' })).toBe('Casts');
    expect(memberDisplayName({ info: { testId: 'x', name: 'CRP', status: 'inactive' }, state: 'loaded' })).toBe('Inactive: CRP');
    expect(memberDisplayName({ local: { name: 'CRP' }, info: { testId: 'x', status: 'inactive' }, state: 'loaded' })).toBe('Inactive: CRP');
    expect(memberDisplayName({ info: { testId: 'x', status: 'family_line' }, state: 'loaded' })).toBe('Family line');
    expect(memberDisplayName({ info: { testId: 'x', status: 'missing' }, state: 'loaded' })).toBe('Removed from Test Master');
    expect(memberDisplayName({ info: { testId: 'x', name: 'ALT', status: 'active' }, state: 'loaded' })).toBe('ALT');
    expect(memberDisplayName({ state: 'loaded' })).toBe('Removed from Test Master');
    expect(memberDisplayName({ state: 'loading' })).toBe('Loading…');
    expect(memberDisplayName({ state: 'none' })).toBe('Not in the test list');
  });
});
