import { Injectable, signal } from '@angular/core';

/** Who the app is acting as right now. `null` = signed out. */
export interface SessionIdentity {
  /** App user id (UserEntity.Id — what the accounts registry keys on). */
  userId: string;
  tenantId: string;
  /** Supabase sub — the id SignalR and chat use. */
  authId?: string | null;
}

export interface SessionChange {
  prev: SessionIdentity | null;
  next: SessionIdentity | null;
}

/**
 * ONE "session changed" event for every user-scoped service (Messages RCA
 * 2026-09-27). Root singletons (chat / signaling / calls / windows / presence /
 * pop-ups / sounds) outlive an in-place identity change — "Add account" signs
 * the new person in WITHOUT a page reload — so each registers a reset here
 * instead of every screen doing ad-hoc cleanup.
 *
 * AuthService calls {@link changed} synchronously BEFORE it publishes the new
 * user, so by the time anything reacts to `auth.user()` the old account's
 * sockets, stores and timers are already gone.
 *
 * Deliberately dependency-free (no AuthService import) so any service can
 * inject it without a DI cycle.
 */
@Injectable({ providedIn: 'root' })
export class SessionScopeService {
  private readonly _identity = signal<SessionIdentity | null>(null);
  readonly identity = this._identity.asReadonly();
  private readonly handlers = new Set<(c: SessionChange) => void>();

  /** Stable per-account namespace: `<tenantId>:<userId>` or `anon`. */
  scopeKey(id: SessionIdentity | null = this._identity()): string {
    return id ? `${id.tenantId || 'no-tenant'}:${id.userId}` : 'anon';
  }

  /** Namespace a persistent storage key by tenant + user. */
  storageKey(base: string, id: SessionIdentity | null = this._identity()): string {
    return `${base}:${this.scopeKey(id)}`;
  }

  /** Register a reset. Returns the unregister function. */
  onChange(fn: (c: SessionChange) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  /** Publish the active identity. No-op when it is the same account; runs
   *  every handler synchronously otherwise (errors are isolated so one bad
   *  handler can't leave the rest of the app on the old account). */
  changed(next: SessionIdentity | null): void {
    const prev = this._identity();
    if (SessionScopeService.same(prev, next)) {
      // Same person — just refresh details like authId without a reset.
      if (next) this._identity.set(next);
      return;
    }
    this._identity.set(next);
    const change: SessionChange = { prev, next };
    for (const fn of Array.from(this.handlers)) {
      try { fn(change); } catch (e) { console.error('[session-scope] reset handler failed', e); }
    }
  }

  private static same(a: SessionIdentity | null, b: SessionIdentity | null): boolean {
    if (!a || !b) return a === b;
    return a.userId === b.userId && (a.tenantId || '') === (b.tenantId || '');
  }
}
