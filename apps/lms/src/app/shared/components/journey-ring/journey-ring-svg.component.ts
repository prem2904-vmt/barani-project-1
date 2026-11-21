import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RING, RING_SERVICE_LABEL, RingService, RingStep, ringSegments } from './journey-ring';

/** The ring's drawing only (shared by `<pf-journey-ring>` in a row and the big ring of the journey view). */
@Component({
  selector: 'pf-journey-ring-svg',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-svc]': 'service()' },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" [attr.viewBox]="'0 0 ' + box + ' ' + box" aria-hidden="true" focusable="false">
      <circle class="pf-jring__disc" [class.pf-jring__disc--blank]="!showLabel()" [attr.cx]="c" [attr.cy]="c" [attr.r]="disc" />
      @if (showLabel()) {
        <text class="pf-jring__lbl" [class.pf-jring__lbl--long]="label().length > 3" [attr.x]="c" [attr.y]="c">{{ label() }}</text>
      }
      @for (s of segs(); track $index) {
        <path class="pf-jring__seg" [attr.d]="s.d" [attr.data-state]="s.state" />
      }
    </svg>
  `,
  styles: [`
    :host {
      display: inline-flex; flex: none;
      --jr-lab: var(--pf-svc-lab, var(--sky-text, #0284c7)); --jr-opd: var(--pf-svc-opd, var(--violet-text, #6d28d9)); --jr-ipd: var(--blue-text, #2563eb);
      --jr-scan: var(--teal-text, #0d9488); --jr-er: var(--pink-text, #db2777);
      --jr-svc: var(--jr-lab);
    }
    :host([data-svc='opd']) { --jr-svc: var(--jr-opd); }
    :host([data-svc='ipd']) { --jr-svc: var(--jr-ipd); }
    :host([data-svc='scan']) { --jr-svc: var(--jr-scan); }
    :host([data-svc='er']) { --jr-svc: var(--jr-er); }
    svg { display: block; overflow: visible; }
    .pf-jring__disc { fill: var(--jr-svc); }
    .pf-jring__disc--blank { fill: var(--pf-chip-bg, #f3f4f6); }
    .pf-jring__lbl {
      fill: var(--pf-on-soft, var(--pf-card-bg, #fff)); font-size: 8.5px; font-weight: 800; letter-spacing: 0.02em;
      text-anchor: middle; dominant-baseline: central; pointer-events: none;
    }
    .pf-jring__lbl--long { font-size: 7px; }
    .pf-jring__seg { fill: none; stroke-width: 5; stroke-linecap: butt; stroke: var(--pf-ring-todo, var(--pf-line, #e5e7eb)); }
    .pf-jring__seg[data-state='done'] { stroke: var(--jr-svc); }
    .pf-jring__seg[data-state='now'] { stroke: var(--pf-ring-now, var(--text-primary, #111928)); }
    .pf-jring__seg[data-state='late'] { stroke: var(--pf-late-fill, var(--rose-text, #e11d48)); }
  `],
})
export class JourneyRingSvgComponent {
  readonly steps = input<readonly RingStep[]>([]);
  readonly service = input<RingService>('lab');
  readonly showLabel = input(true);
  readonly size = input(44);
  readonly box = RING.size;
  readonly c = RING.c;
  readonly disc = RING.disc;
  readonly label = computed(() => RING_SERVICE_LABEL[this.service()] ?? '');
  readonly segs = computed(() => {
    const st = this.steps();
    return ringSegments(st.length).map((g, i) => ({ d: g.d, state: st[i].state }));
  });
}
