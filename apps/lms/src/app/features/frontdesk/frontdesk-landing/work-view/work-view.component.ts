import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import type { ServiceId } from '../../../../core/services/service-shelf';
import { FlowGridComponent } from '../flow-grid/flow-grid.component';
import type { FlowGridContext } from '../flow-grid/flow-cells';
import type { FlowRow } from '../flow-grid/flow-row';
import { ClinicViewComponent } from './clinic-view.component';
import { chipOf } from './clinic';
import { tokenWidth } from '../flow-grid/flow-fold';
import { dailyNoLabel } from '../../../../shared/utils/daily-no';
import { buildSections, loadSectionOrder, mergeSectionOrder, moveSection, saveSectionOrder } from './sections';

export type WorkViewMode = 'list' | 'clinic';

/** Owner motion style: ~260ms slide / fade, off under reduced motion. */
export const WV_MOTION_MS = 260;
export const WV_EASE = 'cubic-bezier(.2,.7,.2,1)';
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Morph stagger per tile (owner mock: i·22ms). */
export const STAGGER_MS = 22;

interface Slot { x: number; y: number; w: number; h: number; overflow: boolean; dense: boolean }
export interface MorphTile {
  id: string; x: number; y: number; w: number; h: number; delay: number; gone: boolean; dense: boolean;
  token: string; name: string; short: string; meta: string; where: string; wait: string; act: string; late: boolean; now: boolean;
}
export interface WorkMorph { face: 'row' | 'chip'; go: boolean; tiles: MorphTile[] }

/** A row's two faces: its list cells and its room chip (same words the real cells / chips show). */
export function tileFace(r: FlowRow): Omit<MorphTile, 'id' | 'x' | 'y' | 'w' | 'h' | 'delay' | 'gone' | 'dense'> {
  const c = chipOf(r);
  return { token: c.token, name: r.name, short: c.name, meta: r.meta, where: r.where, wait: r.waitMin === null ? '—' : r.wait,
    act: r.next?.label ?? '', late: r.late, now: c.now };
}

/**
 * The Frontdesk WORK card body (new design, ≥1024px):
 *  - List, ONE service picked (or a single-service tenant): the flow grid as before;
 *  - List, "All" with 2+ services: one SECTION per service (sticky header: grip · dot · name · count · "n late") with
 *    that service's own columns — the user orders them (drag the header's grip, long-press on touch, Alt+↑/↓ on a
 *    focused header), saved per tenant + user;
 *  - Clinic: the same rows put in their places (clinic-view.component.ts).
 * The landing hands in the rows it already built (status pill, search, More filters, step all applied).
 */
@Component({
  selector: 'pf-fd-work-view',
  standalone: true,
  imports: [FlowGridComponent, ClinicViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fd-wv__stack" #stack [class.fd-wv--morph]="!!morph()" [class.fd-wv--clinic]="view() === 'clinic'">
      @if (showList()) {
        <div class="fd-wv__view fd-wv__list" [class.off]="view() === 'clinic'">
          @if (split() && sections().length) {
            <div class="fd-secs" #secs [class.fd-secs--dragging]="!!drag()">
              @for (s of sections(); track s.id) {
                <section class="fd-sec" [attr.data-sec]="s.id" [class.fd-sec--lifted]="drag()?.id === s.id"
                  [style.transform]="drag()?.id === s.id ? 'translateY(' + drag()!.dy + 'px)' : null">
                  <header class="fd-sec__h" tabindex="0" [attr.data-sec-head]="s.id"
                    [attr.aria-label]="s.label + ', ' + s.rows.length + (s.rows.length === 1 ? ' patient' : ' patients') + (s.late ? ', ' + s.late + ' late' : '') + '. Alt plus arrow up or down moves this section.'"
                    (keydown)="onKey($event, s.id)">
                    <span class="fd-sec__grip" aria-hidden="true" title="Drag to reorder" (pointerdown)="dragStart($event, s.id)">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />
                      </svg>
                    </span>
                    <i class="fd-sec__dot" [attr.data-svc]="s.id" aria-hidden="true"></i>
                    <span class="fd-sec__name">{{ s.label }}</span>
                    <span class="fd-sec__n">{{ s.rows.length }}</span>
                    @if (s.late) { <span class="fd-sec__late">{{ s.late }} late</span> }
                  </header>
                  <pf-fd-flow-grid class="pf-fd-flow fd-sec__grid" [rows]="s.rows" [service]="s.id" [auto]="true" [context]="context()"
                    [selecting]="selecting()" [sharedTokenW]="tokenW()" (opened)="opened.emit($event)" />
                </section>
              }
              @if (drag(); as d) { <div class="fd-secs__drop" aria-hidden="true" [style.top.px]="d.lineY"></div> }
            </div>
          } @else {
            <pf-fd-flow-grid class="pf-fd-flow" [rows]="rows()" [context]="context()" [loading]="loading()"
              [selecting]="selecting()" [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()" (opened)="opened.emit($event)" />
          }
        </div>
      }
      @if (showClinic()) {
        <pf-fd-clinic class="fd-wv__view fd-wv__clinic" [class.off]="view() === 'list'" [rows]="rows()" [order]="order()" [single]="!split()"
          [context]="context()" [ringLabels]="split()" (more)="moreFor.emit($event)" (fitted)="onClinicFitted()" />
      }
      <!-- The morph (owner mock fd-morph-clinic): ONE moving tile per patient above both views, holding both faces
           (the row's cells and the room chip); each flies from its slot in the outgoing view to its slot in the
           incoming one (stagger i·22ms, 260ms). -->
      @if (morph(); as m) {
        <div class="fd-tiles" [class.fd-tiles--chip]="m.face === 'chip'" [class.fd-tiles--still]="!m.go" aria-hidden="true">
          @for (t of m.tiles; track t.id) {
            <div class="fd-tile" [attr.data-tile]="t.id" [class.lt]="t.late" [class.now]="t.now" [class.gone]="t.gone" [class.dense]="t.dense"
              [style.transform]="'translate(' + t.x + 'px,' + t.y + 'px)'" [style.width.px]="t.w" [style.height.px]="t.h"
              [style.transition-delay]="t.delay + 'ms'">
              <div class="fd-tile__cells">
                <span class="fd-tile__tok">{{ t.token }}</span>
                <span class="fd-tile__pt"><b>{{ t.name }}</b>@if (t.meta) { <small>{{ t.meta }}</small> }</span>
                <span class="fd-tile__where"><i aria-hidden="true"></i>{{ t.where }}</span>
                <span class="fd-tile__wait" [class.late]="t.late">{{ t.wait }}</span>
                @if (t.act) { <span class="fd-tile__act">{{ t.act }}</span> }
              </div>
              <div class="fd-tile__chip"><b>{{ t.token }}</b><span class="fd-tile__nm">{{ t.short }}</span>@if (t.wait !== '—') { <span class="fd-tile__t">{{ t.wait }}</span> }</div>
            </div>
          }
        </div>
      }
    </div>
    <span class="fd-sr" aria-live="polite">{{ announce() }}</span>
  `,
  styleUrl: './work-view.component.scss',
})
export class WorkViewComponent {
  readonly rows = input<FlowRow[]>([]);
  readonly context = input.required<FlowGridContext>();
  readonly loading = input(false);
  readonly selecting = input(false);
  readonly emptyTitle = input('');
  readonly emptyBody = input('');
  /** All with 2+ services: split by service. */
  readonly split = input(false);
  /** The tenant's services in Services-shelf order (the default section order). */
  readonly services = input<ServiceId[]>([]);
  /** localStorage key for the user's section order (`pf.fd.sectionOrder.<tenant>.<user>`). */
  readonly orderKey = input('');
  readonly view = input<WorkViewMode>('list');

  readonly opened = output<FlowRow>();
  /** "+N more" in a clinic room: show that service's list. */
  readonly moreFor = output<ServiceId>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly secsEl = viewChild<ElementRef<HTMLElement>>('secs');

  /** Bumped when the saved order changes (localStorage is not reactive). */
  private readonly orderVer = signal(0);
  readonly order = computed<ServiceId[]>(() => {
    this.orderVer();
    const key = this.orderKey();
    // Services with rows count as present (a row is never hidden), so a section the user placed keeps its place.
    const svcs = this.services();
    const withRows = [...new Set(this.rows().map(r => r.service))].filter(s => !svcs.includes(s));
    return mergeSectionOrder(key ? loadSectionOrder(key) : null, [...svcs, ...withRows]);
  });
  readonly sections = computed(() => buildSections(this.rows(), this.order()));
  /** ONE Token width for every section (Token / Patient at the same x in each). */
  readonly tokenW = computed(() => tokenWidth(this.rows().map(r => r.visit ? r.visit.tokenLabel : dailyNoLabel(r.order?.dailyNo, r.order?.dailyNoDay))));

  readonly drag = signal<{ id: ServiceId; dy: number; lineY: number; to: number } | null>(null);
  readonly announce = signal('');
  private readonly stackEl = viewChild<ElementRef<HTMLElement>>('stack');
  private readonly clinicView = viewChild(ClinicViewComponent);

  /** The morph in flight (null = none). */
  readonly morph = signal<WorkMorph | null>(null);
  readonly showList = computed(() => this.view() === 'list' || !!this.morph());
  readonly showClinic = computed(() => this.view() === 'clinic' || !!this.morph());
  private sources = new Map<string, Slot>();
  private morphTo: WorkViewMode | null = null;
  private morphStarted = false;
  private morphTimer: ReturnType<typeof setTimeout> | null = null;
  private waitFrames = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.endDrag(); if (this.morphTimer) clearTimeout(this.morphTimer); });
  }

  /** The landing calls this right before it flips the view (the DOM still shows the outgoing one). */
  beforeSwitch(to: WorkViewMode): void {
    this.finishMorph();
    if (reducedMotion()) return;                                   // reduced motion: the switch is instant
    this.sources = to === 'clinic' ? this.listSlots() : this.clinicSlots();
    if (!this.sources.size) return;
    this.morphTo = to;
    this.morphStarted = false;
    this.waitFrames = 0;
    this.morph.set({ face: to === 'clinic' ? 'row' : 'chip', go: false, tiles: [] });
    if (to === 'list') requestAnimationFrame(() => this.whenListReady());
  }

  /** The clinic fitted its rooms: start the morph into it, or re-place the tiles after a late layout shift. */
  onClinicFitted(): void {
    if (this.morphTo !== 'clinic' || !this.morph()) return;
    if (!this.morphStarted) this.startMorph();
    else this.place(this.clinicSlots(), false);
  }

  private whenListReady(): void {
    if (this.morphTo !== 'list' || this.morphStarted) return;
    const ready = this.host.nativeElement.querySelector('.fd-wv__list .ag-row[row-id]');
    if (ready || ++this.waitFrames > 30) { requestAnimationFrame(() => this.startMorph()); return; }
    requestAnimationFrame(() => this.whenListReady());
  }

  /** Box of every row in the list (its grid row), relative to the stack. */
  private listSlots(): Map<string, Slot> {
    const out = new Map<string, Slot>();
    const o = this.stackEl()?.nativeElement.getBoundingClientRect();
    if (!o) return out;
    // A grid row may be split over containers (pinned / centre): its widest part is the row.
    for (const el of Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.fd-wv__list .ag-row[row-id]'))) {
      const id = el.getAttribute('row-id');
      const r = el.getBoundingClientRect();
      if (!id || r.height <= 0 || (out.get(id)?.w ?? 0) >= r.width) continue;
      out.set(id, { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, overflow: false, dense: false });
    }
    return out;
  }

  /** Box of every row's chip in the clinic (or its room's "+N" when the room overflowed). */
  private clinicSlots(): Map<string, Slot> {
    const out = new Map<string, Slot>();
    const cv = this.clinicView();
    const o = this.stackEl()?.nativeElement.getBoundingClientRect();
    if (!cv || !o) return out;
    for (const r of this.rows()) {
      const s = cv.slotOf(r.id);
      if (!s) continue;
      const b = s.el.getBoundingClientRect();
      if (b.width > 0) out.set(r.id, { x: b.left - o.left, y: b.top - o.top, w: b.width, h: b.height, overflow: s.overflow, dense: s.dense });
    }
    return out;
  }

  /** Tiles at their OUTGOING slots (no transition), then — two frames later — at the incoming ones (staggered). */
  private startMorph(): void {
    const to = this.morphTo;
    if (!to || this.morphStarted) return;
    this.morphStarted = true;
    const targets = to === 'clinic' ? this.clinicSlots() : this.listSlots();
    const tiles: MorphTile[] = [];
    let i = 0;
    for (const r of this.rows()) {
      const from = this.sources.get(r.id);
      const dest = targets.get(r.id);
      if (!from && !dest) continue;
      const start = from ?? dest!;
      tiles.push({
        ...tileFace(r), id: r.id, x: start.x, y: start.y, w: start.w, h: start.h,
        gone: !from || !!from.overflow, dense: !!(from ?? dest)?.dense, delay: Math.min(i++ * STAGGER_MS, 900),
      });
    }
    this.morph.set({ face: to === 'clinic' ? 'row' : 'chip', go: false, tiles });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const m = this.morph();
      if (!m) return;
      this.morph.set({ ...m, go: true, face: to === 'clinic' ? 'chip' : 'row' });
      this.place(targets, true);
      // Late layout shifts (grid rows measuring their height): re-place once they have settled.
      if (to === 'list') setTimeout(() => { if (this.morphTo === 'list') this.place(this.listSlots(), false); }, 140);
    }));
  }

  /** Move every tile to its slot in the incoming view; a tile with no slot (or a room's overflow) fades away. */
  private place(targets: Map<string, Slot>, schedule: boolean): void {
    const m = this.morph();
    if (!m) return;
    const tiles = m.tiles.map(t => {
      const d = targets.get(t.id);
      if (!d) return { ...t, gone: true };
      return { ...t, x: d.x, y: d.y, w: d.w, h: d.h, gone: d.overflow, dense: d.dense };
    });
    this.morph.set({ ...m, tiles });
    if (schedule) {
      const last = Math.max(0, ...tiles.map(t => t.delay));
      if (this.morphTimer) clearTimeout(this.morphTimer);
      this.morphTimer = setTimeout(() => this.finishMorph(), last + WV_MOTION_MS + 140);
    }
  }

  private finishMorph(): void {
    if (this.morphTimer) { clearTimeout(this.morphTimer); this.morphTimer = null; }
    this.morphTo = null;
    this.morphStarted = false;
    if (this.morph()) this.morph.set(null);
  }

  // ── Reordering ──────────────────────────────────────────────────────────────────────────────────────────

  private visibleIds(): ServiceId[] { return this.sections().map(s => s.id); }

  /** Apply a new order: save it, then FLIP the sections from their old boxes (~260ms). */
  private apply(next: ServiceId[], moved: ServiceId): void {
    const before = this.sectionBoxes();
    const key = this.orderKey();
    if (key) saveSectionOrder(key, next);
    this.orderVer.update(v => v + 1);
    const vis = next.filter(s => this.visibleIds().includes(s));
    const label = this.sections().find(s => s.id === moved)?.label ?? moved;
    this.announce.set(`${label} moved to position ${vis.indexOf(moved) + 1} of ${vis.length}`);
    if (reducedMotion()) return;
    requestAnimationFrame(() => {
      const root = this.secsEl()?.nativeElement;
      if (!root) return;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>('.fd-sec'))) {
        const id = el.dataset['sec'] ?? '';
        const was = before.get(id);
        if (!was) continue;
        const dy = was - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) continue;
        el.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: WV_MOTION_MS, easing: WV_EASE });
      }
    });
  }

  private sectionBoxes(): Map<string, number> {
    const m = new Map<string, number>();
    const root = this.secsEl()?.nativeElement;
    for (const el of Array.from(root?.querySelectorAll<HTMLElement>('.fd-sec') ?? [])) m.set(el.dataset['sec'] ?? '', el.getBoundingClientRect().top);
    return m;
  }

  /** Alt/Option + ↑ / ↓ on a focused section header. */
  onKey(ev: KeyboardEvent, id: ServiceId): void {
    if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    const vis = this.visibleIds();
    const i = vis.indexOf(id);
    const to = ev.key === 'ArrowUp' ? i - 1 : i + 1;
    if (to < 0 || to >= vis.length) return;
    this.apply(moveSection(this.order(), vis, id, to), id);
    requestAnimationFrame(() => this.secsEl()?.nativeElement.querySelector<HTMLElement>(`[data-sec-head="${id}"]`)?.focus());
  }

  private pending: { timer: ReturnType<typeof setTimeout> | null; x: number; y: number; id: ServiceId; pointerId: number } | null = null;
  private dragState: { startY: number; mids: Array<{ id: ServiceId; top: number; mid: number; bottom: number }>; rootTop: number } | null = null;
  private readonly onMove = (e: PointerEvent) => this.dragMove(e);
  private readonly onUp = (e: PointerEvent) => this.dragEnd(e);

  /** Mouse: drag at once. Touch / pen: hold ~350ms first (a quick swipe still scrolls). */
  dragStart(ev: PointerEvent, id: ServiceId): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    this.pending = { timer: null, x: ev.clientX, y: ev.clientY, id, pointerId: ev.pointerId };
    window.addEventListener('pointermove', this.onMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    if (ev.pointerType === 'mouse') this.begin(ev.clientY);
    else this.pending.timer = setTimeout(() => { if (this.pending) this.begin(this.pending.y); }, 350);
  }

  private begin(y: number): void {
    const p = this.pending;
    const root = this.secsEl()?.nativeElement;
    if (!p || !root) return;
    // Section boxes in CONTENT coordinates (the body auto-scrolls while dragging).
    const rt = root.getBoundingClientRect().top;
    const mids = Array.from(root.querySelectorAll<HTMLElement>('.fd-sec')).map(el => {
      const r = el.getBoundingClientRect();
      const top = r.top - rt + root.scrollTop;
      return { id: el.dataset['sec'] as ServiceId, top, mid: top + Math.min(r.height, 120) / 2, bottom: top + r.height };
    });
    this.dragState = { startY: y + root.scrollTop, mids, rootTop: rt };
    const i = mids.findIndex(m => m.id === p.id);
    this.drag.set({ id: p.id, dy: 0, lineY: mids[i]?.top ?? 0, to: i });
    try { navigator.vibrate?.(10); } catch { /* not supported */ }
  }

  private dragMove(e: PointerEvent): void {
    const p = this.pending;
    if (!p) return;
    if (!this.dragState) {
      // Long-press not reached: a real move cancels it (the finger is scrolling).
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) this.endDrag();
      return;
    }
    e.preventDefault();
    const st = this.dragState;
    const root = this.secsEl()?.nativeElement;
    if (!root) return;
    const r = root.getBoundingClientRect();
    if (e.clientY < r.top + 40) root.scrollTop -= 24;
    else if (e.clientY > r.bottom - 40) root.scrollTop += 24;
    const y = e.clientY - r.top + root.scrollTop;          // pointer in content coordinates
    const others = st.mids.filter(m => m.id !== p.id);
    const to = Math.max(0, Math.min(others.length, others.filter(m => y > m.mid).length));
    const lineAt = to < others.length ? others[to].top : (others[others.length - 1]?.bottom ?? st.mids[0].bottom);
    this.drag.set({ id: p.id, dy: (e.clientY + root.scrollTop) - st.startY, lineY: lineAt - 1, to });
  }

  private dragEnd(_e: PointerEvent): void {
    const d = this.drag();
    const id = this.pending?.id;
    this.endDrag();
    if (!d || !id) return;
    const vis = this.visibleIds();
    if (d.to !== vis.indexOf(id)) this.apply(moveSection(this.order(), vis, id, d.to), id);
  }

  private endDrag(): void {
    if (this.pending?.timer) clearTimeout(this.pending.timer);
    this.pending = null;
    this.dragState = null;
    this.drag.set(null);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointermove', this.onMove);
      window.removeEventListener('pointerup', this.onUp);
      window.removeEventListener('pointercancel', this.onUp);
    }
  }
}
