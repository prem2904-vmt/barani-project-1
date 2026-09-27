import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { AccountsService, StoredAccount } from './accounts.service';
import { BranchLabConfigService } from '../services/branch-lab-config.service';

/**
 * Account switch from the avatar menu (owner 2026-09-27: switching Frontdesk
 * → Admin said "This profile's session has expired — sign in again" and the
 * profile vanished). The switch must:
 *  - use a still-valid saved session without rotating anything;
 *  - treat ONLY a rejected refresh token as expired — keep the profile,
 *    flag it, and offer sign-in (never a silent removal);
 *  - treat network failures as retryable;
 *  - never half-switch: a saved session that belongs to someone else is
 *    refused before any state changes.
 * And the registry never writes a stale (already-rotated) token back.
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string, expInSec = 3600) => `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + expInSec })}.sig`;

const FD = { id: 'app-fd', sub: 'sub-fd' };
const ADMIN = { id: 'app-admin', sub: 'sub-admin' };
const row = (who: { id: string }, accessToken: string, refreshToken: string, extra: Partial<StoredAccount> = {}): StoredAccount => ({
  userId: who.id, org: 'Micro World', tenantId: 't1', displayName: who === ADMIN ? 'Admin User' : 'Frontdesk',
  email: `${who.id}@t1.tenant.prefrontal`, accessToken, refreshToken, hasPin: true, addedAt: '', ...extra,
});

type Route = (url: string, init?: RequestInit) => Promise<Response> | Response | null;
const subOf = (token: string): string | null => {
  try { return JSON.parse(atob(token.split('.')[1])).sub ?? null; } catch { return null; }
};
const PROFILES: Record<string, { id: string; displayName: string }> = {
  [FD.sub]: { id: FD.id, displayName: 'Frontdesk' },
  [ADMIN.sub]: { id: ADMIN.id, displayName: 'Admin User' },
};
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(accounts: StoredAccount[], route: Route) {
  const mem = new Map<string, string>();
  const store = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(), key: (i: number) => Array.from(mem.keys())[i] ?? null,
    get length() { return mem.size; },
  };
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', { ...store, getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  mem.set('pf.accounts', JSON.stringify(accounts));
  mem.set('pf.activeAccount', FD.id);
  mem.set('pf.session', JSON.stringify({ access_token: jwt(FD.sub), refresh_token: 'rt-fd' }));
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url.replace(/^https?:\/\/[^/]+/, ''));
    const custom = await route(url, init);
    if (custom) return custom;
    if (url.includes('/api/auth/me')) {
      const auth = new Headers(init?.headers).get('Authorization') ?? '';
      const p = PROFILES[subOf(auth.replace(/^Bearer\s+/, '')) ?? ''];
      if (!p) return json(401, {});
      return json(200, { success: true, data: { ...p, authId: Object.keys(PROFILES).find(k => PROFILES[k] === p),
        tenantId: 't1', tenantName: 'Micro World', branchId: 'b1', roles: [], permissions: [], branches: [] } });
    }
    return json(404, {});
  }));
  TestBed.configureTestingModule({
    providers: [{ provide: BranchLabConfigService, useValue: { hasDedicatedCollection: () => false, collectsAtFrontdesk: () => true } }],
  });
  const auth = TestBed.inject(AuthService);
  const acc = TestBed.inject(AccountsService);
  return { auth, acc, calls, mem, ready: () => auth.waitForAuth() };
}

afterEach(() => vi.unstubAllGlobals());

describe('AuthService.switchAccount', () => {
  it('a still-valid saved session switches WITHOUT a token exchange (nothing rotated)', async () => {
    const adminAccess = jwt(ADMIN.sub);
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, adminAccess, 'rt-admin')], (url) => {
      if (url.includes('/api/auth/pin/verify')) return json(200, { success: true });
      return null;
    });
    await t.ready(); t.calls.length = 0;
    await t.auth.switchAccount(t.acc.fresh(ADMIN.id)!, '1234');
    expect(t.calls.some(c => c.includes('/auth/v1/token'))).toBe(false);
    expect(t.auth.session()?.access_token).toBe(adminAccess);
    expect(t.auth.user()?.id).toBe(ADMIN.id);
  });

  it('a REJECTED refresh token keeps the profile (flagged) and leaves the current account untouched', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, jwt(ADMIN.sub, -60), 'rt-admin-dead')], (url) => {
      if (url.includes('/auth/v1/token')) return json(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
      return null;
    });
    await t.ready(); t.calls.length = 0;
    await expect(t.auth.switchAccount(t.acc.fresh(ADMIN.id)!, '1234')).rejects.toMatchObject({ code: 'session_expired' });
    const admin = t.acc.fresh(ADMIN.id)!;
    expect(admin).not.toBeNull();                      // NOT removed any more
    expect(admin.expired).toBe(true);                  // → "Sign in as Admin"
    expect(t.auth.user()?.id).toBe(FD.id);             // no half-switch
    expect(t.auth.session()?.refresh_token).toBe('rt-fd');
  });

  it('a network failure is retryable — the profile is neither removed nor expired', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, jwt(ADMIN.sub, -60), 'rt-admin')], (url) => {
      if (url.includes('/auth/v1/token')) throw new TypeError('Failed to fetch');
      return null;
    });
    await t.ready(); t.calls.length = 0;
    await expect(t.auth.switchAccount(t.acc.fresh(ADMIN.id)!, '1234')).rejects.toMatchObject({ code: 'network' });
    expect(t.acc.fresh(ADMIN.id)!.expired).toBeFalsy();
    expect(t.auth.user()?.id).toBe(FD.id);
  });

  it('a saved session that belongs to SOMEONE ELSE is refused before any state changes', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, jwt(FD.sub), 'rt-fd-copy')], (url) => {
      return null;
    });
    await t.ready(); t.calls.length = 0;
    await expect(t.auth.switchAccount(t.acc.fresh(ADMIN.id)!, '1234')).rejects.toMatchObject({ code: 'session_mismatch' });
    expect(t.calls.some(c => c.includes('/pin/verify'))).toBe(false);
    expect(t.auth.user()?.id).toBe(FD.id);
    expect(t.acc.fresh(ADMIN.id)!.expired).toBe(true);
  });

  it('an expired access token is exchanged and the rotated refresh token is saved even if the PIN is wrong', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, jwt(ADMIN.sub, -60), 'rt-admin-1')], (url) => {
      if (url.includes('/auth/v1/token')) return json(200, { access_token: jwt(ADMIN.sub), refresh_token: 'rt-admin-2' });
      if (url.includes('/pin/verify')) return json(401, { success: false, error: { code: 'wrong_pin', message: 'Incorrect PIN.' } });
      return null;
    });
    await t.ready(); t.calls.length = 0;
    await expect(t.auth.switchAccount(t.acc.fresh(ADMIN.id)!, '0000')).rejects.toMatchObject({ code: 'wrong_pin' });
    expect(t.acc.fresh(ADMIN.id)!.refreshToken).toBe('rt-admin-2');
    expect(t.auth.user()?.id).toBe(FD.id);
  });
});

describe('AccountsService registry', () => {
  it('never writes a stale in-memory token back over another tab\'s rotation', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd'), row(ADMIN, 'a2', 'rt-admin-1')], () => null);
    await t.ready();
    // Another tab rotates Admin's refresh token (writes storage directly).
    const other = JSON.parse(t.mem.get('pf.accounts')!) as StoredAccount[];
    other.find(a => a.userId === ADMIN.id)!.refreshToken = 'rt-admin-2';
    t.mem.set('pf.accounts', JSON.stringify(other));
    // This tab (stale in-memory copy) edits an unrelated field.
    t.acc.setHasPin(FD.id, false);
    expect(t.acc.fresh(ADMIN.id)!.refreshToken).toBe('rt-admin-2');
  });

  it('refresh adopts a newer token another tab already rotated for the same account (no reuse)', async () => {
    const t = setup([row(FD, jwt(FD.sub), 'rt-fd')], (url) => (url.includes('/auth/v1/token') ? json(500, {}) : null));
    await t.ready(); t.calls.length = 0;
    // This tab's in-memory session went stale…
    (t.auth as unknown as { _session: { set(v: unknown): void } })._session.set({ access_token: jwt(FD.sub, -60), refresh_token: 'rt-fd-1' });
    // …while another tab of the same account already rotated it.
    const newer = jwt(FD.sub);
    const list = JSON.parse(t.mem.get('pf.accounts')!) as StoredAccount[];
    Object.assign(list.find(a => a.userId === FD.id)!, { accessToken: newer, refreshToken: 'rt-fd-2' });
    t.mem.set('pf.accounts', JSON.stringify(list));
    await expect(t.auth.refreshAccessToken()).resolves.toBe(true);
    expect(t.calls.some(c => c.includes('/auth/v1/token'))).toBe(false);   // no reuse of rt-fd-1
    expect(t.auth.session()?.refresh_token).toBe('rt-fd-2');
  });
});
