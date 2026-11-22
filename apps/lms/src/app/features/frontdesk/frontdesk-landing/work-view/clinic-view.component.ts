import {
  AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, NgZone, computed, effect, inject, input, output, signal,
  untracked,
} from '@angular/core';
import type { ServiceId } from '../../../../core/services/service-shelf';
import { JourneyOverlayService } from '../../../../shared/components/journey-ring/journey-overlay.service';
import type { FlowGridContext } from '../flow-grid/flow-cells';
import { flowJourneyDetail } from '../flow-grid/flow-journey';
import type { FlowRow } from '../flow-grid/flow-row';
import { type BoardDoctor, type ClinicChip, type FitResult, blockRowWeights, blockSpans, clinicServices, fitRoom, placeCols } from './clinic';

/** Chip geometry (CSS below is the same numbers): padding 8 · gap 6 · border 1 · 30px tall (44px on touch). */
const CHIP = { pad: 8, gap: 6, border: 1, h: 30, hTouch: 44, lineGap: 6 };

/**
 * Frontdesk CLINIC view (owner mock fd-morph-clinic): one block per service (the user's section order), places inside
 * it (clinic.ts), people as chips. Rooms fit their people (fitRoom: full → dense → hide who → "+N more" → count in the
 * title) — re-fitted whenever the card resizes. A chip opens the SAME journey view as the list's ring; "+N more"
 * goes back to that service's list. Entering, chips glide from their list rows (~260ms; reduced motion: none).
 */
@Component({
  selector: 'pf-fd-clinic',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cv" [style.grid-template-rows]="rowsTpl()">
      @for (s of blocks(); track s.svc.id) {
        <section class="cv-svc" [attr.data-sec]="s.svc.id" [style.grid-column]="'span ' + s.span" [style.grid-row]="(s.row + 1)">
          <header class="cv-svc__h">
            <i class="cv-dot" [attr.data-svc]="s.svc.id" aria-hidden="true"></i>
            <span class="cv-svc__name">{{ s.svc.label }}</span><span class="cv-svc__n">{{ s.svc.n }}</span>
            @if (s.svc.late) { <span class="cv-svc__late">{{ s.svc.late }} late</span> }
          </header>
          <div class="cv-rooms" [style.grid-template-columns]="'repeat(' + s.cols + ', minmax(0, 1fr))'">
            @for (p of s.svc.places; track p.id) {
              @let f = fitOf(p.id, p.chips.length);
              <div class="cv-room" [attr.data-place]="p.id" [class.cv-room--wait]="p.wait" [class.cv-room--tall]="p.wait && s.svc.places.length > s.cols"
                [class.cv-room--dense]="f.level !== 'full'" [class.cv-room--tight]="f.level === 'tight' || f.level === 'more' || f.level === 'counted'"
                [attr.data-fit]="f.level">
                <h3 class="cv-room__t">
                  @if (p.doctor) {
                    <button type="button" class="cv-room__title cv-room__doc" [attr.aria-label]="'Show the patients of ' + p.title + ' in the list'"
                      [attr.title]="'Show the patients of ' + p.title" (click)="doctor.emit(p.doctor!)">{{ p.title }}</button>
                  } @else {
                    <span class="cv-room__title">{{ p.title }}</span>
                  }
                  @if (f.level === 'counted') {
                    <button type="button" class="cv-chip cv-more" (click)="more.emit(s.svc.id)"
                      [attr.aria-label]="p.chips.length + ' in ' + p.title + ', show them in the list'">+{{ p.chips.length }}</button>
                  }
                  @if (p.status) { <span class="cv-st" [class.cv-st--run]="p.status.run">{{ p.status.label }}</span> }
                </h3>
                @if (p.wait) { <div class="cv-room__who"><span class="cv-big">{{ p.chips.length }}</span> {{ p.who.replace(p.chips.length + ' ', '') }}</div>
                  @if (p.by) { <div class="cv-room__who cv-room__by">{{ p.by }}</div> } }
                @else if (p.who) { <div class="cv-room__who">{{ p.who }}</div> }
                <div class="cv-chips">
                  @for (c of p.chips; track c.id; let i = $index) {
                    @if (i < f.shown) {
                      <button type="button" class="cv-chip" [attr.data-row]="c.id" [class.cv-chip--late]="c.late" [class.cv-chip--now]="c.now"
                        [attr.title]="c.where" [attr.aria-label]="c.token + ' ' + c.name + (c.where ? ', ' + c.where : '') + (c.wait ? ', waiting ' + c.wait : '') + (c.late ? ', late' : '') + '. Open journey'"
                        (click)="openChip(c, $event)">
                        <b class="cv-chip__tok">{{ c.token }}</b><span class="cv-chip__nm">{{ c.name }}</span>
                        @if (c.wait) { <span class="cv-chip__t">{{ c.wait }}</span> }
                      </button>
                    }
                  }
                  @if (f.level === 'more') {
                    <button type="button" class="cv-chip cv-more" (click)="more.emit(s.svc.id)"
                      [attr.aria-label]="(p.chips.length - f.shown) + ' more in ' + p.title + ', show them in the list'">+{{ p.chips.length - f.shown }}{{ compact() ? '' : ' more' }}</button>
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
      @if (!blocks().length) { <p class="cv-empty">Nobody here for this filter.</p> }
    </div>
  `,
  styleUrl: './clinic-view.component.scss',
})
export class ClinicViewComponent implements AfterViewInit {
  readonly rows = input<FlowRow[]>([]);
  readonly order = input<ServiceId[]>([]);
  /** Filtered to one service: its block takes the whole card. */
  readonly single = input(false);
  readonly context = input.required<FlowGridContext>();
  readonly ringLabels = input(true);
  /** The OPD doctors board (OPD on only): every doctor gets a room with the board's counts. */
  readonly board = input<BoardDoctor[]>([]);
  readonly more = output<ServiceId>();
  /** A doctor's room title: show that doctor's patients in the list (the board's "tap a doctor"). */
  readonly doctor = output<string>();
  /** Every completed fit (the work view's morph places its tiles on the chips after it, and re-places on later ones). */
  readonly fitted = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly overlay = inject(JourneyOverlayService);

  readonly width = signal(1000);
  readonly compact = computed(() => this.width() < 900);
  readonly services = computed(() => clinicServices(this.rows(), this.order(), this.board()));
  readonly blocks = computed(() => {
    const svcs = this.services();
    const w = this.width();
    const spans = blockSpans(svcs.map(s => s.places.length), this.single(), w);
    return svcs.map((svc, i) => {
      const span = spans[i]?.span ?? 12;
      return { svc, span, row: spans[i]?.row ?? 0, cols: placeCols(svc.places.length, (w * span) / 12 - 20, this.compact() ? 140 : 170) };
    });
  });
  readonly rowsTpl = computed(() => {
    const b = this.blocks();
    const weights = blockRowWeights(b.map(x => x.svc.places.length), b);
    // A block row never shrinks below one room (title + a chip); a crowded card scrolls rather than cutting rooms.
    return (weights.length ? weights : [1]).map(n => `minmax(${weights.length > 1 ? 150 : 0}px, ${n}fr)`).join(' ');
  });

  /** placeId → fit (measured after render). Before a measure, everything shows (then fits within a frame). */
  private readonly fits = signal<Map<string, FitResult>>(new Map());
  fitOf(id: string, n: number): FitResult { return this.fits().get(id) ?? { level: 'full', shown: n }; }

  private canvas: CanvasRenderingContext2D | null = null;
  private raf = 0;

  constructor() {
    // Re-fit whenever the rows / layout change.
    effect(() => { this.blocks(); untracked(() => this.scheduleFit()); });
  }

  ngAfterViewInit(): void {
    const el = this.host.nativeElement;
    this.width.set(el.clientWidth || 1000);
    if (typeof ResizeObserver !== 'undefined') {
      this.zone.runOutsideAngular(() => {
        const ro = new ResizeObserver(() => {
          const w = el.clientWidth;
          if (w && w !== this.width()) this.zone.run(() => this.width.set(w));
          this.scheduleFit();
        });
        ro.observe(el);
        this.destroyRef.onDestroy(() => { ro.disconnect(); cancelAnimationFrame(this.raf); });
      });
    }
    this.scheduleFit();
  }

  private scheduleFit(): void {
    if (typeof requestAnimationFrame === 'undefined') return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.zone.run(() => this.fit()));
  }

  private textW(text: string, weight: number, size: number, family: string): number {
    if (!this.canvas) this.canvas = document.createElement('canvas').getContext('2d');
    const c = this.canvas;
    if (!c) return text.length * size * 0.6;
    c.font = `${weight} ${size}px ${family}`;
    return c.measureText(text).width;
  }

  /** Measure every room (its box never depends on its chips) and pick each room's level. */
  private fit(): void {
    const root = this.host.nativeElement;
    const family = getComputedStyle(root).fontFamily || 'sans-serif';
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const chipH = touch ? CHIP.hTouch : CHIP.h;
    const fs = this.compact() ? 11.5 : 12;
    const byId = new Map(this.services().flatMap(s => s.places).map(p => [p.id, p] as const));
    const next = new Map<string, FitResult>();
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('.cv-room'))) {
      const p = byId.get(el.dataset['place'] ?? '');
      if (!p) continue;
      const cs = getComputedStyle(el);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      // The title line WITHOUT a "+N" that may sit in it (the fit must not depend on its own result).
      const head = Math.max(20, el.querySelector<HTMLElement>('.cv-room__title')?.offsetHeight ?? 0, el.querySelector<HTMLElement>('.cv-st')?.offsetHeight ?? 0);
      const who = Array.from(el.querySelectorAll<HTMLElement>('.cv-room__who')).reduce((s, w) => s + w.offsetHeight + CHIP.lineGap, 0);
      const chip = (c: ClinicChip, name: boolean) => {
        let w = CHIP.pad * 2 + CHIP.border * 2 + this.textW(c.token, 700, fs, family);
        if (name) w += CHIP.gap + this.textW(c.name, 400, fs, family);
        if (c.wait) w += CHIP.gap + this.textW(c.wait, 400, fs - 1, family);
        return Math.ceil(w) + 1;
      };
      const moreW = (n: number) => Math.ceil(CHIP.pad * 2 + CHIP.border * 2 + this.textW(`+${n}${this.compact() ? '' : ' more'}`, 700, fs, family)) + 1;
      next.set(p.id, fitRoom({
        w: el.clientWidth - padX, h: el.clientHeight - padY, head, who: Math.max(0, who - CHIP.lineGap), gap: CHIP.lineGap, chipH,
        full: p.chips.map(c => chip(c, true)), dense: p.chips.map(c => chip(c, false)), moreW, keepWho: !!p.wait,
      }));
    }
    const cur = this.fits();
    const same = cur.size === next.size && [...next].every(([k, v]) => cur.get(k)?.level === v.level && cur.get(k)?.shown === v.shown);
    if (!same) this.fits.set(next);
    // The new fit renders on the next change detection; report once it is on screen.
    requestAnimationFrame(() => this.fitted.emit());
  }

  /** Where a row sits in this view: its chip, or — when its room overflowed — the room's "+N" (null = not here). */
  slotOf(rowId: string): { el: HTMLElement; overflow: boolean; dense: boolean } | null {
    const root = this.host.nativeElement;
    const chip = root.querySelector<HTMLElement>(`.cv-chip[data-row="${CSS.escape(rowId)}"]`);
    if (chip) return { el: chip, overflow: false, dense: !!chip.closest('.cv-room--dense') };
    const place = this.services().flatMap(s => s.places).find(p => p.chips.some(c => c.id === rowId));
    if (!place) return null;
    const room = root.querySelector<HTMLElement>(`.cv-room[data-place="${CSS.escape(place.id)}"]`);
    const more = room?.querySelector<HTMLElement>('.cv-more') ?? room;
    return more ? { el: more, overflow: true, dense: true } : null;
  }

  openChip(c: ClinicChip, ev: MouseEvent): void {
    const row = this.rows().find(r => r.id === c.id);
    if (!row) return;
    const btn = ev.currentTarget as HTMLElement;
    const ctx = this.context();
    const n = row.next;
    this.overlay.open(flowJourneyDetail(row, Date.now(), {
      showLabel: this.ringLabels(),
      action: n ? { label: n.label, aria: n.aria, run: () => ctx.act(row, n.id, btn) } : null,
    }), btn);
  }
}
