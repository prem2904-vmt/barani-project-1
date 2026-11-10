import { CORTEX_IMPORT_FLAG_KEY, cortexImportOn, installPfCortexImport } from './cortex-import-gate';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('pf.cortexImport() console switch', () => {
  it('is off until it is switched on, and pf.cortexImport(false) turns it off', () => {
    const s = mem();
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = { pf: { opd: () => 1 } };
    const reload = vi.fn();
    installPfCortexImport(win, s, reload);
    expect(typeof win.pf!['opd']).toBe('function'); // merged, not replaced
    expect(cortexImportOn(s)).toBe(false);
    (win.pf!['cortexImport'] as () => void)();
    expect(s.getItem(CORTEX_IMPORT_FLAG_KEY)).toBe('1');
    expect(cortexImportOn(s)).toBe(true);
    (win.pf!['cortexImport'] as (on: boolean) => void)(false);
    expect(cortexImportOn(s)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a blocked storage is simply off', () => {
    expect(cortexImportOn({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined })).toBe(false);
    expect(cortexImportOn(null)).toBe(false);
  });
});
