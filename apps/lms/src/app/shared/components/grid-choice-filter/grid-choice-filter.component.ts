import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { IFilterAngularComp } from 'ag-grid-angular';
import type { IDoesFilterPassParams, IFilterParams } from 'ag-grid-community';

/** One choice in a column's header filter ('' = every value). */
export interface GridChoice { value: string; label: string; count?: number; dot?: string; disabled?: boolean }

/**
 * The params a column passes (`filter: GridChoiceFilterComponent, filterParams: {...}`). The filter is BOUND to the
 * screen's own filter state (a side-card filter covering the same field), so the two never disagree: the column's
 * header filter reads `selected()` and writes through `select()`; the screen has already narrowed the rows, so
 * `doesFilterPass` passes everything unless a `matches` rule is given (a column-only filter).
 */
export interface GridChoiceFilterParams {
  title: string;
  options: () => GridChoice[];
  selected: () => string;
  select: (value: string) => void;
  /** Column-only filters: does this row's value match the choice? (Omit when the screen filters the rows itself.) */
  matches?: (row: unknown, value: string) => boolean;
}

/**
 * GRID CHOICE FILTER (owner 2026-11-20, "column filters in the header like Test Master"): a set-style header filter
 * for AG-Grid Community (which has no Set Filter) — the values present, one tap picks, "All" clears. Rows ≥ 44px,
 * dot + count like the side cards; every colour a token. Used by Results' Status / Generated / Sent columns.
 */
@Component({
  selector: 'pf-grid-choice-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-gcf" role="radiogroup" [attr.aria-label]="'Filter ' + title()">
      <p class="pf-gcf__title">{{ title() }}</p>
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
  `,
  styles: [`
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
    .pf-gcf__lbl { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .pf-gcf__n { flex: none; font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
  `],
})
export class GridChoiceFilterComponent implements IFilterAngularComp {
  private params!: IFilterParams & GridChoiceFilterParams;
  readonly title = signal('');
  /** Re-read the bound state on every change detection (the options / counts are the screen's signals). */
  options(): GridChoice[] { return this.params?.options() ?? []; }
  current(): string { return this.params?.selected() ?? ''; }

  agInit(params: IFilterParams & GridChoiceFilterParams): void {
    this.params = params;
    this.title.set(params.title);
  }

  pick(value: string): void {
    this.params.select(value);
    this.params.filterChangedCallback();
  }

  isFilterActive(): boolean { return !!this.params?.selected(); }

  doesFilterPass(p: IDoesFilterPassParams): boolean {
    const v = this.params.selected();
    return !v || !this.params.matches || this.params.matches(p.data, v);
  }

  getModel(): { value: string } | null {
    const v = this.params?.selected();
    return v ? { value: v } : null;
  }

  /** `api.setFilterModel(null)` (Clear) / a saved model: write it back to the bound state. */
  setModel(model: { value?: string } | null): void {
    const v = model?.value ?? '';
    if (v !== this.params.selected()) this.params.select(v);
  }
}
