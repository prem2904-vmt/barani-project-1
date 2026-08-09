import { Injectable, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { PRIMARY_NAV } from '../../layout/nav-items';

/**
 * Single source of truth for the mobile "back" affordance.
 *
 * Primary screens — the ones reached from the bottom nav / launcher — are app
 * roots and show NO back button. Everything deeper is a "secondary" screen and
 * gets a back chevron (rendered by pf-screen-header) plus the edge-swipe-back
 * gesture (SwipeBackDirective). Both consumers read {@link showBack}; both call
 * {@link back}. The root set is derived from the live PRIMARY_NAV config so it
 * stays in sync with the actual navigation rather than a hand-kept list.
 *
 * Desktop/iPad are unaffected: pf-screen-header hides the button at md+ via CSS,
 * and the swipe directive only ever sees touch events.
 */
@Injectable({ providedIn: 'root' })
export class NavBackService {
  private readonly router = inject(Router);
  private readonly location = inject(Location);

  /** Exact routes that are app roots — never show a back affordance. */
  private readonly roots = new Set<string>([
    ...PRIMARY_NAV.map((n) => this.norm(n.href)),
    '/admin',
    '/dashboard',
    '/login',
    '/track',
    '/set-password',
    '', // normalised "/"
  ]);

  private readonly url = signal(this.norm(this.router.url));

  /** An optional in-page back handler. A screen whose "back" is NOT a route
   *  change (e.g. the chat thread, which closes a conversation via a signal on
   *  the /messages root) registers one so the shared chevron, the edge-swipe
   *  gesture, and Android hardware-back all route through it instead of popping
   *  history. Returns true if it handled the back. */
  private interceptor: (() => boolean) | null = null;
  private readonly hasInterceptor = signal(false);

  /** True when a back affordance should be shown: an in-page handler is active,
   *  OR the current route is a secondary (drill-down) page. */
  readonly showBack = computed(() => this.hasInterceptor() || !this.roots.has(this.url()));

  /** Register an in-page back handler (call from a screen's effect/ngOnInit). */
  registerBackInterceptor(fn: () => boolean): void {
    this.interceptor = fn;
    this.hasInterceptor.set(true);
  }

  /** Clear the handler (pass the same fn to avoid clobbering a newer one). */
  clearBackInterceptor(fn?: () => boolean): void {
    if (!fn || this.interceptor === fn) {
      this.interceptor = null;
      this.hasInterceptor.set(false);
    }
  }

  constructor() {
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.url.set(this.norm(e.urlAfterRedirects));
    });
  }

  /** Strip query/hash + trailing slashes so "/lab/my-work/" === "/lab/my-work". */
  private norm(u: string): string {
    return u.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }

  /**
   * Go back through history. On a cold deep-link (no in-app history — e.g. the
   * app was launched straight onto a secondary route) fall back to the app root
   * so the user is never stranded on a page they can't leave.
   */
  back(): void {
    // An in-page handler (e.g. close the open chat thread) takes precedence.
    if (this.interceptor && this.interceptor()) return;
    if (typeof window !== 'undefined' && window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/');
    }
  }
}
