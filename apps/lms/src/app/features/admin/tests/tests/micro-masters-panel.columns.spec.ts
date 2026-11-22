import { microColumns } from './micro-masters-panel.component';
import { sortsAndFilters } from '../../../../shared/utils/work-grid';

describe('Microbiology reference grids', () => {
  for (const section of ['specimens', 'organisms', 'antibiotics', 'breakpoints'] as const) {
    it(`${section}: every data column sorts and filters on its real value`, () => {
      const cols = microColumns(section, (s, r) => `${r + 1}–${s - 1}`);
      expect(cols.length).toBeGreaterThan(4);
      for (const c of cols) expect(sortsAndFilters(c as never), `${section}/${c.headerName}`).toBe(true);
    });
  }
  it('S and R cut-offs sort as numbers; the I window is derived when there is no stored zone', () => {
    const cols = microColumns('breakpoints', (s, r) => `${r + 1}–${s - 1}`);
    const s = cols.find(c => c.headerName === 'S ≥ mm')!;
    expect((s.valueGetter as (p: { data: unknown }) => unknown)({ data: { susceptibleMin: 18 } })).toBe(18);
    const i = cols.find(c => c.headerName === 'I mm')!;
    expect((i.valueGetter as (p: { data: unknown }) => unknown)({ data: { susceptibleMin: 18, resistantMax: 12 } })).toBe('13–17');
  });
});
