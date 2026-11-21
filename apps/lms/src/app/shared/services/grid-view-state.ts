import { Directive, DestroyRef, inject, input } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import type { GridApi } from 'ag-grid-community';
import { ViewStateService } from './view-state.service';

/** What a grid remembers between visits: header / column filters, sort, the first visible row. */
export interface GridViewState {
  filter?: Record<string, unknown>;
  sort?: { colId: string; sort: 'asc' | 'desc' | null; sortIndex?: number | null }[];
  row?: number;
}

/**
 * Restore, then track, an AG Grid's column filters / sort / scroll under `grid:<key>` in ViewStateService
 * (screen view state, owner 2026-11-21). `sort: false` for grids whose sort already persists elsewhere
 * (per-user sort in localStorage) — that stays the single home of the sort.
 */
export function keepGridViewState(api: GridApi<any>, vs: ViewStateService, key: string, opts: { sort?: boolean } = {}): void {
  if (!key) return;
  const keepSort = opts.sort !== false;
  const k = `grid:${key}`;
  const saved = vs.get<GridViewState & Record<string, unknown>>(k);
  let restoring = false;
  const hasFilter = () => !!saved?.filter && Object.keys(saved.filter).length > 0;
  const applyFilters = () => {
    if (!hasFilter()) return;
    restoring = true;
    try { api.setFilterModel(saved!.filter!); } finally { restoring = false; }
  };
  if (saved) {
    applyFilters();
    if (keepSort && saved.sort) api.applyColumnState({ state: saved.sort, defaultState: { sort: null } });
  }
  const save = () => {
    if (restoring || api.isDestroyed()) return;
    const part: GridViewState = { filter: api.getFilterModel() ?? {} };
    if (keepSort) {
      part.sort = api.getColumnState().filter(c => !!c.sort)
        .map(c => ({ colId: c.colId, sort: (c.sort ?? null) as 'asc' | 'desc' | null, sortIndex: c.sortIndex ?? null }));
    }
    vs.patch(k, part as Record<string, unknown>);
  };
  api.addEventListener('filterChanged', save);
  api.addEventListener('sortChanged', save);
  // Rows (and columns computed from them) arrive after ready: re-apply a filter whose columns weren't there yet,
  // then bring the remembered first row back into view once.
  let scrolled = false;
  api.addEventListener('firstDataRendered', () => {
    if (hasFilter() && !Object.keys(api.getFilterModel() ?? {}).length) applyFilters();
    if (!scrolled && saved?.row && saved.row > 0) {
      scrolled = true;
      const row = Math.min(saved.row, Math.max(0, api.getDisplayedRowCount() - 1));
      api.ensureIndexVisible(row, 'top');
    }
  });
  api.addEventListener('bodyScrollEnd', () => {
    if (!api.isDestroyed()) vs.patch(k, { row: api.getFirstDisplayedRowIndex() });
  });
}

/**
 * The same for a raw `<ag-grid-angular>` (screens not yet on pf-data-grid):
 *   <ag-grid-angular pfGridViewState="expenses.entries" …>
 */
@Directive({ selector: 'ag-grid-angular[pfGridViewState]', standalone: true })
export class GridViewStateDirective {
  readonly pfGridViewState = input('');
  /** false = the sort already persists elsewhere. */
  readonly pfGridViewStateSort = input(true);
  constructor() {
    // Optional: a spec that swaps the grid for a stub keeps working (nothing to remember there).
    const grid = inject(AgGridAngular, { optional: true });
    if (!grid) return;
    const vs = inject(ViewStateService);
    const sub = grid.gridReady.subscribe(e => keepGridViewState(e.api, vs, this.pfGridViewState(), { sort: this.pfGridViewStateSort() }));
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }
}
