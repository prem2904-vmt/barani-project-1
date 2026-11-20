import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import type { IFilterAngularComp } from 'ag-grid-angular';
import type { IDoesFilterPassParams, IFilterParams } from 'ag-grid-community';

/**
 * The work grids' SET-style column filter (owner 2026-11-20: "the filter in the grid is missing" — Test Master's
 * header filters on every data column). AG-Grid Community has no set filter, so this is the small shared one: the
 * values present in the column (read through the column's `filterValueGetter`), each a kit check row (no native
 * checkbox), an empty selection = no filter. Status / Priority / Journey step columns use it via `setFilterCol()`
 * (shared/utils/work-grid.ts).
 */
@Component({
  selector: 'pf-work-set-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wsf" role="group" [attr.aria-label]="'Filter ' + title">
      @for (v of values; track v) {
        <button type="button" class="wsf__row" role="checkbox" [attr.aria-checked]="picked.has(v)" [attr.data-value]="v" (click)="toggle(v)">
          <span class="wsf__box" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
          </span>
          <span class="wsf__t">{{ v }}</span>
        </button>
      } @empty { <p class="wsf__none">Nothing to filter</p> }
      @if (picked.size) { <button type="button" class="pf-btn pf-btn--tertiary wsf__clear" (click)="clear()">Clear</button> }
    </div>`,
  styles: [`
    .wsf { display: flex; flex-direction: column; gap: 2px; padding: 8px; width: 220px; box-sizing: border-box; max-height: 320px; overflow-y: auto; }
    .wsf__row { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 8px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .wsf__row:hover { background: var(--bg-hover, rgba(124, 58, 237, 0.06)); }
    .wsf__t { flex: 1; overflow-wrap: anywhere; }
    .wsf__box { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 5px;
      border: 1.5px solid var(--pf-line-strong, var(--text-tertiary)); color: transparent; background: var(--pf-card-bg); }
    .wsf__box svg { width: 12px; height: 12px; }
    .wsf__row[aria-checked='true'] .wsf__box { background: var(--color-primary, #7c3aed); border-color: var(--color-primary, #7c3aed); color: #fff; }
    .wsf__row:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: -2px; }
    .wsf__none { margin: 8px; font-size: 12.5px; color: var(--text-tertiary); }
    .wsf__clear { align-self: flex-end; margin-top: 4px; min-height: 32px; height: 32px; }
    @media not ((hover: hover) and (pointer: fine)) { .wsf__row, .wsf__clear { min-height: 44px; } }
  `],
})
export class WorkSetFilterComponent implements IFilterAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  private params!: IFilterParams;
  values: string[] = [];
  picked = new Set<string>();
  title = '';

  agInit(params: IFilterParams): void {
    this.params = params;
    this.title = params.colDef.headerName || 'column';
    this.collect();
  }
  /** The values present right now (re-read each time the filter opens). */
  afterGuiAttached(): void { this.collect(); this.cdr.markForCheck(); }
  private collect(): void {
    const seen = new Set<string>();
    this.params.api.forEachNode(n => {
      const v = this.params.getValue(n);
      if (v != null && v !== '') seen.add(String(v));
    });
    for (const p of this.picked) seen.add(p);
    this.values = [...seen].sort((a, b) => a.localeCompare(b));
  }
  isFilterActive(): boolean { return this.picked.size > 0; }
  doesFilterPass(p: IDoesFilterPassParams): boolean {
    const v = this.params.getValue(p.node);
    return this.picked.has(String(v ?? ''));
  }
  getModel(): { values: string[] } | null { return this.picked.size ? { values: [...this.picked] } : null; }
  setModel(m: { values?: string[] } | null): void { this.picked = new Set(m?.values ?? []); this.cdr.markForCheck(); }
  toggle(v: string): void {
    const next = new Set(this.picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    this.picked = next;
    this.cdr.markForCheck();
    this.params.filterChangedCallback();
  }
  clear(): void { this.picked = new Set(); this.cdr.markForCheck(); this.params.filterChangedCallback(); }
}
