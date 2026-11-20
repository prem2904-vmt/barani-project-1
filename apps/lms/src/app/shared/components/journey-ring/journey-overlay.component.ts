import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, input, output, signal, viewChild,
} from '@angular/core';
import { JourneyRingSvgComponent } from './journey-ring-svg.component';
import { JourneyDetail, detailLine, detailStepOf, detailTat, fmtMinutes } from './journey-detail';
import { RING_SERVICE_LABEL } from './journey-ring';

/** The FLIP length (owner: ~550 ms ease-out); reduced motion = a plain fade. */
export const JOURNEY_FLIP_MS = 550;

/**
 * Tap-to-expand journey view (owner-approved 2026-11-20), opened by `JourneyOverlayService` from a
 * `<pf-journey-ring [detail]>`. A blurred, theme-aware scrim over the screen; the SAME ring grows from the row into
 * a large ring on the left (FLIP: drawn in its final slot, the inverse transform from the row ring's rect animated
 * away; reversed on close), the patient above it, and a card on the right: "Journey · Step k of n", the row's own
 * next action, time in clinic (vs the usual time when known) and the step timeline. aria-modal dialog; ✕ / Esc /
 * backdrop close; focus moves in and returns to the ring. Phones stack (small ring on top, panel scrolls).
 */
@Component({
  selector: 'pf-journey-overlay',
  standalone: true,
  imports: [JourneyRingSvgComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-jov', '[class.pf-jov--on]': 'shown()', '[class.pf-jov--still]': 'still', '[class.pf-jov--stack]': 'stack()',
    '(keydown)': 'onKey($event)', '(window:resize)': 'onResize()',
  },
  template: `
    @let d = detail();
    @let st = stepOf();
    <div class="pf-jov__scrim" (click)="close()" data-testid="journey-scrim"></div>
    <div class="pf-jov__view pf-modal-centered" role="dialog" aria-modal="true" aria-labelledby="pf-jov-name" #dialog (click)="onViewClick($event)">
      <div class="pf-jov__left" data-close-zone>
        <div class="pf-jov__who">
          <h2 id="pf-jov-name" class="pf-jov__name">{{ d.name }}</h2>
          @if (d.meta) { <p class="pf-jov__meta">{{ d.meta }}</p> }
          <div class="pf-jov__chips">
            <span class="pf-jov__chip" [attr.data-svc]="d.service"><i aria-hidden="true"></i>{{ svcLabel() }}{{ d.token ? ' · ' + d.token : '' }}</span>
            @if (d.visit) { <span class="pf-jov__chip">{{ d.visit }}</span> }
            @if (d.lateMin) { <span class="pf-jov__chip pf-jov__chip--late">Late · {{ fmt(d.lateMin) }}</span> }
          </div>
        </div>
        <div class="pf-jov__slot" #slot>
          <div class="pf-jov__big" #big>
            <pf-journey-ring-svg [steps]="ringSteps()" [service]="d.service" [showLabel]="d.showLabel" [size]="ringSize()" />
          </div>
        </div>
      </div>
      <section class="pf-jov__panel" aria-label="Journey details">
        <div class="pf-jov__ph">
          <h3 class="pf-jov__pt">Journey · Step {{ st.k }} of {{ st.n }}</h3>
          @if (d.action; as a) {
            <button type="button" class="pf-btn pf-btn--primary pf-jov__act" [attr.aria-label]="a.aria || a.label" (click)="runAction()">{{ a.label }}</button>
          }
        </div>
        @if (d.inClinicMin != null) {
          <div class="pf-jov__tat">
            <div class="pf-jov__tat-l">
              <span>Time in clinic <strong>{{ fmt(d.inClinicMin) }}</strong></span>
              @if (d.usualMin) { <span>Usual for this visit {{ fmt(d.usualMin) }}</span> }
            </div>
            @if (tat(); as t) {
              <div class="pf-jov__bar"><b [style.width.%]="t.pct" [class.pf-jov__bar--over]="t.over"></b></div>
            }
          </div>
        }
        <ol class="pf-jov__steps">
          @for (s of d.steps; track $index) {
            @let l = line(s);
            <li class="pf-jov__step" [attr.data-state]="s.state" [style.--i]="$index">
              <span class="pf-jov__dot" aria-hidden="true">
                @if (s.state === 'done') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                } @else if (s.state === 'late') {
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01" /></svg>
                }
              </span>
              <span class="pf-jov__t">{{ s.label }}<span class="pf-jov__sr">, {{ stateWord(s.state) }}</span></span>
              @if (l.time) { <span class="pf-jov__d">{{ l.time }}</span> }
              @if (l.sub) { <span class="pf-jov__m">{{ l.sub }}</span> }
              @if (s.note && (s.state === 'now' || s.state === 'late')) {
                <span class="pf-jov__note" [class.pf-jov__note--late]="s.state === 'late'">{{ s.note }}</span>
              }
            </li>
          }
        </ol>
      </section>
    </div>
    <button type="button" class="pf-jov__close" aria-label="Close journey" (click)="close()" #closeBtn>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  `,
  styleUrl: './journey-overlay.component.scss',
})
export class JourneyOverlayComponent implements AfterViewInit, OnDestroy {
  readonly detail = input.required<JourneyDetail>();
  /** The row's ring (the FLIP origin and where focus returns). */
  readonly origin = input<HTMLElement | null>(null);
  readonly closed = output<void>();

  private readonly slot = viewChild.required<ElementRef<HTMLElement>>('slot');
  private readonly big = viewChild.required<ElementRef<HTMLElement>>('big');
  private readonly dialog = viewChild.required<ElementRef<HTMLElement>>('dialog');
  private readonly closeBtn = viewChild.required<ElementRef<HTMLButtonElement>>('closeBtn');

  readonly shown = signal(false);
  private closing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Reduced motion: no flight, a fade only. */
  readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Phone width: stacked (small ring on top, panel below, the view scrolls). */
  readonly stack = signal(typeof window !== 'undefined' && window.innerWidth <= 820);
  onResize(): void { this.stack.set(window.innerWidth <= 820); }

  readonly ringSize = computed(() => (this.stack() ? 180 : 300));
  readonly ringSteps = computed(() => this.detail().steps.map(s => ({ label: s.label, state: s.state })));
  readonly stepOf = computed(() => detailStepOf(this.detail().steps));
  readonly tat = computed(() => detailTat(this.detail().inClinicMin, this.detail().usualMin));
  readonly svcLabel = computed(() => RING_SERVICE_LABEL[this.detail().service]);
  readonly line = detailLine;
  readonly fmt = fmtMinutes;
  stateWord(s: string): string { return s === 'done' ? 'done' : s === 'now' ? 'in progress' : s === 'late' ? 'late' : 'not started'; }

  ngAfterViewInit(): void {
    const from = this.origin()?.getBoundingClientRect();
    const big = this.big().nativeElement;
    if (from && !this.still) big.style.transform = this.inverse(from);
    big.getBoundingClientRect();                   // commit the start
    requestAnimationFrame(() => {
      this.shown.set(true);
      if (!this.still) { big.classList.add('pf-jov__big--go'); big.style.transform = 'none'; }
      this.closeBtn().nativeElement.focus();
    });
  }

  /** Close: fly back into the row (or fade), then hand focus back to the ring. */
  close(): void {
    if (this.closing) return;
    this.closing = true;
    const o = this.origin();
    const big = this.big().nativeElement;
    if (o && !this.still && o.isConnected) big.style.transform = this.inverse(o.getBoundingClientRect());
    this.shown.set(false);
    this.timer = setTimeout(() => this.finish(), this.still ? 160 : JOURNEY_FLIP_MS);
  }

  /** The row's own action: close first (its drawer / page must not sit under the scrim), then run it. */
  runAction(): void {
    const a = this.detail().action;
    this.finish();
    a?.run();
  }

  private finish(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const o = this.origin();
    this.closed.emit();
    o?.focus?.();
  }

  onViewClick(e: MouseEvent): void {
    const t = e.target as HTMLElement;
    if (t === e.currentTarget || t.hasAttribute('data-close-zone')) this.close();
  }

  onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    // Focus stays inside the dialog (its controls + ✕).
    const host = this.dialog().nativeElement.parentElement as HTMLElement;
    const f = [...host.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])')].filter(x => !x.hasAttribute('disabled'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  ngOnDestroy(): void { if (this.timer) clearTimeout(this.timer); }

  private inverse(r: DOMRect): string {
    const t = this.slot().nativeElement.getBoundingClientRect();
    if (!t.width) return 'none';
    return `translate(${r.left - t.left}px, ${r.top - t.top}px) scale(${r.width / t.width})`;
  }
}
