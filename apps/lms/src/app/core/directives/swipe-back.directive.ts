import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { NavBackService } from '../services/nav-back.service';

/**
 * iOS / Android edge-swipe-to-go-back.
 *
 * A one-finger drag that *starts within EDGE px of the left screen edge* and
 * travels right far enough commits a navigation back; the host content follows
 * the finger live (translateX) so it feels like the native interactive swipe,
 * then either slides the rest of the way out (commit) or snaps back (cancel).
 *
 * Gated on {@link NavBackService.showBack} so it never fires on a primary root,
 * and it's inherently touch-only (no touch events → no-op on mouse desktops),
 * keeping the desktop/iPad experience untouched. All listeners run outside the
 * Angular zone; only the final navigate re-enters it.
 */
@Directive({ selector: '[pfSwipeBack]', standalone: true })
export class SwipeBackDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly nav = inject(NavBackService);

  private el!: HTMLElement;
  private startX = 0;
  private startY = 0;
  private dx = 0;
  private tracking = false;
  private decided = false; // committed to "this is a horizontal back-swipe"

  private readonly EDGE = 28; // px from the left edge the drag must start within
  private readonly THRESHOLD = 0.4; // fraction of viewport width to commit
  private readonly START_SLOP = 8; // px before we decide direction
  private readonly MAX_SLOPE = 0.8; // dy/dx above this = vertical scroll, bail

  ngOnInit(): void {
    this.el = this.host.nativeElement;
    this.zone.runOutsideAngular(() => {
      this.el.addEventListener('touchstart', this.onStart, { passive: true });
      this.el.addEventListener('touchmove', this.onMove, { passive: false });
      this.el.addEventListener('touchend', this.onEnd, { passive: true });
      this.el.addEventListener('touchcancel', this.onCancel, { passive: true });
    });
  }

  ngOnDestroy(): void {
    this.el.removeEventListener('touchstart', this.onStart);
    this.el.removeEventListener('touchmove', this.onMove);
    this.el.removeEventListener('touchend', this.onEnd);
    this.el.removeEventListener('touchcancel', this.onCancel);
  }

  private onStart = (e: TouchEvent): void => {
    if (e.touches.length !== 1 || !this.nav.showBack()) return;
    const t = e.touches[0];
    if (t.clientX > this.EDGE) return; // only the left-edge zone arms the gesture
    this.startX = t.clientX;
    this.startY = t.clientY;
    this.dx = 0;
    this.tracking = true;
    this.decided = false;
  };

  private onMove = (e: TouchEvent): void => {
    if (!this.tracking) return;
    const t = e.touches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;

    if (!this.decided) {
      if (Math.abs(dx) < this.START_SLOP && Math.abs(dy) < this.START_SLOP) return;
      // First decisive movement: if it's more vertical than horizontal, this is
      // a scroll — release the gesture and let the page scroll normally.
      if (Math.abs(dy) > Math.abs(dx) * this.MAX_SLOPE) {
        this.tracking = false;
        this.reset();
        return;
      }
      this.decided = true;
    }

    if (dx <= 0) {
      this.dx = 0;
      this.translate(0);
      return;
    }
    e.preventDefault(); // we own this gesture now → suppress horizontal scroll
    this.dx = dx;
    this.translate(dx);
  };

  private onEnd = (): void => {
    if (!this.tracking || !this.decided) {
      this.tracking = false;
      this.reset();
      return;
    }
    this.tracking = false;
    const w = window.innerWidth || 1;
    if (this.dx > w * this.THRESHOLD) {
      this.commit(w);
    } else {
      this.snapBack();
    }
  };

  private onCancel = (): void => {
    this.tracking = false;
    if (this.decided) this.snapBack();
    else this.reset();
  };

  private translate(dx: number): void {
    this.el.style.transition = 'none';
    this.el.style.transform = `translateX(${dx}px)`;
  }

  private commit(w: number): void {
    let fired = false;
    const finish = (): void => {
      if (fired) return;
      fired = true;
      this.el.removeEventListener('transitionend', finish);
      this.reset();
      this.zone.run(() => this.nav.back());
    };
    this.el.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
    this.el.style.transform = `translateX(${w}px)`;
    this.el.style.opacity = '0';
    this.el.addEventListener('transitionend', finish);
    setTimeout(finish, 240); // safety net if transitionend is dropped
  }

  private snapBack(): void {
    let done = false;
    const clear = (): void => {
      if (done) return;
      done = true;
      this.el.removeEventListener('transitionend', clear);
      this.reset();
    };
    this.el.style.transition = 'transform .2s ease-out';
    this.el.style.transform = 'translateX(0)';
    this.el.addEventListener('transitionend', clear);
    setTimeout(clear, 240);
  }

  private reset(): void {
    this.el.style.transition = '';
    this.el.style.transform = '';
    this.el.style.opacity = '';
  }
}
