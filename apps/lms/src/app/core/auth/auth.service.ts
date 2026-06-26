import { Injectable, computed, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { BranchLabConfigService } from '../services/branch-lab-config.service';
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
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly labCfg = inject(BranchLabConfigService);

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
  /** Exchange the stored refresh token for a fresh access token, straight
   *  against Supabase's token endpoint (the SDK refresh flow hangs on native).
   *  Updates + persists the session. Returns false if there's no refresh token
   *  or the exchange fails. */
  private async refreshAccessToken(): Promise<boolean> {
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
      return true;
    } catch { return false; }
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
        this._session.set(session);
        this.persistSession(session);
        await this.loadProfile();
      }
    });
  }

  waitForAuth(): Promise<void> {
    return this._ready;
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
  async signIn(org: string, username: string, password: string): Promise<void> {
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
    this.persistSession(null);   // clear our stored tokens
    this._session.set(null);
    this._user.set(null);
    try { await supabase.auth.signOut(); } catch { /* SDK may hang on native — already cleared locally */ }
  }

  async getAccessToken(): Promise<string | null> {
    // Prefer the session we set locally via directTokenFetch — the SDK's
    // getSession() occasionally hangs on cold starts waiting on the Web-Locks
    // refresh flow. Fall back to SDK only if we haven't cached one yet.
    const local = this._session()?.access_token;
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
        branches: data.branches ?? []
      });

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
