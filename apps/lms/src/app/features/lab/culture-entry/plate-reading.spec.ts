import { parsePlate, plateJsonFromCase, plateRows, readingFromMeasure } from './plate-reading';

const session = { dishMm: 90, calPts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], zones: [
  { cx: 0, cy: 0, r: 1, abName: 'Imipenem', code: 'IPM 10', mm: 25, n: 4 },
  { cx: 0, cy: 0, r: 1, abName: 'Cefixime', code: 'CFM 5', mm: 20, n: 2 },
] };

describe('plate reading', () => {
  it('from the modal: master index → drug, the code + disk number, sorted by disk, one per drug', () => {
    const r = readingFromMeasure({ measurements: [{ index: 2, zoneMm: 25 }, { index: 1, zoneMm: 20 }, { index: 2, zoneMm: 99 }], imageUrl: '/p.jpg', session, auditId: 'a' },
      ['Amikacin', 'Cefixime', 'Imipenem'], new Date('2026-09-25T00:00:00Z'));
    expect(r.disks).toEqual([{ n: 2, code: 'CFM 5', drug: 'Cefixime', mm: 20 }, { n: 4, code: 'IPM 10', drug: 'Imipenem', mm: 25 }]);
    expect(r).toMatchObject({ v: 1, auditId: 'a', imageUrl: '/p.jpg', measuredAt: '2026-09-25T00:00:00.000Z' });
    expect(plateRows(r)).toEqual([
      { name: 'Cefixime', zoneSize: 20, interpretation: '' }, { name: 'Imipenem', zoneSize: 25, interpretation: '' },
    ]);
  });

  it('parses only a well-formed reading', () => {
    expect(parsePlate(null)).toBeNull();
    expect(parsePlate('nope')).toBeNull();
    expect(parsePlate('{"disks":[]}')).toBeNull();                     // no session
    expect(parsePlate(JSON.stringify({ disks: [], session }))?.disks).toEqual([]);
  });

  it('finds the AST stage plate on the primary or a subculture branch', () => {
    const view = { stages: [{ key: 'ast', plateJson: 'P' }], subCultures: [{ id: 'S1', stages: [{ key: 'gram' }, { key: 'ast', plateJson: 'Q' }] }] };
    expect(plateJsonFromCase(view, null)).toBe('P');
    expect(plateJsonFromCase(view, 'S1')).toBe('Q');
    expect(plateJsonFromCase(view, 'nope')).toBeNull();
    expect(plateJsonFromCase(null, null)).toBeNull();
  });
});
