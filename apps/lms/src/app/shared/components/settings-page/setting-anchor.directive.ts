import { DestroyRef, Directive, ElementRef, Injector, afterNextRender, inject, input, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

/** How long a deep-linked setting stays highlighted. */
export const SETTING_HIT_MS = 2800;

/**
 * Marks one setting row (or section) as a search deep-link target.
 *
 *   <div class="nd-set" pfSettingAnchor="scan-mode">…</div>
 *
 * Sets the host `id`. When the page is opened with a matching `#fragment`
 * (the Admin search links `/admin/lab-settings#scan-mode`), the row is
 * scrolled into view, focused for keyboard / screen-reader users and briefly
 * highlighted (`.nd-set--hit`; static under reduced motion). Works for rows
 * that render late (behind a loading `@if`) because the check runs when the
 * row itself is created.
 */
@Directive({
  selector: '[pfSettingAnchor]',
  standalone: true,
  host: { '[id]': 'pfSettingAnchor()' },
})
export class SettingAnchorDirective implements OnInit {
  readonly pfSettingAnchor = input.required<string>();
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    const check = (frag: string | null | undefined) => {
      const f = frag ?? (typeof location !== 'undefined' ? location.hash.replace(/^#/, '') : '');
      if (f && decodeURIComponent(f) === this.pfSettingAnchor()) {
        afterNextRender(() => this.reveal(), { injector: this.injector });
      }
    };
    if (this.route) {
      const sub = this.route.fragment.subscribe((f) => check(f));
      this.destroyRef.onDestroy(() => sub.unsubscribe());
    } else {
      check(null);
    }
    this.destroyRef.onDestroy(() => { if (this.timer) clearTimeout(this.timer); });
  }

  /** Scroll to, focus and highlight the row. */
  reveal(): void {
    const host = this.el.nativeElement;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '-1');
    host.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    host.focus?.({ preventScroll: true });
    host.classList.remove('nd-set--hit');
    // Restart the animation when the same row is hit twice in a row.
    void host.offsetWidth;
    host.classList.add('nd-set--hit');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => host.classList.remove('nd-set--hit'), SETTING_HIT_MS);
  }
}
