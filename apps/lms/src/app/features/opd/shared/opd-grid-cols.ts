import type { ColDef } from 'ag-grid-community';
import { WorkSetFilterComponent } from '../../../shared/components/work-set-filter/work-set-filter.component';
import { compareText, valuesCol, type WorkAlign } from '../../../shared/utils/work-grid';

/**
 * A categorical column whose cell VALUE is the raw stored value (an id, a code, a boolean) because a select / checkbox
 * editor or a `field` write-back reads it — yet it sorts and filters on the WORD the user sees (`label`).
 * The helper's set filter and text comparator run on `label`; `valueGetter` stays the raw value so editing keeps working.
 */
export function rawChoiceCol<T>(def: ColDef<T>, raw: (row: T) => unknown, label: (row: T) => string, a: WorkAlign = 'left'): ColDef<T> {
  const col = valuesCol<T>(def, label, WorkSetFilterComponent, a);
  return {
    ...col,
    valueGetter: p => (p.data ? raw(p.data) : null),
    comparator: (_x, _y, na, nb, desc) => compareText(na?.data ? label(na.data) : null, nb?.data ? label(nb.data) : null, !!desc),
  } as ColDef<T>;
}
