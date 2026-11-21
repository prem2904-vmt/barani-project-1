import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { PricingComponent } from './pricing.component';
import { sortsAndFilters } from '../../../shared/utils/work-grid';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';

/**
 * Price by specimen (owner 2026-09-29): the Pricing screen expands a test
 * with allowed specimens into one row per specimen — its own price, or
 * blank = the test's base price — and saves them through the same
 * PATCH /api/tests/prices/bulk with `specimenCode` (null price = back to
 * the base price).
 */
const tests = [
  { id: 'cs', name: 'Bacterial C&S', price: 100, priceIsDefault: false, department: { id: 'mic', name: 'Microbiology' } },
  { id: 'hb', name: 'Haemoglobin', price: 50, priceIsDefault: false, department: { id: 'hae', name: 'Haematology' } },
];
const specimenRows = [
  { testId: 'cs', testName: 'Bacterial C&S', specimenCode: 'SPEC013', specimenName: 'Urine', price: null, basePrice: 100, mode: 'choose' },
  { testId: 'cs', testName: 'Bacterial C&S', specimenCode: 'SPEC005', specimenName: 'Sputum', price: 250, basePrice: 100, mode: 'choose' },
];

function make(opts: { isolation?: boolean } = {}) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/tests/prices/specimens')) return of(specimenRows);
      if (url.startsWith('/api/tests')) return of(tests);
      return of([]);
    }),
    patch: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const tenant = signal<any>({ id: 'tn', branchIsolationEnabled: !!opts.isolation });
  const auth = {
    user: () => ({ branches: [{ id: 'b1', name: 'Alwarpet' }, { id: 'b2', name: 'Chennai' }] }),
    activeBranchId: () => 'b1',
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

describe('PricingComponent — per-specimen rows', () => {
  it('reads GET /api/tests/prices/specimens and expands the test into its allowed specimens', () => {
    const { c, api } = make();
    expect(api.get).toHaveBeenCalledWith('/api/tests/prices/specimens');
    expect(c.specimenRowsOf('cs').map(s => s.code)).toEqual(['SPEC013', 'SPEC005']);
    expect(c.specimenRowsOf('hb')).toEqual([]);
    expect(c.specimenPriceNow('cs', 'SPEC013')).toBe('');      // blank = the base price
    expect(c.specimenPriceNow('cs', 'SPEC005')).toBe(250);
    expect(c.dirtyCount()).toBe(0);
  });

  it('isolation ON reads the viewed branch\'s specimen prices', () => {
    const { api } = make({ isolation: true });
    expect(api.get).toHaveBeenCalledWith('/api/tests/prices/specimens');
  });

  it('a specimen price edit is one dirty change; clearing a price writes null (back to base); Save sends specimenCode', async () => {
    const { c, api } = make();
    c.setSpecimenPrice('cs', 'SPEC013', 120);
    c.setSpecimenPrice('cs', 'SPEC005', '');
    expect(c.isSpecimenDirty('cs', 'SPEC013')).toBe(true);
    expect(c.isSpecimenDirty('cs', 'SPEC005')).toBe(true);
    expect(c.specimenDirty('cs')).toBe(true);
    expect(c.dirtyCount()).toBe(2);

    await c.save();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/prices/bulk', {
      updates: [
        { testId: 'cs', specimenCode: 'SPEC013', price: 120 },
        { testId: 'cs', specimenCode: 'SPEC005', price: null },
      ],
    });
    // Saved values become the originals.
    expect(c.dirtyCount()).toBe(0);
    expect(c.specimenPriceNow('cs', 'SPEC013')).toBe(120);
    expect(c.specimenPriceNow('cs', 'SPEC005')).toBe('');
  });

  it('setting a specimen price back to its saved value is not dirty; Discard drops specimen edits', () => {
    const { c } = make();
    c.setSpecimenPrice('cs', 'SPEC005', 250);
    expect(c.dirtyCount()).toBe(0);
    c.setSpecimenPrice('cs', 'SPEC005', 300);
    expect(c.dirtyCount()).toBe(1);
    c.discard();
    expect(c.dirtyCount()).toBe(0);
    expect(c.specimenPriceNow('cs', 'SPEC005')).toBe(250);
  });
});

describe('PricingComponent — grid columns sort + filter on the real value', () => {
  it('every data column sorts and filters; the editable price stays in rupees and keeps its setter', () => {
    const { c } = make();
    const cols = c.prCols as any[];
    expect(cols.map(x => x.colId)).toEqual(['name', 'type', 'offered', 'price']);
    for (const col of cols) expect(sortsAndFilters(col), col.colId).toBe(true);
    const price = cols.find(x => x.colId === 'price');
    expect(price.editable).toBe(true);
    expect(typeof price.valueSetter).toBe('function');
    const row = (spec: string | null) => ({ key: 'cs|' + spec, testId: 'cs', spec, name: 'x', meta: '', type: 'Specimen' });
    expect(price.valueGetter({ data: row('SPEC005') })).toBe(250);   // rupees, not paise
    expect(price.valueGetter({ data: row('SPEC013') })).toBeNull();  // blank = base price
    expect(price.valueGetter({ data: { key: 'cs', testId: 'cs', spec: null, name: 'x', meta: '', type: 'Test' } })).toBe(100);
  });
});
