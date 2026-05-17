import { Injectable, computed, inject, signal } from '@angular/core';
import { Session } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { BranchLabConfigService } from '../services/branch-lab-config.service';
import { CurrentUser } from './mock-user';
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

  constructor() {
    // Restore session on startup and subscribe to auth changes. A 3s watchdog
    // guarantees the auth guard never hangs on a stalled Supabase call — if
    // getSession() throws or takes too long, we just boot as signed-out.
    const settle = () => { this._isReady.set(true); this._readyResolver(); };
    const watchdog = setTimeout(() => {
      if (!this._isReady()) {
        console.warn('[auth] getSession timed out; booting as signed-out');
        settle();
      }
    }, 3000);

    supabase.auth.getSession()
      .then(async ({ data }) => {
        this._session.set(data.session ?? null);
        if (data.session) {
          await this.loadProfile();
        }
      })
      .catch(err => console.error('[auth] getSession failed', err))
      .finally(() => { clearTimeout(watchdog); settle(); });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      this._session.set(session ?? null);
      if (session) {
        await this.loadProfile();
      } else {
        this._user.set(null);
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
    if (code === 'collect_sample' && this.labCfg.collectionMode() === 'dedicated_counter') {
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

  async signIn(email: string, password: string): Promise<void> {
    const timed = <T>(label: string, p: Promise<T>, ms: number): Promise<T> => Promise.race([
      p,
      new Promise<never>((_, rej) => setTimeout(
        () => rej(new Error(`${label} timed out after ${ms}ms`)),
        ms
      ))
    ]);

    // Sign-in path: direct POST to Supabase's token endpoint. The supabase-js
    // SDK's signInWithPassword was reliably hanging on cold page loads (the
    // lib spins up realtime + a Lock-based refresh pipeline that can stall),
    // and we've got a clean REST endpoint anyway. We only use the SDK to
    // publish the session via setSession so onAuthStateChange + token refresh
    // still work downstream.
    const t0 = performance.now();
    const session = await this.directTokenFetch(email, password, 6000);
    console.info('[auth] directTokenFetch', Math.round(performance.now() - t0), 'ms');

    // Publish to the SDK (non-fatal if it hangs — we already have the token).
    try {
      await timed('setSession',
        supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token
        }), 2000);
    } catch {
      console.warn('[auth] setSession hung — continuing with local session');
    }

    // Publish the session locally BEFORE calling loadProfile so it uses the
    // fast path (reads from _session signal, no SDK round-trip).
    this._session.set(session);

    const t1 = performance.now();
    await timed('loadProfile (/api/auth/me)', this.loadProfile(), 6000);
    console.info('[auth] loadProfile', Math.round(performance.now() - t1), 'ms');
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
    await supabase.auth.signOut();
    this._session.set(null);
    this._user.set(null);
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

  private async loadProfile(): Promise<void> {
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
        // Token valid but user not provisioned — sign out to force a clean login.
        await supabase.auth.signOut();
        this._user.set(null);
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
        permissions: data.permissions ?? []
      });
    } catch {
      this._user.set(null);
    }
  }
}
