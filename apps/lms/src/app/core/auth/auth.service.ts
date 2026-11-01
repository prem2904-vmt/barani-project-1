import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { AccountsService, StoredAccount } from './accounts.service';
import { BranchRef, CurrentUser } from './mock-user';
import { SessionScopeService } from './session-scope.service';
import { purgeSupabaseIndexedDb, purgeSupabaseLocalStorage } from './supabase-storage';
import { opdPreviewHeaders } from '../../features/opd/shared/opd-gate';
import { betaHeaders } from '../beta/beta-gate';

interface MeResponse {
  id: string;
  authId?: string;
  firstName: string;
  fathersName: string;
  displayName: string;
  email: string;
  tenantId: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  roles: string[];
  permissions: string[];
  branches?: BranchRef[];
  /** Product modules this user is scoped to (OPD build); defaults to ["lab"]. */
  modules?: string[];
  hasPin?: boolean;
  signatureDataUrl?: string;
  /** Medical council / registration number (dash on screens until set). */
  registrationId?: string;
  /** Caller has a DoctorProfile — unlocks the OPD Consult Room. */
  isDoctor?: boolean;
  /** OPD dark build: the server admits this user's OPD calls (tenant explicitly
   *  entitled OR the request carried X-PF-OPD: 1 after pf.opd()). See OpdGateService. */
  opdAccess?: boolean;
  /** The tenant EXPLICITLY has OPD on — visible without the console flag. */
  opdEntitled?: boolean;
  /** Temp-password gate (newer servers). Read ONLY by the passkey sign-in,
   *  which has no /login response to carry it. */
  mustChangePassword?: boolean;
}

/**
 * What a refresh-token exchange came back with.
 *  - `ok`        — a new access token is in place.
 *  - `transient` — the auth server could not be reached / answered 5xx / 429 /
 *                  timed out. The session is NOT over: keep it, retry later.
 *  - `dead`      — the auth server REJECTED the refresh token (revoked, reused,
 *                  not found) or there is none. Only this ends a session.
 *
 * Login audit 2026-09-29 (root cause #1): every failure used to be reported
 * as `false`, and `false` signed the user out — a Wi-Fi blip on resume, a 4s
 * timeout on mobile data or a 502 during a deploy all logged people out.
 */
export type RefreshOutcome = 'ok' | 'transient' | 'dead';

/** Why a session ended — drives the note on the login screen. */
export type SessionEndReason = 'user' | 'expired' | 'suspended' | 'elsewhere';

/** Outcome of loading /api/auth/me (same classification as a refresh). */
export type ProfileOutcome = 'ok' | 'transient' | 'dead';

@Injectable({ providedIn: 'root' })
export class AuthService {
  /** Gmail-style multi-account registry (shared lab machines). */
  readonly accounts = inject(AccountsService);
  /** One "session changed" event for every user-scoped service — fired
   *  BEFORE a different person's profile is published (see applyProfile). */
  private readonly scope = inject(SessionScopeService);

  private readonly _session = signal<Session | null>(null);
  private readonly _user = signal<CurrentUser | null>(null);
  private readonly _isReady = signal<boolean>(false);

  private _readyResolver!: () => void;
  private readonly _ready = new Promise<void>(resolve => (this._readyResolver = resolve));

  readonly session = this._session.asReadonly();
  readonly user = this._user.asReadonly();
  readonly isReady = this._isReady.asReadonly();
  readonly isAuthenticated = computed(() => !!this._user());
  readonly accessToken = computed(() => this._session()?.access_token ?? null);
  readonly permissions = computed(() => this._user()?.permissions ?? []);
  /** OPD Consult Room gate — the backend flags users with a DoctorProfile. */
  readonly isDoctor = computed(() => this._user()?.isDoctor ?? false);

  // Forced-password-change gate: when true, the app routes to /set-password.
  private readonly _mustChangePassword = signal(false);
  readonly mustChangePassword = this._mustChangePassword.asReadonly();

  /** Refresh this long BEFORE the access token expires (resume / foreground
   *  tick), so the burst of requests after a wake never meets an expired
   *  token in the first place. */
  static readonly REFRESH_AHEAD_MS = 5 * 60_000;
  /** Mobile data after a resume routinely needs > 4s (the old abort). */
  static readonly REFRESH_TIMEOUT_MS = 10_000;
  /** With a stored session but no cached profile, wait this long for /me
   *  before booting as signed-out (was 4s — a slow cold start on mobile data
   *  landed people on the login screen with a perfectly good session). */
  static readonly BOOT_WATCHDOG_MS = 15_000;

  // Persisted session tokens. The SDK's setSession() hangs on native
  // (WKWebView Web-Locks / refresh), so it never writes the session to
  // storage — meaning the user was signed out on every cold start. We own
  // persistence here instead: store the tokens on login, restore on boot.
  private static readonly SESSION_KEY = 'pf.session';
  /** Cross-tab session events (sign-out) — see onStorage(). */
  static readonly SESSION_EVENT_KEY = 'pf.sessionEvent';
  /** Last good /me per auth user (keyed by the JWT sub) — lets a restored
   *  session boot straight in and survive /me being unreachable (a deploy,
   *  a dead zone) instead of being thrown back to the login screen. */
  static readonly PROFILE_KEY_PREFIX = 'pf.profile:';
  private static readonly ACTIVE_BRANCH_KEY = 'pf.activeBranch';

  private persistSession(s: Session | null): void {
    try {
      if (s?.access_token) {
        localStorage.setItem(AuthService.SESSION_KEY, JSON.stringify({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
        }));
      } else {
        localStorage.removeItem(AuthService.SESSION_KEY);
      }
    } catch { /* private mode */ }
  }
  // Per-TAB account pin (sessionStorage: survives this tab's reloads, never
  // shared with other tabs). Two tabs showing two accounts used to share the
  // single `pf.session` key, so a reload of either tab came back as whichever
  // account wrote last — and a token refresh in one tab was filed under the
  // OTHER tab's registry row (Messages RCA §1 "two tabs").
  private static readonly TAB_ACCOUNT_KEY = 'pf.tabAccount';
  private static readTabAccount(): string | null {
    try { return sessionStorage.getItem(AuthService.TAB_ACCOUNT_KEY); } catch { return null; }
  }
  private static writeTabAccount(userId: string | null): void {
    try {
      if (userId) sessionStorage.setItem(AuthService.TAB_ACCOUNT_KEY, userId);
      else sessionStorage.removeItem(AuthService.TAB_ACCOUNT_KEY);
    } catch { /* private mode */ }
  }
  /** The registry row whose tokens THIS tab holds. */
  private ownAccountId(): string | null {
    return this._user()?.id ?? AuthService.readTabAccount() ?? this.accounts.activeUserId();
  }

  private restorePersistedSession(): Session | null {
    // This tab was showing a specific account → resume THAT account from the
    // registry (freshest rotated tokens), not the device-wide last writer.
    const pinned = AuthService.readTabAccount();
    if (pinned) {
      const acc = this.accounts.accounts().find(a => a.userId === pinned);
      if (acc?.accessToken && acc.refreshToken) {
        return { access_token: acc.accessToken, refresh_token: acc.refreshToken } as Session;
      }
    }
    try {
      const raw = localStorage.getItem(AuthService.SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      return s?.access_token ? (s as Session) : null;
    } catch { return null; }
  }

  /** Single-flight guard: concurrent 401s (e.g. a burst of API calls after
   *  the token expires) must NOT each burn the one-time-use refresh token —
   *  Supabase rotates it, so the second concurrent exchange fails and signs
   *  the user out. All callers await the same in-flight refresh. */
  private _refreshInFlight: Promise<RefreshOutcome> | null = null;

  // ── Stale-permission refresh ──────────────────────────────────────
  // Long-lived tabs keep serving day-old roles/permissions: an admin revokes
  // a perm but the open session never re-fetches /api/auth/me. Re-load the
  // profile when the window regains focus and the last load is older than
  // this window. Single-flight so a focus+visibilitychange burst (both fire
  // on tab switch) doesn't stack concurrent loads.
  private static readonly PROFILE_STALE_MS = 5 * 60_000;
  private _lastProfileLoadedAt = 0;
  private _staleProfileRefresh: Promise<unknown> | null = null;

  private refreshProfileIfStale(): void {
    if (!this._session()) return; // no session — nothing to refresh
    if (Date.now() - this._lastProfileLoadedAt < AuthService.PROFILE_STALE_MS) return;
    this._staleProfileRefresh ??= this.loadProfile()
      .catch(() => { /* best-effort — next focus retries */ })
      .finally(() => { this._staleProfileRefresh = null; });
  }

  // ── Session end (logout / expiry) ─────────────────────────────────
  // The full sign-out sequence (revoke → push → sockets → timers → clear →
  // navigate) lives in SessionService, which depends on services that
  // themselves inject AuthService. It registers itself here so a definitive
  // auth failure detected INSIDE AuthService (a dead refresh token on /me,
  // a suspended tenant, another tab signing out) runs the same sequence.
  private _endHandler: ((reason: SessionEndReason) => Promise<void>) | null = null;
  setSessionEndHandler(fn: ((reason: SessionEndReason) => Promise<void>) | null): void {
    this._endHandler = fn;
  }
  /** End the session for `reason`. Falls back to a local clear when no
   *  SessionService is wired (unit tests of AuthService alone). */
  endSession(reason: SessionEndReason): Promise<void> {
    if (this._endHandler) return this._endHandler(reason);
    this.clearLocalSession({ broadcast: reason !== 'elsewhere' });
    return Promise.resolve();
  }

  /** Exchange the stored refresh token for a fresh access token, straight
   *  against Supabase's token endpoint (the SDK refresh flow hangs on native).
   *  Updates + persists the session. Deduped: concurrent callers share one
   *  refresh — and across TABS a Web Lock serialises it, so two tabs of the
   *  same account never race the same one-time-use token. */
  refreshSession(): Promise<RefreshOutcome> {
    this._refreshInFlight ??= AuthService.withRefreshLock(() => this.doRefresh())
      .finally(() => { this._refreshInFlight = null; });
    return this._refreshInFlight;
  }

  /** Boolean facade kept for existing callers: true only on `ok`. */
  refreshAccessToken(): Promise<boolean> {
    return this.refreshSession().then(o => o === 'ok');
  }

  /**
   * Proactive refresh before a request goes out: when the access token is
   * within 60s of expiry, refresh first (single-flight) instead of letting
   * every in-flight request 401 and queue behind a reactive refresh.
   *  - `fresh` — nothing to do (or no session at all);
   *  - otherwise the refresh outcome. `transient` still sends the request
   *    (the API accepts a token a few minutes past expiry — clock skew).
   */
  async ensureFreshToken(): Promise<'fresh' | RefreshOutcome> {
    const t = this._session()?.access_token;
    if (!t || !this.isExpiringSoon(t)) return 'fresh';
    return this.refreshSession();
  }

  /** Serialise refreshes across tabs (Web Locks). Falls back to running
   *  unlocked when the API is missing or the lock can't be had in time —
   *  WKWebView's lock implementation is what made the SDK hang, so this
   *  never waits more than a few seconds for it. */
  private static async withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined'
      ? (navigator as unknown as { locks?: { request?: (n: string, o: object, cb: () => Promise<T>) => Promise<T> } }).locks
      : undefined;
    if (!locks?.request || typeof AbortController === 'undefined') return fn();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let started = false;
    try {
      return await locks.request('pf-auth-refresh', { signal: ctrl.signal }, () => {
        started = true;
        clearTimeout(timer);
        return fn();
      });
    } catch (e) {
      if (!started) return fn();   // lock unavailable / timed out — go unlocked
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** A NEWER copy of this tab's own session written by another tab (registry
   *  row or the shared pf.session key), for the SAME auth user. */
  private newerStoredSession(cur: Session): Session | null {
    const mySub = AuthService.jwtSub(cur.access_token ?? '');
    const ownId = this.ownAccountId();
    const row = ownId ? this.accounts.fresh(ownId) : null;
    if (row?.refreshToken && row.refreshToken !== cur.refresh_token) {
      const rowSub = AuthService.jwtSub(row.accessToken ?? '');
      if (!mySub || !rowSub || rowSub === mySub) {
        return { access_token: row.accessToken, refresh_token: row.refreshToken } as Session;
      }
    }
    try {
      const raw = localStorage.getItem(AuthService.SESSION_KEY);
      const s = raw ? JSON.parse(raw) as Session : null;
      if (s?.refresh_token && s.refresh_token !== cur.refresh_token && mySub
        && AuthService.jwtSub(s.access_token ?? '') === mySub) {
        return s;
      }
    } catch { /* ignore */ }
    return null;
  }

  /** Put a (refreshed or adopted) session in place for THIS tab's account. */
  private adoptSession(s: Session): void {
    this._session.set(s);
    this.persistSession(s);
    // Keep the multi-account registry's copy fresh — Supabase rotates the
    // refresh token on every exchange, so a stale registry copy goes dead.
    // File them under the account THIS tab holds — not the device-wide
    // "active" id, which another tab may have switched to someone else.
    const ownId = this.ownAccountId();
    if (ownId && s.refresh_token) this.accounts.updateTokens(ownId, s.access_token, s.refresh_token);
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const current = this._session();
    if (!current?.refresh_token) return 'dead';
    let refresh = current.refresh_token;
    // Another tab holding the SAME account may already have rotated the
    // refresh token (Supabase revokes the old one, and re-using it outside
    // the reuse window revokes the whole session). Prefer the newer copy:
    // adopt it outright if its access token is still good, otherwise
    // refresh with the newest refresh token.
    const newer = this.newerStoredSession(current);
    if (newer) {
      if (newer.access_token && !this.isExpiringSoon(newer.access_token)) {
        this.adoptSession(newer);
        return 'ok';
      }
      refresh = newer.refresh_token!;
    }
    const first = await this.postRefresh(refresh);
    if (first.session) { this.adoptSession(first.session); return 'ok'; }
    if (!first.rejected) return 'transient';
    // Rejected — but a tab may have rotated it while ours was in flight.
    // Only after that last check is the session really over.
    const late = this.newerStoredSession({ ...current, refresh_token: refresh } as Session);
    if (late) {
      if (late.access_token && !this.isExpiringSoon(late.access_token)) { this.adoptSession(late); return 'ok'; }
      const second = await this.postRefresh(late.refresh_token!);
      if (second.session) { this.adoptSession(second.session); return 'ok'; }
      if (!second.rejected) return 'transient';
    }
    return 'dead';
  }

  /** One refresh-token grant. `rejected` = the auth server answered and said
   *  no (400 invalid_grant / 401 / 403); anything else is transient. */
  private async postRefresh(refresh: string): Promise<{ session: Session | null; rejected: boolean }> {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), AuthService.REFRESH_TIMEOUT_MS);
    try {
      const res = await fetch(`${environment.auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: environment.auth.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) return { session: null, rejected: AuthService.isRejection(res.status) };
      const s = await res.json().catch(() => null) as Session | null;
      return s?.access_token ? { session: s, rejected: false } : { session: null, rejected: false };
    } catch { return { session: null, rejected: false }; }
    finally { clearTimeout(killer); }
  }

  /** The token endpoint's "this refresh token is no good" statuses. */
  static isRejection(status: number): boolean {
    return status === 400 || status === 401 || status === 403;
  }

  /** Exchange ANY refresh token for a fresh session (used when switching to a
   *  non-active profile — proves this device holds that account's session).
   *  `dead` = the auth server REJECTED the token (400/401: revoked, reused,
   *  not found) — only then is the profile's saved sign-in really over. A
   *  timeout / network error / 5xx is transient and must not kill the
   *  profile (it used to be removed from the device on any failure). */
  private async exchangeRefreshToken(refresh: string): Promise<{ session: Session | null; dead: boolean }> {
    const r = await this.postRefresh(refresh);
    return { session: r.session, dead: !r.session && r.rejected };
  }

  /** Who a token belongs to (app user id) — read-only /api/auth/me. */
  private async profileIdFor(token: string): Promise<string | null> {
    try {
      const res = await fetch(`${environment.apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, ...opdPreviewHeaders() }, cache: 'no-store',
      });
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      return json?.data?.id ?? null;
    } catch { return null; }
  }

  private static switchError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
  }

  // Remembered organizations for the login screen (most-recent first). A
  // per-device convenience — it survives sign-out on purpose.
  private static readonly ORGS_KEY = 'pf.orgs';
  readonly rememberedOrgs = signal<string[]>(AuthService.loadOrgs());
  private static loadOrgs(): string[] {
    try { return JSON.parse(localStorage.getItem(AuthService.ORGS_KEY) ?? '[]'); } catch { return []; }
  }
  private rememberOrg(org: string): void {
    const next = [org, ...this.rememberedOrgs().filter(o => o.toLowerCase() !== org.toLowerCase())].slice(0, 8);
    this.rememberedOrgs.set(next);
    try { localStorage.setItem(AuthService.ORGS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  }

  // Active branch for the branch switcher. The interceptor sends this as the
  // X-Active-Branch header; the backend validates it against the user's
  // permitted branches and REFUSES anything else (403 branch_not_permitted —
  // strict branch access, 2026-09-27). /me still answers, so a stale id is
  // reset here on every profile load; see also dropActiveBranch().
  private readonly _activeBranchId = signal<string | null>(
    (() => { try { return localStorage.getItem(AuthService.ACTIVE_BRANCH_KEY); } catch { return null; } })()
  );
  readonly activeBranchId = this._activeBranchId.asReadonly();
  /** The currently-active branch object (from the user's permitted list). */
  readonly activeBranch = computed<BranchRef | null>(() => {
    const id = this._activeBranchId();
    const branches = this._user()?.branches ?? [];
    return branches.find(b => b.id === id) ?? null;
  });

  /** Switch the active branch. Persists it; returns false when the branch is
   *  not one of the user's (or already active).
   *
   *  `reload: false` is the in-app re-scope used by BranchSwitchService (the
   *  switcher UI): it re-creates the routed screen and resets the branch-
   *  scoped caches without a page reload — no bundle re-parse, no session
   *  restore, no /me, no tenant/entitlement refetch. The default keeps the
   *  old full reload for any other caller (the safest fallback). */
  setActiveBranch(branchId: string, opts: { reload?: boolean } = {}): boolean {
    const allowed = (this._user()?.branches ?? []).some(b => b.id === branchId);
    if (!allowed || branchId === this._activeBranchId()) return false;
    this._activeBranchId.set(branchId);
    try { localStorage.setItem(AuthService.ACTIVE_BRANCH_KEY, branchId); } catch { /* private mode */ }
    if (opts.reload === false) return true;
    // Full reload re-scopes every component that caches branch data in
    // signals; the session survives it.
    try { window.location.reload(); } catch { /* SSR/native guard */ }
    return true;
  }

  /** The server refused our X-Active-Branch (the user's branches changed
   *  under them, or a stale id from another account). Forget it — requests
   *  fall back to the user's default branch — and re-pull /me so the switcher
   *  and the header re-seed from the current permitted list. */
  dropActiveBranch(): void {
    if (!this._activeBranchId()) return;
    this._activeBranchId.set(null);
    try { localStorage.removeItem(AuthService.ACTIVE_BRANCH_KEY); } catch { /* private mode */ }
    void this.loadProfile();
  }

  constructor() {
    // The Supabase JS SDK is no longer used for sessions (login audit
    // 2026-09-29, root cause #2): its own storage held a stale copy of the
    // refresh token (we rotate ours directly), getSession() silently
    // refreshed that stale copy — Supabase's reuse detection then revoked the
    // whole session — and signOut() defaulted to scope=global, revoking the
    // user's sessions on EVERY device and tab. Drop whatever it left behind.
    purgeSupabaseLocalStorage();

    const settle = () => {
      if (this._isReady()) return;
      this._isReady.set(true);
      this._readyResolver();
    };

    const stored = this.restorePersistedSession();
    if (!stored) {
      settle();
    } else {
      this._session.set(stored);
      this.startSessionTimer();
      const cached = this.cachedProfile(AuthService.jwtSub(stored.access_token));
      if (cached) {
        // Instant, offline-tolerant boot: publish the last good profile and
        // let the guard through; /me revalidates in the background and ends
        // the session only on a DEFINITIVE answer (dead token / suspended).
        this.applyProfile(cached, { fromCache: true });
        settle();
        void this.loadProfile().catch(err => console.error('[auth] profile revalidate failed', err));
      } else {
        // No cached profile: wait for /me, but never forever — a stalled
        // network still boots (as signed-out) after the watchdog. The login
        // screen follows the session in if /me answers later.
        const watchdog = setTimeout(() => {
          if (!this._isReady()) console.warn('[auth] session restore is slow; booting without a profile');
          settle();
        }, AuthService.BOOT_WATCHDOG_MS);
        this.loadProfile()
          .catch(err => console.error('[auth] session restore failed', err))
          .finally(() => { clearTimeout(watchdog); settle(); });
      }
    }

    // Resume / foreground: refresh ahead of expiry (the token very likely
    // lapsed while the app was backgrounded) and re-pull stale permissions.
    try {
      const onResume = () => this.onResume();
      window.addEventListener('focus', onResume);
      window.addEventListener('online', onResume);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.onResume();
      });
      // Cross-tab: a token rotated / a sign-out in another tab.
      window.addEventListener('storage', (e) => this.onStorage(e));
      // Capacitor: WKWebView doesn't always raise visibilitychange on resume.
      const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
      if (cap?.isNativePlatform?.()) {
        void import('@capacitor/app')
          .then(({ App }) => App.addListener('appStateChange', ({ isActive }) => { if (isActive) this.onResume(); }))
          .catch(() => { /* plugin missing — visibilitychange covers it */ });
      }
    } catch { /* SSR/native guard */ }
  }

  waitForAuth(): Promise<void> {
    return this._ready;
  }

  // ── Resume + foreground refresh ───────────────────────────────────
  private _resumeBusy = false;
  private onResume(): void {
    if (!this._session() || this._resumeBusy) return;
    this._resumeBusy = true;
    void this.refreshIfExpiringSoon()
      .finally(() => { this._resumeBusy = false; this.refreshProfileIfStale(); });
  }

  /** Refresh when the access token is within REFRESH_AHEAD_MS of expiry.
   *  A dead refresh token ends the session (definitive); a transient
   *  failure is left for the next tick / request. */
  async refreshIfExpiringSoon(): Promise<RefreshOutcome | 'fresh'> {
    const t = this._session()?.access_token;
    if (!t || !this.isExpiringSoon(t, AuthService.REFRESH_AHEAD_MS)) return 'fresh';
    const outcome = await this.refreshSession();
    if (outcome === 'dead' && this._session()) await this.endSession('expired');
    return outcome;
  }

  private _sessionTimer: ReturnType<typeof setInterval> | null = null;
  /** A light foreground tick: keeps the token ahead of expiry while the app
   *  is open (hub reconnects, pollers) without the SDK's background timer. */
  private startSessionTimer(): void {
    if (this._sessionTimer || typeof window === 'undefined') return;
    this._sessionTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (this._session() && !this._resumeBusy) void this.refreshIfExpiringSoon();
    }, 60_000);
  }
  /** Stop the foreground refresh tick (sign-out). */
  stopSessionTimers(): void {
    if (this._sessionTimer) { clearInterval(this._sessionTimer); this._sessionTimer = null; }
    if (this._profileRetry) { clearTimeout(this._profileRetry); this._profileRetry = null; }
  }

  /** Another tab changed shared auth storage. */
  private onStorage(e: StorageEvent): void {
    try {
      if (e.key === AuthService.SESSION_EVENT_KEY && e.newValue) {
        const ev = JSON.parse(e.newValue) as { type?: string; userId?: string };
        const me = this._user()?.id;
        // Only THIS tab's account: on a shared machine another tab signing a
        // different profile out must leave this one alone.
        if (ev.type === 'signout' && me && ev.userId === me) void this.endSession('elsewhere');
        return;
      }
      // Token rotated by another tab for the same auth user → adopt it, so
      // this tab never presents (or refreshes with) a revoked token.
      if (e.key === AuthService.SESSION_KEY || e.key === 'pf.accounts' || e.key === null) {
        const cur = this._session();
        if (!cur) return;
        const newer = this.newerStoredSession(cur);
        if (newer?.access_token && !this.isExpiringSoon(newer.access_token)) this._session.set(newer);
      }
    } catch { /* malformed — ignore */ }
  }

  /** Auth user id (sub claim) from a JWT — used to tell profiles apart when
   *  reconciling our locally-owned session with the SDK's. Null on any parse
   *  failure so callers fail open (treat as "unknown", not "different"). */
  static jwtSub(token: string): string | null {
    try {
      const payload = token.split('.')[1];
      const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      return json?.sub ?? null;
    } catch { return null; }
  }

  hasPermission(code: string): boolean {
    const perms = this._user()?.permissions ?? [];
    return perms.includes('*') || perms.includes(code);
  }

  hasAnyPermission(codes: string[]): boolean {
    const perms = this._user()?.permissions ?? [];
    if (perms.includes('*')) return true;
    return codes.some(c => perms.includes(c));
  }

  /**
   * The permission check the nav / guards use for "can this user DO it here".
   * Identical to hasPermission: collection is purely permission-based (owner
   * 2026-09-27 — "if the receptionist is assigned [collect_sample], they can
   * collect"), gated only by collect_sample + the workflow's Collect /
   * Frontdesk / Lab slots. The old front-end-only rule that hid collection
   * from a Receptionist when the branch collected at a dedicated counter is
   * gone (the backend never enforced it). Kept as the single hook for any
   * future mode-aware check.
   */
  hasEffectivePermission(code: string): boolean {
    return this.hasPermission(code);
  }

  hasAnyEffectivePermission(codes: string[]): boolean {
    if (this.permissions().includes('*')) return true;
    return codes.some(c => this.hasEffectivePermission(c));
  }

  /**
   * Tenant-scoped sign-in: (organization, username, password). The backend
   * resolves the tenant + user and performs the Supabase password grant against
   * the user's synthetic auth email, returning tokens + mustChangePassword.
   */
  async signIn(org: string, username: string, password: string, expectedTenantId?: string): Promise<void> {
    const res = await fetch(`${environment.apiUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org, username, password }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    const data = json?.data;
    if (!res.ok || !json?.success || !data?.accessToken) {
      throw new Error(json?.error?.message || json?.message || 'Invalid organization, username or password.');
    }

    // Add-account tenant lock: when appending a profile on a shared device, the
    // new account MUST belong to the same tenant as the one that launched "Add
    // account". Verify BEFORE touching any session state so a mismatch leaves the
    // current profile fully intact. Fail closed if the tenant can't be read.
    if (expectedTenantId) {
      const newTenantId: string | undefined = data.tenant?.id;
      if (!newTenantId || newTenantId !== expectedTenantId) {
        throw Object.assign(
          new Error(
            `That account belongs to a different organization${data.tenant?.name ? ` (${data.tenant.name})` : ''}. ` +
            `On this device you can only add accounts from your current organization.`,
          ),
          { code: 'tenant_mismatch' },
        );
      }
    }

    const session = {
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    } as Session;
    await this.beginSession(session, { mustChangePassword: !!data.mustChangePassword, org: data.tenant?.name ?? org });
    this._signedInWith.set('password');
  }

  /**
   * Passkey sign-in: Supabase already verified the passkey and minted the
   * SAME kind of session the password grant returns. From here everything is
   * the password path's tail (beginSession): persist, idle-lock reset, /me,
   * registry, cache. The temp-password gate is raised when /me says so
   * (`mustChangePassword`, additive on the server), and a session /me refuses
   * is revoked at once so no orphan sign-in stays behind.
   */
  async signInWithPasskeySession(tokens: { access_token: string; refresh_token: string }): Promise<void> {
    const session = { access_token: tokens.access_token, refresh_token: tokens.refresh_token } as Session;
    this._meMustChangePassword = false;
    try {
      await this.beginSession(session, { mustChangePassword: false, org: null });
    } catch (e) {
      void this.revokeToken(tokens.access_token);
      throw e;
    }
    if (this._meMustChangePassword) this._mustChangePassword.set(true);
    const org = this._user()?.tenantName;
    if (org) this.rememberOrg(org);
    this._signedInWith.set('passkey');
    // The sign-in never went through /api/auth/login (which audits itself):
    // record it once. Fire-and-forget — an audit hiccup never blocks sign-in.
    void this.recordSessionStart(tokens.access_token, 'passkey');
  }

  /** POST /api/auth/session-started — the server writes the "login" audit row
   *  once per session (idempotent on the token's session id). Beta-gated on the
   *  server (`passkeys`), so it carries X-PF-BETA like every beta call. Never throws. */
  private async recordSessionStart(token: string, method: 'passkey'): Promise<void> {
    try {
      await fetch(`${environment.apiUrl}/api/auth/session-started`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...betaHeaders() },
        body: JSON.stringify({ method }),
        cache: 'no-store',
      });
    } catch { /* offline — the audit row is best-effort */ }
  }

  /** How THIS tab's session started (null = restored / switched profile).
   *  Drives the one-time passkey suggestion (only after a password sign-in). */
  private readonly _signedInWith = signal<'password' | 'passkey' | null>(null);
  readonly signedInWith = this._signedInWith.asReadonly();
  /** /me's `mustChangePassword` (newer servers) from the last profile load. */
  private _meMustChangePassword = false;

  /** The shared tail of every credential sign-in (password or passkey). */
  private async beginSession(session: Session, opts: { mustChangePassword: boolean; org: string | null }): Promise<void> {
    // Add account keeps the previous profile's session until the new one
    // is fully loaded — restored if /me can't be reached.
    const prev = this._session();
    this._session.set(session);
    this.persistSession(session);   // survive cold start
    this.startSessionTimer();
    this._mustChangePassword.set(opts.mustChangePassword);
    if (opts.org) this.rememberOrg(opts.org);
    // A fresh credential sign-in supersedes any leftover idle-lock from a prior
    // session on this device — otherwise the user is greeted by a PIN gate the
    // instant they log in (and a PIN-less user could be stranded). Clear the
    // persisted key AND tell the LockService to drop its in-memory lock (its
    // _locked signal was seeded at construction, before this login).
    try { localStorage.removeItem('pf.lockedAt'); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('pf:fresh-signin')); } catch { /* ignore */ }
    const outcome = await this.loadProfile(false, { quiet: true });
    if (outcome !== 'ok') {
      this._session.set(prev);
      this.persistSession(prev);
      throw new Error(outcome === 'transient'
        ? `Signed in, but couldn't load your profile. Check your connection and try again.`
        : 'This account can’t be used here. Ask your admin to check it.');
    }
  }

  /** Best-effort revoke of ONE access token's session (scope=local). */
  private async revokeToken(token: string): Promise<void> {
    try {
      await fetch(`${environment.auth.supabaseUrl}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: environment.auth.supabaseAnonKey, Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
    } catch { /* offline — the token dies with its expiry */ }
  }

  /** Set a new password (forced-change gate + self-service). Clears the gate. */
  async changePassword(newPassword: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${environment.apiUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newPassword }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || json?.message || 'Could not update password.');
    }
    this._mustChangePassword.set(false);
  }

  /**
   * Revoke THIS session's refresh token on the auth server (best effort).
   * scope=local ends only this device's session — never the user's other
   * devices (the SDK's default was scope=global). The access JWT itself stays
   * valid for the API until it expires (stateless validation), so the push
   * unregister that follows still authenticates.
   */
  async revokeSession(timeoutMs = 5000): Promise<void> {
    let token = this._session()?.access_token;
    if (!token) return;
    if (this.isExpiringSoon(token, 0)) {
      if (await this.refreshSession() !== 'ok') return;   // dead/offline — nothing to revoke with
      token = this._session()?.access_token;
      if (!token) return;
    }
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      await fetch(`${environment.auth.supabaseUrl}/auth/v1/logout?scope=local`, {
        method: 'POST',
        headers: { apikey: environment.auth.supabaseAnonKey, Authorization: `Bearer ${token}` },
        cache: 'no-store',
        signal: ctrl.signal,
      });
    } catch { /* offline — the token dies with its expiry */ }
    finally { clearTimeout(killer); }
  }

  /**
   * Drop every piece of THIS session on this device: the tokens, the user /
   * tenant / permission state, the active branch, the idle lock, the cached
   * profile, the registry row of the signed-out profile (other profiles on a
   * shared machine stay) and any Supabase SDK leftovers. Per-device
   * conveniences — theme, design mode, remembered organizations, printer —
   * are kept. `broadcast` tells other tabs of the same account to follow.
   */
  clearLocalSession(opts: { broadcast?: boolean } = {}): void {
    const activeId = this._user()?.id ?? AuthService.readTabAccount() ?? this.accounts.activeUserId();
    const sub = AuthService.jwtSub(this._session()?.access_token ?? '') ?? this._user()?.authId ?? null;
    this.stopSessionTimers();
    // Remove ONLY the active profile from the device registry — other signed-in
    // accounts stay so their owners can still switch in with their PIN.
    if (activeId) this.accounts.remove(activeId);
    // Tear down every user-scoped realtime service (hubs, stores, windows,
    // pop-ups, rings) before anything else can react to the sign-out.
    this.scope.changed(null);
    AuthService.writeTabAccount(null);
    this.persistSession(null);
    this._session.set(null);
    this._user.set(null);
    this._mustChangePassword.set(false);
    this._signedInWith.set(null);
    this._lastProfileLoadedAt = 0;
    this._activeBranchId.set(null);
    try { localStorage.removeItem(AuthService.ACTIVE_BRANCH_KEY); } catch { /* */ }
    if (sub) { try { localStorage.removeItem(AuthService.PROFILE_KEY_PREFIX + sub); } catch { /* */ } }
    // Signing out ENDS the idle lock. Leaving pf.lockedAt behind meant the
    // next person to sign in on this device was met by the PIN screen for a
    // lock that belonged to the session they just ended (owner: "if it's
    // sign out the pin is not needed, it just needs to sign in"). Cleared
    // here rather than in LockService to avoid an AuthService <-> LockService
    // DI cycle; the event lets a live LockService drop its in-memory flag too.
    try { localStorage.removeItem('pf.lockedAt'); } catch { /* */ }
    purgeSupabaseLocalStorage();
    void purgeSupabaseIndexedDb();
    if (opts.broadcast && activeId) {
      try {
        localStorage.setItem(AuthService.SESSION_EVENT_KEY,
          JSON.stringify({ type: 'signout', userId: activeId, at: Date.now() }));
      } catch { /* */ }
    }
    try { window.dispatchEvent(new Event('pf:signed-out')); } catch { /* SSR/native */ }
  }

  /**
   * Low-level sign-out: best-effort server revoke + local clear. Screens use
   * SessionService.logout() (the full ordered sequence); this stays for the
   * few callers that only need the auth half.
   */
  async signOut(opts: { revoke?: boolean } = {}): Promise<void> {
    if (opts.revoke !== false) await this.revokeSession();
    this.clearLocalSession({ broadcast: true });
  }

  // ── Multi-account switching + PIN (shared lab machines) ──────────────

  /** Switch to another signed-in profile. Two proofs are required: this
   *  device must hold a live session for the target (its refresh token still
   *  exchanges), AND the person must know that account's PIN (verified
   *  server-side, rate-limited). Throws with a user-readable message. */
  async switchAccount(acc: StoredAccount, pin: string): Promise<void> {
    const first = (acc.displayName || 'this profile').split(' ')[0];
    const expired = () => AuthService.switchError('session_expired',
      `${first}’s saved sign-in has ended on this device — sign in again to switch.`);
    // Always work from the FRESHEST stored tokens (another tab may have
    // rotated them since this list was rendered).
    const row = this.accounts.fresh(acc.userId) ?? acc;
    if (!row.refreshToken) { this.accounts.markExpired(acc.userId); throw expired(); }

    // A still-valid access token needs no exchange (no rotation, nothing to
    // lose); otherwise — or if the server no longer accepts it — exchange
    // the refresh token.
    let sess: Session | null = null;
    let who: string | null = null;
    if (row.accessToken && !this.isExpiringSoon(row.accessToken)) {
      who = await this.profileIdFor(row.accessToken);
      if (who) sess = { access_token: row.accessToken, refresh_token: row.refreshToken } as Session;
    }
    if (!sess) {
      const ex = await this.exchangeRefreshToken(row.refreshToken);
      if (!ex.session) {
        if (ex.dead) { this.accounts.markExpired(acc.userId); throw expired(); }
        throw AuthService.switchError('network', 'Couldn’t reach the sign-in server — check the connection and try again.');
      }
      sess = ex.session;
      // Supabase rotated the refresh token — save it even if the PIN fails,
      // otherwise the stored one is dead and the profile bricks.
      this.accounts.updateTokens(acc.userId, sess.access_token, sess.refresh_token!);
      who = await this.profileIdFor(sess.access_token);
      if (!who) throw AuthService.switchError('network', 'Couldn’t reach the server — check the connection and try again.');
    }

    // Never half-switch: the saved session must really be THIS profile
    // (a cross-tab write used to file one account's tokens under another's
    // row). Checked read-only, before any state changes.
    if (who !== acc.userId) {
      this.accounts.markExpired(acc.userId);
      throw AuthService.switchError('session_mismatch',
        `The saved sign-in for ${first} belongs to a different account — sign in again to switch.`);
    }

    const res = await fetch(`${environment.apiUrl}/api/auth/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.access_token}` },
      body: JSON.stringify({ pin: pin ?? '' }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      const code = typeof json?.error === 'string' ? json.error : json?.error?.code;
      // No PIN set on the target → the profile opens directly (the server is
      // authoritative here, not the possibly-stale local hasPin cache).
      if (code !== 'no_pin') {
        const err = new Error(json?.error?.message || json?.message || 'Incorrect PIN.');
        (err as Error & { code?: string }).code = code || 'wrong_pin';
        throw err;
      }
      this.accounts.setHasPin(acc.userId, false);
    }

    this._session.set(sess);
    this.persistSession(sess);
    this.startSessionTimer();
    this.accounts.setActive(acc.userId);
    this._mustChangePassword.set(false);
    this._signedInWith.set(null);
    await this.loadProfile();
  }

  /** Verify the ACTIVE account's PIN (idle-lock unlock). */
  async verifyPin(pin: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${environment.apiUrl}/api/auth/pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pin }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || json?.message || 'Incorrect PIN.');
    }
  }

  /** Set or change the account's PIN (change requires the current PIN). */
  async setPin(newPin: string, currentPin?: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`${environment.apiUrl}/api/auth/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ newPin, currentPin: currentPin || null }),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      throw new Error(json?.error?.message || json?.message || 'Could not update the PIN.');
    }
    const u = this._user();
    if (u) {
      this._user.set({ ...u, hasPin: true });
      this.accounts.setHasPin(u.id, true);
    }
  }

  /** Patch the cached signature after a save/remove so anything reading
   *  `user()?.signatureDataUrl` (invoices, the My-signature screen) updates live
   *  without re-fetching the whole profile. */
  setSignatureLocal(dataUrl: string | null): void {
    const u = this._user();
    if (u) this._user.set({ ...u, signatureDataUrl: dataUrl ?? undefined });
  }

  /** Mirror a saved registration ID onto the in-memory user. */
  setRegistrationIdLocal(regId: string | null): void {
    const u = this._user();
    if (u) this._user.set({ ...u, registrationId: regId ?? undefined });
  }

  /**
   * The current access token, refreshed first when it is expired / near
   * expiry (SignalR's accessTokenFactory, raw fetches). Never falls back to
   * the Supabase SDK's own storage: that copy is stale by design and reading
   * it made the SDK refresh a rotated token (root cause #2).
   */
  async getAccessToken(): Promise<string | null> {
    const local = this._session()?.access_token ?? null;
    if (local && this.isExpiringSoon(local)) {
      await this.refreshSession();
      return this._session()?.access_token ?? null;
    }
    return local;
  }

  /** True if the JWT is expired or within `skewMs` (default 60s) of expiring. */
  private isExpiringSoon(jwt: string, skewMs = 60_000): boolean {
    try {
      const payload = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const exp = (JSON.parse(atob(payload)).exp as number) * 1000;
      return Date.now() >= exp - skewMs;
    } catch { return true; }
  }

  // ── Profile (/api/auth/me) ─────────────────────────────────────────

  private cachedProfile(sub: string | null): CurrentUser | null {
    if (!sub) return null;
    try {
      const raw = localStorage.getItem(AuthService.PROFILE_KEY_PREFIX + sub);
      const parsed = raw ? JSON.parse(raw) as { user?: CurrentUser } : null;
      return parsed?.user?.id ? parsed.user : null;
    } catch { return null; }
  }

  private cacheProfile(u: CurrentUser): void {
    const sub = AuthService.jwtSub(this._session()?.access_token ?? '') ?? u.authId ?? null;
    if (!sub) return;
    // The signature image (up to ~45 kB) is not needed to boot.
    const { signatureDataUrl: _sig, ...rest } = u;
    try {
      localStorage.setItem(AuthService.PROFILE_KEY_PREFIX + sub, JSON.stringify({ user: rest, at: Date.now() }));
    } catch { /* quota / private mode */ }
  }

  /** Publish a profile as the current user (from /me or the boot cache). */
  private applyProfile(u: CurrentUser, opts: { fromCache: boolean }): void {
    // A DIFFERENT person is about to become the active user (Add account
    // signs in without a reload): reset every user-scoped service FIRST so
    // nothing — hub sockets, message stores, windows, rings — survives
    // from the previous account. No-op for the same person.
    this.scope.changed({ userId: u.id, tenantId: u.tenantId, authId: u.authId ?? null });
    AuthService.writeTabAccount(u.id);
    const prev = this._user();
    // Keep the signature we already hold when the cache (which omits it)
    // stands in for the same person.
    const signature = opts.fromCache && prev?.id === u.id ? prev.signatureDataUrl : u.signatureDataUrl;
    this._user.set({ ...u, signatureDataUrl: signature });

    // Seed / validate the active branch against what this user may access.
    // Clear a stale stored branch so the header doesn't send a rejected id.
    const branches = u.branches ?? [];
    const stored = this._activeBranchId();
    if (!stored || !branches.some(b => b.id === stored)) {
      this._activeBranchId.set(u.branchId);
      try { localStorage.setItem(AuthService.ACTIVE_BRANCH_KEY, u.branchId); } catch { /* private mode */ }
    }
  }

  private _profileRetry: ReturnType<typeof setTimeout> | null = null;
  private _profileRetryDelay = 5000;
  /** /me couldn't be reached and there is no profile to show: try again
   *  with backoff while the session exists (the login screen follows the
   *  session in once it answers). */
  private scheduleProfileRetry(): void {
    if (this._profileRetry || typeof window === 'undefined') return;
    const delay = this._profileRetryDelay;
    this._profileRetryDelay = Math.min(delay * 2, 60_000);
    this._profileRetry = setTimeout(() => {
      this._profileRetry = null;
      if (this._session() && !this._user()) void this.loadProfile();
    }, delay);
  }

  /**
   * Load /api/auth/me for the current session and classify the answer:
   *  - 200            → `ok`, profile published + cached;
   *  - network / 5xx / 429 / anything unexpected → `transient`: the session
   *    and whatever profile we hold stay (it used to sign out on any non-200
   *    — every dev deploy's 502/503 window logged people out);
   *  - 401 → refresh once and retry; a rejected refresh, or a 401 again
   *    with a freshly minted token, is `dead`;
   *  - 403 (tenant suspended) → `dead`.
   * `dead` ends the session (SessionService sequence) unless `quiet`, where
   * the caller (sign-in) reports it instead.
   */
  async loadProfile(retried = false, opts: { quiet?: boolean } = {}): Promise<ProfileOutcome> {
    const token = await this.getAccessToken();
    if (!token) {
      if (!this._session()) this._user.set(null);
      return this._session() ? 'transient' : 'dead';
    }

    let res: Response;
    try {
      // no-store to stop Chrome's HTTP cache from serving a stale 401 from a
      // previous (signed-out) session — that used to leave the login button
      // stuck on "Signing in…" whenever DevTools was closed (DevTools auto-
      // disables the cache, which is why it worked with inspect open).
      res = await fetch(`${environment.apiUrl}/api/auth/me`, {
        // opdPreviewHeaders: /me.opdAccess reflects pf.opd() (OPD dark build).
        headers: { Authorization: `Bearer ${token}`, ...opdPreviewHeaders() },
        cache: 'no-store'
      });
    } catch {
      return this.profileUnavailable(opts.quiet);
    }

    if (res.status === 401) {
      if (!retried) {
        // The access token expired while we were away. Refresh once and retry.
        const r = await this.refreshSession();
        if (r === 'ok') return this.loadProfile(true, opts);
        if (r === 'transient') return this.profileUnavailable(opts.quiet);
      }
      if (!opts.quiet) await this.endSession('expired');
      return 'dead';
    }
    if (res.status === 403) {
      const body = await res.json().catch(() => null) as { error?: string } | null;
      if (!opts.quiet) await this.endSession(body?.error === 'tenant_suspended' ? 'suspended' : 'expired');
      return 'dead';
    }
    if (!res.ok) return this.profileUnavailable(opts.quiet);

    const json = await res.json().catch(() => null);
    const data: MeResponse | undefined = json?.data;
    if (!data) return this.profileUnavailable(opts.quiet);
    // The session may have ended (sign-out) while /me was in flight.
    if (AuthService.jwtSub(this._session()?.access_token ?? '') !== AuthService.jwtSub(token)) return 'transient';

    const user: CurrentUser = {
      id: data.id,
      authId: data.authId,
      firstName: data.firstName ?? '',
      fathersName: data.fathersName ?? '',
      displayName: data.displayName || [data.firstName, data.fathersName].filter(Boolean).join(' '),
      email: data.email,
      tenantId: data.tenantId,
      tenantName: data.tenantName,
      branchId: data.branchId,
      branchName: data.branchName,
      roles: data.roles ?? [],
      permissions: data.permissions ?? [],
      branches: data.branches ?? [],
      // OPD build: module scope from the backend; older servers omit it →
      // default ['lab'] so the front-desk fork stays lab-only.
      modules: data.modules ?? ['lab'],
      hasPin: data.hasPin ?? false,
      signatureDataUrl: data.signatureDataUrl ?? undefined,
      registrationId: data.registrationId ?? undefined,
      isDoctor: data.isDoctor ?? false,
      // OPD dark build — older servers omit both → OPD stays hidden.
      opdAccess: data.opdAccess ?? false,
      opdEntitled: data.opdEntitled ?? false
    };
    this._meMustChangePassword = data.mustChangePassword === true;
    // A restored session (reload / reopened app) never passed through the
    // sign-in that raises the gate: raise it here from /me so the person is
    // held on /set-password (core/auth/password-gate) instead of an app whose
    // every call answers 403. Only ever RAISED here — changePassword clears it.
    if (this._meMustChangePassword) this._mustChangePassword.set(true);
    this.applyProfile(user, { fromCache: false });
    this.cacheProfile(user);
    this._lastProfileLoadedAt = Date.now();
    this._profileRetryDelay = 5000;
    if (this._profileRetry) { clearTimeout(this._profileRetry); this._profileRetry = null; }

    // Sync the multi-account registry: this profile is now the device's
    // active account, with its current tokens and display info.
    const sess = this._session();
    if (sess?.access_token) {
      this.accounts.upsert({
        userId: data.id,
        org: data.tenantName,
        tenantId: data.tenantId,
        displayName: user.displayName,
        email: data.email,
        accessToken: sess.access_token,
        refreshToken: sess.refresh_token ?? '',
        hasPin: data.hasPin ?? false,
        addedAt: new Date().toISOString(),
      });
      this.accounts.setActive(data.id);
    }
    return 'ok';
  }

  /** /me unreachable: keep the session and any profile we hold; if there is
   *  none yet, fall back to the cached one, else retry with backoff. */
  private profileUnavailable(quiet = false): ProfileOutcome {
    // Sign-in reports the failure itself (and restores the previous session).
    if (!quiet && !this._user()) {
      const cached = this.cachedProfile(AuthService.jwtSub(this._session()?.access_token ?? ''));
      if (cached) this.applyProfile(cached, { fromCache: true });
      else this.scheduleProfileRetry();
    }
    return 'transient';
  }
}
