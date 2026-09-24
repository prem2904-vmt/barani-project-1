import { bandFilter, bandMatch } from './band-search';

describe('bandMatch / bandFilter — the admin pill search', () => {
  it('empty query matches everything', () => {
    expect(bandMatch('', 'x')).toBe(true);
    expect(bandMatch('   ', 'x')).toBe(true);
    expect(bandMatch(null, 'x')).toBe(true);
  });

  it('case-insensitive, every word must appear across the fields', () => {
    expect(bandMatch('hosp chennai', 'City Hospital', 'Chennai')).toBe(true);
    expect(bandMatch('HOSP', 'city hospital')).toBe(true);
    expect(bandMatch('hosp madurai', 'City Hospital', 'Chennai')).toBe(false);
  });

  it('ignores null / undefined / numbers become text', () => {
    expect(bandMatch('42', null, undefined, 42)).toBe(true);
    expect(bandMatch('null', null)).toBe(false);
  });

  it('bandFilter keeps matching rows in order and copies on empty query', () => {
    const rows = [{ n: 'Alpha' }, { n: 'Beta' }, { n: 'Alphabet' }];
    expect(bandFilter(rows, 'alp', (r) => [r.n]).map((r) => r.n)).toEqual(['Alpha', 'Alphabet']);
    const all = bandFilter(rows, '', (r) => [r.n]);
    expect(all).toEqual(rows);
    expect(all).not.toBe(rows);
  });
});
