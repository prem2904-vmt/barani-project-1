import { OPD_DEV_ONLY_NOTE, FlagStorage, OPD_FLAG_KEY, OPD_PREVIEW_HEADER, installPfOpd, isApiRequest, opdConsolePreview, opdPreviewHeaders, opdVisible, readOpdFlag } from './opd-gate';

/** OPD dark build — the pure visibility rule and the silent `pf.opd()` hook. */
describe('opdVisible — the gate matrix (console flag × tenant entitlement)', () => {
  const rows: Array<[boolean, boolean, boolean]> = [
    // consoleFlag, tenantEntitled → visible
    [false, false, false], // everyone today (incl. the no-row "all modules on" default)
    [true, false, true],   // ANY signed-in user after pf.opd(): visible (no allowlist)
    [false, true, true],   // explicitly entitled tenant: visible, no flag
    [true, true, true],
  ];
  it.each(rows)('flag=%s entitled=%s → %s', (consoleFlag, tenantEntitled, expected) => {
    expect(opdVisible({ consoleFlag, tenantEntitled })).toBe(expected);
  });

  it('console preview is exactly the flag', () => {
    expect(opdConsolePreview({ consoleFlag: true, tenantEntitled: false })).toBe(true);
    expect(opdConsolePreview({ consoleFlag: true, tenantEntitled: true })).toBe(true);
    expect(opdConsolePreview({ consoleFlag: false, tenantEntitled: true })).toBe(false);
  });
});

describe('opdPreviewHeaders / isApiRequest', () => {
  it('adds X-PF-OPD: 1 only while the flag is exactly "1"', () => {
    expect(opdPreviewHeaders(fakeStorage({ [OPD_FLAG_KEY]: '1' }))).toEqual({ [OPD_PREVIEW_HEADER]: '1' });
    expect(OPD_PREVIEW_HEADER).toBe('X-PF-OPD');
    expect(opdPreviewHeaders(fakeStorage())).toEqual({});
    expect(opdPreviewHeaders(fakeStorage({ [OPD_FLAG_KEY]: 'true' }))).toEqual({});
    expect(opdPreviewHeaders(null)).toEqual({});
  });
  it('matches our API urls only', () => {
    expect(isApiRequest('/api/opd/visits')).toBe(true);
    expect(isApiRequest('https://med-fetch-dev.prefrontal.health/api/auth/me')).toBe(true);
    expect(isApiRequest('https://x.supabase.co/auth/v1/token')).toBe(false);
    expect(isApiRequest('https://prefrontal.sgp1.digitaloceanspaces.com/t/report.pdf')).toBe(false);
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

describe('OPD preview is dev-only (owner 2026-11-21)', () => {
  it('readOpdFlag: a stored 1 counts on dev, is ignored off dev', () => {
    const st = fakeStorage({ [OPD_FLAG_KEY]: '1' });
    expect(readOpdFlag(st, true)).toBe(true);
    expect(readOpdFlag(st, false)).toBe(false);
  });

  it('opdPreviewHeaders: no X-PF-OPD off dev even with the flag set', () => {
    const st = fakeStorage({ [OPD_FLAG_KEY]: '1' });
    expect(opdPreviewHeaders(st, true)).toEqual({ [OPD_PREVIEW_HEADER]: '1' });
    expect(opdPreviewHeaders(st, false)).toEqual({});
  });

  it('off dev, pf.opd() only prints the note: nothing stored, no reload', () => {
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    const st = fakeStorage();
    let reloads = 0;
    const notes: string[] = [];
    installPfOpd(win, st, () => { reloads++; }, false, m => notes.push(m));
    const opd = win.pf!['opd'] as (on?: unknown) => void;
    opd(); opd(false);
    expect(notes).toEqual([OPD_DEV_ONLY_NOTE, OPD_DEV_ONLY_NOTE]);
    expect(OPD_DEV_ONLY_NOTE).toBe('OPD preview is available on dev only');
    expect(st.data).toEqual({});
    expect(reloads).toBe(0);
  });

  it('off dev, entitlement still opens OPD while a leftover flag does nothing', () => {
    const flag = readOpdFlag(fakeStorage({ [OPD_FLAG_KEY]: '1' }), false);
    expect(opdVisible({ consoleFlag: flag, tenantEntitled: false })).toBe(false);
    expect(opdVisible({ consoleFlag: flag, tenantEntitled: true })).toBe(true);
  });
});
