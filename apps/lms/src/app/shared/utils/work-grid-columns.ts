import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ColDef, IDoesFilterPassParams, IFilterParams, ValueGetterParams } from 'ag-grid-community';
import type { IFilterAngularComp } from 'ag-grid-angular';

/**
 * THE work-grid column rule (owner 2026-11-20) — Frontdesk flow grid, Lab / Pathologist and Results grids share it:
 *  1. Column filters like Test Master on every DATA column (never the action column):
 *     - `text`   — Token / ID / Patient: AG-Grid's text filter over `filterText` (patient = name + MRN + phone);
 *     - `values` — Where now / Status / Payment: a set-style filter of the values present (`PfValuesFilterComponent`);
 *     - `number` — Waiting / TAT: AG-Grid's number filter over minutes.
 *     They AND with whatever the screen already filters (the head's pill / search / More filters narrow `rowData`).
 *  2. Alignment: read-left-to-right text LEFT (Patient, Where now), short same-shape values CENTRED (Token, Journey,
 *     Waiting, Payment, Priority, TAT) — header and cells alike — and the action column RIGHT.
 * Classes `pf-wg-*` are styled once in styles.scss (the shared grid theme stays untouched).
 */
export type WorkColAlign = 'left' | 'center' | 'right';

const ALIGN: Record<WorkColAlign, { cell: string; head: string }> = {
  left: { cell: 'pf-wg-left', head: 'pf-wg-h-left' },
  center: { cell: 'pf-wg-center', head: 'pf-wg-h-center' },
  right: { cell: 'pf-wg-right', head: 'pf-wg-h-right' },
};

function withAlign<T>(def: ColDef<T>, align: WorkColAlign): ColDef<T> {
  const join = (a: ColDef<T>['cellClass'] | ColDef<T>['headerClass'], b: string) =>
    [b, ...(Array.isArray(a) ? a : a ? [a as string] : [])];
  return {
    ...def,
    cellClass: join(def.cellClass, ALIGN[align].cell) as ColDef<T>['cellClass'],
    headerClass: join(def.headerClass, ALIGN[align].head) as ColDef<T>['headerClass'],
  };
}

/** Text column (Token / ID / Patient): text filter over `filterText(row)`. */
export function textCol<T>(def: ColDef<T>, filterText: (row: T) => string, align: WorkColAlign = 'left'): ColDef<T> {
  return withAlign<T>({
    ...def,
    filter: 'agTextColumnFilter',
    filterValueGetter: (p: ValueGetterParams<T>) => (p.data ? filterText(p.data) : ''),
    filterParams: { buttons: ['reset'], maxNumConditions: 1 },
  }, align);
}

/** Set-style column (Where now / Status / Payment): tick the values present. */
export function valuesCol<T>(def: ColDef<T>, value: (row: T) => string, align: WorkColAlign = 'left'): ColDef<T> {
  return withAlign<T>({
    ...def,
    filter: PfValuesFilterComponent,
    filterValueGetter: (p: ValueGetterParams<T>) => (p.data ? value(p.data) : ''),
  }, align);
}

/** Number column (Waiting / TAT, minutes). */
export function numberCol<T>(def: ColDef<T>, minutes: (row: T) => number | null, align: WorkColAlign = 'center'): ColDef<T> {
  return withAlign<T>({
    ...def,
    filter: 'agNumberColumnFilter',
    filterValueGetter: (p: ValueGetterParams<T>) => (p.data ? minutes(p.data) : null),
    filterParams: { buttons: ['reset'], maxNumConditions: 1 },
  }, align);
}

/** A display-only column (Journey ring …): centred, no filter. */
export function shapeCol<T>(def: ColDef<T>, align: WorkColAlign = 'center'): ColDef<T> {
  return withAlign<T>({ ...def, filter: false }, align);
}

/** The action column (Next + ⋯): right, never filtered. */
export function actionCol<T>(def: ColDef<T>): ColDef<T> {
  return withAlign<T>({ ...def, filter: false, sortable: false }, 'right');
}

/** The pure set rule: no ticks = everything passes; otherwise the row's value must be ticked. */
export function valuesPass(selected: ReadonlySet<string> | null, v: string): boolean {
  return !selected || selected.has(v);
}

/**
 * Set-style filter (AG-Grid Community has none): the distinct values of the column, each a tickbox; "All" clears.
 * Kit checkboxes (role=checkbox buttons), 44px rows on touch, tokens only.
 */
@Component({
  selector: 'pf-values-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-vf" role="group" [attr.aria-label]="'Filter ' + title()">
      <button type="button" class="pf-vf__row" role="checkbox" [attr.aria-checked]="selected() === null" (click)="all()">
        <span class="pf-vf__box" aria-hidden="true">@if (selected() === null) { <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg> }</span>
        <span>All</span>
      </button>
      @for (v of values(); track v) {
        <button type="button" class="pf-vf__row" role="checkbox" [attr.aria-checked]="isOn(v)" [attr.data-value]="v" (click)="toggle(v)">
          <span class="pf-vf__box" aria-hidden="true">@if (isOn(v)) { <svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7" /></svg> }</span>
          <span class="pf-vf__l">{{ v || '(blank)' }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    .pf-vf { display: flex; flex-direction: column; min-width: 200px; max-width: 280px; max-height: 320px; overflow: auto; padding: 6px; }
    .pf-vf__row {
      display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 8px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .pf-vf__row:hover { background: var(--pf-chip-bg, #f3f4f6); }
    .pf-vf__row:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-vf__box {
      width: 18px; height: 18px; flex: none; border-radius: 5px; border: 1.5px solid var(--pf-toggle-border, #94a3b8);
      display: grid; place-items: center; box-sizing: border-box; color: var(--pf-card-bg, #fff);
    }
    .pf-vf__row[aria-checked='true'] .pf-vf__box { background: var(--pf-toggle-on, #7c3aed); border-color: var(--pf-toggle-on, #7c3aed); }
    .pf-vf__box svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .pf-vf__l { overflow-wrap: anywhere; }
    @media (pointer: coarse) { .pf-vf__row { min-height: 44px; } }
  `],
})
export class PfValuesFilterComponent implements IFilterAngularComp {
  private params!: IFilterParams;
  readonly values = signal<string[]>([]);
  readonly title = signal('');
  /** null = every value (no filter). */
  readonly selected = signal<Set<string> | null>(null);

  agInit(params: IFilterParams): void {
    this.params = params;
    this.title.set(params.colDef.headerName || 'column');
    this.refreshValues();
  }
  /** Re-read the distinct values whenever the popup opens (rows change all day). */
  afterGuiAttached(): void { this.refreshValues(); }

  private refreshValues(): void {
    const seen = new Set<string>();
    this.params.api.forEachNode(n => {
      const v = this.params.getValue(n);
      seen.add(v == null ? '' : String(v));
    });
    this.values.set([...seen].sort((a, b) => a.localeCompare(b)));
  }

  isOn(v: string): boolean { const s = this.selected(); return !!s && s.has(v); }
  toggle(v: string): void {
    const s = new Set(this.selected() ?? []);
    if (s.has(v)) s.delete(v); else s.add(v);
    this.selected.set(s.size ? s : null);
    this.params.filterChangedCallback();
  }
  all(): void { this.selected.set(null); this.params.filterChangedCallback(); }

  isFilterActive(): boolean { return this.selected() !== null; }
  doesFilterPass(p: IDoesFilterPassParams): boolean {
    const v = this.params.getValue(p.node);
    return valuesPass(this.selected(), v == null ? '' : String(v));
  }
  getModel(): { values: string[] } | null { const s = this.selected(); return s ? { values: [...s] } : null; }
  setModel(m: { values: string[] } | null): void { this.selected.set(m?.values?.length ? new Set(m.values) : null); }
}
