import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import type { ServiceDef, ServiceFilter, ServiceId } from '../../../../core/services/service-shelf';
import {
  SUN, ServiceNode, Slice, SliceCard, WhoItem, buildWhoTree, centreOf, describeSlice, layoutSunburst, sliceOn,
} from './who-is-where';

/** What a slice / chip / the centre asks for: a service (+ step), or 'all' to clear. */
export interface WhoPick { service: ServiceFilter; step: string | null }

/**
 * "Who is where" (Frontdesk side card, owner-approved 2026-11-20): an SVG sunburst — inner ring = service, outer
 * ring = step — over the work card's active rows, the service chips under it, and a small description card on
 * hover (pointer only) or keyboard focus. Clicking a slice / chip emits a pick; the landing hands it to the ONE
 * service filter (ServiceShelfService), so the chart, the chips, the bottom-bar Services shelf and the side card
 * lists always agree. Colours are theme tokens (light + dark); motion is off under reduced motion.
 */
@Component({
  selector: 'pf-fd-who-is-where',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = centre();
    <div class="wiw" [class.wiw--filtered]="service() !== 'all'" [class.wiw--hovering]="!!hov()" data-testid="who-is-where">
      <div class="wiw__sun">
        <svg [attr.viewBox]="'0 0 ' + size + ' ' + size" role="group" aria-label="Who is where: services and steps">
          @if (!slices().length) {
            <circle class="wiw__empty" [attr.cx]="size / 2" [attr.cy]="size / 2" r="83" />
          }
          @for (s of slices(); track s.key) {
            <path class="wiw__slice" [attr.d]="s.d" [attr.data-svc]="s.service" [attr.data-step]="s.step"
              [class.wiw__slice--step]="s.ring === 'step'" [class.wiw__slice--late]="s.ring === 'step' && s.late > 0"
              [class.is-on]="isOn(s)" [class.is-hov]="isLit(s)"
              tabindex="0" role="button" [attr.aria-label]="sliceAria(s)" [attr.aria-pressed]="isPicked(s)"
              (click)="choose(s.service, s.step)"
              (keydown.enter)="$event.preventDefault(); choose(s.service, s.step)"
              (keydown.space)="$event.preventDefault(); choose(s.service, s.step)"
              (pointermove)="pointerOver($event, s.service, s.step)" (pointerleave)="unhover()"
              (focus)="focusOn(s, $event)" (blur)="unhover()" />
          }
          @for (s of slices(); track s.key) {
            @if (s.label) {
              <text class="wiw__n" [class.wiw__n--step]="s.ring === 'step'" [attr.x]="s.label.x" [attr.y]="s.label.y"
                [class.is-on]="isOn(s)" [class.is-hov]="isLit(s)" aria-hidden="true">{{ s.n }}</text>
            }
          }
        </svg>
        <button type="button" class="wiw__ctr" (click)="pick.emit({ service: 'all', step: null })"
          [attr.aria-label]="c.filtered ? 'Showing ' + c.label + ', ' + c.n + '. Show everyone' : c.n + ' in the clinic'">
          @if (hovCentre(); as hc) {
            <b class="pf-num">{{ hc.n }}</b><span>{{ hc.label }}</span>
          } @else {
            <b class="pf-num">{{ c.n }}</b><span>{{ c.label }}</span>
            @if (c.filtered) { <small>tap for all</small> }
          }
        </button>
      </div>
      <div class="wiw__chips" role="group" aria-label="Services">
        @for (s of tree(); track s.id) {
          <button type="button" class="wiw__chip" [attr.data-svc]="s.id" [attr.data-service]="s.id"
            [class.is-on]="service() === 'all' || service() === s.id" [class.is-hov]="hov()?.service === s.id"
            [attr.aria-pressed]="service() === s.id" [attr.aria-label]="chipAria(s)"
            (click)="choose(s.id, null)" (pointerenter)="pointerOver($event, s.id, null)" (pointerleave)="unhover()">
            <i class="wiw__dot" aria-hidden="true"></i>
            <span class="wiw__chip-l">{{ s.label }}</span>
            <span class="wiw__chip-n pf-num">{{ s.n }}</span>
            @if (s.late) { <span class="wiw__chip-late">{{ s.late }} late</span> }
          </button>
        }
      </div>
      <p class="wiw__hint">{{ slices().length ? 'Tap a slice to filter the list' : 'Nobody in the clinic right now' }}</p>
      @if (card(); as k) {
        <div class="wiw__tip" role="status" aria-live="polite" [style.left.px]="tipAt().x" [style.top.px]="tipAt().y">
          <p class="wiw__tip-h"><i class="wiw__dot" [attr.data-svc]="hov()!.service" aria-hidden="true"></i>{{ k.title }}<b class="pf-num">{{ k.n }}</b></p>
          @for (l of k.lines; track $index) {
            <p class="wiw__tip-l" [class.wiw__tip-l--late]="$index === 0 && k.late > 0">{{ l }}</p>
          }
          <p class="wiw__tip-go">{{ k.action }}</p>
        </div>
      }
    </div>
  `,
  styleUrl: './who-is-where.component.scss',
})
export class WhoIsWhereComponent {
  /** The active work rows (every service, before the service filter). */
  readonly items = input<readonly WhoItem[]>([]);
  /** The services the user has (shelf order). */
  readonly services = input<readonly ServiceDef[]>([]);
  /** The ONE filter in force. */
  readonly service = input<ServiceFilter>('all');
  readonly step = input<string | null>(null);
  readonly pick = output<WhoPick>();

  readonly size = SUN.size;
  readonly tree = computed<ServiceNode[]>(() => buildWhoTree(this.items(), this.services()));
  readonly slices = computed<Slice[]>(() => layoutSunburst(this.tree()));
  readonly centre = computed(() => centreOf(this.tree(), this.service(), this.step()));

  /** Hovered / focused slice or chip. */
  readonly hov = signal<{ service: ServiceId; step: string | null } | null>(null);
  readonly tipAt = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  /** The description card shows only for a pointer hover or a keyboard focus (never a touch). */
  private readonly tipOn = signal(false);
  readonly card = computed<SliceCard | null>(() => {
    const h = this.hov();
    if (!h || !this.tipOn()) return null;
    return describeSlice(this.tree(), h.service, h.step, { service: this.service(), step: this.step() });
  });
  readonly hovCentre = computed(() => {
    const h = this.hov();
    if (!h) return null;
    const s = this.tree().find(x => x.id === h.service);
    const n = h.step === null ? s?.n : s?.steps.find(x => x.step === h.step)?.n;
    return { n: n ?? 0, label: h.step ?? s?.label ?? '' };
  });

  isOn(s: Slice): boolean { return sliceOn(s, this.service(), this.step()); }
  isLit(s: Slice): boolean {
    const h = this.hov();
    return !!h && s.service === h.service && (h.step === null || s.step === null || s.step === h.step);
  }
  isPicked(s: Slice): boolean { return this.service() === s.service && (this.step() ?? null) === s.step; }

  sliceAria(s: Slice): string {
    if (s.step === null) return `${s.serviceLabel}, ${s.n}${s.late ? `, ${s.late} late` : ''}`;
    return s.ring === 'step' && s.late ? `${s.serviceLabel} › ${s.step}, ${s.n} late` : `${s.serviceLabel} › ${s.step}, ${s.n}`;
  }
  chipAria(s: ServiceNode): string { return `${s.label}, ${s.n}${s.late ? `, ${s.late} late` : ''}`; }

  choose(service: ServiceId, step: string | null): void { this.pick.emit({ service, step }); }

  pointerOver(e: PointerEvent, service: ServiceId, step: string | null): void {
    if (e.pointerType === 'touch') return;
    this.hov.set({ service, step });
    this.tipOn.set(true);
    this.place(e.clientX, e.clientY);
  }
  focusOn(s: Slice, e?: Event): void {
    this.hov.set({ service: s.service, step: s.step });
    this.tipOn.set(true);
    const r = (e?.target as Element | null)?.getBoundingClientRect?.();
    if (r) this.place(r.left + r.width / 2, r.top + r.height / 2);
  }
  unhover(): void { this.hov.set(null); this.tipOn.set(false); }

  /** The card follows the pointer and flips to stay on screen. */
  private place(x: number, y: number): void {
    const W = 228, H = 140;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    let nx = x + 16, ny = y + 18;
    if (nx + W > vw - 8) nx = x - W - 16;
    if (ny + H > vh - 8) ny = y - H - 18;
    this.tipAt.set({ x: Math.max(8, nx), y: Math.max(8, ny) });
  }
}
