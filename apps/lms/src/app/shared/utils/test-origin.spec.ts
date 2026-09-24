import {
  canRevertToMaster, isMasterCodeShape, isReservedForTenant, originHint, originLabel, originOf, revertToMasterPath,
  ORIGIN_ICON_PATHS,
} from './test-origin';

/** Test Master single source — where a row comes from + the reserved code shape. */
describe('test origin', () => {
  it('labels: Master / Customised / Branch / Own test; unknown or absent → none', () => {
    expect(originLabel({ origin: 'master' })).toBe('Master');
    expect(originLabel({ origin: 'customised' })).toBe('Customised');
    expect(originLabel({ origin: 'branch' })).toBe('Branch');
    expect(originLabel({ origin: 'local' })).toBe('Own test');
    expect(originLabel({ origin: 'Customised' })).toBe('Customised');
    expect(originLabel({ origin: 'weird' })).toBe('');
    expect(originLabel({})).toBe('');
    expect(originOf(null)).toBeNull();
    expect(originHint({ origin: 'master' })).toContain('Admin Test Master');
  });

  it('every origin has a stroked SVG path (never emoji)', () => {
    for (const k of ['master', 'customised', 'branch', 'local'] as const) {
      expect(ORIGIN_ICON_PATHS[k]).toMatch(/^M[\d .,-]/);
    }
  });

  it('only a lab copy (customised / branch) can revert to the master', () => {
    expect(canRevertToMaster({ origin: 'customised' })).toBe(true);
    expect(canRevertToMaster({ origin: 'branch' })).toBe(true);
    expect(canRevertToMaster({ origin: 'master' })).toBe(false);
    expect(canRevertToMaster({ origin: 'local' })).toBe(false);
    expect(revertToMasterPath('t9')).toBe('/api/tests/t9/revert-to-master');
  });

  it('master code shape = 3 letters + digits, no separator', () => {
    for (const c of ['BIO019', 'HEM012', 'cpy031', ' MIC105 ']) expect(isMasterCodeShape(c)).toBe(true);
    for (const c of ['MW-0001', 'BIO-019', 'BI019', 'BIOC019', 'LFT', '', null]) expect(isMasterCodeShape(c)).toBe(false);
  });

  it('a tenant may keep its copy\'s own master code but never take a new one', () => {
    expect(isReservedForTenant('BIO019', 'BIO019')).toBe(false);
    expect(isReservedForTenant('bio019', 'BIO019')).toBe(false);
    expect(isReservedForTenant('BIO020', 'BIO019')).toBe(true);
    expect(isReservedForTenant('BIO777', null)).toBe(true);
    expect(isReservedForTenant('MW-0001', null)).toBe(false);
    expect(isReservedForTenant('', null)).toBe(false);
  });
});
