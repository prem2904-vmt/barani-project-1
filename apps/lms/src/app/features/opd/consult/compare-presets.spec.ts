import { comparePresets, presetTitle } from './compare-presets';

const consults = [
  { visitId: 'v1', date: '2026-01-14', hasRx: false },
  { visitId: 'today', date: '2026-10-03', hasRx: true },
  { visitId: 'v3', date: '2026-08-12', hasRx: true },
  { visitId: 'v2', date: '2026-05-02', hasRx: true },
];
const img = (i: number) => ({ fileId: 'doc:i' + i, date: `2026-0${i}-01`, title: `Photo ${i}` });

describe('Compare presets (pure, on the data the consult already loads)', () => {
  const all = comparePresets({
    consults,
    reports: [{ fileId: 'rep:o1', date: '2026-09-27', title: 'FBS' }, { fileId: 'doc:pdf', date: '2026-01-14', title: 'Discharge.pdf' }],
    images: [1, 2, 3, 4, 5, 6, 7].map(img),
    trends: [
      { key: 'fbs', title: 'Fasting Blood Sugar', points: [{ date: '2026-01-14', value: 118 }, { date: '2026-09-27', value: 145 }] },
      { key: 'ldl', title: 'LDL', points: [{ date: '2026-01-14', value: 128 }] },
    ],
  });
  const by = (id: string) => all.find(p => p.id === id)!;

  it('lists the seven presets in menu order with counts', () => {
    expect(all.map(p => [p.label, p.count])).toEqual([
      ['Last 3 visits', 3], ['All visits', 4], ['All reports', 2], ['All images', 7], ['Last 6 images', 6], ['Lab trends', 1], ['Prescriptions', 3],
    ]);
  });

  it('last 3 visits = the three newest consults (today first); prescriptions = consults with an Rx, Rx section only', () => {
    expect(by('last3').picks).toEqual([{ kind: 'consult', visitId: 'today' }, { kind: 'consult', visitId: 'v3' }, { kind: 'consult', visitId: 'v2' }]);
    expect(by('rx').picks.map(p => p.kind === 'consult' && p.visitId)).toEqual(['today', 'v3', 'v2']);
    expect(by('rx').sections).toEqual(['rx']);
    expect(by('last3').sections).toBeUndefined();
  });

  it('last 6 images are the newest six; lab trends need 2+ results', () => {
    expect(by('last6img').picks.map(p => p.kind === 'file' && p.fileId)).toEqual(['doc:i7', 'doc:i6', 'doc:i5', 'doc:i4', 'doc:i3', 'doc:i2']);
    expect(by('last6img').picks.every(p => p.kind === 'file' && p.image)).toBe(true);
    expect(by('trends').picks.map(p => p.kind === 'trend' && p.trend.key)).toEqual(['fbs']);
  });

  it('a preset with nothing to compare has a count of 0 (the menu disables it)', () => {
    const none = comparePresets({ consults: [{ visitId: 'today', date: '2026-10-03', hasRx: false }], reports: [], images: [], trends: [] });
    expect(none.filter(p => p.count === 0).map(p => p.id)).toEqual(['reports', 'images', 'last6img', 'trends', 'rx']);
  });

  it('the header names the active preset', () => {
    expect(presetTitle('Last 6 images')).toBe('Comparing: last 6 images');
  });
});
