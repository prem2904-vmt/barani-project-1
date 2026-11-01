import {
  MIN_ACCENT_CONTRAST, MIN_HIGH_LOW_GAP, MIN_TEXT_CONTRAST, PALETTES, PALETTE_KEYS, TODAY_COLORS, allChecksPass, checkColors,
  contrastRatio, derivePaletteFromAccent, detectPalette, greyOf, isNeon, lightness, mix, normalizeHex, paletteColumns,
  readableOn, templateColors,
} from './report-palettes';

describe('report palettes — colour maths', () => {
  it('contrast: black on white is 21, same colour is 1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
  it('lightness runs 0 (black) to 100 (white)', () => {
    expect(lightness('#000000')).toBeCloseTo(0, 1);
    expect(lightness('#ffffff')).toBeCloseTo(100, 0);
  });
  it('normalizeHex accepts #rgb / rrggbb and refuses junk', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('1B3A6B')).toBe('#1b3a6b');
    for (const v of ['', 'red', '#12', null, 5, '#gggggg']) expect(normalizeHex(v)).toBeNull();
  });
  it('mix and readableOn', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(readableOn('#ffffff')).toBe('#000000');
    expect(readableOn('#1B3A6B')).toBe('#ffffff');
  });
  it('greyOf is a neutral grey of the same lightness', () => {
    const g = greyOf('#2a68d6');
    expect(g.slice(1, 3)).toBe(g.slice(3, 5));
    expect(g.slice(3, 5)).toBe(g.slice(5, 7));
    expect(Math.abs(lightness(g) - lightness('#2a68d6'))).toBeLessThan(1.5);
  });
  it('a neon is flagged, a deep colour is not', () => {
    expect(isNeon('#39ff14')).toBe(true);
    expect(isNeon('#1B3A6B')).toBe(false);
  });
});

describe('report palettes — the six curated palettes are print-safe', () => {
  it('there are six, with unique ids and every colour column present', () => {
    expect(PALETTES.map(p => p.id)).toEqual(['ink', 'navy', 'teal', 'forest', 'plum', 'slate']);
    for (const p of PALETTES) expect(Object.keys(p.colors).sort()).toEqual([...PALETTE_KEYS].sort());
  });

  for (const p of PALETTES) {
    it(`${p.label}: every check passes — contrast >= ${MIN_TEXT_CONTRAST}, High / Low >= ${MIN_HIGH_LOW_GAP} L* apart`, () => {
      const checks = checkColors(p.colors, true);
      expect(checks.filter(c => !c.ok).map(c => c.id)).toEqual([]);
      expect(allChecksPass(checks)).toBe(true);
      const c = p.colors;
      expect(contrastRatio(c.tableHeaderText, c.tableHeaderBg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(c.primaryColor, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(c.abnormalColor, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(c.abnormalLowColor, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(c.accentColor, '#ffffff')).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
      expect(Math.abs(lightness(c.abnormalLowColor) - lightness(c.abnormalColor))).toBeGreaterThanOrEqual(MIN_HIGH_LOW_GAP);
    });
  }

  it('the High and Low greys are different greys for every palette (not colour-only)', () => {
    for (const p of PALETTES) expect(greyOf(p.colors.abnormalColor)).not.toBe(greyOf(p.colors.abnormalLowColor));
  });

  it('palette columns are exactly the seven colour keys', () => {
    expect(Object.keys(paletteColumns(PALETTES[2].colors)).sort()).toEqual([...PALETTE_KEYS].sort());
  });
});

describe('report palettes — the check', () => {
  it("today's red / blue are too alike in greyscale (documents why the palettes spread them)", () => {
    const bad = checkColors(TODAY_COLORS, true).find(c => c.id === 'flags-grey')!;
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/H and L letters/);
  });
  it('when flags print without colour, the greyscale check passes by construction', () => {
    const c = checkColors(TODAY_COLORS, false);
    expect(c.find(x => x.id === 'flags-grey')!.ok).toBe(true);
    expect(c.find(x => x.id === 'flags-text')).toBeUndefined();
  });
  it('low-contrast header text, a pale lab name and a neon accent are each reported in plain words', () => {
    const c = checkColors({ tableHeaderBg: '#eeeeee', tableHeaderText: '#cccccc', primaryColor: '#dddddd', accentColor: '#39ff14' }, false);
    const by = Object.fromEntries(c.map(x => [x.id, x]));
    expect(by['header-text'].ok).toBe(false);
    expect(by['header-text'].detail).toMatch(/needs 4.5 : 1/);
    expect(by['lab-name'].ok).toBe(false);
    expect(by['accent'].ok).toBe(false);
    expect(by['accent'].detail).toMatch(/neon/);
  });
  it('blank or junk columns use the renderer defaults and never throw', () => {
    expect(() => checkColors({ primaryColor: '', accentColor: 'nope' as string })).not.toThrow();
    expect(templateColors({ primaryColor: '' })).toEqual(TODAY_COLORS);
  });
});

describe('report palettes — custom accent', () => {
  it('derives a header tint, readable text and a hairline from one colour', () => {
    const d = derivePaletteFromAccent('#0E7C86');
    expect(d.accentColor).toBe('#0e7c86');
    expect(contrastRatio(d.tableHeaderText, d.tableHeaderBg)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(d.primaryColor, '#ffffff')).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(lightness(d.tableHeaderBg)).toBeGreaterThan(90);
  });
  it('a sensible accent gives a fully passing set; a pale one is caught', () => {
    for (const a of ['#0066CC', '#7B2D8E', '#B45309', '#2E7D32']) expect(allChecksPass(checkColors(derivePaletteFromAccent(a), true))).toBe(true);
    const pale = checkColors(derivePaletteFromAccent('#ffe08a'), true);
    expect(pale.find(c => c.id === 'accent')!.ok).toBe(false);
    expect(pale.find(c => c.id === 'lab-name')!.ok).toBe(true);   // the lab name is darkened until it reads
  });
  it('a junk accent falls back to the default', () => {
    expect(derivePaletteFromAccent('zzz').accentColor).toBe(TODAY_COLORS.accentColor.toLowerCase());
  });
});

describe('report palettes — detection', () => {
  it('a template carrying a palette exactly is detected; anything else is custom', () => {
    for (const p of PALETTES) expect(detectPalette(paletteColumns(p.colors))).toBe(p.id);
    expect(detectPalette({})).toBe('custom');
    expect(detectPalette({ ...paletteColumns(PALETTES[1].colors), accentColor: '#123456' })).toBe('custom');
  });
});
