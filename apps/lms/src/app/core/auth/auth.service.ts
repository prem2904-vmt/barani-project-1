import { Injectable, computed, signal } from '@angular/core';
import { createClient, Session, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { CurrentUser, MOCK_USER } from './mock-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _supabase: SupabaseClient | null;
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

  constructor() {
    if (environment.auth.bypass || !environment.supabase.url || environment.supabase.url.includes('placeholder')) {
      this._supabase = null;
      this._user.set(MOCK_USER);
      this._isReady.set(true);
      this._readyResolver();
      return;
    }

    this._supabase = createClient(environment.supabase.url, environment.supabase.anonKey);

    this._supabase.auth.getSession().then(({ data }) => {
      this._session.set(data.session);
      this._user.set(this.toCurrentUser(data.session));
      this._isReady.set(true);
      this._readyResolver();
    });

    this._supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
      this._user.set(this.toCurrentUser(session));
    });
  }

  waitForAuth(): Promise<void> {
    return this._ready;
  }

  hasPermission(code: string): boolean {
    const perms = this._user()?.permissions ?? [];
    return perms.includes('*') || perms.includes(code);
  }

  async loginWithPassword(email: string, password: string) {
    if (!this._supabase) throw new Error('Supabase not configured');
    return this._supabase.auth.signInWithPassword({ email, password });
  }

  async logout() {
    if (!this._supabase) return;
    await this._supabase.auth.signOut();
    this._user.set(null);
  }

  private toCurrentUser(session: Session | null): CurrentUser | null {
    if (!session?.user) return null;
    const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: session.user.id,
      name: (meta['name'] as string) ?? session.user.email ?? 'User',
      email: session.user.email ?? undefined,
      tenantId: (meta['tenant_id'] as string) ?? '',
      branchId: (meta['branch_id'] as string) ?? '',
      tenantName: (meta['tenant_name'] as string) ?? '',
      branchName: (meta['branch_name'] as string) ?? '',
      permissions: ((meta['permissions'] as string[]) ?? [])
    };
  }
}
