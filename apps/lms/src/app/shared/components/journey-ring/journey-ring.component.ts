import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, inject, input } from '@angular/core';
import { RING_SERVICE_NAME, RingService, RingStep, ringAria, ringTipLines } from './journey-ring';
import { JourneyRingSvgComponent } from './journey-ring-svg.component';
import { JourneyOverlayService } from './journey-overlay.service';
import type { JourneyDetail } from './journey-detail';

/**
 * `<pf-journey-ring>` — a row's journey as a ~44px ring (owner-approved 2026-11-20). Shared: no screen imports, so
 * the Frontdesk flow grid, the Lab and Pathologist grids all draw the SAME ring.
 *
 *   <pf-journey-ring [steps]="row.ring" service="lab" [showLabel]="true" />
 *
 * Inputs:
 *  - `steps: RingStep[]`  — the row's OWN steps (journey-ring.ts builders), one outer segment each, small gaps;
 *  - `service: RingService` — 'lab' | 'opd' | 'ipd' | 'scan' | 'er' → the inner disc + done-segment colour;
 *  - `showLabel = true`   — the inner disc's "LAB"/"OPD"; pass false when it adds nothing (a single-service tenant,
 *                           or the screen is already filtered to one service) → a blank neutral disc;
 *  - `name?: string`      — the spoken service name (default Lab / OPD …);
 *  - `size = 44`          — px;
 *  - `detail?: JourneyDetail | () => JourneyDetail` — set it and the ring becomes a ≥44px button ("… Open journey")
 *                           that opens the tap-to-expand journey view (JourneyOverlayService) — free for every screen.
 * Colours: done = the service colour, the current step = the strongest neutral (in progress) or soft rose (late /
 * blocked), later steps = the dim track. role="img" + aria-label ("Lab · step 3 of 5 · Dispatch · in progress").
 * Pointer hover (never touch) shows the step names (done / now / next). No motion.
 */
@Component({
  selector: 'pf-journey-ring',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [JourneyRingSvgComponent],
  host: {
    class: 'pf-jring', '[attr.role]': 'detail() ? null : "img"', '[attr.aria-label]': 'detail() ? null : aria()',
    '[attr.data-svc]': 'service()',
    '(pointerenter)': 'tipOn($event)', '(pointerleave)': 'tipOff()',
  },
  template: `
    @if (detail()) {
      <button type="button" class="pf-jring__btn" [attr.aria-label]="aria() + '. Open journey'" (click)="openDetail($event)">
        <pf-journey-ring-svg [steps]="steps()" [service]="service()" [showLabel]="showLabel()" [size]="size()" />
      </button>
    } @else {
      <pf-journey-ring-svg [steps]="steps()" [service]="service()" [showLabel]="showLabel()" [size]="size()" />
    }
  `,
  styles: [`
    :host { display: inline-flex; flex: none; vertical-align: middle; }
    .pf-jring__btn {
      display: inline-grid; place-items: center; min-width: 44px; min-height: 44px; padding: 0; margin: 0;
      border: 0; border-radius: 50%; background: transparent; cursor: zoom-in;
    }
    .pf-jring__btn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-jring__btn pf-journey-ring-svg { transition: transform 0.2s ease; }
    .pf-jring__btn:hover pf-journey-ring-svg { transform: scale(1.08); }
    :host(.pf-jring--away) pf-journey-ring-svg { opacity: 0; }
    @media (prefers-reduced-motion: reduce) { .pf-jring__btn pf-journey-ring-svg { transition: none; } .pf-jring__btn:hover pf-journey-ring-svg { transform: none; } }
  `],
})
export class JourneyRingComponent implements OnDestroy {
  readonly steps = input<readonly RingStep[]>([]);
  readonly service = input<RingService>('lab');
  readonly showLabel = input(true);
  readonly name = input<string | null>(null);
  readonly size = input(44);

  /** Tap-to-expand: what the journey view shows (a value, or a function read at tap time). Null = a plain ring. */
  readonly detail = input<JourneyDetail | (() => JourneyDetail) | null>(null);
  private readonly overlay = inject(JourneyOverlayService);
  readonly aria = computed(() => ringAria(this.service(), this.steps(), this.name() ?? RING_SERVICE_NAME[this.service()]));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private tip: HTMLElement | null = null;

  /** The hover card lives on <body> (a grid row clips and transforms its cells). Built with textContent only. */
  tipOn(e: PointerEvent): void {
    if (e.pointerType === 'touch' || typeof document === 'undefined' || !this.steps().length) return;
    this.tipOff();
    const tip = document.createElement('div');
    tip.className = 'pf-jring-tip';
    tip.setAttribute('role', 'tooltip');
    const h = document.createElement('p');
    h.className = 'pf-jring-tip__h';
    h.textContent = this.name() ?? RING_SERVICE_NAME[this.service()];
    tip.appendChild(h);
    for (const l of ringTipLines(this.steps())) {
      const row = document.createElement('p');
      row.className = 'pf-jring-tip__row';
      row.dataset['state'] = l.state;
      const mark = document.createElement('span');
      mark.className = 'pf-jring-tip__mark';
      mark.setAttribute('aria-hidden', 'true');
      const t = document.createElement('span');
      t.textContent = l.label;
      const w = document.createElement('span');
      w.className = 'pf-jring-tip__w';
      w.textContent = l.word;
      row.append(mark, t, w);
      tip.appendChild(row);
    }
    document.body.appendChild(tip);
    const r = this.host.nativeElement.getBoundingClientRect();
    const W = tip.offsetWidth || 180, H = tip.offsetHeight || 120;
    let x = r.right + 8, y = r.top + r.height / 2 - H / 2;
    if (x + W > window.innerWidth - 8) x = r.left - W - 8;
    y = Math.max(8, Math.min(y, window.innerHeight - H - 8));
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${y}px`;
    this.tip = tip;
  }
  tipOff(): void { this.tip?.remove(); this.tip = null; }

  /** Open the journey view from this ring (the row's own tap stays the row's). */
  openDetail(e: Event): void {
    e.stopPropagation();
    const d = this.detail();
    if (!d) return;
    this.tipOff();
    const btn = this.host.nativeElement.querySelector<HTMLElement>('.pf-jring__btn');
    this.overlay.open(typeof d === 'function' ? d() : d, btn);
  }
  ngOnDestroy(): void { this.tipOff(); }
}
