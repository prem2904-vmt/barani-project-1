import { emptyDefinition, addPage } from './doc';
import { PALETTE, PALETTE_GROUPS, paletteField } from './legacy-palette';
import { ICONS } from '../icons/icons';
import { KNOWN_KINDS } from '../core/types';

describe('legacy palette', () => {
  it('has the legacy groups in order, then the Department group', () => {
    expect(PALETTE_GROUPS).toEqual(['Input Fields', 'Selection Fields', 'Special Fields', 'Department']);
  });

  it('every tile maps to a known kind and a real icon', () => {
    for (const e of PALETTE) {
      expect(KNOWN_KINDS as readonly string[], e.id).toContain(e.kind);
      expect(Object.keys(ICONS), e.id).toContain(e.icon);
    }
  });

  it('every kind appears in some tile, so nothing is unreachable', () => {
    const used = new Set(PALETTE.map((e) => e.kind));
    for (const k of KNOWN_KINDS) expect(used.has(k), k).toBe(true);
  });

  it('a checkbox is multiple choice, a toggle is a yes/no slider with two worded options', () => {
    const d = addPage(emptyDefinition('x'), 'P').def;
    const cb = paletteField(d, PALETTE.find((e) => e.id === 'checkbox')!);
    expect(cb.kind).toBe('multi');
    const tg = paletteField(d, PALETTE.find((e) => e.id === 'toggle')!);
    expect(tg.kind).toBe('yesno');
    expect(tg.config).toMatchObject({ display: 'switch', labelFallback: true });
    expect(tg.options?.map((o) => o.label)).toEqual(['No', 'Yes']);
  });

  it('keys stay unique when the same tile is used twice', () => {
    let d = addPage(emptyDefinition('x'), 'P').def;
    const a = paletteField(d, PALETTE[0]);
    d = { ...d, pages: [{ ...d.pages[0], fields: [a] }] };
    const b = paletteField(d, PALETTE[0]);
    expect(b.key).not.toBe(a.key);
  });
});
