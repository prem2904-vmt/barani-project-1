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
    const list = this._accounts().filter((a) => a.userId !== acc.userId);
    this.persist([acc, ...list].slice(0, 8)); // sanity cap for a shared machine
  }

  /** Keep a profile's tokens fresh (after refresh grants) without other edits. */
  updateTokens(userId: string, accessToken: string, refreshToken: string): void {
    this.persist(this._accounts().map((a) =>
      a.userId === userId ? { ...a, accessToken, refreshToken } : a));
  }

  setHasPin(userId: string, hasPin: boolean): void {
    this.persist(this._accounts().map((a) => (a.userId === userId ? { ...a, hasPin } : a)));
  }

  remove(userId: string): void {
    this.persist(this._accounts().filter((a) => a.userId !== userId));
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
