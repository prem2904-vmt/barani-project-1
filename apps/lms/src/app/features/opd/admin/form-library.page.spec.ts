import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { formLibraryColumns } from './form-library.page';

describe('OPD form library grid columns', () => {
  it('every data column sorts and filters on its real value; Edit is action-only', () => {
    const cols = formLibraryColumns();
    for (const c of cols) {
      if (c.colId === 'act') { expect(c.sortable).toBe(false); expect(c.filter).toBe(false); continue; }
      expect(sortsAndFilters(c as never), String(c.colId ?? c.field)).toBe(true);
    }
    const version = cols.find((c) => c.colId === 'version')!;
    expect((version.valueGetter as (p: unknown) => unknown)({ data: { publishedVersion: 3 } })).toBe(3);
  });
});
