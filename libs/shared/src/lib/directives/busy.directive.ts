import {
  ComponentRef, DestroyRef, Directive, ElementRef, ViewContainerRef, booleanAttribute, effect, inject, input, untracked,
} from '@angular/core';
import { BusyComponent } from '../primitives/skeleton-kit.component.js';
import { createSpinDelay } from '../utils/busy.js';

/**
 * `[pfBusy]` — the ONE busy state for a button whose request is running
 * (docs/PF-PATTERN.md "Loading feedback").
 *
 *   <button class="pf-hb-btn pf-hb-btn--primary" [disabled]="saving()"
 *           [pfBusy]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
 *
 * - INSTANT: the same frame the flag turns on, the host gets aria-busy,
 *   `.pf-is-busy` (progress cursor, gently dimmed) and repeat presses are
 *   swallowed (capture phase, before the host's own (click)) — no double
 *   submits even where the button has no [disabled] binding.
 * - After {@link BUSY_SHOW_AFTER_MS} the kit's `<pf-busy>` dots are appended
 *   inside the button (never for a fast answer), held >= BUSY_MIN_SHOW_MS.
 * - Reduced motion: the dots are static (pf-busy handles it).
 *
 * It never writes `disabled` itself, so it never fights an existing
 * `[disabled]` binding: keep that binding where the button had one.
 */
@Directive({
  selector: '[pfBusy]',
  standalone: true,
  host: {
    '[attr.aria-busy]': 'busy() ? "true" : null',
    '[attr.aria-disabled]': 'busy() || inactive() ? "true" : null',
    '[class.pf-is-busy]': 'busy()',
    '[class.pf-is-busy--shown]': 'shown()',
  },
})
export class BusyDirective {
  readonly busy = input(false, { alias: 'pfBusy', transform: booleanAttribute });
  /** What a screen reader hears while the dots show. */
  readonly label = input('Working…', { alias: 'pfBusyLabel' });
  /** The button is otherwise inactive (e.g. a Save with nothing to save, owner 2026-11-19): aria-disabled stays "true"
   *  even when not busy. This directive owns the host's aria-disabled, so a screen passes it here, never as its own
   *  `[attr.aria-disabled]` binding (which this one would overwrite). */
  readonly inactive = input(false, { alias: 'pfBusyInactive', transform: booleanAttribute });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly vcr = inject(ViewContainerRef);
  private readonly machine = createSpinDelay();
  /** True while the moving dots are on screen (delayed + held). */
  readonly shown = this.machine.shown;
  private dots: ComponentRef<BusyComponent> | null = null;

  constructor() {
    effect(() => {
      const on = this.busy();
      untracked(() => this.machine.set(on));
    });
    effect(() => {
      const show = this.shown();
      untracked(() => (show ? this.mountDots() : this.unmountDots()));
    });
    const el = this.host.nativeElement;
    const swallow = (e: Event) => {
      if (!this.busy()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    el.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => {
      el.removeEventListener('click', swallow, true);
      this.machine.dispose();
      this.unmountDots();
    });
  }

  private mountDots(): void {
    if (this.dots) return;
    const ref = this.vcr.createComponent(BusyComponent);
    ref.setInput('label', this.label());
    const node = ref.location.nativeElement as HTMLElement;
    node.classList.add('pf-busy--inbtn');
    this.host.nativeElement.appendChild(node);
    ref.changeDetectorRef.detectChanges();
    this.dots = ref;
  }

  private unmountDots(): void {
    if (!this.dots) return;
    this.dots.destroy();
    this.dots = null;
  }
}
