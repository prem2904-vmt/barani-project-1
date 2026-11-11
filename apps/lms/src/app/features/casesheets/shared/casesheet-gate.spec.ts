import {
  CASESHEETS_FLAG_KEY, CASESHEETS_HEADER, FlagStorage, casesheetsHeaders, casesheetsVisible, installPfCasesheets,
  ipdExplicitlyOn, readCasesheetsFlag,
} from './casesheet-gate';

/** Case sheets (part of IPD) — the pure visibility rule and the silent `pf.casesheets()` hook. */
describe('casesheetsVisible — dev && (explicit IPD || personal tenant || console flag)', () => {
  // isDev, ipdExplicit, personalTenant, consoleFlag → visible
  const rows: Array<[boolean, boolean, boolean, boolean, boolean]> = [
    [true, false, false, false, false],  // every lab today (incl. the no-row "all modules on" default)
    [true, true, false, false, true],    // tenant explicitly has IPD on
    [true, false, true, false, true],    // personal case-sheet space
    [true, false, false, true, true],    // pf.casesheets() in this browser
    [false, true, true, true, false],    // never outside dev, whatever else holds
    [false, false, false, true, false],
  ];
  it.each(rows)('dev=%s ipd=%s personal=%s flag=%s → %s', (isDev, ipdExplicit, personalTenant, consoleFlag, expected) => {
    expect(casesheetsVisible({ isDev, ipdExplicit, personalTenant, consoleFlag })).toBe(expected);
  });
});

describe('casesheetsVisible — every lab on dev (owner 2026-11-11)', () => {
  it('opens for a signed-in lab without IPD, only on dev', () => {
    expect(casesheetsVisible({ isDev: true, labTenant: true, ipdExplicit: false, personalTenant: false, consoleFlag: false })).toBe(true);
    expect(casesheetsVisible({ isDev: false, labTenant: true, ipdExplicit: true, personalTenant: false, consoleFlag: true })).toBe(false);
    expect(casesheetsVisible({ isDev: true, labTenant: false, ipdExplicit: false, personalTenant: false, consoleFlag: false })).toBe(false);
  });
  it('closes when an admin switched IPD off (the console flag still previews)', () => {
    expect(casesheetsVisible({ isDev: true, labTenant: true, ipdOff: true, ipdExplicit: false, personalTenant: false, consoleFlag: false })).toBe(false);
    expect(casesheetsVisible({ isDev: true, labTenant: true, ipdOff: true, ipdExplicit: false, personalTenant: false, consoleFlag: true })).toBe(true);
  });
});

describe('ipdExplicitlyOn — IPD must be EXPLICIT (owner 2026-11-10)', () => {
  it('only a stored ipd.enabled === true counts', () => {
    expect(ipdExplicitlyOn({ ipd: { enabled: true } })).toBe(true);
    expect(ipdExplicitlyOn(null)).toBe(false);                               // no module row
    expect(ipdExplicitlyOn(undefined)).toBe(false);
    expect(ipdExplicitlyOn({ lab: { enabled: true }, inventory: { enabled: true } })).toBe(false); // legacy seed
    expect(ipdExplicitlyOn({ ipd: { enabled: false } })).toBe(false);
    expect(ipdExplicitlyOn({ ipd: { enabled: 'true' } })).toBe(false);
    expect(ipdExplicitlyOn({ ipd: {} })).toBe(false);
    expect(ipdExplicitlyOn({ opd: { enabled: true } })).toBe(false);
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

describe('the console flag + header', () => {
  it('flag is on only for the exact "1"', () => {
    expect(CASESHEETS_FLAG_KEY).toBe('pf.casesheets');
    expect(readCasesheetsFlag(fakeStorage({ [CASESHEETS_FLAG_KEY]: '1' }))).toBe(true);
    expect(readCasesheetsFlag(fakeStorage({ [CASESHEETS_FLAG_KEY]: 'true' }))).toBe(false);
    expect(readCasesheetsFlag(fakeStorage())).toBe(false);
    expect(readCasesheetsFlag(null)).toBe(false);
    expect(readCasesheetsFlag({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined })).toBe(false);
  });
  it('X-PF-CASESHEETS: 1 only while the flag is set', () => {
    expect(CASESHEETS_HEADER).toBe('X-PF-CASESHEETS');
    expect(casesheetsHeaders(fakeStorage({ [CASESHEETS_FLAG_KEY]: '1' }))).toEqual({ 'X-PF-CASESHEETS': '1' });
    expect(casesheetsHeaders(fakeStorage())).toEqual({});
    expect(casesheetsHeaders(null)).toEqual({});
  });
});

describe('installPfCasesheets — window.pf.casesheets()', () => {
  it('merges into an existing window.pf (pf.opd, beta switches) and never replaces it', () => {
    const opd = () => 'kept';
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = { pf: { opd } };
    installPfCasesheets(win, fakeStorage(), () => undefined);
    expect(win.pf!['opd']).toBe(opd);
    expect(typeof win.pf!['casesheets']).toBe('function');
  });

  it('pf.casesheets() sets the flag and reloads; pf.casesheets(false) clears it and reloads', () => {
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    const store = fakeStorage();
    let reloads = 0;
    installPfCasesheets(win, store, () => { reloads++; });
    const cs = win.pf!['casesheets'] as (on?: unknown) => void;
    cs();
    expect(store.data[CASESHEETS_FLAG_KEY]).toBe('1');
    cs(false);
    expect(CASESHEETS_FLAG_KEY in store.data).toBe(false);
    cs(true);
    expect(store.data[CASESHEETS_FLAG_KEY]).toBe('1');
    cs('off');
    expect(CASESHEETS_FLAG_KEY in store.data).toBe(false);
    expect(reloads).toBe(4);
  });

  it('is silent — installing and calling it prints nothing', () => {
    const spies = (['log', 'info', 'warn', 'debug', 'error'] as const).map(m => vi.spyOn(console, m).mockImplementation(() => undefined));
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = {};
    installPfCasesheets(win, fakeStorage(), () => undefined);
    (win.pf!['casesheets'] as () => void)();
    for (const s of spies) { expect(s).not.toHaveBeenCalled(); s.mockRestore(); }
  });
});
