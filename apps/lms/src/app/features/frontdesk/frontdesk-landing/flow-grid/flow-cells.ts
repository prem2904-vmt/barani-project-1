import { ChangeDetectionStrategy, ChangeDetectorRef, Component, ElementRef, Input, inject, viewChildren } from '@angular/core';
import type { ICellRendererParams } from 'ag-grid-community';
import type { ICellRendererAngularComp } from 'ag-grid-angular';
import { DailyNoComponent } from '../../../../shared/components/daily-no/daily-no.component';
import { ActionsMenuComponent, PfAction } from '../../../../shared/components/actions-menu/actions-menu.component';
import { OutsourcedActionsComponent } from '../../outsourced/outsourced-actions.component';
import { JourneyRingComponent } from '../../../../shared/components/journey-ring/journey-ring.component';
import type { JourneyDetail } from '../../../../shared/components/journey-ring/journey-detail';
import { flowJourneyDetail } from './flow-journey';
import { StatusWordsComponent } from '../../../../shared/components/status-words/status-words.component';
import type { StatusWords } from '../../../../shared/utils/status-words';
import { dailyNoLabel } from '../../../../shared/utils/daily-no';
import { type FlowAction, type FlowActionId, type FlowRow, whereWords } from './flow-row';

/** What the landing hands the grid (pf-data-grid `context`): its existing handlers + busy states. */
export interface FlowGridContext {
  /** Run an action (the landing's existing handler). `anchor` = the pressed control (the Share menu opens by it). */
  act(row: FlowRow, id: FlowActionId, anchor: HTMLElement | null): void;
  /** Open the row — the same thing tapping it does today. */
  open(row: FlowRow): void;
  busy(row: FlowRow, id: FlowActionId): boolean;
  /** In progress multi-select (bulk dispatch / package). */
  selectable(row: FlowRow): boolean;
  selected(row: FlowRow): boolean;
  toggle(row: FlowRow, ev: MouseEvent | KeyboardEvent): void;
  /** The ring's inner service label adds information: 2+ services and no single-service filter. */
  ringLabels?(): boolean;
  /** Settings › Work grid columns preview: the header drag / ✕ / Alt+arrows (flow-head.component.ts). */
  columnEdit?: FlowColumnEdit;
  /** Frontdesk: this person may hide a column for themselves (only while the admin allows it). */
  columnHide?: FlowColumnHide;
}

export interface FlowColumnEdit {
  start(ev: PointerEvent, fdId: string, headerCell: HTMLElement): void;
  key(ev: KeyboardEvent, fdId: string): void;
  remove(fdId: string): void;
}
export interface FlowColumnHide {
  hide(fdId: string): void;
  showAll(): void;
  hiddenCount(): number;
}

type P = ICellRendererParams<FlowRow> & { context: FlowGridContext };

const MENU_ICON: Partial<Record<string, PfAction['icon']>> = {
  share: 'share', download: 'download', reprint: 'print', open: 'view', profile: 'patient', pay: 'edit', discard: undefined,
};

/**
 * Where now (owner design D, 2026-11-21): the journey ring and the words in ONE cell — the shared pf-journey-ring
 * (32px; its own ≥44px button opens the journey view, the row's tap stays the row's) + `<pf-status-words>`: line 1
 * what is happening now, line 2 the detail / next (flow-row.ts `whereWords`). A narrow grid folds Waiting in as a
 * third quiet line (rose when late). No pill, no dot.
 */
@Component({
  selector: 'pf-fd-flow-where',
  standalone: true,
  imports: [JourneyRingComponent, StatusWordsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (row) {
    <span class="fd-cell-where">
      <pf-journey-ring class="fd-cell-ring" [steps]="row.ring ?? []" [service]="row.service" [showLabel]="false" [size]="32" [detail]="detail" />
      <span class="fd-cell-where__words">
        <pf-status-words [words]="words" />
        @if (waitIn && row.waitMin !== null) { <span class="fd-cell-where__wait" [class.fd-cell-where__wait--late]="row.late">Waiting {{ row.wait }}</span> }
      </span>
    </span>
  }`,
  styles: [`
    :host { display: flex; align-items: center; min-height: 100%; min-width: 0; }
    .fd-cell-where { display: grid; grid-template-columns: 44px minmax(0, 1fr); align-items: center; column-gap: 8px; padding: 6px 0; min-width: 0; width: 100%; }
    .fd-cell-where pf-journey-ring { justify-self: center; }
    .fd-cell-where__words { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .fd-cell-where__wait { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .fd-cell-where__wait--late { color: var(--pf-late-text, color-mix(in srgb, var(--red-text) 85%, var(--text-primary))); font-weight: 600; }
  `],
})
export class FlowWhereCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  row: FlowRow | null = null;
  words: StatusWords | null = null;
  /** Waiting folded into this cell (flow-fold.ts 'wait'). */
  waitIn = false;
  private ctx: FlowGridContext | null = null;
  /** Read at tap time (fresh clock, the row's own Next action through the landing's existing handler). */
  readonly detail = (): JourneyDetail => {
    const row = this.row!;
    const n = row.next;
    return flowJourneyDetail(row, Date.now(), {
      showLabel: this.ctx?.ringLabels?.() ?? true,
      action: n ? { label: n.label, aria: n.aria, run: () => this.ctx?.act(row, n.id, this.el.nativeElement) } : null,
    });
  };
  agInit(p: P & { waitIn?: boolean }): void {
    this.row = p.data ?? null; this.ctx = p.context; this.waitIn = !!p.waitIn;
    this.words = this.row ? whereWords(this.row) : null;
    this.cdr.markForCheck();
  }
  refresh(p: P): boolean { this.agInit(p); return true; }
}

/** Token: the day's "#N" (pf-daily-no — the same chip the lab screens use). */
@Component({
  selector: 'pf-fd-flow-token',
  standalone: true,
  imports: [DailyNoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (row?.order) { <span class="fd-cell-tok" [attr.data-order-id]="row!.id"><pf-daily-no [of]="row!.order" /></span> }
    @else if (row?.visit) { <span class="fd-cell-tok fd-cell-tok--opd" [attr.data-visit-id]="row!.visit!.id">{{ row!.visit!.tokenLabel }}</span> }`,
  styles: [`.fd-cell-tok { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--violet-text, #6d28d9); }
    .fd-cell-tok ::ng-deep .pf-dayno { font: inherit; color: inherit; }
    .fd-cell-tok--opd { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; font-size: 12.5px;
      background: color-mix(in srgb, var(--violet-text, #6d28d9) 10%, var(--pf-card-bg, #fff)); }`],
})
export class FlowTokenCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  row: FlowRow | null = null;
  agInit(p: P): void { this.row = p.data ?? null; this.cdr.markForCheck(); }
  refresh(p: P): boolean { this.agInit(p); return true; }
}

/** Patient: the FULL name (wraps, never cut) + "30/F · MRN". Enter on the name opens the row (keyboard parity
 *  with the old focusable rows). */
@Component({
  selector: 'pf-fd-flow-patient',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (row) {
      <span class="fd-cell-pt">
        @if (token) { <span class="fd-cell-pt__tok">{{ token }}</span> }
        <span class="fd-cell-pt__name" tabindex="0" role="link" [attr.aria-label]="'Open ' + row.name"
          (keydown.enter)="open($event)" (keydown.space)="open($event)">{{ row.name }}</span>
        @if (row.meta) { <span class="fd-cell-pt__meta">{{ row.meta }}</span> }
        <!-- Narrow grids (iPad) fold the Payment column into this line so Patient keeps whole words. -->
        @if (row.pay && row.pay !== '—') { <span class="fd-cell-pt__pay" [class.fd-cell-pt__pay--due]="row.payDue">{{ row.pay }}</span> }
      </span>
    }`,
  styles: [`
    .fd-cell-pt { display: flex; flex-direction: column; gap: 2px; padding: 8px 0; min-width: 0; line-height: 1.3; }
    .fd-cell-pt__name { font-weight: 600; font-size: 13.5px; color: var(--text-primary); white-space: normal; overflow-wrap: break-word; border-radius: 4px; }
    .fd-cell-pt__name:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 2px; }
    .fd-cell-pt__meta { font-size: 12px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .fd-cell-pt__pay { display: none; font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .fd-cell-pt__pay--due { color: color-mix(in srgb, var(--red-text) 80%, var(--text-primary)); font-weight: 600; }
    :host-context(.fd-flow--fold) .fd-cell-pt__pay { display: inline; }
    /* A narrow grid folds the Token column into a small chip before the name (flow-fold.ts). */
    .fd-cell-pt__tok { display: none; align-self: flex-start; min-height: 20px; padding: 0 7px; border-radius: 999px; font-size: 11.5px; font-weight: 700;
      line-height: 20px; font-variant-numeric: tabular-nums; color: var(--violet-text, #6d28d9);
      background: color-mix(in srgb, var(--violet-text, #6d28d9) 10%, var(--pf-card-bg, #fff)); }
    :host-context(.fd-flow--fold-token) .fd-cell-pt__tok { display: inline-block; }
  `],
})
export class FlowPatientCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  row: FlowRow | null = null;
  token = '';
  private ctx: FlowGridContext | null = null;
  agInit(p: P): void {
    this.row = p.data ?? null; this.ctx = p.context;
    const r = this.row;
    this.token = r?.visit ? r.visit.tokenLabel : dailyNoLabel(r?.order?.dailyNo, r?.order?.dailyNoDay);
    this.cdr.markForCheck();
  }
  refresh(p: P): boolean { this.agInit(p); return true; }
  open(ev: Event): void { ev.preventDefault(); ev.stopPropagation(); if (this.row) this.ctx?.open(this.row); }
}

/** In progress multi-select: the kit's round .pf-check (only on rows that can take the bulk actions). */
@Component({
  selector: 'pf-fd-flow-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (row && ctx?.selectable(row)) {
      <button type="button" class="pf-check fd-cell-sel" role="checkbox" [attr.aria-checked]="ctx!.selected(row)"
        [attr.aria-label]="'Select ' + row.name" (click)="toggle($event)" (keydown.space)="toggle($any($event))">
        <span class="pf-check__box" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
        </span>
      </button>
    }`,
  styles: [`.fd-cell-sel { display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; }
    @media (pointer: coarse) { .fd-cell-sel { min-width: 44px; min-height: 44px; } }`],
})
export class FlowSelectCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  row: FlowRow | null = null;
  ctx: FlowGridContext | null = null;
  agInit(p: P): void { this.row = p.data ?? null; this.ctx = p.context; this.cdr.markForCheck(); }
  refresh(p: P): boolean { this.agInit(p); return true; }
  toggle(ev: MouseEvent | KeyboardEvent): void {
    ev.preventDefault(); ev.stopPropagation();
    if (this.row) this.ctx?.toggle(this.row, ev);
    this.cdr.markForCheck();
  }
}

/**
 * Next: ONE contextual button for the row's next step + ⋯ (pf-actions-menu) with every other action. Outsourced tube
 * actions go through the tube's own pf-outsourced-actions (kept mounted, hidden — ONE home for the upload / attach
 * flow: file picker, DialogService question, toasts).
 */
@Component({
  selector: 'pf-fd-flow-next',
  standalone: true,
  imports: [ActionsMenuComponent, OutsourcedActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (row) {
      <span class="fd-cell-next pf-share-wrapper">
        @if (row.next; as n) {
          <button type="button" class="pf-rowact fd-cell-next__btn" [attr.aria-label]="n.aria" [attr.data-action]="n.id"
            [disabled]="busy(n.id)" [attr.aria-busy]="busy(n.id) || null" (click)="run(n, $event)">{{ busy(n.id) ? busyText(n) : n.label }}</button>
        }
        <pf-actions-menu class="fd-cell-next__menu" [actions]="menu" heading="More actions" [label]="'More actions for ' + row.name"
          triggerClass="pf-rowact pf-rowact--icon fd-cell-next__more" (action)="pick($event)" />
      </span>
      @if (row.tubes.length) {
        <span class="fd-cell-next__oa" aria-hidden="true">
          @for (t of row.tubes; track t.sampleId) { <pf-outsourced-actions [tube]="t" /> }
        </span>
      }
    }`,
  styles: [`
    :host { display: flex; justify-content: flex-end; width: 100%; }
    .fd-cell-next { display: inline-flex; align-items: center; gap: 4px; }
    .fd-cell-next__btn { height: 36px; min-height: 36px; min-width: 84px; padding: 0 14px; font-size: 13px;
      color: var(--violet-text, #6d28d9); border-color: color-mix(in srgb, var(--violet-text, #6d28d9) 35%, var(--pf-line)); }
    :host ::ng-deep .fd-cell-next__more { width: 36px; min-width: 36px; height: 36px; min-height: 36px; border-color: transparent; background: transparent; }
    @media (pointer: coarse) {
      .fd-cell-next__btn { height: 44px; min-height: 44px; min-width: 88px; }
      :host ::ng-deep .fd-cell-next__more { width: 44px; min-width: 44px; height: 44px; min-height: 44px; }
    }
    /* Narrowest grid: the button keeps its whole label at its natural width (never clipped). */
    :host-context(.fd-flow--tight) .fd-cell-next__btn { min-width: 0; padding: 0 10px; }
    .fd-cell-next__btn { white-space: nowrap; flex: none; }
    .fd-cell-next__oa { position: absolute; width: 0; height: 0; overflow: hidden; visibility: hidden; }
  `],
})
export class FlowNextCellComponent implements ICellRendererAngularComp {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly tubeActs = viewChildren(OutsourcedActionsComponent);
  row: FlowRow | null = null;
  menu: PfAction[] = [];
  private ctx: FlowGridContext | null = null;
  /** Outside the grid (the shared work list below 1024px): the same cell, fed the row + context directly. */
  @Input() set item(v: { row: FlowRow; ctx: FlowGridContext } | null) { if (v) this.agInit({ data: v.row, context: v.ctx } as P); }

  agInit(p: P): void {
    this.row = p.data ?? null;
    this.ctx = p.context;
    this.menu = (this.row?.more ?? []).map(a => ({
      id: a.id, label: a.label, icon: MENU_ICON[a.id.split(':')[0]] ?? undefined,
      group: a.id.startsWith('out-') ? 'Partner lab' : a.id === 'open' || a.id === 'profile' ? 'Open' : undefined,
    }));
    this.cdr.markForCheck();
  }
  refresh(p: P): boolean { this.agInit(p); return true; }

  busy(id: FlowActionId): boolean { return !!this.row && !!this.ctx?.busy(this.row, id); }
  busyText(a: FlowAction): string {
    return a.id === 'dispatch' || a.id === 'dispatch-drawn' ? 'Dispatching…' : a.id === 'recollect' ? 'Reopening…'
      : a.id === 'download' ? 'Preparing…' : a.id === 'reprint' ? 'Printing…' : a.label;
  }

  run(a: FlowAction, ev: MouseEvent): void {
    ev.stopPropagation();
    this.exec(a.id, ev.currentTarget as HTMLElement);
  }

  pick(id: string): void {
    const trigger = this.el.nativeElement.querySelector('.fd-cell-next__more') as HTMLElement | null;
    // The menu emits from inside its own click (portalled to <body>); the Share menu opens after that click
    // has finished bubbling, so the landing's outside-click rule doesn't close it again at once.
    setTimeout(() => this.exec(id as FlowActionId, trigger), 0);
  }

  private exec(id: FlowActionId, anchor: HTMLElement | null): void {
    if (!this.row) return;
    const [kind, sampleId] = id.split(':');
    if (sampleId && kind.startsWith('out-')) {
      const idx = this.row.tubes.findIndex(t => t.sampleId === sampleId);
      const comp = this.tubeActs()[idx];
      const tube = this.row.tubes[idx];
      if (!comp || !tube) return;
      if (kind === 'out-upload') comp.pick();
      else if (kind === 'out-complete') void comp.markCompleted();
      else if (kind === 'out-undo') void comp.undo();
      else if (kind === 'out-attach') void comp.toggleAttach();
      else if (kind === 'out-view') { const rep = comp.rowReport(tube); if (rep) comp.view(rep.url); }
      return;
    }
    this.ctx?.act(this.row, id, anchor);
  }
}
