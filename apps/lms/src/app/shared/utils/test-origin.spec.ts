import {
  canRevertToMaster, isCloneMode, originHint, originLabel, originOf, restoreDefaultsMessage, restoreDefaultsSummary,
  revertToMasterPath, ORIGIN_ICON_PATHS,
} from './test-origin';

/** Test Master single source — where a row comes from. */
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
    expect(originHint({ origin: 'master' })).toContain('Read from the Admin Test Master');
    expect(originHint({ origin: 'master', catalogMode: 'reference' })).toContain('Read from the Admin Test Master');
  });

  it('clone mode: the lab holds its own copy — never "read from the master", no revert', () => {
    const row = { origin: 'master', catalogMode: 'clone' };
    expect(isCloneMode(row)).toBe(true);
    expect(originLabel(row)).toBe('Master copy');
    expect(originHint(row)).not.toContain('Read from');
    expect(originHint(row)).toContain('copy');
    expect(originHint({ origin: 'customised', catalogMode: 'clone' })).not.toContain('Revert');
    expect(originLabel({ origin: 'local', catalogMode: 'clone' })).toBe('Own test');
    expect(canRevertToMaster({ origin: 'customised', catalogMode: 'clone' })).toBe(false);
    expect(canRevertToMaster({ origin: 'branch', catalogMode: 'clone' })).toBe(false);
  });

  it('every origin has a stroked SVG path (never emoji)', () => {
    for (const k of ['master', 'customised', 'branch', 'local'] as const) {
      expect(ORIGIN_ICON_PATHS[k]).toMatch(/^M[\d .,-]/);
    }
  });

  it('only a lab copy (customised / branch) can revert to the master', () => {
    expect(canRevertToMaster({ origin: 'customised' })).toBe(true);
    expect(canRevertToMaster({ origin: 'branch', catalogMode: 'reference' })).toBe(true);
    expect(canRevertToMaster({ origin: 'master' })).toBe(false);
    expect(canRevertToMaster({ origin: 'local' })).toBe(false);
    expect(revertToMasterPath('t9')).toBe('/api/tests/t9/revert-to-master');
  });

  it('restore-to-default copy keeps prices (never "reset to ₹0")', () => {
    for (const who of ['lab', 'tenant'] as const) {
      const m = restoreDefaultsMessage(who);
      expect(m).toContain('Prices');
      expect(m).toContain('kept');
      expect(m).not.toMatch(/reset to (₹)?0/);
    }
    expect(restoreDefaultsMessage('lab')).toMatch(/^Your lab's own copies/);
    expect(restoreDefaultsMessage('tenant')).toMatch(/^This tenant's own copies/);
    expect(restoreDefaultsSummary({ deleted: 2, parked: 1, cloned: 0, mode: 'reference' })).toBe('Restored — 3 lab copies removed; prices kept.');
    expect(restoreDefaultsSummary({ deleted: 0, parked: 0, cloned: 0, mode: 'reference' })).toContain('Nothing to restore');
    expect(restoreDefaultsSummary({ deleted: 4, parked: 1, cloned: 500 })).toContain('500 default tests loaded');
  });
});
