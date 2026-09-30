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
  /** The URL we navigated here FROM — lets back() POP history when the
   *  previous entry already is the parent (no history growth), instead of
   *  pushing a duplicate parent entry that browser-back would bounce off. */
  private previousUrl: string | null = null;

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
      if (e instanceof NavigationEnd) {
        this.previousUrl = this.url();
        this.url.set(this.norm(e.urlAfterRedirects));
      }
    });
  }

  /** Strip query/hash + trailing slashes so "/lab/my-work/" === "/lab/my-work". */
  private norm(u: string): string {
    return u.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }

  /** Compute the main parent route for the current URL instead of raw history pop. */
  getParentRoute(currentUrl: string): string {
    const rawUrl = currentUrl || this.router.url;
    const normUrl = this.norm(rawUrl);

    // People & Access (cat=people)
    if (normUrl === '/admin/users/invite' || (normUrl.startsWith('/admin/users/') && normUrl !== '/admin/users')) {
      return '/admin/users?tab=users';
    }
    if (normUrl === '/admin/roles/new' || (normUrl.startsWith('/admin/roles/') && normUrl !== '/admin/roles')) {
      return '/admin/users?tab=roles';
    }
    if (normUrl === '/admin/users' || normUrl === '/admin/roles' || normUrl === '/admin/audit') {
      return '/admin/manage?cat=people';
    }

    // Branches & Organization (cat=org)
    if (normUrl === '/admin/vendors' || normUrl === '/admin/referral-labs' || normUrl === '/admin/referring-network') {
      return '/admin/partners';
    }
    if (
      normUrl === '/admin/branches' ||
      normUrl === '/admin/organization' ||
      normUrl === '/admin/appointments' ||
      normUrl === '/admin/partners' ||
      normUrl === '/setup'
    ) {
      return '/admin/manage?cat=org';
    }

    // Finance (cat=finance)
    if (normUrl === '/admin/billing' || normUrl === '/finance' || normUrl === '/finance/daily' || normUrl === '/finance/expenses') {
      return '/admin/manage?cat=finance';
    }

    // Platform & Automation (cat=automation)
    if (normUrl.startsWith('/admin/workflows/')) {
      const seg = normUrl.split('/').filter(Boolean);
      return seg.length > 3 ? `/admin/workflows/${seg[2]}` : '/admin/workflows';
    }
    if (normUrl === '/admin/process' || normUrl === '/admin/workflows') {
      return '/admin/manage?cat=automation';
    }

    // Settings hub landing
    if (normUrl === '/admin/manage') {
      return '/admin';
    }

    // Tests & Lab settings hub (/lab/settings)
    if (normUrl.startsWith('/admin/tests/')) {
      const match = rawUrl.match(/[?&]type=([^&]+)/);
      if (match) {
        return `/admin/tests?type=${match[1]}`;
      }
      return '/admin/tests';
    }
    if (
      normUrl === '/admin/tests' ||
      normUrl === '/admin/lab-settings' ||
      normUrl.startsWith('/admin/lab-settings/') ||
      normUrl === '/admin/reports' ||
      normUrl === '/admin/notifications' ||
      normUrl === '/admin/microbiology' ||
      normUrl === '/admin/kpis'
    ) {
      return '/lab/settings';
    }

    // Frontdesk subroutes
    if (normUrl.startsWith('/frontdesk/appointments/')) {
      const match = rawUrl.match(/[?&]patientId=([^&]+)/);
      if (match && match[1]) {
        return `/frontdesk/patients/${match[1]}`;
      }
      return '/frontdesk/appointments';
    }
    if (normUrl === '/frontdesk/patients/new' || normUrl === '/reception/patients/new') {
      const match = rawUrl.match(/[?&]patientId=([^&]+)/);
      if (match && match[1]) {
        return `/frontdesk/patients/${match[1]}`;
      }
      return '/frontdesk';
    }
    if (normUrl.startsWith('/frontdesk/')) {
      const match = rawUrl.match(/[?&]patientId=([^&]+)/);
      if (match && match[1] && normUrl !== '/frontdesk') {
        return `/frontdesk/patients/${match[1]}`;
      }
      return '/frontdesk';
    }
    // Shortlink screens (/o/:id order, /p/:id patient) live under the desk.
    if (normUrl.startsWith('/o/') || normUrl.startsWith('/p/')) {
      return '/frontdesk';
    }

    // Lab settings hub is an ADMIN surface reached from /admin, but its own
    // children (culture settings…) parent back to the hub.
    if (normUrl === '/lab/settings') {
      return '/admin';
    }
    if (normUrl.startsWith('/lab/settings/')) {
      return '/lab/settings';
    }
    if (normUrl.startsWith('/lab/')) {
      return '/lab/my-work';
    }
    if (normUrl.startsWith('/pathologist/')) {
      return '/pathologist/pending-validation';
    }
    if (normUrl.startsWith('/reports/')) {
      return '/reports';
    }
    if (normUrl.startsWith('/admin/opd/')) {
      return '/admin/opd';
    }
    if (normUrl.startsWith('/admin/')) {
      return '/admin/manage';
    }

    // Generic: the LONGEST strict prefix that is a primary root — so
    // /reports/view/abc lands on /reports, /stores/receive on /stores —
    // falling back to a single-segment trim for depths the root set
    // doesn't know.
    const segments = normUrl.split('/').filter(Boolean);
    for (let n = segments.length - 1; n >= 1; n--) {
      const prefix = '/' + segments.slice(0, n).join('/');
      if (this.roots.has(prefix)) return prefix;
    }
    if (segments.length > 1) {
      return '/' + segments.slice(0, -1).join('/');
    }

    return '/admin';
  }

  /** Navigate UP to a known parent with correct history semantics: POP when
   *  we came here from that parent (no history growth — browser-back from the
   *  parent must not bounce back down), otherwise REPLACE this entry so the
   *  child doesn't linger behind the parent. Screens with explicit parents
   *  (test editor → Test Master, viewer → /reports…) call this instead of
   *  router.navigate. */
  backTo(target: string): void {
    const current = this.norm(this.router.url);
    if (this.norm(target) === current) return;
    if (this.previousUrl !== null && this.previousUrl === this.norm(target)) {
      this.location.back();
    } else {
      void this.router.navigateByUrl(target, { replaceUrl: true });
    }
  }

  /**
   * Hierarchical back (owner 2026-09-20): the chevron climbs the page TREE —
   * result entry → Lab my work, test editor → Test Master — it never replays
   * browser history, so how you ARRIVED at a page (a notification, a report
   * link, a sibling-tube tab) can't change where back takes you.
   */
  back(): void {
    // An in-page handler (e.g. close the open chat thread) takes precedence.
    if (this.interceptor && this.interceptor()) return;

    const current = this.norm(this.router.url);
    const parent = this.getParentRoute(this.router.url);
    if (parent && this.norm(parent) !== current) {
      this.backTo(parent);
      return;
    }
    // Already at a root (or the map returned self) — history is the only
    // sensible move left.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigateByUrl('/admin');
    }
  }
}
