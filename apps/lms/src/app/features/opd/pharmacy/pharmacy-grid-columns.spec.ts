import type { ColDef } from 'ag-grid-community';
import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { drugMasterColumns } from './drug-master.component';
import { h1Columns } from './h1-register.page';
import { moveColumns } from './returns.page';
import { stockColumns } from './stock.page';
import { supplierColumns } from './suppliers.page';

/** Owner 2026-11-21: wherever a grid is used, filter and sort must be there — on the real value. */
const GRIDS: Record<string, ColDef<unknown>[]> = {
  'drug master': drugMasterColumns() as unknown as ColDef<unknown>[],
  'H1 register': h1Columns() as unknown as ColDef<unknown>[],
  'stock movements': moveColumns() as unknown as ColDef<unknown>[],
  stock: stockColumns() as unknown as ColDef<unknown>[],
  suppliers: supplierColumns() as unknown as ColDef<unknown>[],
};

describe('pharmacy grids sort and filter on the real value', () => {
  for (const [name, cols] of Object.entries(GRIDS)) {
    it(`${name}: every column sorts and filters (no action-only columns here)`, () => {
      expect(cols.length).toBeGreaterThan(0);
      for (const c of cols) expect(sortsAndFilters(c), `${name}.${String(c.colId ?? c.field)}`).toBe(true);
    });
  }

  it('numbers sort as numbers, dates as time, editable cells keep their raw value', () => {
    const get = (cols: ColDef<unknown>[], id: string) => cols.find(c => (c.colId ?? c.field) === id)!.valueGetter as (p: unknown) => unknown;
    expect(get(GRIDS['stock'], 'onHand')({ data: { onHand: 9 } })).toBe(9);
    expect(get(GRIDS['H1 register'], 'at')({ data: { at: '2026-11-01T10:00:00Z' } })).toBe(Date.parse('2026-11-01T10:00:00Z'));
    expect(get(GRIDS['drug master'], 'isActive')({ data: { isActive: true } })).toBe(true);
    expect(get(GRIDS['drug master'], 'schedule')({ data: { schedule: 'H1' } })).toBe('H1');
  });
});
