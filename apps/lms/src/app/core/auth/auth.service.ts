import { Injectable, computed, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { BranchLabConfigService } from '../services/branch-lab-config.service';
import { AccountsService, StoredAccount } from './accounts.service';
import { BranchRef, CurrentUser } from './mock-user';
import { supabase } from './supabase.client';

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
  subBranchId?: string | null;
  subBranchName?: string | null;
  roles: string[];
  permissions: string[];
  branches?: BranchRef[];
  /** Product modules this user is scoped to (OPD build); defaults to ["lab"]. */
  modules?: string[];
  hasPin?: boolean;
  signatureDataUrl?: string;
  /** Medical council / registration number (dash on screens until set). */
  registrationId?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly labCfg = inject(BranchLabConfigService);
  /** Gmail-style multi-account registry (shared lab machines). */
  readonly accounts = inject(AccountsService);

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

  // Forced-password-change gate: when true, the app routes to /set-password.
  private readonly _mustChangePassword = signal(false);
  readonly mustChangePassword = this._mustChangePassword.asReadonly();

  // Persisted session tokens. The SDK's setSession() hangs on native
  // (WKWebView Web-Locks / refresh), so it never writes the session to
  // storage — meaning the user was signed out on every cold start. We own
  // persistence here instead: store the tokens on login, restore on boot.
  private static readonly SESSION_KEY = 'pf.session';
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
  private restorePersistedSession(): Session | null {
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
  private _refreshInFlight: Promise<boolean> | null = null;

  // ── Stale-permission refresh ──────────────────────────────────────
  // Long-lived tabs keep serving day-old roles/permissions: an admin revokes
  // a perm but the open session never re-fetches /api/auth/me. Re-load the
  // profile when the window regains focus and the last load is older than
  // this window. Single-flight so a focus+visibilitychange burst (both fire
  // on tab switch) doesn't stack concurrent loads.
  private static readonly PROFILE_STALE_MS = 5 * 60_000;
  private _lastProfileLoadedAt = 0;
  private _staleProfileRefresh: Promise<void> | null = null;

  private refreshProfileIfStale(): void {
    if (!this._session()) return; // no session — nothing to refresh
    if (Date.now() - this._lastProfileLoadedAt < AuthService.PROFILE_STALE_MS) return;
    this._staleProfileRefresh ??= this.loadProfile()
      .catch(() => { /* best-effort — next focus retries */ })
      .finally(() => { this._staleProfileRefresh = null; });
  }

  /** Exchange the stored refresh token for a fresh access token, straight
   *  against Supabase's token endpoint (the SDK refresh flow hangs on native).
   *  Updates + persists the session. Returns false if there's no refresh token
   *  or the exchange fails. Deduped: concurrent callers share one refresh. */
  refreshAccessToken(): Promise<boolean> {
    this._refreshInFlight ??= this.doRefreshAccessToken()
      .finally(() => { this._refreshInFlight = null; });
    return this._refreshInFlight;
  }

  private async doRefreshAccessToken(): Promise<boolean> {
    const refresh = this._session()?.refresh_token;
    if (!refresh) return false;
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(`${environment.auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: environment.auth.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) return false;
      const s = await res.json() as Session;
      if (!s?.access_token) return false;
      this._session.set(s);
      this.persistSession(s);
      // Keep the multi-account registry's copy fresh — Supabase rotates the
      // refresh token on every exchange, so a stale registry copy goes dead.
      const activeId = this.accounts.activeUserId();
      if (activeId) this.accounts.updateTokens(activeId, s.access_token, s.refresh_token!);
      return true;
    } catch { return false; }
    finally { clearTimeout(killer); }
  }

  /** Exchange ANY refresh token for a fresh session (used when switching to a
   *  non-active profile — proves this device holds that account's session). */
  private async exchangeRefreshToken(refresh: string): Promise<Session | null> {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(`${environment.auth.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: environment.auth.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
        cache: 'no-store',
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      const s = await res.json() as Session;
      return s?.access_token ? s : null;
    } catch { return null; }
    finally { clearTimeout(killer); }
  }

  // Remembered organizations for the login dropdown (most-recent first).
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
  // permitted branches and falls back to their default if it isn't allowed.
  private static readonly ACTIVE_BRANCH_KEY = 'pf.activeBranch';
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

  /** Switch the active branch. Persists, then reloads so every branch-scoped
   *  view re-fetches cleanly under the new scope (no stale state). */
  setActiveBranch(branchId: string): void {
    const allowed = (this._user()?.branches ?? []).some(b => b.id === branchId);
    if (!allowed || branchId === this._activeBranchId()) return;
    this._activeBranchId.set(branchId);
    try { localStorage.setItem(AuthService.ACTIVE_BRANCH_KEY, branchId); } catch { /* private mode */ }
    // Full reload is the most robust way to re-scope the many components that
    // cache branch-scoped data in signals; the Supabase session survives it.
    try { window.location.reload(); } catch { /* SSR/native guard */ }
  }

  constructor() {
    // Restore session on startup and subscribe to auth changes. A 3s watchdog
    // guarantees the auth guard never hangs on a stalled Supabase call — if
    // getSession() throws or takes too long, we just boot as signed-out.
    const settle = () => { this._isReady.set(true); this._readyResolver(); };
    const watchdog = setTimeout(() => {
      if (!this._isReady()) {
        console.warn('[auth] session restore timed out; booting as signed-out');
        settle();
      }
    }, 4000);

    // Restore from OUR persisted tokens first (survives SDK setSession hangs).
    // Falls back to the SDK's storage if we have nothing of our own.
    const stored = this.restorePersistedSession();
    const restore = stored
      ? (async () => { this._session.set(stored); await this.loadProfile(); })()
      : supabase.auth.getSession().then(async ({ data }) => {
          this._session.set(data.session ?? null);
          if (data.session) await this.loadProfile();
        });
    restore
      .catch(err => console.error('[auth] session restore failed', err))
      .finally(() => { clearTimeout(watchdog); settle(); });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      // Only ADOPT a real SDK session (e.g. a successful background refresh).
      // Ignore null/SIGNED_OUT events: our session is owned locally (custom
      // login + persisted tokens) and signOut() clears it explicitly — letting
      // the SDK's empty state null us out would sign the user out on boot.
      if (session) {
        // Multi-account guard: after a profile switch the SDK's storage can
        // still hold the PREVIOUS account and background-refresh it — blindly
        // adopting that session silently switches the user back. Only adopt
        // when it belongs to the same auth user as our locally-owned session.
        const mySub = AuthService.jwtSub(this._session()?.access_token ?? '');
        const sdkSub = AuthService.jwtSub(session.access_token);
        if (mySub && sdkSub && mySub !== sdkSub) {
          return; // stale SDK session from another profile — ours is authoritative
        }
        this._session.set(session);
        this.persistSession(session);
        await this.loadProfile();
      }
    });

    // Stale-permission refresh: re-pull the profile when the app comes back
    // to the foreground after sitting idle (see refreshProfileIfStale).
    try {
      window.addEventListener('focus', () => this.refreshProfileIfStale());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.refreshProfileIfStale();
      });
    } catch { /* SSR/native guard */ }
  }

  waitForAuth(): Promise<void> {
    return this._ready;
  }

  /** Auth user id (sub claim) from a JWT — used to tell profiles apart when
   *  reconciling our locally-owned session with the SDK's. Null on any parse
   *  failure so callers fail open (treat as "unknown", not "different"). */
  private static jwtSub(token: string): string | null {
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
   * Permission check with mode-aware suppression. Same as hasPermission for
   * everything except `collect_sample` in dedicated-counter mode: the
   * Receptionist role keeps the seeded perm so an admin can flip the branch
   * back to front-desk collection without a re-seed, but in dedicated mode
   * the FD counter doesn't draw samples — only the dedicated counter does.
   * Users who hold collect_sample via Sample Collector / Lab Tech / Lab Admin
   * roles still pass.
   */
  hasEffectivePermission(code: string): boolean {
    // Suppress FD collection only when collection runs at a dedicated counter and
    // is NOT also placed at the front desk (multi-placement: if FD collects too,
    // reception keeps the perm).
    if (code === 'collect_sample' && this.labCfg.hasDedicatedCollection() && !this.labCfg.collectsAtFrontdesk()) {
      const roles = this._user()?.roles ?? [];
      const otherCollectorRole =
        roles.includes('Sample Collector') ||
        roles.includes('Lab Technician')   ||
        roles.includes('Lab Admin');
      if (roles.includes('Receptionist') && !otherCollectorRole) return false;
    }
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

    // Publish to the SDK so refresh + onAuthStateChange keep working (non-fatal).
    try {
      await Promise.race([
        supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('setSession timed out')), 2000)),
      ]);
    } catch { console.warn('[auth] setSession hung — continuing with local session'); }

    this._session.set(session);
    this.persistSession(session);   // survive cold start regardless of the SDK
    this._mustChangePassword.set(!!data.mustChangePassword);
    this.rememberOrg(data.tenant?.name ?? org);
    // A fresh credential sign-in supersedes any leftover idle-lock from a prior
    // session on this device — otherwise the user is greeted by a PIN gate the
    // instant they log in (and a PIN-less user could be stranded). Clear the
    // persisted key AND tell the LockService to drop its in-memory lock (its
    // _locked signal was seeded at construction, before this login).
    try { localStorage.removeItem('pf.lockedAt'); } catch { /* ignore */ }
    try { window.dispatchEvent(new Event('pf:fresh-signin')); } catch { /* ignore */ }
    await this.loadProfile();
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
   * Bypass-the-SDK sign-in path. POSTs directly to Supabase's token endpoint
   * with an AbortController so it can never outrun the caller's timeout. If
   * this fetch also hangs the problem is network-level (extension blocking
   * *.supabase.co, corporate proxy, DNS) — the error message says so.
   */
  private async directTokenFetch(email: string, password: string, ms: number): Promise<Session> {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), ms);
    try {
      const url = `${environment.auth.supabaseUrl}/auth/v1/token?grant_type=password`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': environment.auth.supabaseAnonKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password }),
        cache: 'no-store',
        signal: ctrl.signal
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supabase rejected sign-in (${res.status}): ${body}`);
      }
      return await res.json() as Session;
    } catch (e: unknown) {
      if ((e as Error).name === 'AbortError') {
        throw new Error(
          "Can't reach Supabase auth — a browser extension, ad blocker, or corporate proxy is probably blocking *.supabase.co. Try an Incognito window to confirm."
        );
      }
      throw e;
    } finally {
      clearTimeout(killer);
    }
  }

  async signOut(): Promise<void> {
    // Remove ONLY the active profile from the device registry — other signed-in
    // accounts stay so their owners can still switch in with their PIN.
    const activeId = this.accounts.activeUserId();
    if (activeId) this.accounts.remove(activeId);
    this.persistSession(null);   // clear our stored tokens
    this._session.set(null);
    this._user.set(null);
    try { await supabase.auth.signOut(); } catch { /* SDK may hang on native — already cleared locally */ }
  }

  // ── Multi-account switching + PIN (shared lab machines) ──────────────

  /** Switch to another signed-in profile. Two proofs are required: this
   *  device must hold a live session for the target (its refresh token still
   *  exchanges), AND the person must know that account's PIN (verified
   *  server-side, rate-limited). Throws with a user-readable message. */
  async switchAccount(acc: StoredAccount, pin: string): Promise<void> {
    if (!acc.refreshToken) throw new Error('This profile’s session has expired — sign in again.');
    const sess = await this.exchangeRefreshToken(acc.refreshToken);
    if (!sess) {
      // Dead session: drop the stale profile so the switcher stops offering it.
      this.accounts.remove(acc.userId);
      throw new Error('This profile’s session has expired — sign in again.');
    }
    // Supabase rotated the refresh token — save it even if the PIN fails,
    // otherwise the stored one is dead and the profile bricks.
    this.accounts.updateTokens(acc.userId, sess.access_token, sess.refresh_token!);

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

    // Point the SDK's own storage at the NEW profile too — otherwise it keeps
    // background-refreshing the previous account and (on the next boot) would
    // try to clobber the switch. Non-fatal: the onAuthStateChange sub-guard
    // also refuses cross-profile adoption if this hangs.
    try {
      await Promise.race([
        supabase.auth.setSession({ access_token: sess.access_token, refresh_token: sess.refresh_token! }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('setSession timed out')), 2000)),
      ]);
    } catch { console.warn('[auth] setSession hung during switch — continuing with local session'); }

    this._session.set(sess);
    this.persistSession(sess);
    this.accounts.setActive(acc.userId);
    this._mustChangePassword.set(false);
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

  async getAccessToken(): Promise<string | null> {
    // Prefer the session we set locally via directTokenFetch — the SDK's
    // getSession() occasionally hangs on cold starts waiting on the Web-Locks
    // refresh flow. Fall back to SDK only if we haven't cached one yet.
    const local = this._session()?.access_token;
    // On a cold launch the cached token is often expired; hand SignalR an
    // expired token and the hub handshake 401s and the call silently drops.
    // Refresh first when it's expired/near-expiry.
    if (local && this.isExpiringSoon(local)) {
      if (await this.refreshAccessToken()) return this._session()?.access_token ?? local;
      return local; // refresh failed — return what we have rather than nothing
    }
    if (local) return local;
    try {
      const { data } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('getSession timed out')), 1500))
      ]);
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  /** True if the JWT is expired or within 60s of expiring. */
  private isExpiringSoon(jwt: string, skewMs = 60_000): boolean {
    try {
      const exp = (JSON.parse(atob(jwt.split('.')[1])).exp as number) * 1000;
      return Date.now() >= exp - skewMs;
    } catch { return true; }
  }

  private async loadProfile(retried = false): Promise<void> {
    const token = await this.getAccessToken();
    if (!token) { this._user.set(null); return; }

    try {
      // no-store to stop Chrome's HTTP cache from serving a stale 401 from a
      // previous (signed-out) session — that used to leave the login button
      // stuck on "Signing in…" whenever DevTools was closed (DevTools auto-
      // disables the cache, which is why it worked with inspect open).
      const res = await fetch(`${environment.apiUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!res.ok) {
        // 401 on a restored session usually means the cached access token
        // expired (they're ~1h). Refresh once with the stored refresh token,
        // then retry — so the user stays logged in across longer gaps instead
        // of being bounced to the login screen.
        if (res.status === 401 && !retried && await this.refreshAccessToken()) {
          return this.loadProfile(true);
        }
        // Couldn't authenticate — sign out cleanly (clears persisted tokens).
        await this.signOut();
        return;
      }
      const json = await res.json();
      const data: MeResponse | undefined = json?.data;
      if (!data) { this._user.set(null); return; }

      this._user.set({
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
        subBranchId: data.subBranchId ?? null,
        subBranchName: data.subBranchName ?? null,
        roles: data.roles ?? [],
        permissions: data.permissions ?? [],
        branches: data.branches ?? [],
        // OPD build: module scope from the backend; older servers omit it →
        // default ['lab'] so the front-desk fork stays lab-only.
        modules: data.modules ?? ['lab'],
        hasPin: data.hasPin ?? false,
        signatureDataUrl: data.signatureDataUrl ?? undefined,
        registrationId: data.registrationId ?? undefined
      });
      this._lastProfileLoadedAt = Date.now();

      // Sync the multi-account registry: this profile is now the device's
      // active account, with its current tokens and display info.
      const sess = this._session();
      if (sess?.access_token) {
        this.accounts.upsert({
          userId: data.id,
          org: data.tenantName,
          tenantId: data.tenantId,
          displayName: data.displayName || [data.firstName, data.fathersName].filter(Boolean).join(' '),
          email: data.email,
          accessToken: sess.access_token,
          refreshToken: sess.refresh_token ?? '',
          hasPin: data.hasPin ?? false,
          addedAt: new Date().toISOString(),
        });
        this.accounts.setActive(data.id);
      }

      // Seed / validate the active branch against what this user may access.
      // Clear a stale stored branch so the header doesn't send a rejected id.
      const branches = data.branches ?? [];
      const stored = this._activeBranchId();
      if (!stored || !branches.some(b => b.id === stored)) {
        this._activeBranchId.set(data.branchId);
        try { localStorage.setItem(AuthService.ACTIVE_BRANCH_KEY, data.branchId); } catch { /* private mode */ }
      }
    } catch {
      this._user.set(null);
    }
  }
}
