import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewEncapsulation, inject, input } from '@angular/core';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import type { StatusWords } from '../../utils/status-words';

/**
 * `<pf-status-words [words]="w">` — THE status cell (owner design D, 2026-11-21): two lines of words, no pill, no dot.
 * Line 1 = what is happening now (rose when late / failed, green when done, else normal text); line 2 = the quiet
 * detail / next step. Words wrap by whole words, never an ellipsis. Classes are global (`pf-sw…`, encapsulation
 * None) so string-rendered cells and the screens specs can find them.
 */
@Component({
  selector: 'pf-status-words',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'pf-sw', '[attr.data-tone]': 'words()?.tone ?? "normal"', '[attr.title]': 'words()?.title || null' },
  template: `@if (words(); as w) {<span class="pf-sw__now">{{ w.now }}</span>@if (w.detail) {<span class="pf-sw__detail">{{ w.detail }}</span>}}`,
  styles: [`
    .pf-sw { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 2px; min-width: 0; max-width: 100%;
      line-height: 1.3; text-align: left; white-space: normal; overflow-wrap: break-word; word-break: normal; }
    .pf-sw__now { font-size: 13px; font-weight: 600; color: var(--text-primary); }
    .pf-sw__detail { font-size: 12px; font-weight: 400; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    /* Soft rose = late / blocked / failed (the late TEXT token, never amber); soft green = done. */
    .pf-sw[data-tone='late'] > .pf-sw__now { color: var(--pf-late-text, color-mix(in srgb, var(--red-text) 85%, var(--text-primary))); }
    .pf-sw[data-tone='done'] > .pf-sw__now { color: var(--success-text, var(--green-text)); }
  `],
})
export class StatusWordsComponent {
  readonly words = input<StatusWords | null | undefined>(null);
}

/** Params for the AG-Grid cell: how a row becomes words. */
export interface StatusWordsCellParams<T = unknown> {
  statusWords: (row: T) => StatusWords | null | undefined;
}

/** AG-Grid cell renderer for a plain status column: `cellRenderer: StatusWordsCellComponent, cellRendererParams: { statusWords }`. */
@Component({
  selector: 'pf-status-words-cell',
  standalone: true,
  imports: [StatusWordsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (w) {<pf-status-words [words]="w" />}`,
  styles: [':host { display: flex; align-items: center; min-height: 100%; padding: 6px 0; min-width: 0; }'],
})
export class StatusWordsCellComponent<T = unknown> implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  w: StatusWords | null = null;
  agInit(p: ICellRendererParams<T> & Partial<StatusWordsCellParams<T>>): void {
    this.w = p.data && p.statusWords ? p.statusWords(p.data) ?? null : null;
    this.cdr.markForCheck();
  }
  refresh(p: ICellRendererParams<T> & Partial<StatusWordsCellParams<T>>): boolean { this.agInit(p); return true; }
}

/**
 * A status column drawn as words. The column's VALUE (sort / set filter / export) stays line 1 unless the def brings
 * its own `valueGetter`; the cell wraps and the row grows (autoHeight) so line 2 is never cut.
 */
export function statusWordsCol<T>(def: ColDef<T>, words: (row: T) => StatusWords | null | undefined): ColDef<T> {
  return {
    valueGetter: p => (p.data ? words(p.data)?.now ?? '' : ''),
    wrapText: true, autoHeight: true,
    ...def,
    cellRenderer: StatusWordsCellComponent,
    cellRendererParams: { statusWords: words } satisfies StatusWordsCellParams<T>,
  };
}
