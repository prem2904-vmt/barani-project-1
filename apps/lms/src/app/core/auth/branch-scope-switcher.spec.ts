import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { isBranchRefused } from './auth.interceptor';
import { BranchLabConfigService } from '../services/branch-lab-config.service';

/**
 * Strict branch access (owner, 2026-09-27): "If a user is applicable to only
 * two branches, only those two branches are visible to that user." The
 * avatar-menu switcher (top strip + bottom nav) lists `auth.user().branches`
 * — exactly what /me returns — and the active branch can never be set to a
 * branch outside it. A stale stored id is reset to the default; a server
 * 403 branch_not_permitted drops it and re-pulls /me.
 */
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
const jwt = (sub: string) => `${b64({ alg: 'none' })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CHN = { id: 'chn', name: 'Chennai Main' };
const SLM = { id: 'slm', name: 'Salem' };
const MDU = { id: 'mdu', name: 'Madurai' };

function setup(me: { branchId: string; branches: { id: string; name: string }[] }, storedBranch: string | null) {
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
  mem.set('pf.session', JSON.stringify({ access_token: jwt('sub-1'), refresh_token: 'rt' }));
  if (storedBranch) mem.set('pf.activeBranch', storedBranch);
  const meCalls: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/auth/me')) {
      meCalls.push(1);
      return json(200, { success: true, data: { id: 'u1', authId: 'sub-1', tenantId: 't1', tenantName: 'Micro World',
        branchId: me.branchId, roles: [], permissions: [], branches: me.branches } });
    }
    return json(404, {});
  }));
  TestBed.configureTestingModule({
    providers: [{ provide: BranchLabConfigService, useValue: { hasDedicatedCollection: () => false, collectsAtFrontdesk: () => true } }],
  });
  const auth = TestBed.inject(AuthService);
  return { auth, mem, meCalls };
}

afterEach(() => vi.unstubAllGlobals());

describe('Branch switcher shows only the assigned branches', () => {
  it('a two-branch user is offered exactly those two; a third cannot be selected', async () => {
    const { auth, mem } = setup({ branchId: SLM.id, branches: [CHN, SLM] }, null);
    await auth.waitForAuth();
    expect((auth.user()!.branches ?? []).map(b => b.id)).toEqual(['chn', 'slm']);
    expect(auth.activeBranchId()).toBe('slm');                   // default = first assigned (server's pick)
    auth.setActiveBranch(MDU.id);
    expect(auth.activeBranchId()).toBe('slm');                   // refused client-side too
    expect(mem.get('pf.activeBranch')).toBe('slm');
  });

  it('a one-branch user (Priya, Chennai Main) sees one branch — no switcher', async () => {
    const { auth } = setup({ branchId: CHN.id, branches: [CHN] }, null);
    await auth.waitForAuth();
    expect((auth.user()!.branches ?? [])).toEqual([CHN]);
    expect((auth.user()!.branches ?? []).length > 1).toBe(false);        // canSwitchBranch
    expect(auth.activeBranch()).toEqual(CHN);
  });

  it('a stale stored branch outside the set is reset to the default on load', async () => {
    const { auth, mem } = setup({ branchId: CHN.id, branches: [CHN, SLM] }, MDU.id);
    await auth.waitForAuth();
    expect(auth.activeBranchId()).toBe('chn');
    expect(mem.get('pf.activeBranch')).toBe('chn');
  });

  it('a server refusal (403 branch_not_permitted) drops the active branch and re-pulls /me', async () => {
    const { auth, meCalls } = setup({ branchId: CHN.id, branches: [CHN, SLM] }, SLM.id);
    await auth.waitForAuth();
    expect(auth.activeBranchId()).toBe('slm');
    const before = meCalls.length;
    auth.dropActiveBranch();
    expect(auth.activeBranchId()).toBeNull();                    // retry goes out with no header
    await vi.waitFor(() => expect(meCalls.length).toBe(before + 1));
    await vi.waitFor(() => expect(auth.activeBranchId()).toBe('chn'));
  });
});

describe('isBranchRefused', () => {
  it('matches only the branch 403', () => {
    expect(isBranchRefused(new HttpErrorResponse({ status: 403, error: { success: false, error: 'branch_not_permitted' } }))).toBe(true);
    expect(isBranchRefused(new HttpErrorResponse({ status: 403, error: { success: false, error: 'forbidden' } }))).toBe(false);
    expect(isBranchRefused(new HttpErrorResponse({ status: 401, error: { error: 'branch_not_permitted' } }))).toBe(false);
    expect(isBranchRefused(new Error('x'))).toBe(false);
  });
});
