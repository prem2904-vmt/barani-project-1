import { fastingGroups, fastingText, infoDefaultOpen, infoDocked, infoKey, infoTier, readInfoOpen, writeInfoOpen } from './info-panel';

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}
const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };

describe('info panel — tier by width', () => {
  it('desktop from 1280px, tablet 641–1279, phone up to 640', () => {
    expect(infoTier(1440)).toBe('desktop');
    expect(infoTier(1280)).toBe('desktop');
    expect(infoTier(1279)).toBe('tablet');
    expect(infoTier(1180)).toBe('tablet');
    expect(infoTier(820)).toBe('tablet');
    expect(infoTier(641)).toBe('tablet');
    expect(infoTier(640)).toBe('phone');
    expect(infoTier(390)).toBe('phone');
  });
  it('docked + open by default only on desktop', () => {
    expect(infoDocked('desktop')).toBe(true);
    expect(infoDocked('tablet')).toBe(false);
    expect(infoDefaultOpen('desktop')).toBe(true);
    expect(infoDefaultOpen('tablet')).toBe(false);
    expect(infoDefaultOpen('phone')).toBe(false);
  });
});

describe('info panel — remembered choice', () => {
  it('falls back to the tier default when nothing is stored', () => {
    const s = memStore();
    expect(readInfoOpen(s, 'u1', 'desktop')).toBe(true);
    expect(readInfoOpen(s, 'u1', 'tablet')).toBe(false);
  });
  it('remembers per user and per tier', () => {
    const s = memStore();
    writeInfoOpen(s, 'u1', 'desktop', false);
    writeInfoOpen(s, 'u1', 'tablet', true);
    expect(readInfoOpen(s, 'u1', 'desktop')).toBe(false);
    expect(readInfoOpen(s, 'u1', 'tablet')).toBe(true);
    expect(readInfoOpen(s, 'u1', 'phone')).toBe(false);      // untouched tier keeps its default
    expect(readInfoOpen(s, 'u2', 'desktop')).toBe(true);     // another user keeps the default
    expect(s.m.get(infoKey('u1', 'desktop'))).toBe('0');
    expect(infoKey('u1', 'tablet')).toBe('pf-lms.collect.info.u1.tablet');
    expect(infoKey(null, 'phone')).toBe('pf-lms.collect.info.anon.phone');
  });
  it('ignores junk values and survives storage that throws or is missing', () => {
    const s = memStore();
    s.setItem(infoKey('u1', 'desktop'), 'yes');
    expect(readInfoOpen(s, 'u1', 'desktop')).toBe(true);
    expect(readInfoOpen(throwing, 'u1', 'desktop')).toBe(true);
    expect(readInfoOpen(throwing, 'u1', 'tablet')).toBe(false);
    expect(() => writeInfoOpen(throwing, 'u1', 'tablet', true)).not.toThrow();
    expect(readInfoOpen(null, 'u1', 'tablet')).toBe(false);
  });
});

describe('fasting text', () => {
  it('turns a timed series into one sorted short list', () => {
    const g = fastingGroups(['OGTT – 120 Minutes', 'OGTT – 30 Minutes', 'OGTT – 180 Minutes', 'OGTT – 60 Minutes']);
    expect(g).toEqual([{ base: 'OGTT', offsets: ['30 min', '60 min', '120 min', '180 min'] }]);
  });
  it('reads hours as minutes, dedupes, keeps plain names after the series', () => {
    const g = fastingGroups(['Glucose Fasting', 'GTT 2 Hours', 'GTT - 1 hr', 'GTT 2h', 'Glucose Fasting', 'Vitamin B12']);
    expect(g).toEqual([
      { base: 'GTT', offsets: ['60 min', '120 min'] },
      { base: 'Glucose Fasting', offsets: [] },
      { base: 'Vitamin B12', offsets: [] },
    ]);
  });
  it('full text for the chip', () => {
    expect(fastingText(['OGTT – 60 Minutes', 'OGTT – 30 Minutes', 'Lipid Profile']))
      .toBe('Fasting required: OGTT 30 min · 60 min; Lipid Profile');
    expect(fastingText([])).toBe('');
  });
});
