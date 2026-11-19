import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, ElementRef, NgZone, TemplateRef, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import type { ICellRendererParams } from 'ag-grid-community';

/** What a column (or the full-width row) hands the template cell. */
export interface TemplateCellParams<T = unknown> {
  /** The page's own `<ng-template let-row>` — rendered with the row as `$implicit`. */
  tpl: TemplateRef<{ $implicit: T; params: ICellRendererParams<T> }>;
  /** Full-width rows: measure the rendered content and give the row that height
   *  (AG-Grid does not auto-size full-width rows). */
  measure?: boolean;
}

/**
 * pf-data-grid's template cell: a column (or a full-width row) renders a TemplateRef the PAGE declares, so its cell
 * markup keeps the page's own components, directives, signals and scoped styles (row actions with busy states, the
 * ⋮ menu, chips). `cellRenderer: DataGridTemplateCellComponent, cellRendererParams: { tpl }`.
 */
@Component({
  selector: 'pf-dg-tpl-cell',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pf-dg-tpl-cell' },
  template: `@if (tpl) {<ng-container *ngTemplateOutlet="tpl; context: { $implicit: row, params: params }"></ng-container>}`,
  styles: [':host { display: block; width: 100%; min-width: 0; }'],
})
export class DataGridTemplateCellComponent<T = unknown> implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  tpl: TemplateCellParams<T>['tpl'] | null = null;
  row: T | undefined;
  params: ICellRendererParams<T> | null = null;
  private ro: ResizeObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.ro?.disconnect());
  }

  agInit(p: ICellRendererParams<T> & Partial<TemplateCellParams<T>>): void {
    this.params = p;
    this.tpl = p.tpl ?? null;
    this.row = p.data;
    this.cdr.markForCheck();
    if (p.measure && !this.ro && typeof ResizeObserver !== 'undefined') {
      this.zone.runOutsideAngular(() => {
        this.ro = new ResizeObserver(() => this.fit());
        this.ro.observe(this.host.nativeElement);
      });
    }
  }

  refresh(p: ICellRendererParams<T> & Partial<TemplateCellParams<T>>): boolean {
    this.agInit(p);
    return true;
  }

  /** Full-width row: the row takes the content's height. */
  private fit(): void {
    const p = this.params;
    const h = Math.ceil(this.host.nativeElement.getBoundingClientRect().height);
    if (!p?.node || h <= 0 || p.node.rowHeight === h) return;
    p.node.setRowHeight(h);
    p.api.onRowHeightChanged();
  }
}
