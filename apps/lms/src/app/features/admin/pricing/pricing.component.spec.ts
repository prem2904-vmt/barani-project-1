import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { PricingComponent } from './pricing.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { TENANT_PRICE_SCOPE } from '../../../shared/utils/test-pricing';

/**
 * Test Master single source — phase 2: the Pricing page IS the per-tenant
 * pricing table. The DTO carries the effective price (+ priceIsDefault /
 * isOffered); every write goes through PATCH /api/tests/prices/bulk only,
 * with `branchId` when the tenant isolates branches.
 */
const tests = [
  { id: 't1', name: 'CBC', price: 300, priceIsDefault: false, department: { id: 'd1', name: 'Haematology' } },
  { id: 't2', name: 'ALT', price: 1, priceIsDefault: true, departmentId: 'd2', department: null },
  { id: 't3', name: 'AST', price: 0, priceIsDefault: false, isOffered: false, department: { id: 'd2', name: 'Biochemistry' } },
];

function make(list: any[] = tests, opts: { isolation?: boolean; active?: string; patchErr?: any } = {}) {
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? list : [])),
    patch: vi.fn(() => (opts.patchErr ? throwError(() => opts.patchErr) : of({}))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const tenant = signal<any>({ id: 'tn', branchIsolationEnabled: !!opts.isolation });
  const auth = {
    user: () => ({ branches: [{ id: 'b1', name: 'Alwarpet' }, { id: 'b2', name: 'Chennai' }] }),
    activeBranchId: () => opts.active ?? 'b1',
    hasPermission: () => true,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: auth },
      { provide: TenantStateService, useValue: { tenant, ensureLoaded: vi.fn() } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new PricingComponent());
  c.ngOnInit();
  return { c, api, toasts };
}

describe('PricingComponent — reads the pricing-table DTO', () => {
  it('loads GET /api/tests/?view=summary (effective price for the acting branch); a missing price reads as the ₹1 default', () => {
    const { c, api } = make([...tests, { id: 't9', name: 'New', department: { id: 'd1', name: 'H' } }]);
    expect(api.get).toHaveBeenCalledWith('/api/tests/?view=summary');
    const byId = Object.fromEntries(c.filtered().map(r => [r.id, r]));
    expect(byId['t1'].orig).toBe(300);
    expect(byId['t3'].orig).toBe(0);          // a real ₹0 price stays ₹0
    expect(byId['t9'].orig).toBe(1);
    expect(byId['t2'].deptId).toBe('d2');      // falls back to departmentId
  });

  it('a test still at the default is just "₹1": the row knows it (data), no "not priced" notice or count', () => {
    const { c } = make();
    const row = c.filtered().find(r => r.id === 't2')!;
    expect(row.notPriced).toBe(true);
    expect(row.orig).toBe(1);
    expect((c as any).showsNotPriced).toBeUndefined();
    expect((c as any).notPricedCount).toBeUndefined();
  });

  it('isOffered=false rows read as not offered', () => {
    const { c } = make();
    expect(c.offeredNow('t3')).toBe(false);
    expect(c.offeredNow('t1')).toBe(true);
  });
});

describe('PricingComponent — writes only through the bulk endpoint', () => {
  it('isolation OFF: save() PATCHes /api/tests/prices/bulk with ONLY the changed rows and no branchId', async () => {
    const { c, api } = make();
    c.setPrice('t1', 350.555);
    await c.save();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 350.56 }] });
    expect(c.dirtyCount()).toBe(0);
    expect(api.patch).not.toHaveBeenCalledWith(expect.stringMatching(/^\/api\/tests\/t1/), expect.anything());
  });

  it('pricing a default row clears its "not priced" flag after save', async () => {
    const { c } = make();
    c.setPrice('t2', 80);
    await c.save();
    expect(c.filtered().find(r => r.id === 't2')!.notPriced).toBe(false);
  });

  it('"Offered here" off → isOffered:false on the price row, no price sent (never a test override)', async () => {
    const { c, api } = make();
    c.setOffered('t1', false);
    expect(c.dirtyCount()).toBe(1);
    await c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', isOffered: false }] });
    expect(c.offeredNow('t1')).toBe(false);
  });

  it('setPrice clamps negatives to 0; nothing dirty → no request', async () => {
    const { c, api } = make();
    c.setPrice('t1', -5);
    expect(c.edits()['t1']).toBe(0);
    c.discard();
    await c.save();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('applyBulk changes only the filtered department', () => {
    const { c } = make();
    c.selectedDeptId.set('d1');
    c.pct.set(10);
    c.applyBulk();
    expect(c.edits()['t1']).toBe(330);
    expect(c.edits()['t3']).toBe(0);
  });

  it('a failed write toasts and keeps the edits', async () => {
    const { c, toasts } = make(tests, { patchErr: { error: { message: 'nope' } } });
    c.setPrice('t1', 400);
    await c.save();
    expect(toasts.error).toHaveBeenCalledWith('nope');
    expect(c.dirtyCount()).toBe(1);
  });
});

describe('PricingComponent — branch isolation', () => {
  it('isolation OFF → no branch picker', () => {
    const { c } = make();
    expect(c.isolationOn()).toBe(false);
  });

  it('isolation ON → picker lists "All branches" + the branches, showing the acting branch; save sends that branchId', async () => {
    const { c, api } = make(tests, { isolation: true, active: 'b2' });
    expect(c.isolationOn()).toBe(true);
    expect(c.branchOptions().map(o => o.value)).toEqual([TENANT_PRICE_SCOPE, 'b1', 'b2']);
    expect(c.scopeValue()).toBe('b2');
    c.setPrice('t1', 500);
    await c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 500 }], branchId: 'b2' });
  });

  it('isolation ON → picking a branch reloads that branch\'s prices and writes to it', async () => {
    const { c, api } = make(tests, { isolation: true });
    c.setScope('b2');
    expect(api.get).toHaveBeenCalledWith('/api/tests/?branchId=b2&view=summary');
    c.setPrice('t1', 250);
    await c.save();
    expect(api.patch).toHaveBeenLastCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 250 }], branchId: 'b2' });
  });

  it('isolation ON → "All branches" reads the tenant view and writes the tenant default (no branchId)', async () => {
    const { c, api } = make(tests, { isolation: true });
    c.setScope(TENANT_PRICE_SCOPE);
    expect(api.get).toHaveBeenCalledWith(`/api/tests/?branchId=${TENANT_PRICE_SCOPE}&view=summary`);
    c.setPrice('t1', 275);
    await c.save();
    expect(api.patch).toHaveBeenLastCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 275 }] });
  });
});
