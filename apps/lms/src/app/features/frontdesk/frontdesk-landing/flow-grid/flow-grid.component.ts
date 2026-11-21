import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, inject, input, output, signal,
} from '@angular/core';
import type { ColDef, GetRowIdParams, GridReadyEvent, RowClassParams, RowClickedEvent, ICellRendererParams } from 'ag-grid-community';
import type { ServiceId } from '../../../../core/services/service-shelf';
import { FLOW_MIN, flowLayout, tokenWidth } from './flow-fold';
import { dailyNoLabel } from '../../../../shared/utils/daily-no';
import { DataGridComponent } from '../../../../shared/components/data-grid/data-grid.component';
import type { FlowRow, JourneyState } from './flow-row';
import { actionCol, numberCol, shapeCol, textCol, valuesCol } from '../../../../shared/utils/work-grid';
import { WorkSetFilterComponent } from '../../../../shared/components/work-set-filter/work-set-filter.component';

/** Token column filter text: "#12". */
export function flowTokenText(r: FlowRow): string { return r.visit ? r.visit.tokenLabel : r.order?.dailyNo ? `#${r.order.dailyNo}` : ''; }
/** Patient column filter text: name + MRN (meta) + phone. */
export function flowPatientText(r: FlowRow): string {
  const phone = r.order?.patient?.phone ?? r.draft?.patient?.phone ?? '';
  return [r.name, r.meta, phone].filter(Boolean).join(' ');
}
/** Payment column's set values: an amount due reads "Due" (one value, not one per amount). */
export function flowPayValue(r: FlowRow): string { return r.payDue ? 'Due' : r.pay; }
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
    <pf-data-grid class="fd-flow" [class.fd-flow--fold]="folded()" [class.fd-flow--fold-token]="foldToken()" [class.fd-flow--tight]="foldTight()" [class.fd-flow--auto]="auto()" [rowData]="rows()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
      [getRowId]="rowId" [getRowClass]="rowClass" [context]="context()" [clickable]="true"
      [loading]="loading()" loadingLabel="Loading orders…" [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()"
      [viewStateKey]="'frontdesk.flow.' + (service() ?? 'all')"
      (rowClicked)="onRow($event)" (gridReady)="onReady($event)" />
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
  /** A per-service SECTION (All split by service): that service's own columns (work-view/sections.ts). */
  readonly service = input<ServiceId | null>(null);
  /** Grow with the rows (stacked sections scroll together in their body) instead of filling the card. */
  readonly auto = input(false);

  readonly opened = output<FlowRow>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly width = signal(1200);
  readonly tier = computed(() => flowColumnTier(this.width()));
  /** What folds at the grid's own width (flow-fold.ts): never a sideways scroll. */
  /** Stacked sections share ONE Token width (the work view passes it) so Token / Patient line up across sections. */
  readonly sharedTokenW = input<number | null>(null);
  readonly tokenW = computed(() => this.sharedTokenW() ?? tokenWidth(this.rows().map(r => r.visit ? r.visit.tokenLabel : dailyNoLabel(r.order?.dailyNo, r.order?.dailyNoDay))));
  readonly layout = computed(() => flowLayout(this.width(), { selecting: this.selecting(), service: this.service(), tokenW: this.tokenW() }));
  /** Payment folded into the Patient line. */
  readonly folded = computed(() => this.layout().fold.has('pay'));
  readonly foldToken = computed(() => this.layout().fold.has('token'));
  readonly foldTight = computed(() => this.layout().fold.has('tight'));

  readonly defaultCol: ColDef<FlowRow> = { sortable: false, resizable: false, filter: false, suppressMovable: true, minWidth: 60 };
  readonly rowId = (p: GetRowIdParams<FlowRow>) => p.data.id;
  /** `pf-wrow` keeps the work list's row hook (specs and the share flow find a row by it). */
  readonly rowClass = (p: RowClassParams<FlowRow>) => {
    const c = ['pf-wrow', 'fd-flow__row'];
    if (p.data?.urgent) c.push('fd-flow__row--urgent');
    return c;
  };

  readonly cols = computed<ColDef<FlowRow>[]>(() => {
    const { fold, own } = this.layout();
    const tight = fold.has('tight');
    const ringSmall = fold.has('ring');
    const waitIn = fold.has('wait');
    const W = FLOW_MIN;
    /** Waiting folded into the Where (or first own) cell: a second line, rose when late. */
    const waitLine = (r: FlowRow) => waitIn && r.waitMin !== null
      ? `<span class="fd-flow__sub fd-flow__wait-in${r.late ? ' fd-flow__wait--late' : ''}">Waiting ${esc(r.wait)}</span>` : '';
    const whereCell = (p: ICellRendererParams<FlowRow>) => p.data
      ? `<span class="fd-flow__where"><span class="fd-flow__stage" data-tone="${p.data.tone}"><span class="fd-flow__dot" aria-hidden="true"></span><span>${esc(p.data.where)}</span></span>${p.data.whereSub ? `<span class="fd-flow__sub">${esc(p.data.whereSub)}</span>` : ''}${waitLine(p.data)}</span>`
      : '';
    const whereCol = (minW: number) => valuesCol<FlowRow>({ colId: 'where', headerName: tight ? 'Where' : 'Where now', headerTooltip: 'Where now', flex: 1,
      minWidth: tight ? W.whereTight : minW, wrapText: true, autoHeight: true, cellClass: 'fd-flow__c-wrap', cellRenderer: whereCell }, r => r.where, WorkSetFilterComponent);
    const waitCol = (): ColDef<FlowRow> => numberCol<FlowRow>({ colId: 'wait', headerName: 'Waiting', width: W.wait, minWidth: W.wait,
      cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
        ? `<span class="fd-flow__wait${p.data.late ? ' fd-flow__wait--late' : ''}"${p.data.late ? ' title="Waiting over 30 minutes"' : ''}>${esc(p.data.wait)}</span>` : '' },
      r => r.waitMin);
    const payCol = (): ColDef<FlowRow> => valuesCol<FlowRow>({ colId: 'pay', headerName: 'Payment', width: W.pay, minWidth: W.pay,
      cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
        ? `<span class="fd-flow__pay${p.data.payDue ? ' fd-flow__pay--due' : ''}">${esc(p.data.pay)}</span>` : '' },
      r => flowPayValue(r), WorkSetFilterComponent, 'center');

    let mid: ColDef<FlowRow>[];
    if (!own) {
      mid = [whereCol(W.where), ...(waitIn ? [] : [waitCol()]), ...(fold.has('pay') ? [] : [payCol()])];
    } else {
      // The first never-folding text column carries the folded Waiting line when the section has no Where.
      const carrier = own.some(c => c.id === 'where') ? 'where' : own.find(c => c.fold === 0 && c.id !== 'wait' && c.id !== 'pay')?.id;
      mid = own.map(c => {
        if (c.id === 'where') return whereCol(c.min);
        if (c.id === 'wait') return waitCol();
        if (c.id === 'pay') return payCol();
        const def: ColDef<FlowRow> = {
          colId: c.id, headerName: c.header, minWidth: c.min, ...(c.flex ? { flex: c.flex } : { width: c.min }),
          wrapText: true, autoHeight: true, cellClass: 'fd-flow__c-wrap',
          cellRenderer: (p: ICellRendererParams<FlowRow>) => {
            const v = p.data?.cells?.[c.id];
            const txt = v ? `<span class="fd-flow__txt${v.late ? ' fd-flow__txt--late' : ''}">${esc(v.text)}</span>` : '<span class="fd-flow__muted">—</span>';
            return c.id === carrier && p.data ? `<span class="fd-flow__where">${txt}${waitLine(p.data)}</span>` : txt;
          },
        };
        const get = (r: FlowRow) => r.cells?.[c.id]?.text ?? '';
        return c.align === 'center' ? valuesCol<FlowRow>(def, get, WorkSetFilterComponent, 'center') : valuesCol<FlowRow>(def, get, WorkSetFilterComponent);
      });
    }
    return [
      { colId: 'sel', headerName: '', width: W.sel, minWidth: W.sel, maxWidth: W.sel, hide: !this.selecting(), cellRenderer: FlowSelectCellComponent,
        cellClass: 'fd-flow__c-sel' },
      // Work-grid column rule (shared/utils/work-grid): filters like Test Master on every data column, text
      // LEFT, short same-shape values CENTRED, the action column RIGHT. They AND with the head's pill / search / filters.
      textCol<FlowRow>({ colId: 'token', headerName: 'Token', hide: fold.has('token'), width: this.tokenW(), minWidth: this.tokenW(), cellRenderer: FlowTokenCellComponent },
        r => flowTokenText(r), 'center'),
      textCol<FlowRow>({ colId: 'patient', headerName: 'Patient', flex: 1.6, minWidth: tight ? W.patientTight : W.patient, wrapText: true, autoHeight: true,
        cellRenderer: FlowPatientCellComponent, cellClass: 'fd-flow__c-wrap' }, r => flowPatientText(r)),
      // Journey (owner 2026-11-20): ONE ring per row — inner disc = the service, outer ring = the row's own steps.
      // Always has its header; a narrow grid shrinks the ring to 32px (owner 2026-11-21).
      shapeCol<FlowRow>({ colId: 'journey', headerName: 'Journey', headerTooltip: 'Journey', headerClass: ringSmall ? 'fd-flow__h-ring' : undefined,
        width: ringSmall ? W.ringSmall : W.ring, minWidth: ringSmall ? W.ringSmall : W.ring, maxWidth: ringSmall ? W.ringSmall : W.ring + 16,
        cellRenderer: FlowRingCellComponent, cellRendererParams: { ringSize: ringSmall ? 32 : 44 }, cellClass: 'fd-flow__c-ring' }),
      ...mid,
      // Sections: Waiting is a FIXED column right before Next — the same x in every section (owner 2026-11-21).
      ...(own && !waitIn ? [waitCol()] : []),
      actionCol<FlowRow>({ colId: 'next', headerName: 'Next', width: tight ? W.nextTight : W.next, minWidth: tight ? W.nextTight : W.next,
        headerClass: 'fd-flow__h-right', cellClass: 'fd-flow__c-next', cellRenderer: FlowNextCellComponent }),
    ];
  });

  onReady(e: GridReadyEvent<FlowRow>): void {
    if (this.auto()) e.api.setGridOption('domLayout', 'autoHeight');
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        const key = (x: number) => { const l = flowLayout(x, { selecting: this.selecting(), service: this.service(), tokenW: this.tokenW() }); return [...l.fold].join() + '|' + (l.own ?? []).map(c => c.id).join(); };
        if (w > 0 && key(w) !== key(this.width())) this.zone.run(() => this.width.set(w));
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
