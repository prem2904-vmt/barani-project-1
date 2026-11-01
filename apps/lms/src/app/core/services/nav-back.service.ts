import { Injectable, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { PRIMARY_NAV } from '../../layout/nav-items';
import { PERSONAL_SETTINGS_PAGES, SETTINGS_HUBS, SETTINGS_PARENT } from '../../shared/utils/settings-catalog';

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

  /** The URL this page was opened FROM (normalised), or null on a fresh
   *  load — read-only, for a screen whose back depends on where it came from. */
  cameFrom(): string | null { return this.previousUrl; }

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
    if (this.url()) this.stack.push(this.url());
    this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        const next = this.norm(e.urlAfterRedirects);
        // A query-only change on the same page (a tab / category kept in the
        // URL with replaceUrl) is not "coming from" somewhere — keep the
        // page we really arrived from.
        if (next === this.url()) return;
        this.track(next);
        this.previousUrl = this.url();
        this.url.set(next);
      }
    });
  }

  /** Best-effort mirror of this tab's history (normalised paths, oldest
   *  first) so back can POP to an ancestor that is really behind us instead
   *  of pushing a duplicate entry browser-back would bounce off. Reset by a
   *  reload (then back falls back to replacing the entry). */
  private readonly stack: string[] = [];

  private track(next: string): void {
    const nav = typeof this.router.getCurrentNavigation === 'function' ? this.router.getCurrentNavigation() : null;
    const top = this.stack.length - 1;
    if (nav?.trigger === 'popstate') {
      // Browser back / forward (or our own location.back / history.go):
      // land on the nearest matching entry behind us, else treat as forward.
      const i = this.stack.lastIndexOf(next, top - 1);
      if (i >= 0) { this.stack.length = i + 1; return; }
      this.stack.push(next);
      return;
    }
    if (nav?.extras?.replaceUrl && top >= 0) { this.stack[top] = next; return; }
    this.stack.push(next);
  }

  /** Strip query/hash + trailing slashes so "/lab/my-work/" === "/lab/my-work". */
  private norm(u: string): string {
    return u.split('?')[0].split('#')[0].replace(/\/+$/, '');
  }

  /** Compute the main parent route for the current URL instead of raw history pop. */
  getParentRoute(currentUrl: string): string {
    const rawUrl = currentUrl || this.router.url;
    const normUrl = this.norm(rawUrl);

    // People & Access editors
    if (normUrl === '/admin/users/invite' || (normUrl.startsWith('/admin/users/') && normUrl !== '/admin/users')) {
      return '/admin/users?tab=users';
    }
    if (normUrl === '/admin/roles/new' || (normUrl.startsWith('/admin/roles/') && normUrl !== '/admin/roles')) {
      return '/admin/users?tab=roles';
    }

    // Nested settings editors climb to their list.
    if (normUrl.startsWith('/admin/workflows/')) {
      const seg = normUrl.split('/').filter(Boolean);
      return seg.length > 3 ? `/admin/workflows/${seg[2]}` : '/admin/workflows';
    }
    if (normUrl.startsWith('/admin/tests/')) {
      const match = rawUrl.match(/[?&]type=([^&]+)/);
      if (match) {
        return `/admin/tests?type=${match[1]}`;
      }
      return '/admin/tests';
    }
    if (normUrl.startsWith('/admin/instruments/')) return '/admin/instruments';
    if (normUrl.startsWith('/admin/bridges/')) return '/admin/bridges';
    if (normUrl.startsWith('/admin/lab-settings/')) return '/lab/settings';

    // Personal settings (avatar menu, any signed-in user, reached from any
    // screen): back is where you came from — never /admin (a 403 for most).
    if (PERSONAL_SETTINGS_PAGES.includes(normUrl)) {
      return this.previousUrl && this.previousUrl !== normUrl ? this.previousUrl : '/';
    }

    // Every settings page → the ONE hub that lists it (settings-catalog).
    if (SETTINGS_PARENT[normUrl]) {
      return SETTINGS_PARENT[normUrl];
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

    // The Lab settings hub's own children (culture settings…) parent back to it.
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
    const want = this.norm(target);
    if (want === current) return;
    if (this.previousUrl !== null && this.previousUrl === want) {
      this.location.back();
      return;
    }
    // The parent is further behind us in this tab's history (e.g. hub →
    // list → editor → list): go back to THAT entry, so no duplicate piles up.
    const top = this.stack.length - 1;
    const i = top > 0 && this.stack[top] === current ? this.stack.lastIndexOf(want, top - 1) : -1;
    if (i >= 0 && i === top - 1) { this.location.back(); return; }
    if (i >= 0 && typeof window !== 'undefined') {
      window.history.go(i - top);
      return;
    }
    void this.router.navigateByUrl(target, { replaceUrl: true });
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
    // A settings page opened from a settings hub (its tiles or its search)
    // goes back to THAT hub — the one the person came from — by popping
    // history, so browser back and the chevron agree.
    if (SETTINGS_PARENT[current] && this.previousUrl !== null && this.previousUrl !== current
        && SETTINGS_HUBS.includes(this.previousUrl)) {
      this.location.back();
      return;
    }
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
