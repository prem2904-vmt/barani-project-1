import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { RouteProgressService } from '../../../core/navigation/route-progress.service';

type BarState = 'idle' | 'loading' | 'done';

/**
 * `<pf-route-progress>` — the thin violet bar at the very top of the window
 * while a screen is on its way (lazy chunk, guards). Mounted ONCE in the
 * root component (app.ts); every navigation drives it through
 * {@link RouteProgressService} — nothing per screen.
 *
 * - Shows only after 150ms (an instant navigation shows nothing), then
 *   eases toward 90% while it waits and runs to 100% + fades on arrival.
 * - Reduced motion: no growth — a static full-width line that simply
 *   appears and disappears.
 * - Decorative for sighted users; AT gets one polite "Loading page" status.
 */
@Component({
  selector: 'pf-route-progress',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'pf-route-progress',
    '[attr.data-state]': 'state()',
    '[attr.data-active]': 'state() === "loading" ? "true" : null',
  },
  template: `
    <div class="pf-route-progress__bar" aria-hidden="true"></div>
    <span class="pf-route-progress__sr" role="status" aria-live="polite">{{ state() === 'loading' ? 'Loading page…' : '' }}</span>
  `,
  styles: [`
    :host {
      position: fixed; top: 0; left: 0; right: 0; height: 3px;
      z-index: 2147483100; pointer-events: none;
      /* Above the iOS notch / status bar on native. */
      top: env(safe-area-inset-top, 0px);
    }
    .pf-route-progress__bar {
      height: 100%; width: 0; opacity: 0;
      background: var(--color-primary, #7c3aed);
      box-shadow: 0 0 8px color-mix(in srgb, var(--color-primary, #7c3aed) 55%, transparent);
      border-radius: 0 2px 2px 0;
      transform-origin: left center;
    }
    :host([data-state='loading']) .pf-route-progress__bar {
      opacity: 1;
      animation: pf-rp-grow 8s cubic-bezier(0.08, 0.82, 0.17, 1) forwards;
    }
    :host([data-state='done']) .pf-route-progress__bar {
      width: 100%; opacity: 0;
      transition: width 200ms cubic-bezier(0.32, 0.72, 0, 1), opacity 260ms ease 120ms;
    }
    @keyframes pf-rp-grow { from { width: 8%; } 30% { width: 62%; } to { width: 90%; } }
    @media (prefers-reduced-motion: reduce) {
      :host([data-state='loading']) .pf-route-progress__bar { animation: none; width: 100%; opacity: 0.7; }
      :host([data-state='done']) .pf-route-progress__bar { transition: none; }
    }
    .pf-route-progress__sr {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
  `],
})
export class RouteProgressComponent {
  private readonly progress = inject(RouteProgressService);
  readonly state = signal<BarState>('idle');
  private doneTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const shown = this.progress.shown();
      untracked(() => {
        if (this.doneTimer !== null) { clearTimeout(this.doneTimer); this.doneTimer = null; }
        if (shown) { this.state.set('loading'); return; }
        if (this.state() !== 'loading') return;
        this.state.set('done');
        this.doneTimer = setTimeout(() => { this.doneTimer = null; this.state.set('idle'); }, 400);
      });
    });
    inject(DestroyRef).onDestroy(() => { if (this.doneTimer !== null) clearTimeout(this.doneTimer); });
  }
}
