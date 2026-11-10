import manifest from '../testing/components.manifest.json';
import { FieldDef } from '../core/types';
import { KIND_BUILDS, kindBuild } from './build-registry';
import { resolve } from '../build/contract';
import { ICONS } from '../kit';

type Kind = { name: string; configSchema: { properties?: Record<string, unknown> }; examples: { field: FieldDef }[] };
const kinds = (manifest as unknown as { kinds: Kind[] }).kinds;

/** Plan §4: every catalogue kind also has a Studio descriptor (palette name, icon, sentence, sample). */
describe('kind build registry', () => {
  it('every catalogue kind has a build descriptor, and nothing extra', () => {
    expect(Object.keys(KIND_BUILDS).sort()).toEqual(kinds.map((k) => k.name).sort());
  });

  it('names are plain words, icons exist, settings name real config properties', () => {
    for (const k of kinds) {
      const b = KIND_BUILDS[k.name as keyof typeof KIND_BUILDS];
      expect(b.name, k.name).not.toMatch(/[a-z][A-Z]/); // no camelCase in a doctor's word
      expect(b.icon in ICONS, `${k.name} icon ${b.icon}`).toBe(true);
      const props = Object.keys(k.configSchema.properties ?? {});
      for (const c of b.config) expect(props, `${k.name}.${c.name}`).toContain(c.name);
    }
  });

  it('every catalogue example yields a sample answer and condition words', () => {
    for (const k of kinds)
      for (const ex of k.examples) {
        const b = kindBuild(k.name);
        expect(() => b.sample(ex.field)).not.toThrow();
        expect(resolve(b.conditionOps, ex.field).length, k.name).toBeGreaterThan(0);
      }
  });

  it('an unknown (imported) kind still has a safe descriptor', () => {
    const b = kindBuild('scribblePad');
    expect(b.name).toBe('Not supported yet');
    expect(b.conditionOps).toEqual([]);
  });
});
