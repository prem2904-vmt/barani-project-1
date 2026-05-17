import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';

/**
 * Binds a MediaStream to a media element's `srcObject` property and kicks
 * playback. Required because Angular's template binding `[srcObject]="..."`
 * is property-binding-by-reflection — it works in Chrome but is unreliable
 * on Safari + iOS WebKit. A directive bound to the same selector applies
 * the value in the element's lifecycle (after it's in the DOM) and calls
 * .play() explicitly so autoplay policy is satisfied by the user gesture
 * that opened the call.
 *
 * Usage: `<audio [srcObject]="stream" autoplay playsinline></audio>`
 * The selector matches both `<audio>` and `<video>` elements that carry
 * a `srcObject` input.
 */
@Directive({
  selector: 'audio[srcObject], video[srcObject]',
  standalone: true
})
export class SrcObjectDirective implements OnChanges, OnDestroy {
  @Input() srcObject: MediaProvider | null = null;
  private readonly el = inject(ElementRef<HTMLMediaElement>).nativeElement;

  ngOnChanges(): void {
    if (this.el.srcObject !== this.srcObject) {
      this.el.srcObject = this.srcObject;
    }
    if (this.srcObject) {
      // .play() returns a Promise; autoplay-policy rejection lands in
      // .catch. The user-gesture that started the call usually covers it,
      // but Safari sometimes still rejects — swallow + log so the rest of
      // the call doesn't crash.
      const p = this.el.play();
      if (p && typeof (p as Promise<void>).catch === 'function') {
        (p as Promise<void>).catch(err => {
          // eslint-disable-next-line no-console
          console.warn('[srcObject] audio play() rejected:', err?.name ?? err);
        });
      }
    }
  }

  ngOnDestroy(): void {
    // Detach so the browser doesn't hold a reference to the stream after
    // the element leaves the DOM.
    try { this.el.srcObject = null; } catch { /* ignore */ }
  }
}
