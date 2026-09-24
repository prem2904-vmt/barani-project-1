import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PricingComponent } from './pricing.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Test Master single-source — Stage 1 safety net for the Pricing page.
 * TODAY: prices are read from the TEST ROW (`GET /api/tests/` → t.price) and
 * written back to it (`PATCH /api/tests/prices/bulk`). Phase 2 moves pricing
 * to the per-tenant `rate_list_prices` table with a ₹1 default.
 */
const tests = [
  { id: 't1', name: 'CBC', price: 300, department: { id: 'd1', name: 'Haematology' } },
  { id: 't2', name: 'ALT', price: 0, departmentId: 'd2', department: null },
  { id: 't3', name: 'AST', price: undefined, department: { id: 'd2', name: 'Biochemistry' } },
];

function make(list: any[] = tests) {
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? list : [])),
    patch: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [{ provide: ApiService, useValue: api }, { provide: ToastService, useValue: toasts }],
  });
  const c = TestBed.runInInjectionContext(() => new PricingComponent());
  c.ngOnInit();
  return { c, api, toasts };
}

describe('PricingComponent (CURRENT: price lives on the test row)', () => {
  it('loads prices from GET /api/tests/ — missing price reads as 0', () => {
    const { c, api } = make();
    expect(api.get).toHaveBeenCalledWith('/api/tests/');
    const byId = Object.fromEntries(c.filtered().map(r => [r.id, r]));
    expect(byId['t1'].orig).toBe(300);
    expect(byId['t2'].orig).toBe(0);
    expect(byId['t3'].orig).toBe(0);
    expect(byId['t2'].deptId).toBe('d2');   // falls back to departmentId
  });

  it('save() PATCHes /api/tests/prices/bulk with ONLY the changed rows (testId + price)', async () => {
    const { c, api } = make();
    c.setPrice('t1', 350.555);
    await c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', { updates: [{ testId: 't1', price: 350.56 }] });
    expect(c.dirtyCount()).toBe(0);
  });

  it('setPrice clamps negatives to 0; nothing dirty → no request', async () => {
    const { c, api } = make();
    c.setPrice('t1', -5);
    expect(c.edits()['t1']).toBe(0);
    c.discard();
    await c.save();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('applyBulk raises only the filtered department', () => {
    const { c } = make();
    c.selectedDeptId.set('d1');
    c.pct.set(10);
    c.applyBulk();
    expect(c.edits()['t1']).toBe(330);
    expect(c.edits()['t3']).toBe(0);
  });

  it('a ₹0 test is shown like any other row — there is no "not priced yet" flag today', () => {
    const { c } = make();
    const row = c.filtered().find(r => r.id === 't2') as any;
    expect(row.notPriced).toBeUndefined();
  });

  it.skip('TARGET phase 2: default price is ₹1 and an unpriced row is flagged "₹1 · not priced yet"', () => {
    const { c } = make([{ id: 't9', name: 'New', department: { id: 'd1', name: 'H' } }]);
    const row = c.filtered()[0] as any;
    expect(row.orig).toBe(1);
    expect(row.notPriced).toBe(true);
  });

  it.skip('TARGET phase 2: reads/writes the per-tenant pricing table, never the test row', async () => {
    const { c, api } = make();
    c.setPrice('t1', 400);
    await c.save();
    expect(api.patch).not.toHaveBeenCalledWith('/api/tests/prices/bulk', expect.anything());
    // e.g. PUT /api/pricing (rate_list_prices, branch-aware when isolation is ON)
  });

  it.skip('TARGET phase 2: "not offered here" toggles is_offered on the price row (never a test override)', () => {
    expect(true).toBe(false);
  });
});
