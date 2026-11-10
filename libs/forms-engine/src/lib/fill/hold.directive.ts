import { DestroyRef, Directive, ElementRef, inject, input, output } from '@angular/core';

/** How far a finger may drift before a hold becomes a scroll (px). */
export const HOLD_SLOP_PX = 10;

/** A short buzz where the device supports it (legacy used Capacitor haptics on every hold). Silent everywhere else. */
export function buzz(ms = 12): void {
  try {
    (navigator as Navigator & { vibrate?: (p: number) => boolean }).vibrate?.(ms);
  } catch {
    /* no vibration on this device */
  }
}

/**
 * Press-and-hold (legacy resident-fe `step-footer.ts:41-184`, `tab-nav.ts:305-420`, `text-input.ts:585-628`):
 * after `holdDelay` ms of a still press the hold STARTS (`data-holding` on the host, a light buzz, and the
 * CSS custom property `--fe-hold-ms` for a fill animation); `holdMs` later it FIRES (`feHold`, a firmer
 * buzz). Releasing, moving more than 10px (a scroll) or leaving cancels. A fired hold swallows the click
 * that follows, so a tap and a hold never both happen. Pointer events only (one path for finger, pen and
 * mouse; no touch + mouse double-fire). Keyboard users keep the plain click; holds are a shortcut, never
 * the only way.
 */
@Directive({
  selector: '[feHold]',
  standalone: true,
  host: {
    '(pointerdown)': 'down($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'cancel()',
    '(pointercancel)': 'cancel()',
    '(pointerleave)': 'cancel()',
    '(contextmenu)': 'onContext($event)',
    '[style.--fe-hold-ms]': 'holdMs() + "ms"',
  },
})
export class HoldDirective {
  /** Still-press time before the hold starts (a tap is shorter than this). */
  readonly holdDelay = input(300);
  /** Fill time after the start before the hold fires (0 = fires as soon as it starts). */
  readonly holdMs = input(0);
  /** Letting go after the hold STARTED but before it fired is not a tap either (legacy PF logo: navbar.ts:546-582). */
  readonly holdCancelSwallowsTap = input(false);
  readonly feHold = output<void>();
  /** The hold started (for a hint); fires before feHold. */
  readonly holdStart = output<void>();

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private start: { x: number; y: number } | null = null;
  private delayTimer: ReturnType<typeof setTimeout> | null = null;
  private fireTimer: ReturnType<typeof setTimeout> | null = null;
  private swallowClick = false;

  constructor() {
    // capture phase: runs before the button's own (click) handler, so a fired hold can swallow the click
    const swallow = (e: Event) => this.onClick(e);
    this.el.nativeElement.addEventListener('click', swallow, true);
    inject(DestroyRef).onDestroy(() => {
      this.clear();
      this.el.nativeElement.removeEventListener('click', swallow, true);
    });
  }

  protected down(e: PointerEvent): void {
    if (e.button !== 0 || (this.el.nativeElement as HTMLButtonElement).disabled) return;
    this.clear();
    this.swallowClick = false;
    this.start = { x: e.clientX, y: e.clientY };
    this.delayTimer = setTimeout(() => this.begin(), this.holdDelay());
  }

  protected move(e: PointerEvent): void {
    if (!this.start) return;
    if (Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y) > HOLD_SLOP_PX) this.cancel();
  }

  /** Release / leave / cancel before it fired: nothing happens (the click, if any, is a normal tap). */
  cancel(): void {
    const started = this.el.nativeElement.hasAttribute('data-holding');
    this.start = null;
    this.clear();
    if (started && this.holdCancelSwallowsTap()) this.swallowClick = true;
  }

  protected onContext(e: Event): void {
    // a long press on touch opens the browser's menu; the hold owns the gesture
    if (this.start || this.swallowClick) e.preventDefault();
  }

  private onClick(e: Event): void {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private begin(): void {
    this.delayTimer = null;
    this.el.nativeElement.setAttribute('data-holding', '');
    buzz(8);
    this.holdStart.emit();
    if (this.holdMs() <= 0) return this.fire();
    this.fireTimer = setTimeout(() => this.fire(), this.holdMs());
  }

  private fire(): void {
    this.fireTimer = null;
    this.start = null;
    this.el.nativeElement.removeAttribute('data-holding');
    // the click that ends THIS press is swallowed however long the finger stays down after the hold fired
    // (legacy tab-nav holdTriggered); if no click comes (the finger left the button), the next press's
    // pointerdown clears it, so a later real tap is never lost
    this.swallowClick = true;
    buzz(24);
    this.feHold.emit();
  }

  private clear(): void {
    if (this.delayTimer) clearTimeout(this.delayTimer);
    if (this.fireTimer) clearTimeout(this.fireTimer);
    this.delayTimer = this.fireTimer = null;
    this.el.nativeElement.removeAttribute('data-holding');
  }
}
