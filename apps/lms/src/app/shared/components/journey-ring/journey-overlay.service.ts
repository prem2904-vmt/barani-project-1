import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, createComponent, inject } from '@angular/core';
import { JourneyOverlayComponent } from './journey-overlay.component';
import type { JourneyDetail } from './journey-detail';

/**
 * Opens the tap-to-expand journey view (one at a time) on <body>. `<pf-journey-ring [detail]>` calls it, so every
 * screen that draws a ring gets the view for free; a screen can also call `open` itself.
 */
@Injectable({ providedIn: 'root' })
export class JourneyOverlayService {
  private readonly app = inject(ApplicationRef);
  private readonly env = inject(EnvironmentInjector);
  private ref: ComponentRef<JourneyOverlayComponent> | null = null;

  get isOpen(): boolean { return !!this.ref; }

  open(detail: JourneyDetail, origin: HTMLElement | null): void {
    if (this.ref || typeof document === 'undefined') return;
    const ref = createComponent(JourneyOverlayComponent, { environmentInjector: this.env });
    ref.setInput('detail', detail);
    ref.setInput('origin', origin);
    ref.instance.closed.subscribe(() => this.dispose());
    this.app.attachView(ref.hostView);
    const host = ref.location.nativeElement as HTMLElement & { showPopover?: () => void };
    // The TOP LAYER (popover): above every z-index, and a fixed box no ancestor's transform / filter can re-anchor
    // (the dark theme gives <body> one, which left the bottom bar uncovered). Older engines: a child of <html>.
    if (typeof host.showPopover === 'function') {
      host.setAttribute('popover', 'manual');
      document.body.appendChild(host);
      host.showPopover();
    } else {
      document.documentElement.appendChild(host);
    }
    this.ref = ref;
    ref.changeDetectorRef.detectChanges();
  }

  /** Animated close (the ✕ path). */
  close(): void { this.ref?.instance.close(); }

  private dispose(): void {
    const ref = this.ref;
    if (!ref) return;
    this.ref = null;
    this.app.detachView(ref.hostView);
    ref.destroy();
  }
}
