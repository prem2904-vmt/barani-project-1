import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject } from '@angular/core';
import type { IFilterAngularComp } from 'ag-grid-angular';
import type { IDoesFilterPassParams, IFilterParams } from 'ag-grid-community';

/** One choice in a BOUND column filter ('' = every value). */
export interface GridChoice { value: string; label: string; count?: number; dot?: string; disabled?: boolean }

/**
 * Params of a BOUND column filter (`choiceFilterCol` in shared/utils/work-grid.ts): the header filter IS the screen's
 * own filter state (a side card covering the same field — Results' Status / Generated / Sent), so the two never
 * disagree: it reads `selected()` and writes through `select()`. The screen has already narrowed the rows, so
 * `doesFilterPass` passes everything unless a column-only `matches` rule is given.
 */
export interface GridChoiceFilterParams {
  title: string;
  options: () => GridChoice[];
  selected: () => string;
  select: (value: string) => void;
  matches?: (row: unknown, value: string) => boolean;
}

/**
 * THE set-style column filter of every work grid (owner 2026-11-20: Frontdesk, My Work / Pathologist, Results —
 * Test Master's header filters; AG-Grid Community has no Set Filter). Two modes, one component:
 *  - VALUES (default): the distinct values present in the column (read through its `filterValueGetter`), kit check
 *    rows (no native checkbox), tick any number, an empty selection = no filter, Clear — via `setFilterCol()`;
 *  - BOUND (`filterParams` = `GridChoiceFilterParams`): one choice, two-way bound to the screen's own filter (dot +
 *    count rows like the side card) — via `choiceFilterCol()`.
 * Rows are 44px on touch; every colour is a token.
 */
@Component({
  selector: 'pf-work-set-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bound) {
      <div class="pf-gcf" role="radiogroup" [attr.aria-label]="'Filter ' + title">
        <p class="pf-gcf__title">{{ title }}</p>
        @for (o of options(); track o.value) {
          <button type="button" class="pf-gcf__opt" role="radio" [attr.data-value]="o.value" [attr.aria-checked]="current() === o.value"
                  [disabled]="o.disabled" (click)="pick(o.value)">
            <span class="pf-gcf__mark" aria-hidden="true"></span>
            @if (o.dot) { <span class="pf-gcf__dot" [style.background]="o.dot" aria-hidden="true"></span> }
            <span class="pf-gcf__lbl">{{ o.label }}</span>
            @if (o.count != null) { <span class="pf-gcf__n">{{ o.count }}</span> }
          </button>
        }
      </div>
    } @else {
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
      </div>
    }`,
  styles: [`
    .wsf { display: flex; flex-direction: column; gap: 2px; padding: 8px; width: 220px; box-sizing: border-box; max-height: 320px; overflow-y: auto; }
    .wsf__row { display: flex; align-items: center; gap: 10px; min-height: 36px; padding: 0 8px; border: 0; border-radius: 8px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer; }
    .wsf__row:hover { background: var(--bg-hover, rgba(124, 58, 237, 0.06)); }
    .wsf__t { flex: 1; overflow-wrap: break-word; }
    .wsf__box { flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 5px;
      border: 1.5px solid var(--pf-line-strong, var(--text-tertiary)); color: transparent; background: var(--pf-card-bg); }
    .wsf__box svg { width: 12px; height: 12px; }
    .wsf__row[aria-checked='true'] .wsf__box { background: var(--color-primary, #7c3aed); border-color: var(--color-primary, #7c3aed); color: var(--pf-card-bg, #fff); }
    .wsf__row:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: -2px; }
    .wsf__none { margin: 8px; font-size: 12.5px; color: var(--text-tertiary); }
    .wsf__clear { align-self: flex-end; margin-top: 4px; min-height: 32px; height: 32px; }
    @media not ((hover: hover) and (pointer: fine)) { .wsf__row, .wsf__clear { min-height: 44px; } }

    .pf-gcf { display: flex; flex-direction: column; min-width: 220px; max-width: 300px; padding: 6px; font-family: inherit; }
    .pf-gcf__title { margin: 4px 8px 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); }
    .pf-gcf__opt {
      display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 0 10px; border: 0; border-radius: 10px;
      background: transparent; color: var(--text-primary); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .pf-gcf__opt:hover:not(:disabled) { background: color-mix(in srgb, var(--text-primary) 5%, transparent); }
    .pf-gcf__opt:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: -2px; }
    .pf-gcf__opt:disabled { cursor: default; color: var(--text-tertiary); }
    .pf-gcf__opt[aria-checked='true'] { background: var(--pf-in-tint); box-shadow: inset 0 0 0 1px var(--pf-sel-border); }
    .pf-gcf__mark { flex: none; width: 16px; height: 16px; border-radius: 999px; box-sizing: border-box; border: 1.5px solid var(--text-tertiary); }
    .pf-gcf__opt[aria-checked='true'] .pf-gcf__mark { border: 5px solid var(--pf-switch-on); }
    .pf-gcf__dot { flex: none; width: 8px; height: 8px; border-radius: 999px; }
    .pf-gcf__lbl { flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; }
    .pf-gcf__n { flex: none; font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  `],
})
export class WorkSetFilterComponent implements IFilterAngularComp {
  /** Null when built outside Angular (a spec's `new`). */
  private readonly cdr: ChangeDetectorRef | null = (() => { try { return inject(ChangeDetectorRef); } catch { return null; } })();
  private params!: IFilterParams & Partial<GridChoiceFilterParams>;
  /** Bound to the screen's own filter (`GridChoiceFilterParams`), else the values-present mode. */
  bound = false;
  values: string[] = [];
  picked = new Set<string>();
  title = '';

  agInit(params: IFilterParams & Partial<GridChoiceFilterParams>): void {
    this.params = params;
    this.bound = typeof params.options === 'function' && typeof params.select === 'function';
    this.title = params.title || params.colDef?.headerName || 'column';
    if (!this.bound) this.collect();
  }
  /** The values present right now (re-read each time the filter opens). */
  afterGuiAttached(): void { if (!this.bound) this.collect(); this.cdr?.markForCheck(); }
  private collect(): void {
    const seen = new Set<string>();
    this.params.api.forEachNode(n => {
      const v = this.params.getValue(n);
      if (v != null && v !== '') seen.add(String(v));
    });
    for (const p of this.picked) seen.add(p);
    this.values = [...seen].sort((a, b) => a.localeCompare(b));
  }

  // ── bound mode ──
  /** Re-read the bound state on every change detection (the options / counts are the screen's signals). */
  options(): GridChoice[] { return this.params?.options?.() ?? []; }
  current(): string { return this.params?.selected?.() ?? ''; }
  pick(value: string): void {
    this.params.select!(value);
    this.params.filterChangedCallback();
  }

  // ── values mode ──
  toggle(v: string): void {
    const next = new Set(this.picked);
    if (next.has(v)) next.delete(v); else next.add(v);
    this.picked = next;
    this.cdr?.markForCheck();
    this.params.filterChangedCallback();
  }
  clear(): void { this.picked = new Set(); this.cdr?.markForCheck(); this.params.filterChangedCallback(); }

  // ── AG-Grid filter contract ──
  isFilterActive(): boolean { return this.bound ? !!this.current() : this.picked.size > 0; }
  doesFilterPass(p: IDoesFilterPassParams): boolean {
    if (this.bound) {
      const v = this.current();
      return !v || !this.params.matches || this.params.matches(p.data, v);
    }
    return valuesPass(this.picked, String(this.params.getValue(p.node) ?? ''));
  }
  getModel(): { values: string[] } | { value: string } | null {
    if (this.bound) { const v = this.current(); return v ? { value: v } : null; }
    return this.picked.size ? { values: [...this.picked] } : null;
  }
  /** `api.setFilterModel(null)` (Clear) / a saved model. Bound: written back to the screen's state. */
  setModel(m: { values?: string[]; value?: string } | null): void {
    if (this.bound) {
      const v = m?.value ?? '';
      if (v !== this.current()) this.params.select!(v);
      return;
    }
    this.picked = new Set(m?.values ?? []);
    this.cdr?.markForCheck();
  }
}

/** The values rule: nothing ticked = everything passes; otherwise the row's value must be ticked. */
export function valuesPass(picked: ReadonlySet<string> | null, v: string): boolean {
  return !picked || picked.size === 0 || picked.has(v);
}
