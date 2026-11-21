import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, inject, input, output, signal,
} from '@angular/core';
import type { ColDef, GetRowIdParams, GridReadyEvent, RowClassParams, RowClickedEvent, ICellRendererParams } from 'ag-grid-community';
import type { ServiceId } from '../../../../core/services/service-shelf';
import { FLOW_MIN, tokenWidth } from './flow-fold';
import { fdCell, fdCellCtx, fdFlowLayout } from './flow-columns';
import { FlowHeadComponent, type FlowHeadMode } from './flow-head.component';
import { FdGridColumnsService } from '../../../../core/services/fd-grid-columns.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { type FdModule, fdColumn, fdDataValue } from '../../../../shared/utils/fd-grid-columns';
import { dailyNoLabel } from '../../../../shared/utils/daily-no';
import { DataGridComponent } from '../../../../shared/components/data-grid/data-grid.component';
import type { FlowRow } from './flow-row';
import { actionCol, dateCol, durationCol, epochOf, moneyCol, ratioCol, textCol, tokenCol, tokenLabelValue, tokenValue, valuesCol } from '../../../../shared/utils/work-grid';
import { LATE_AFTER_MIN } from './flow-row';
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
/** Payment's sort / filter number: the rupees due ("₹450 due" = 450, "Paid" = 0); "Not billed" / "—" = none. */
export function flowPayAmount(r: FlowRow): number | null {
  if (r.due > 0) return r.due;
  return r.pay === 'Paid' || r.pay === 'No dues' ? 0 : null;
}
/** Token's sort number: the IST day then the daily number (an OPD token "R-5" = today's 5). */
export function flowTokenValue(r: FlowRow): number | null {
  if (r.visit) return tokenLabelValue(r.visit.tokenLabel);
  return tokenValue(r.order?.dailyNo, r.order?.dailyNoDay);
}
/** Samples drawn of the order's tubes ("1 of 2 drawn") — the same rule as the cell (sections.ts samplesText). */
export function flowSamples(r: FlowRow): { done: number; total: number } | null {
  const list = r.kind === 'draft' ? [] : r.order?.samples ?? [];
  if (!list.length) return null;
  return { done: list.filter(x => x.status && x.status !== 'pending' && x.status !== 'rejected').length, total: list.length };
}
/** Triage order: Urgent before Normal. */
export function flowUrgentRank(r: FlowRow): number { return r.urgent || r.cells?.triage?.text === 'Urgent' ? 0 : 1; }
import {
  FlowColumnHide, FlowGridContext, FlowNextCellComponent, FlowPatientCellComponent, FlowSelectCellComponent, FlowTokenCellComponent,
  FlowWhereCellComponent,
} from './flow-cells';

/** Escape for the plain (string) cell renderers. */
export function esc(s: string | null | undefined): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * A Work grid column (fd-grid-columns.ts) with the sort + filter of what it says (owner 2026-11-21: sort by the math):
 * counts as a ratio, times / days as dates, a due as minutes left, Urgent before Normal, the queue by how many ahead,
 * IDs as text, the rest as categories. Needs-data columns read their named field once a feed carries it.
 */
export function fdTypedCol(module: FdModule, id: string, def: ColDef<FlowRow>, text: (r: FlowRow) => string, align: 'left' | 'center',
  ahead: Map<string, number> = new Map()): ColDef<FlowRow> {
  const col = fdColumn(module, id);
  const data = (r: FlowRow) => (col ? fdDataValue(col, r) : undefined);
  switch (id) {
    case 'samples': return ratioCol<FlowRow>(def, flowSamples, align);
    case 'admitted': case 'arrived': case 'days':
      return dateCol<FlowRow>(def, r => epochOf((r.order?.createdAt ?? r.visit?.checkedInAt ?? r.visit?.createdAt) as unknown as string), align);
    case 'discharge': return dateCol<FlowRow>(def, r => epochOf(data(r) as string | null), align);
    case 'due': return durationCol<FlowRow>(def, r => { const t = epochOf(data(r) as string | null); return t === null ? null : Math.round((t - Date.now()) / 60000); }, { kind: 'due', align });
    case 'priority': return valuesCol<FlowRow>(def, text, WorkSetFilterComponent, align, flowUrgentRank);
    case 'triage': return valuesCol<FlowRow>(def, text, WorkSetFilterComponent, align, r => { const n = Number(data(r)); return Number.isFinite(n) && n > 0 ? n : null; });
    case 'ahead': return valuesCol<FlowRow>(def, text, WorkSetFilterComponent, align, r => ahead.get(r.id) ?? null);
    case 'orderid': return textCol<FlowRow>(def, text, align);
    default: return valuesCol<FlowRow>(def, text, WorkSetFilterComponent, align);
  }
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
 * Token | Patient | Where now (journey ring + words) | Waiting | Payment | Next (+ ⋯). Rows come pre-built
 * (flow-row.ts); tapping a row opens it exactly as the old rows did.
 */
@Component({
  selector: 'pf-fd-flow-grid',
  standalone: true,
  imports: [DataGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-data-grid class="fd-flow" [class.fd-flow--fold]="folded()" [class.fd-flow--fold-token]="foldToken()" [class.fd-flow--tight]="foldTight()" [class.fd-flow--auto]="auto()" [rowData]="rows()" [columnDefs]="cols()" [defaultColDef]="defaultCol"
      [getRowId]="rowId" [getRowClass]="rowClass" [context]="ctx()" [clickable]="true"
      [loading]="loading()" loadingLabel="Loading orders…" [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()"
      [viewStateKey]="columns() ? '' : 'frontdesk.flow.' + (service() ?? 'all')" [suppressColumnVirtualisation]="editing()"
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

  /** Settings › Work grid columns preview: draw exactly these columns (catalogue ids) instead of the saved ones. */
  readonly columns = input<readonly string[] | null>(null);
  /** The module whose columns to draw (else the section's service, else the rows' own, else Lab). */
  readonly module = input<FdModule | null>(null);
  /** Preview headers: drag / ✕ / Alt+arrows (ctx.columnEdit). */
  readonly editing = input(false);
  /** Preview: show every column (the box scrolls) instead of folding them away. */
  readonly noFold = input(false);

  readonly opened = output<FlowRow>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly gridCols = inject(FdGridColumnsService);
  private readonly auth = inject(AuthService);
  private readonly width = signal(1200);
  readonly tier = computed(() => flowColumnTier(this.width()));
  /** What folds at the grid's own width (flow-fold.ts): never a sideways scroll. */
  /** Stacked sections share ONE Token width (the work view passes it) so Token / Patient line up across sections. */
  readonly sharedTokenW = input<number | null>(null);
  readonly tokenW = computed(() => this.sharedTokenW() ?? tokenWidth(this.rows().map(r => r.visit ? r.visit.tokenLabel : dailyNoLabel(r.order?.dailyNo, r.order?.dailyNoDay))));
  /** Whose Work grid columns this grid draws (Settings › <module> › Front desk › Work grid columns). */
  readonly mod = computed<FdModule>(() => this.module() ?? this.service() ?? this.rows()[0]?.service ?? 'lab');
  /** The columns, in order: the preview's own list, else what the admin saved minus what this person hid. */
  readonly ids = computed<readonly string[]>(() => this.columns() ?? this.gridCols.visible(this.mod()));
  readonly layout = computed(() => this.layoutAt(this.width()));
  private layoutAt(w: number) {
    return fdFlowLayout(w, this.mod(), this.ids(), { selecting: this.selecting(), tokenW: this.tokenW(), noFold: this.noFold(), section: !!this.service() });
  }
  /** The landing's context + this person's "Hide column" (only while the admin lets staff hide columns). */
  private readonly hideApi: FlowColumnHide = {
    hide: id => this.gridCols.hide(this.mod(), id),
    showAll: () => this.gridCols.showAll(this.mod()),
    hiddenCount: () => this.gridCols.hidden(this.mod()).filter(id => this.gridCols.configFor(this.mod()).columns.includes(id)).length,
  };
  readonly ctx = computed<FlowGridContext>(() => {
    const base = this.context();
    return this.editing() || this.columns() ? base : { ...base, columnHide: base.columnHide ?? this.hideApi };
  });
  private readonly headMode = computed<FlowHeadMode>(() =>
    this.editing() ? 'edit' : !this.columns() && this.gridCols.canHide(this.mod()) ? 'staff' : 'plain');
  private branchName = (id: string | null | undefined): string => {
    const u = this.auth.user();
    return (u?.branches ?? []).find(b => b.id === id)?.name ?? (id && id === u?.branchId ? u?.branchName ?? '' : '');
  };
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
    const { fold, mid } = this.layout();
    const module = this.mod();
    const mode = this.headMode();
    const hdr = (fdId: string, label: string) => ({
      headerComponentParams: { innerHeaderComponent: FlowHeadComponent, fdId, label, mode, locked: !!fdColumn(module, fdId)?.locked },
    });
    const tight = fold.has('tight');
    const waitIn = fold.has('wait');
    const W = FLOW_MIN;
    const cellCtx = fdCellCtx(this.rows(), this.branchName);
    // Where now (owner design D, 2026-11-21): the journey ring + two lines of words in ONE fixed column (it carries the
    // folded Waiting line). Column id "where"; the set filter reads line 1 (the stage word).
    const whereCol = (): ColDef<FlowRow> => valuesCol<FlowRow>({ colId: 'where', headerName: 'Where now', headerTooltip: 'Where now · journey', flex: 1.2,
      minWidth: tight ? W.whereTight : W.where, wrapText: true, autoHeight: true, cellClass: 'fd-flow__c-wrap',
      cellRenderer: FlowWhereCellComponent, cellRendererParams: { waitIn }, ...hdr('where', 'Where now') }, r => r.where, WorkSetFilterComponent);
    const waitCol = (): ColDef<FlowRow> => durationCol<FlowRow>({ colId: 'wait', headerName: 'Waiting', width: W.wait, minWidth: W.wait, ...hdr('waiting', 'Waiting'),
      cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
        ? `<span class="fd-flow__wait${p.data.late ? ' fd-flow__wait--late' : ''}"${p.data.late ? ' title="Waiting over 30 minutes"' : ''}>${esc(p.data.wait)}</span>` : '' },
      r => r.waitMin, { kind: 'wait', lateAfter: LATE_AFTER_MIN });
    const payCol = (): ColDef<FlowRow> => moneyCol<FlowRow>({ colId: 'pay', headerName: 'Payment', width: W.pay, minWidth: W.pay, ...hdr('payment', 'Payment'),
      cellRenderer: (p: ICellRendererParams<FlowRow>) => p.data
        ? `<span class="fd-flow__pay${p.data.payDue ? ' fd-flow__pay--due' : ''}">${esc(p.data.pay)}</span>` : '' },
      r => flowPayAmount(r), 'center');
    const plainCol = (id: string): ColDef<FlowRow> => {
      const c = fdColumn(module, id);
      const min = c?.min ?? 100;
      const label = c?.label ?? id;
      const def: ColDef<FlowRow> = {
        colId: id, headerName: label, minWidth: min, ...(c?.flex ? { flex: c.flex } : { width: min }),
        wrapText: true, autoHeight: true, cellClass: 'fd-flow__c-wrap', ...hdr(id, label),
        cellRenderer: (p: ICellRendererParams<FlowRow>) => {
          if (!p.data) return '';
          const v = fdCell(module, id, p.data, cellCtx);
          return v.text === '—' ? '<span class="fd-flow__muted">—</span>' : `<span class="fd-flow__txt${v.late ? ' fd-flow__txt--late' : ''}">${esc(v.text)}</span>`;
        },
      };
      return fdTypedCol(module, id, def, r => fdCell(module, id, r, cellCtx).text, c?.align === 'center' ? 'center' : 'left', cellCtx.ahead);
    };
    const ids = this.ids();
    // Waiting is a FIXED column right before Next — the same x in every section (owner 2026-11-21); narrow grids fold it into Where now.
    const showWait = ids.includes('waiting') && !waitIn;
    const all: ColDef<FlowRow>[] = [
      { colId: 'sel', headerName: '', width: W.sel, minWidth: W.sel, maxWidth: W.sel, hide: !this.selecting(), cellRenderer: FlowSelectCellComponent,
        cellClass: 'fd-flow__c-sel' },
      // Work-grid column rule (shared/utils/work-grid): every data column sorts + filters on its real value; text LEFT,
      // short same-shape values CENTRED, the action column RIGHT. They AND with the head's pill / search / filters.
      tokenCol<FlowRow>({ colId: 'token', headerName: 'Token', hide: fold.has('token'), width: this.tokenW(), minWidth: this.tokenW(), cellRenderer: FlowTokenCellComponent,
        ...hdr('token', 'Token') }, r => flowTokenText(r), r => flowTokenValue(r), 'center'),
      textCol<FlowRow>({ colId: 'patient', headerName: 'Patient', flex: 1.6, minWidth: tight ? W.patientTight : W.patient, wrapText: true, autoHeight: true,
        cellRenderer: FlowPatientCellComponent, cellClass: 'fd-flow__c-wrap', ...hdr('patient', 'Patient') }, r => flowPatientText(r), 'left', r => r.name),
      ...(ids.includes('where') ? [whereCol()] : []),
      ...mid.map(id => id === 'payment' ? payCol() : plainCol(id)),
      ...(showWait ? [waitCol()] : []),
      actionCol<FlowRow>({ colId: 'next', headerName: 'Next', width: tight ? W.nextTight : W.next, minWidth: tight ? W.nextTight : W.next,
        headerClass: 'fd-flow__h-right', cellClass: 'fd-flow__c-next', cellRenderer: FlowNextCellComponent, ...hdr('next', 'Next') }),
    ];
    if (!this.editing()) return all;
    // Settings preview: no column filters (nothing to filter), and every header fits grip + whole label + ✕ / lock.
    return all.map(c => {
      if (c.colId === 'sel') return c;
      const label = String((c.headerComponentParams as { label?: string } | undefined)?.label ?? c.headerName ?? '');
      const need = Math.ceil(label.length * 7.6 + 78);
      return {
        ...c, filter: false, sortable: false,
        minWidth: Math.max(c.minWidth ?? 0, need),
        ...(c.width !== undefined ? { width: Math.max(c.width, need) } : {}),
        ...(c.maxWidth !== undefined ? { maxWidth: Math.max(c.maxWidth, need) } : {}),
      };
    });
  });

  /** The visible columns' minimum widths summed (the settings preview scales the grid to fit its box by it). */
  readonly minTotal = computed(() => this.cols().filter(c => !c.hide).reduce((n, c) => n + (c.minWidth ?? c.width ?? 0), 0));

  onReady(e: GridReadyEvent<FlowRow>): void {
    if (this.auto()) e.api.setGridOption('domLayout', 'autoHeight');
  }

  ngAfterViewInit(): void {
    // The admin's Work grid columns for this branch (one load; defaults until it lands or if it fails).
    if (!this.columns()) this.gridCols.ensureLoaded();
    if (typeof ResizeObserver === 'undefined') return;
    const el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      const ro = new ResizeObserver(entries => {
        const w = Math.round(entries[0]?.contentRect.width ?? el.clientWidth);
        const key = (x: number) => { const l = this.layoutAt(x); return [...l.fold].join() + '|' + l.mid.join(); };
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
