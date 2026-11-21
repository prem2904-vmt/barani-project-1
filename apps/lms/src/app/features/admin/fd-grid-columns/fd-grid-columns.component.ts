import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Observable, catchError, map, of } from 'rxjs';
import { FdGridColumnsService } from '../../../core/services/fd-grid-columns.service';
import { ApiService } from '../../../core/services/api.service';
import { OpdDeskApi } from '../../opd/frontdesk/desk-api.service';
import type { Order } from '../../../shared/models/order.model';
import { ToastService } from '../../../core/services/toast.service';
import { SkeletonComponent } from '../../../shared/primitives/skeleton.component';
import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { SettingRowComponent, SettingToggleComponent } from '../../../shared/components/setting-row/setting-row.component';
import { dirtySnapshot } from '../../../shared/utils/dirty-snapshot';
import {
  FD_MODULE_LABEL, type FdDataSource, type FdModule, addFdColumn, defaultFdColumns, fdColumn, fdConfigOf, fdPalette, insertFdColumn,
  isDefaultFdColumns, moveFdColumn, readyFdColumns, removeFdColumn,
} from '../../../shared/utils/fd-grid-columns';
import { FlowGridComponent } from '../../frontdesk/frontdesk-landing/flow-grid/flow-grid.component';
import { agColsOf } from '../../frontdesk/frontdesk-landing/flow-grid/flow-columns';
import type { FlowColumnEdit } from '../../frontdesk/frontdesk-landing/flow-grid/flow-cells';
import { previewContext, previewRows } from './preview-rows';

const GRIP = 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01';

interface DragState {
  id: string;
  src: 'pal' | 'grid';
  x0: number; y0: number;
  on: boolean;
  x: number; y: number;
  /** Insertion index into the current order (null = not over the header). */
  idx: number | null;
  toPal: boolean;
  barLeft: number;
  pointerId: number;
}

/**
 * Settings › <module> › Front desk › Work grid columns (owner-approved mock grid-settings-v3, 2026-11-21): which columns
 * the Frontdesk WORK grid shows for ONE module, in which order.
 *  - AVAILABLE palette (grip · name · description · +); "Needs data" columns greyed and not draggable until a feed
 *    carries their data (`readyFdColumns` over `probe`).
 *  - PREVIEW = the real Frontdesk flow grid (its own column definitions and cell renderers) with sample rows.
 *  - Drag a palette item into the header (violet insertion line), drag a header to move it, drag it back to the palette
 *    or ✕ to remove; + adds before Next. Pointer events (mouse + touch); keyboard: Enter on an item adds, Alt+← / Alt+→
 *    on a focused header moves, Delete removes. Token + Patient stay first, Next last (fd-grid-columns.ts).
 *  - "Staff may hide columns for themselves" switch. Save rides the band (pf-settings-savebar: disabled until the value
 *    differs from the saved snapshot); Reset to default is the group head's tool (`reset()`).
 */
@Component({
  selector: 'pf-fd-grid-columns',
  standalone: true,
  imports: [FlowGridComponent, SettingsSavebarComponent, SettingRowComponent, SettingToggleComponent, SkeletonComponent, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fd-grid-columns.component.html',
  styleUrl: './fd-grid-columns.component.scss',
})
export class FdGridColumnsComponent implements OnInit {
  readonly module = input.required<FdModule>();
  /** Rows of today's feed for this module: a needs-data column whose data they carry becomes available. Read once
   *  (Lab: today's orders, OPD: today's visits); a failure = nothing extra is offered. */
  readonly probe = signal<readonly FdDataSource[]>([]);
  private readonly api = inject(ApiService);
  private readonly opdDesk = inject(OpdDeskApi);

  private readonly svc = inject(FdGridColumnsService);
  private readonly toast = inject(ToastService);
  private readonly zone = viewChild<ElementRef<HTMLElement>>('zone');
  private readonly pal = viewChild<ElementRef<HTMLElement>>('pal');
  private readonly ghost = viewChild<ElementRef<HTMLElement>>('ghost');
  private readonly fit = viewChild<ElementRef<HTMLElement>>('fit');
  private readonly grid = viewChild(FlowGridComponent);

  // ── Scale to fit (owner review 2026-11-21: the preview fits its box like the real Frontdesk, never clipped) ──
  /** The preview box's inner width and the grid's laid-out height (both measured). */
  private readonly boxW = signal(0);
  private readonly gridH = signal(0);
  /** The grid lays out at its natural width (every column at its minimum, more when the box is wider)… */
  readonly fitW = computed(() => Math.max(this.boxW(), (this.grid()?.minTotal() ?? 0) + 4) || null);
  /** …and is scaled down to the box when that is wider than the box. */
  readonly fitScale = computed(() => { const w = this.fitW(), b = this.boxW(); return w && b && w > b ? b / w : 1; });
  /** The box takes the scaled height (a transform does not change layout). */
  readonly fitH = computed(() => (this.gridH() && this.fitScale() < 1 ? Math.ceil(this.gridH() * this.fitScale()) + 2 : null));

  readonly grip = GRIP;
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly order = signal<string[]>([]);
  readonly staffMayHide = signal(true);
  readonly drag = signal<DragState | null>(null);
  readonly announce = signal('');

  readonly moduleLabel = computed(() => FD_MODULE_LABEL[this.module()]);
  readonly rows = computed(() => previewRows(this.module()));
  readonly ready = computed(() => readyFdColumns(this.module(), this.probe()));
  readonly palette = computed(() => fdPalette(this.module(), this.order(), this.ready()));
  readonly isDefault = computed(() => isDefaultFdColumns(this.module(), this.order()));
  /** Reset to default (the group head's tool): only when the columns differ from the catalogue's defaults. */
  readonly canReset = computed(() => !this.loading() && !this.isDefault());
  readonly countLabel = computed(() => { const n = this.order().length; return `${n} ${n === 1 ? 'column' : 'columns'}`; });

  private ro: ResizeObserver | null = null;
  private readonly snap = dirtySnapshot(() => ({ columns: this.order(), staffMayHide: this.staffMayHide() }));
  readonly dirty = this.snap.dirty;

  private readonly edit: FlowColumnEdit = {
    start: (ev, id, el) => this.start(ev, id, 'grid', el),
    key: (ev, id) => this.headKey(ev, id),
    remove: id => this.remove(id, true),
  };
  readonly ctx = previewContext({ columnEdit: this.edit });

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.unlisten(); this.ro?.disconnect(); });
    // Measure the box and the grid (ResizeObserver; the grid sits in an @defer block, so re-observe when it lands).
    effect(() => {
      const zone = this.zone()?.nativeElement;
      const fit = this.fit()?.nativeElement;
      if (typeof ResizeObserver === 'undefined' || !zone) return;
      this.ro?.disconnect();
      this.ro = new ResizeObserver(() => {
        this.boxW.set(Math.floor(zone.clientWidth));
        if (fit) this.gridH.set(fit.offsetHeight);
      });
      this.ro.observe(zone);
      if (fit) this.ro.observe(fit);
    });
    effect(() => {
      const el = this.ghost()?.nativeElement as (HTMLElement & { showPopover?: () => void; hidePopover?: () => void }) | undefined;
      const on = !!this.drag()?.on;
      if (!el?.showPopover) return;
      try {
        const open = el.matches(':popover-open');
        if (on && !open) el.showPopover(); else if (!on && open) el.hidePopover?.();
      } catch { /* no popover support (old browser / test DOM): the ghost just stays hidden */ }
    });
  }

  ngOnInit(): void {
    this.svc.fetch().subscribe({
      next: s => this.take(s?.[this.module()] ?? null),
      error: () => this.take(null),
    });
    this.readProbe();
  }

  private readProbe(): void {
    const m = this.module();
    const src: Observable<FdDataSource[]> = m === 'opd'
      ? this.opdDesk.visits({}).pipe(map(vs => (vs ?? []).map(visit => ({ visit }))))
      : m === 'lab' ? this.api.get<Order[]>('/api/orders/today?view=summary').pipe(map(os => (os ?? []).map(order => ({ order }))))
      : of([] as FdDataSource[]);
    src.pipe(catchError(() => of([] as FdDataSource[]))).subscribe(rows => this.probe.set(rows));
  }

  private take(saved: { columns?: string[]; staffMayHide?: boolean } | null): void {
    const cfg = fdConfigOf(this.module(), saved);
    this.order.set(cfg.columns);
    this.staffMayHide.set(cfg.staffMayHide);
    this.snap.mark();
    this.loading.set(false);
  }

  label(id: string): string { return fdColumn(this.module(), id)?.label ?? id; }

  // ── Edits ─────────────────────────────────────────────────────────────────────────────────────────────────

  add(id: string): void {
    if (!this.palette().ready.some(c => c.id === id)) return;
    this.order.set(addFdColumn(this.module(), this.order(), id));
    this.say(`${this.label(id)} added`);
  }

  remove(id: string, focusNext = false): void {
    const before = this.order();
    const i = before.indexOf(id);
    this.order.set(removeFdColumn(this.module(), before, id));
    if (this.order().length !== before.length) this.say(`${this.label(id)} removed`);
    if (focusNext) this.focusHead(this.order()[Math.min(i, this.order().length - 2)] ?? null);
  }

  /** Reset to default (Save keeps it). */
  reset(): void {
    this.order.set(defaultFdColumns(this.module()));
    this.say('Default columns back. Save to keep.');
  }

  /** Discard (the band's): back to what is saved. */
  discard(): void {
    const s = this.snap.saved();
    if (!s) return;
    this.order.set(s.columns);
    this.staffMayHide.set(s.staffMayHide);
  }

  hasUnsavedChanges(): boolean { return this.dirty(); }
  saveChanges(): Promise<boolean> { return this.post(); }
  save(): void { void this.post(); }

  private post(): Promise<boolean> {
    if (!this.dirty()) return Promise.resolve(true);
    this.saving.set(true);
    const cfg = { columns: this.order(), staffMayHide: this.staffMayHide() };
    return new Promise<boolean>(resolve => this.svc.save(this.module(), cfg).subscribe({
      next: () => { this.snap.mark(); this.saving.set(false); this.toast.success('Saved. The Frontdesk shows these columns now.'); resolve(true); },
      error: (e: { status?: number }) => {
        this.saving.set(false);
        // A server without the work-grid endpoint yet (404): say so plainly; the columns stay as edited (Save stays on).
        this.toast.error(e?.status === 404 ? 'Saving columns is not available on this server yet. Your changes are kept on this page.' : 'Could not save the columns. Try again.');
        resolve(false);
      },
    }));
  }

  private say(text: string): void {
    this.announce.set('');
    queueMicrotask(() => this.announce.set(text));
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────────────────────────────────────

  itemKey(ev: KeyboardEvent, id: string): void {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); this.add(id); }
  }

  private headKey(ev: KeyboardEvent, id: string): void {
    if (ev.altKey && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
      ev.preventDefault();
      ev.stopPropagation();
      const next = moveFdColumn(this.module(), this.order(), id, ev.key === 'ArrowLeft' ? -1 : 1);
      if (next.join() === this.order().join()) return;
      this.order.set(next);
      this.say(`${this.label(id)} moved to position ${next.indexOf(id) + 1} of ${next.length}`);
      this.focusHead(id);
    } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      this.remove(id, true);
    }
  }

  private focusHead(id: string | null): void {
    if (!id) return;
    setTimeout(() => this.zone()?.nativeElement.querySelector<HTMLElement>(`[data-fd-head="${id}"][tabindex]`)?.focus(), 60);
  }

  // ── Pointer drag (mouse + touch) ──────────────────────────────────────────────────────────────────────────

  private readonly onMove = (e: PointerEvent) => this.move(e);
  private readonly onUp = (e: PointerEvent) => this.end(e);
  private readonly onCancel = () => this.cancel();

  startPal(ev: PointerEvent, id: string): void {
    if ((ev.target as HTMLElement | null)?.closest('button')) return;
    if (!this.palette().ready.some(c => c.id === id)) return;
    this.start(ev, id, 'pal', ev.currentTarget as HTMLElement);
  }

  private start(ev: PointerEvent, id: string, src: 'pal' | 'grid', _el: HTMLElement): void {
    if (ev.button > 0) return;
    if (src === 'grid' && fdColumn(this.module(), id)?.locked) return;
    ev.preventDefault();
    this.drag.set({ id, src, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, on: false, idx: null, toPal: false, barLeft: 0, pointerId: ev.pointerId });
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
  }

  /** The header box of each column in the current order (a column = one or more AG header cells). */
  private headBoxes(): Array<{ id: string; left: number; right: number }> {
    const root = this.zone()?.nativeElement;
    if (!root) return [];
    const out: Array<{ id: string; left: number; right: number }> = [];
    for (const id of this.order()) {
      const cells = agColsOf(id).map(c => root.querySelector<HTMLElement>(`.ag-header-cell[col-id="${c}"]`)).filter((x): x is HTMLElement => !!x);
      if (!cells.length) continue;
      const rects = cells.map(c => c.getBoundingClientRect());
      out.push({ id, left: Math.min(...rects.map(r => r.left)), right: Math.max(...rects.map(r => r.right)) });
    }
    return out;
  }

  private move(e: PointerEvent): void {
    const d = this.drag();
    if (!d) return;
    if (!d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return;
    e.preventDefault();
    const zone = this.zone()?.nativeElement;
    const pal = this.pal()?.nativeElement;
    const zr = zone?.getBoundingClientRect();
    const pr = pal?.getBoundingClientRect();
    const inGrid = !!zr && e.clientX >= zr.left && e.clientX <= zr.right && e.clientY >= zr.top - 30 && e.clientY <= zr.bottom;
    const inPal = !!pr && e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom;
    let idx: number | null = null;
    let barLeft = 0;
    if (inGrid && zr) {
      const boxes = this.headBoxes();
      const order = this.order();
      let at = order.length - 1;
      for (const b of boxes) {
        if (e.clientX < (b.left + b.right) / 2) { at = order.indexOf(b.id); break; }
      }
      at = Math.max(2, Math.min(at, order.length - 1));
      idx = at;
      const target = boxes.find(b => b.id === order[at]);
      barLeft = target ? target.left - zr.left - 1 : 0;
    }
    if (!d.on && d.src === 'grid') this.markDragging(d.id);
    this.drag.set({ ...d, on: true, x: e.clientX, y: e.clientY, idx, barLeft, toPal: inPal && d.src === 'grid' });
  }

  private end(_e: PointerEvent): void {
    const d = this.drag();
    this.markDragging(null);
    this.unlisten();
    this.drag.set(null);
    if (!d || !d.on) return;
    if (d.idx !== null) {
      const before = this.order();
      this.order.set(insertFdColumn(this.module(), before, d.id, d.idx));
      if (d.src === 'pal') this.say(`${this.label(d.id)} added`);
      else if (before.join() !== this.order().join()) this.say(`${this.label(d.id)} moved to position ${this.order().indexOf(d.id) + 1} of ${this.order().length}`);
      return;
    }
    if (d.toPal) this.remove(d.id);
  }

  private cancel(): void { this.markDragging(null); this.unlisten(); this.drag.set(null); }

  private unlisten(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
  }

  /** The header being dragged reads faded (its AG header cells). */
  private markDragging(id: string | null): void {
    const root = this.zone()?.nativeElement;
    if (!root) return;
    for (const el of Array.from(root.querySelectorAll('.fdgc-dragging'))) el.classList.remove('fdgc-dragging');
    if (!id) return;
    for (const c of agColsOf(id)) root.querySelector(`.ag-header-cell[col-id="${c}"]`)?.classList.add('fdgc-dragging');
  }
}
