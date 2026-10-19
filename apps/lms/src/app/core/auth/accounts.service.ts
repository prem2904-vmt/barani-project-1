import { Injectable, signal } from '@angular/core';

/** One signed-in profile kept on this device (shared lab machine). Tokens stay
 *  per-account so switching never re-asks for the password — the PIN (verified
 *  server-side against a session for the SAME account) gates the switch. */
export interface StoredAccount {
  userId: string;
  org: string;          // tenant name — what the user types to sign in
  tenantId?: string;
  displayName: string;
  email: string;
  username?: string | null;
  accessToken: string;
  refreshToken: string;
  hasPin: boolean;
  addedAt: string;
  /** The saved refresh token was rejected by the auth server (revoked /
   *  reused). The profile stays listed so its owner can SIGN IN AGAIN from
   *  the switcher instead of the profile silently vanishing. */
  expired?: boolean;
}

/** Pure storage for the Gmail-style multi-account registry (localStorage).
 *  Orchestration (switching, PIN verify) lives in AuthService — this service
 *  deliberately has no dependencies so it can't create injection cycles. */
@Injectable({ providedIn: 'root' })
export class AccountsService {
  private static readonly ACCOUNTS_KEY = 'pf.accounts';
  private static readonly ACTIVE_KEY = 'pf.activeAccount';

  private readonly _accounts = signal<StoredAccount[]>(AccountsService.load());
  readonly accounts = this._accounts.asReadonly();

  constructor() {
    // Other tabs rotate tokens too: keep this tab's copy in sync so it never
    // writes a stale (already-rotated, i.e. revoked) refresh token back.
    try {
      window.addEventListener('storage', (e) => {
        if (e.key === null || e.key === AccountsService.ACCOUNTS_KEY) this._accounts.set(AccountsService.load());
      });
    } catch { /* SSR */ }
  }

  private static load(): StoredAccount[] {
    try {
      const raw = localStorage.getItem(AccountsService.ACCOUNTS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }

  private persist(list: StoredAccount[]): void {
    this._accounts.set(list);
    try { localStorage.setItem(AccountsService.ACCOUNTS_KEY, JSON.stringify(list)); } catch { /* private mode */ }
  }

  /** Read-modify-write against the CURRENT stored list (not this tab's
   *  possibly stale in-memory copy). A tab that wrote its old snapshot back
   *  used to restore an already-rotated refresh token for another profile —
   *  Supabase treats that token as revoked, so switching to that profile
   *  later failed with "session expired" (RCA 2026-09-27). */
  private mutate(fn: (list: StoredAccount[]) => StoredAccount[]): void {
    this.persist(fn(AccountsService.load()));
  }

  /** The freshest stored row for a profile (straight from storage). */
  fresh(userId: string): StoredAccount | null {
    return AccountsService.load().find((a) => a.userId === userId) ?? null;
  }

  activeUserId(): string | null {
    try { return localStorage.getItem(AccountsService.ACTIVE_KEY); } catch { return null; }
  }
  setActive(userId: string): void {
    try { localStorage.setItem(AccountsService.ACTIVE_KEY, userId); } catch { /* private mode */ }
  }

  active(): StoredAccount | null {
    const id = this.activeUserId();
    return this._accounts().find((a) => a.userId === id) ?? null;
  }

  /** Everyone except the active profile — the switcher list. */
  others(): StoredAccount[] {
    const id = this.activeUserId();
    return this._accounts().filter((a) => a.userId !== id);
  }

  upsert(acc: StoredAccount): void {
    // Cap for a shared machine — sized for a full lab shift; the switcher
    // list scrolls, so a big roster stays usable. Oldest profile drops first.
    const { expired: _drop, ...clean } = acc;
    this.mutate((list) => [clean, ...list.filter((a) => a.userId !== acc.userId)].slice(0, 25));
  }

  /** Keep a profile's tokens fresh (after refresh grants) without other edits. */
  updateTokens(userId: string, accessToken: string, refreshToken: string): void {
    this.mutate((list) => list.map((a) =>
      a.userId === userId ? { ...a, accessToken, refreshToken, expired: false } : a));
  }

  /** The profile's saved sign-in is dead — keep it listed, flagged. */
  markExpired(userId: string): void {
    this.mutate((list) => list.map((a) => (a.userId === userId ? { ...a, expired: true } : a)));
  }

  setHasPin(userId: string, hasPin: boolean): void {
    this.mutate((list) => list.map((a) => (a.userId === userId ? { ...a, hasPin } : a)));
  }

  remove(userId: string): void {
    this.mutate((list) => list.filter((a) => a.userId !== userId));
    if (this.activeUserId() === userId) {
      try { localStorage.removeItem(AccountsService.ACTIVE_KEY); } catch { /* */ }
    }
  }

  initials(a: Pick<StoredAccount, 'displayName'>): string {
    return (a.displayName || '?')
      .split(/\s+/).filter(Boolean).slice(0, 2)
      .map((w) => w[0]!.toUpperCase()).join('') || '?';
  }
}
