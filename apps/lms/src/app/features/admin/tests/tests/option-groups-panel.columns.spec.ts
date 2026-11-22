import { ogColumns, type OgGridRow } from './option-groups-panel.component';
import { sortsAndFilters } from '../../../../shared/utils/work-grid';

describe('Option groups grid columns', () => {
  it('every data column sorts and filters on its real value', () => {
    const cols = ogColumns();
    expect(cols.length).toBe(5);
    for (const c of cols) expect(sortsAndFilters(c as never), String(c.headerName)).toBe(true);
  });
  it('Tests sorts numerically', () => {
    const tests = ogColumns().find(c => c.headerName === 'Tests')!;
    const vg = tests.valueGetter as (p: { data: OgGridRow }) => number;
    expect(vg({ data: { testCount: 12 } as OgGridRow })).toBe(12);
    const cmp = tests.comparator as (a: number, b: number) => number;
    expect(cmp(9, 12)).toBeLessThan(0);
  });
});
