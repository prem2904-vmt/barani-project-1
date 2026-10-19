import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/** Owner bug (2026-09-27, strict-isolation tenant): "we put a patient for a
 *  test in the Salem branch, but it is reflecting in the Trichy branch." The
 *  front desk's Drafts (In progress tab + the app-bar draft shelf) scanned
 *  EVERY `pf:order-draft:*` key in the browser, so a cart parked in Salem was
 *  listed in Trichy after a branch switch. Only the active branch's drafts
 *  (plus legacy ones, in the user's default branch) may list. */
class ListStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}

const d = (pid: string, extra: object = {}) =>
  JSON.stringify({ savedAt: Date.now(), priority: 'Normal', testIds: ['t1'], patient: { id: pid, tenantId: 'ten1' }, ...extra });

const listFor = (active: string) => {
  const fake = { auth: { activeBranchId: () => active, user: () => ({ tenantId: 'ten1', branchId: 'bSalem' }) } };
  return ((FrontdeskLandingComponent.prototype as any).loadDrafts.call(fake) as Array<{ patientId: string; key: string }>)
    .map(x => x.patientId).sort();
};

describe('Frontdesk Drafts — only the active branch\'s parked carts', () => {
  let store: ListStorage;
  beforeEach(() => {
    store = new ListStorage();
    vi.stubGlobal('localStorage', store);
    store.setItem('pf:order-draft:bSalem:pSalem', d('pSalem', { branchId: 'bSalem' }));
    store.setItem('pf:order-draft:bTrichy:pTrichy', d('pTrichy', { branchId: 'bTrichy' }));
    store.setItem('pf:order-draft:pLegacy', d('pLegacy'));
    store.setItem('pf:order-draft:bSalem:pOther', JSON.stringify({ savedAt: Date.now(), testIds: ['t1'], tenantId: 'ten2', patient: { id: 'pOther' } }));
    store.setItem('pf:order-draft:pending-registration', JSON.stringify({ testIds: ['t1'] }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Trichy lists only Trichy's draft — never Salem's", () => {
    expect(listFor('bTrichy')).toEqual(['pTrichy']);
  });

  it("Salem lists its own draft plus the legacy (pre-scope) one; never another tenant's", () => {
    expect(listFor('bSalem')).toEqual(['pLegacy', 'pSalem']);
  });
});
