import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import type { ServiceId } from '../../../../core/services/service-shelf';
import { FlowGridComponent } from '../flow-grid/flow-grid.component';
import type { FlowGridContext } from '../flow-grid/flow-cells';
import type { FlowRow } from '../flow-grid/flow-row';
import { ClinicViewComponent } from './clinic-view.component';
import { buildSections, loadSectionOrder, mergeSectionOrder, moveSection, saveSectionOrder } from './sections';

export type WorkViewMode = 'list' | 'clinic';

/** Owner motion style: ~260ms slide / fade, off under reduced motion. */
export const WV_MOTION_MS = 260;
export const WV_EASE = 'cubic-bezier(.2,.7,.2,1)';
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The List view's row boxes by row id (for the Clinic morph). */
export type RowRects = Map<string, DOMRect>;

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
    @if (view() === 'clinic') {
      <pf-fd-clinic class="fd-wv__clinic" [rows]="rows()" [order]="order()" [single]="!split()" [context]="context()"
        [from]="morphFrom()" [ringLabels]="split()" (more)="moreFor.emit($event)" />
    } @else if (split() && sections().length) {
      <div class="fd-secs" #secs [class.fd-secs--in]="listIn()" [class.fd-secs--dragging]="!!drag()">
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
              [selecting]="selecting()" (opened)="opened.emit($event)" />
          </section>
        }
        @if (drag(); as d) { <div class="fd-secs__drop" aria-hidden="true" [style.top.px]="d.lineY"></div> }
      </div>
    } @else {
      <pf-fd-flow-grid class="pf-fd-flow" [class.fd-wv--in]="listIn()" [rows]="rows()" [context]="context()" [loading]="loading()"
        [selecting]="selecting()" [emptyTitle]="emptyTitle()" [emptyBody]="emptyBody()" (opened)="opened.emit($event)" />
    }
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

  readonly drag = signal<{ id: ServiceId; dy: number; lineY: number; to: number } | null>(null);
  readonly announce = signal('');
  /** The list just came back from Clinic: slide / fade it in. */
  readonly listIn = signal(false);
  /** Row boxes captured just before List → Clinic (the clinic morphs its chips from them). */
  readonly morphFrom = signal<RowRects | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.endDrag());
  }

  /** The landing calls this right before it flips the view (the DOM still shows the old one). */
  beforeSwitch(to: WorkViewMode): void {
    if (to === 'clinic') {
      const m: RowRects = new Map();
      if (!reducedMotion()) {
        for (const el of Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.ag-center-cols-container .ag-row[row-id]'))) {
          const id = el.getAttribute('row-id');
          const r = el.getBoundingClientRect();
          if (id && r.height > 0) m.set(id, r);
        }
      }
      this.morphFrom.set(m);
      this.listIn.set(false);
    } else {
      this.morphFrom.set(null);
      this.listIn.set(!reducedMotion());
      setTimeout(() => this.listIn.set(false), WV_MOTION_MS + 80);
    }
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
