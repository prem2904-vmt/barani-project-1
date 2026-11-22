import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, booleanAttribute, computed, inject, input, output,
} from '@angular/core';
import {
  AllCommunityModule, CellClickedEvent, CellValueChangedEvent, ColDef, GetRowIdFunc, GridApi, GridReadyEvent, ModuleRegistry,
  IsFullWidthRowParams, RowClassParams, RowClickedEvent, RowDragEndEvent,
} from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { ThemeService } from '../../../core/services/theme.service';
import { gridThemeDark, gridThemeLight } from '../../../features/admin/tests/tests/grid-theme';
import { SkeletonTableComponent } from '../../primitives/skeleton-kit.component';
import { ViewStateService } from '../../services/view-state.service';
import { keepGridViewState } from '../../services/grid-view-state';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Default column behaviour (wrap, grow, no column-filter menus) — Test Master's grids. */
export const DATA_GRID_DEFAULT_COLDEF: ColDef = { sortable: true, resizable: true, filter: false, minWidth: 90, flex: 1, wrapText: true, autoHeight: true };

/**
 * pf-data-grid — Test Master's working grid as ONE shared component (owner 2026-11-17: "Test Master's grid works —
 * take that as a component"). Same theme (grid-theme.ts: Noto via inherit, 44px rows, violet accent), same cell
 * styles (wrap + centre, status pill / switch, quiet same-size icon actions, greyed inactive rows), skeleton
 * overlay, small empty state, quick filter for the band search, row / cell / edit outputs.
 *
 * SIZING is the component's job, not the page's: the host is a flex column that takes its parent's width and grows
 * to fill; and because a page can sit in hosts whose ancestors are not flex (the Settings shell, the overview's
 * inline page), it also MEASURES the room from its top down to the bottom of the outermost fill body and keeps a
 * min-height so it always reaches the frame's bottom. Phones (<= 640px) scroll the page instead (fixed 320px min).
 */
@Component({
  selector: 'pf-data-grid',
  standalone: true,
  imports: [AgGridAngular, SkeletonTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.pf-dg--clickable]': 'clickable()' },
  template: `
    <ag-grid-angular class="pf-dg__grid" [theme]="gridTheme()" [rowData]="rowData()" [columnDefs]="columnDefs()"
                     [defaultColDef]="defaultColDef()" [getRowId]="getRowId()" [getRowClass]="getRowClass()" [context]="context()"
                     [quickFilterText]="quickFilter()" [animateRows]="true" [suppressNoRowsOverlay]="true"
                     [suppressCellFocus]="suppressCellFocus()" [singleClickEdit]="singleClickEdit()"
                     [stopEditingWhenCellsLoseFocus]="true" [rowDragManaged]="rowDragManaged()" (rowDragEnd)="rowDragEnd.emit($event)"
                     [isFullWidthRow]="isFullWidthRow()" [fullWidthCellRenderer]="fullWidthCellRenderer()"
                     [fullWidthCellRendererParams]="fullWidthCellRendererParams()"
                     [suppressColumnVirtualisation]="suppressColumnVirtualisation()"
                     (gridReady)="onReady($event)" (rowClicked)="rowClicked.emit($event)" (cellClicked)="cellClicked.emit($event)"
                     (cellValueChanged)="cellValueChanged.emit($event)"></ag-grid-angular>
    @if (loading()) {
      <pf-skeleton-table class="pf-dg__skel" [rows]="8" [cols]="5" [label]="loadingLabel()"></pf-skeleton-table>
    } @else if (showEmpty()) {
      <div class="pf-dg__empty" data-testid="dg-empty">
        <p class="pf-dg__empty-title">{{ emptyTitle() }}</p>
        @if (emptyBody()) { <p class="pf-dg__empty-body">{{ emptyBody() }}</p> }
      </div>
    }
  `,
  styleUrl: './data-grid.component.scss',
})
export class DataGridComponent<T = unknown> implements AfterViewInit {
  private readonly theme = inject(ThemeService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly viewState = inject(ViewStateService);

  readonly rowData = input<T[] | null>([]);
  readonly columnDefs = input<ColDef<T>[]>([]);
  readonly defaultColDef = input<ColDef<T>>(DATA_GRID_DEFAULT_COLDEF as ColDef<T>);
  readonly getRowId = input<GetRowIdFunc<T> | undefined>(undefined);
  readonly getRowClass = input<((p: RowClassParams<T>) => string | string[] | undefined) | undefined>(undefined);
  readonly context = input<unknown>(undefined);
  /** The band search (AG-Grid quick filter) — pages that filter rows themselves leave it empty. */
  readonly quickFilter = input<string>('');
  readonly loading = input(false, { transform: booleanAttribute });
  readonly loadingLabel = input('Loading…');
  /** Empty state (shown when not loading and no rows). Blank title = no empty state. */
  readonly emptyTitle = input('');
  readonly emptyBody = input('');
  /** Rows open their record: pointer cursor. */
  readonly clickable = input(false, { transform: booleanAttribute });
  readonly suppressCellFocus = input(true, { transform: booleanAttribute });
  readonly singleClickEdit = input(false, { transform: booleanAttribute });
  /** Rows reorder by dragging a column marked `rowDrag: true`; read the new order on rowDragEnd. */
  readonly rowDragManaged = input(false, { transform: booleanAttribute });
  /** Full-width rows (an inline detail under a row): which rows, their renderer (usually
   *  DataGridTemplateCellComponent with `{ tpl, measure: true }`) and its params. */
  readonly isFullWidthRow = input<((p: IsFullWidthRowParams<T>) => boolean) | undefined>(undefined);
  readonly fullWidthCellRenderer = input<unknown>(undefined);
  readonly fullWidthCellRendererParams = input<unknown>(undefined);
  /** Render every column (a short, fixed column list with template cells). */
  readonly suppressColumnVirtualisation = input(false, { transform: booleanAttribute });
  /** Keep this grid's column filters, sort and scroll across in-app navigation (ViewStateService; empty = off). */
  readonly viewStateKey = input('');
  /** Include the sort in the kept state — off for grids whose sort already persists elsewhere (per-user sort). */
  readonly viewStateSort = input(true, { transform: booleanAttribute });

  readonly rowClicked = output<RowClickedEvent<T>>();
  readonly cellClicked = output<CellClickedEvent<T>>();
  readonly cellValueChanged = output<CellValueChangedEvent<T>>();
  readonly gridReady = output<GridReadyEvent<T>>();
  readonly rowDragEnd = output<RowDragEndEvent<T>>();

  readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  readonly showEmpty = computed(() => !!this.emptyTitle() && !(this.rowData()?.length));
  private api: GridApi<T> | null = null;

  onReady(e: GridReadyEvent<T>): void { this.api = e.api; keepGridViewState(e.api, this.viewState, this.viewStateKey(), { sort: this.viewStateSort() }); this.gridReady.emit(e); }

  /** The grid API, for pages that start an edit or refresh cells. */
  gridApi(): GridApi<T> | null { return this.api; }

  ngAfterViewInit(): void {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement as HTMLElement;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => this.fitToFrame(el));
    };
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(fit);
      const frame = this.frameOf(el);
      if (frame) ro.observe(frame);
      ro.observe(document.documentElement);
      window.addEventListener('resize', fit);
      fit();
      this.destroyRef.onDestroy(() => { ro.disconnect(); window.removeEventListener('resize', fit); cancelAnimationFrame(raf); });
    });
  }

  /** The outermost fill body (the frame the page lives in) — its bottom is where the grid should end. */
  private frameOf(el: HTMLElement): HTMLElement | null {
    let frame: HTMLElement | null = null;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (p.classList.contains('pf-band-body--fill')) frame = p;
    }
    return frame;
  }

  /** Keep a min-height that reaches the frame's bottom (minus the cards' own bottom padding / border). */
  private fitToFrame(el: HTMLElement): void {
    if (window.matchMedia?.('(max-width: 640px)').matches) { el.style.minHeight = ''; return; }
    const frame = this.frameOf(el);
    if (!frame) { el.style.minHeight = ''; return; }
    const f = frame.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(frame).paddingBottom) || 0;
    // Each card / body between the grid and the frame keeps its own bottom padding + border.
    let inner = 0;
    for (let p = el.parentElement; p && p !== frame; p = p.parentElement) {
      const cs = getComputedStyle(p);
      inner += (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    const top = el.getBoundingClientRect().top;
    // Never past the viewport: a frame that grows with its content must not feed a growth loop.
    const bottom = Math.min(f.bottom - pad, window.innerHeight);
    const room = Math.floor(bottom - inner - top);
    const want = Math.max(280, room);
    const next = `${want}px`;
    if (el.style.minHeight !== next) el.style.minHeight = next;
  }
}
