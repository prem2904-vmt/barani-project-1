import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, inject, input, output, signal,
} from '@angular/core';
import type { ColDef, GetRowIdParams, RowClassParams, RowClickedEvent, ICellRendererParams } from 'ag-grid-community';
import { DataGridComponent } from '../../../../shared/components/data-grid/data-grid.component';
import type { FlowRow, JourneyState } from './flow-row';
import {
  FlowGridContext, FlowNextCellComponent, FlowPatientCellComponent, FlowRingCellComponent, FlowSelectCellComponent,
  FlowTokenCellComponent,
} from './flow-cells';

/** Escape for the plain (string) cell renderers. */
export function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const JOURNEY_STEPS = ['Billing', 'Sample', 'Dispatch', 'Result', 'Report'];

export function journeyHtml(dots: readonly JourneyState[], label: string): string {
  if (!dots.length) return '<span class="fd-flow__muted">—</span>';
  const items = dots.map((d, i) => `<span class="fd-flow__step" data-state="${d}" title="${esc(JOURNEY_STEPS[i] ?? '')}"></span>`).join('');
  return `<span class="fd-flow__journey" role="img" aria-label="${esc(label)}">${items}</span>`;
}

/** Column tiers by the grid's own width (the side card is resizable): narrow grids fold Journey, then Visit for. */
export function flowColumnTier(width: number): -1 | 0 | 1 | 2 {
  if (width >= 960) return 2;
  if (width >= 800) return 1;
  if (width >= 700) return 0;
  return -1;   // very narrow (a docked WhatsApp panel beside a 1440 window): every column at its tightest
}

/**
 * The Frontdesk FLOW GRID (owner-approved redesign 2026-11-19): the work card's body on the shared pf-data-grid
 * (Test Master's AG-Grid theme — row height, header and touch sizing come from that theme only).
 * Token | Patient | Journey (ring) | Where now | Waiting | Payment | Next (+ ⋯). Rows come pre-built
 * (flow-row.ts); tapping a row opens it exactly as the old rows did.
 */
@Component({
  selector: 'pf-fd-flow-grid',
  standalone: true,
  imports: [DataGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-data-grid class="fd-flow" [rowData]="rows()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
      [getRowId]="rowId" [getRowClass]="rowClass" [context]="context()" [clickable]="true"
      [loading]="loading()" loadingLabel="Loading orders…" [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()"
      (rowClicked)="onRow($event)" />
  `,
  styleUrl: './flow-grid.component.scss',
})
export class FlowGridComponent implements AfterViewInit {
  readonly rows = input<FlowRow[]>([]);
  readonly context = input.required<FlowGridContext>();
  readonly loading = input(false);
  /** Show the multi-select column (In progress with selectable rows). */
  readonly selecting = input(false);
  readonly emptyTitle = input('');
  readonly emptyBody = input('');

  readonly opened = output<FlowRow>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly width = signal(1200);
  readonly tier = computed(() => flowColumnTier(this.width()));

  readonly defaultCol: ColDef<FlowRow> = { sortable: false, resizable: false, filter: false, suppressMovable: true, minWidth: 60 };
  readonly rowId = (p: GetRowIdParams<FlowRow>) => p.data.id;
  /** `pf-wrow` keeps the work list's row hook (specs and the share flow find a row by it). */
  readonly rowClass = (p: RowClassParams<FlowRow>) => {
    const c = ['pf-wrow', 'fd-flow__row'];
    if (p.data?.urgent) c.push('fd-flow__row--urgent');
    return c;
  };

  readonly cols = computed<ColDef<FlowRow>[]>(() => {
    const t = this.tier();
    const narrow = t <= 0;
    const tight = t < 0;
    return [
      { colId: 'sel', headerName: '', width: 52, minWidth: 52, maxWidth: 52, hide: !this.selecting(), cellRenderer: FlowSelectCellComponent,
        cellClass: 'fd-flow__c-sel' },
      { colId: 'token', headerName: 'Token', width: tight ? 74 : narrow ? 70 : 76, minWidth: 56, cellRenderer: FlowTokenCellComponent },
      { colId: 'patient', headerName: 'Patient', flex: 1.6, minWidth: tight ? 120 : narrow ? 150 : 170, wrapText: true, autoHeight: true,
        cellRenderer: FlowPatientCellComponent, cellClass: 'fd-flow__c-wrap' },
      // Journey (owner 2026-11-20): ONE ring per row — inner disc = the service (replaces "Visit for"), outer ring =
      // the row's own steps (replaces the step dots). 44px; never folds away.
      // Narrower grids (tier < 2, where the old Journey dots folded away) keep the ring in a 64px headerless column.
      { colId: 'journey', headerName: t < 2 ? '' : 'Journey', headerTooltip: 'Journey', width: t < 2 ? 64 : 96,
        minWidth: t < 2 ? 60 : 92, maxWidth: t < 2 ? 68 : 104, cellRenderer: FlowRingCellComponent, cellClass: 'fd-flow__c-ring' },
      { colId: 'where', headerName: 'Where now', flex: 1, minWidth: tight ? 126 : narrow ? 130 : 150, wrapText: true, autoHeight: true, cellClass: 'fd-flow__c-wrap',
        cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
          ? `<span class="fd-flow__where"><span class="fd-flow__stage" data-tone="${p.data.tone}"><span class="fd-flow__dot" aria-hidden="true"></span>${esc(p.data.where)}</span>${p.data.whereSub ? `<span class="fd-flow__sub">${esc(p.data.whereSub)}</span>` : ''}</span>`
          : '' },
      { colId: 'wait', headerName: tight ? 'Wait' : 'Waiting', width: tight ? 66 : narrow ? 80 : 92, minWidth: 62,
        cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
          ? `<span class="fd-flow__wait${p.data.late ? ' fd-flow__wait--late' : ''}"${p.data.late ? ' title="Waiting over 30 minutes"' : ''}>${esc(p.data.wait)}</span>` : '' },
      { colId: 'pay', headerName: 'Payment', width: tight ? 90 : narrow ? 100 : 116, minWidth: 86,
        cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
          ? `<span class="fd-flow__pay${p.data.payDue ? ' fd-flow__pay--due' : ''}">${esc(p.data.pay)}</span>` : '' },
      { colId: 'next', headerName: 'Next', width: narrow ? 164 : 184, minWidth: 156, headerClass: 'fd-flow__h-right', cellClass: 'fd-flow__c-next',
        cellRenderer: FlowNextCellComponent },
    ];
  });

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        if (w > 0 && flowColumnTier(w) !== flowColumnTier(this.width())) this.zone.run(() => this.width.set(w));
        else if (w > 0) this.width.set(w);
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
  }

  onRow(e: RowClickedEvent<FlowRow>): void {
    const t = e.event?.target as HTMLElement | null;
    // A control inside the row (Next, ⋯, the checkbox, a menu) never also opens the row.
    if (t?.closest?.('button, a, input, [role="menu"], .pf-am-layer')) return;
    if (e.data) this.opened.emit(e.data);
  }
}
