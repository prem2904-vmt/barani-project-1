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
    '/setup',
    '', // normalised "/"
  ]);

  private readonly url = signal(this.norm(this.router.url));

  /** True when the current route is a secondary (drill-down) page. */
  readonly showBack = computed(() => !this.roots.has(this.url()));

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
    if (typeof window !== 'undefined' && window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/');
    }
  }
}
