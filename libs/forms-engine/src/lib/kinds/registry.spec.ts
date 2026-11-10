import manifest from '../testing/components.manifest.json';
import { KNOWN_KINDS } from '../core/types';
import { kindControl, preloadKinds } from '../fill/contract';
import { KIND_SPECS, LAZY_KINDS, tapCompletes } from './registry';

/** Plan §4: one definition drives everything — every catalogue kind has a fill control, and nothing else is registered. */
describe('kind registry', () => {
  const catalogue = (manifest as { kinds: { name: string }[] }).kinds.map((k) => k.name).sort();

  it('every kind in the API catalogue has a fill control', () => {
    const missing = catalogue.filter((k) => !(k in KIND_SPECS));
    expect(missing).toEqual([]);
  });

  it('the registry has no kind the catalogue does not know', () => {
    expect(Object.keys(KIND_SPECS).sort()).toEqual(catalogue);
    expect([...KNOWN_KINDS].sort()).toEqual(catalogue);
  });

  it('one-tap kinds (auto-advance)', () => {
    expect(tapCompletes('choice')).toBe(true);
    expect(tapCompletes('yesno', 'buttons')).toBe(true);
    expect(tapCompletes('yesno', 'check')).toBe(false);
    expect(tapCompletes('duration', 'period')).toBe(true);
    expect(tapCompletes('text')).toBe(false);
    expect(tapCompletes('multi')).toBe(false);
  });

  it('heavy kinds are loaded on first use; plain kinds are bundled (bundle budget)', async () => {
    for (const [k, spec] of Object.entries(KIND_SPECS)) {
      if (LAZY_KINDS.includes(k)) {
        expect(spec.component, k).toBeUndefined();
        expect(typeof spec.load, k).toBe('function');
      } else {
        expect(spec.component, k).toBeDefined();
      }
    }
    for (const k of LAZY_KINDS) {
      const spec = (KIND_SPECS as Record<string, (typeof KIND_SPECS)['text']>)[k];
      const first = kindControl(spec);
      expect(first instanceof Promise || typeof first === 'function', k).toBe(true);
      const cls = await first;
      expect(typeof cls, k).toBe('function');
      // once loaded, the class comes back straight away (no flicker on the next page)
      expect(kindControl(spec)).toBe(cls);
    }
  });

  it('preloading fetches a form\'s heavy kinds and ignores unknown ones', async () => {
    let calls = 0;
    const fake = { component: undefined, load: () => (calls++, Promise.resolve(class X {} as never)) };
    await preloadKinds({ fake, text: KIND_SPECS.text }, ['fake', 'fake', 'text', 'nope']);
    expect(calls).toBe(1);
    expect(typeof kindControl(fake)).toBe('function');
  });

  it('a failed load is tried again next time', async () => {
    let n = 0;
    const flaky = { load: () => (++n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(class Y {} as never)) };
    await expect(kindControl(flaky) as Promise<unknown>).rejects.toThrow('offline');
    expect(typeof (await kindControl(flaky))).toBe('function');
  });
});
