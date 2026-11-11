import { CORTEX_BUILDER_FLAG_KEY, cortexBuilderOn, installPfCortexBuilder } from './cortex-builder-gate';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};

describe('pf.cortexBuilder() console switch', () => {
  it('is off until switched on (flag off = nothing shows); pf.cortexBuilder(false) turns it off; merges into window.pf', () => {
    const s = mem();
    const win: { pf?: Record<string, unknown> } & Record<string, unknown> = { pf: { opd: () => 1 } };
    const reload = vi.fn();
    installPfCortexBuilder(win, s, reload);
    expect(typeof win.pf!['opd']).toBe('function');
    expect(cortexBuilderOn(s)).toBe(false);
    (win.pf!['cortexBuilder'] as () => void)();
    expect(s.getItem(CORTEX_BUILDER_FLAG_KEY)).toBe('1');
    expect(cortexBuilderOn(s)).toBe(true);
    (win.pf!['cortexBuilder'] as (on: boolean) => void)(false);
    expect(cortexBuilderOn(s)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('a blocked storage is simply off', () => {
    expect(cortexBuilderOn({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined, removeItem: () => undefined })).toBe(false);
    expect(cortexBuilderOn(null)).toBe(false);
  });
});
