import { FlagStorage, OPD_FLAG_KEY, installPfOpd, opdConsolePreview, opdVisible, readOpdFlag } from './opd-gate';

/** OPD dark build — the pure visibility rule and the silent `pf.opd()` hook. */
describe('opdVisible — the gate matrix (flag × server access × tenant entitlement)', () => {
  const rows: Array<[boolean, boolean, boolean, boolean]> = [
    // consoleFlag, serverAccess, tenantEntitled → visible
    [false, false, false, false], // everyone today
    [true, false, false, false],  // a non-owner typing pf.opd(): nothing
    [false, true, false, false],  // owner without the flag: still dark
    [true, true, false, true],    // owner + pf.opd(): visible
    [false, true, true, true],    // explicitly entitled tenant: visible, no flag
    [true, true, true, true],
    [false, false, true, false],  // (inconsistent server data) entitlement w/o access: dark
    [true, false, true, false],
  ];
  it.each(rows)('flag=%s access=%s entitled=%s → %s', (consoleFlag, serverAccess, tenantEntitled, expected) => {
    expect(opdVisible({ consoleFlag, serverAccess, tenantEntitled })).toBe(expected);
  });

  it('console preview is exactly flag AND server access', () => {
    expect(opdConsolePreview({ consoleFlag: true, serverAccess: true, tenantEntitled: false })).toBe(true);
    expect(opdConsolePreview({ consoleFlag: true, serverAccess: false, tenantEntitled: false })).toBe(false);
    expect(opdConsolePreview({ consoleFlag: false, serverAccess: true, tenantEntitled: true })).toBe(false);
  });
});

function fakeStorage(init: Record<string, string> = {}): FlagStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

describe('readOpdFlag', () => {
  it('is on only for the exact "1"', () => {
    expect(readOpdFlag(fakeStorage({ [OPD_FLAG_KEY]: '1' }))).toBe(true);
    expect(readOpdFlag(fakeStorage({ [OPD_FLAG_KEY]: 'true' }))).toBe(false);
    expect(readOpdFlag(fakeStorage())).toBe(false);
    expect(readOpdFlag(null)).toBe(false);
    expect(readOpdFlag({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined })).toBe(false);
  });
});

describe('installPfOpd — window.pf.opd()', () => {
  it('merges into an existing window.pf and never replaces it', () => {
    const other = () => 'kept';
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = { pf: { other } };
    installPfOpd(win, fakeStorage(), () => undefined);
    expect(win.pf!['other']).toBe(other);
    expect(typeof win.pf!['opd']).toBe('function');
  });

  it('pf.opd() sets the flag and reloads; pf.opd(false) clears it and reloads', () => {
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    const store = fakeStorage();
    let reloads = 0;
    installPfOpd(win, store, () => { reloads++; });
    const opd = win.pf!['opd'] as (on?: unknown) => void;
    opd();
    expect(store.data[OPD_FLAG_KEY]).toBe('1');
    opd(false);
    expect(OPD_FLAG_KEY in store.data).toBe(false);
    opd(true);
    expect(store.data[OPD_FLAG_KEY]).toBe('1');
    expect(reloads).toBe(3);
  });

  it('is silent — installing and calling it prints nothing', () => {
    const spies = (['log', 'info', 'warn', 'debug', 'error'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    installPfOpd(win, fakeStorage(), () => undefined);
    (win.pf!['opd'] as () => void)();
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }
  });
});
