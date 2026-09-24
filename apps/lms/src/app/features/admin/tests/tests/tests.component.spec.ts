import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';

/**
 * Test Master single-source — Stage 1 safety net for the Test Master GRID.
 * TODAY the grid edits the tenant's own test rows in place: unit and the
 * FLAT reference range are typed cells (flat columns win over params for
 * single-band tests), content edits batch into per-row PATCH /api/tests/{id},
 * and a department toggle PATCHes /api/tenants/departments/{id}.
 * Phase 2: the PRICE cell shows the pricing-table price and writes ONLY
 * through the bulk price endpoint (TestPricingService), never the test row.
 */
function make(tests: any[] = [], depts: any[] = []) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? tests : depts)),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({})),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const pricing = { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TestPricingService, useValue: pricing },
      { provide: ToastService, useValue: toasts },
      { provide: ThemeService, useValue: { isDark: () => false } },
      { provide: DialogService, useValue: { confirm: async () => false } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new TestsComponent()) as any;
  c.ngOnInit();
  return { c, api, toasts, pricing };
}

const params = (p: any[]) => JSON.stringify({ parameters: p });
const hb = (over: any = {}) => ({
  id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012',
  price: 150, unit: 'g/dL', adultReferenceRange: '', department: { id: 'd1', name: 'Haematology' },
  parameters: params([{ name: 'hb', unit: 'g/dL', referenceRanges: [{ min: 12, max: 17 }] }]),
  ...over,
});
const col = (c: any, id: string) => c.colDefs().find((d: any) => (d.colId ?? d.field) === id);

describe('Test Master grid — price / unit / range cells (CURRENT)', () => {
  it('individual view exposes EDITABLE price (pricing-table value) and unit cells', () => {
    const { c } = make([hb()]);
    expect(col(c, 'price').editable).toBe(true);
    expect(col(c, 'price').field).toBe('price');
    expect(col(c, 'unit').editable).toBe(true);
  });

  it('price parser clamps negatives to 0 and keeps the old value on garbage; formatter prints ₹ en-IN', () => {
    const { c } = make([hb()]);
    const p = col(c, 'price');
    expect(p.valueParser({ newValue: '-4', oldValue: 10 })).toBe(0);
    expect(p.valueParser({ newValue: 'abc', oldValue: 10 })).toBe(10);
    expect(p.valueFormatter({ value: 125000 })).toBe('₹1,25,000');
    expect(p.valueFormatter({ value: null })).toBe('');
  });

  it('reference range: a typed FLAT adultReferenceRange wins over the parameter band (single band)', () => {
    const { c } = make();
    const rr = col(c, 'referenceRange');
    expect(rr.valueGetter({ data: hb({ adultReferenceRange: '11–16' }) })).toBe('11–16');
    expect(rr.valueGetter({ data: hb() })).toContain('12–17');
    expect(rr.valueGetter({ data: hb() })).toContain('g/dL');
    expect(rr.editable({ data: hb() })).toBe(true);
  });

  it('reference range: multi-band tests are read-only and show every band', () => {
    const { c } = make();
    const multi = hb({ adultReferenceRange: 'stale flat text', parameters: params([{ name: 'hb', referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] }]) });
    const rr = col(c, 'referenceRange');
    expect(rr.editable({ data: multi })).toBe(false);
    const v = rr.valueGetter({ data: multi });
    expect(v).toContain('13–17');
    expect(v).toContain('12–15');
  });

  it('content edits batch per row id (tatHours coerced) and flush as PATCH /api/tests/{id} — price never rides along', () => {
    const { c, api, pricing } = make([hb()]);
    c.onCellValueChanged({ colDef: { field: 'price' }, newValue: '200', oldValue: 150, data: { id: 't1' } });
    c.onCellValueChanged({ colDef: { field: 'unit' }, newValue: 'g/L', oldValue: 'g/dL', data: { id: 't1' } });
    c.onCellValueChanged({ colDef: { field: 'tatHours' }, newValue: '8', oldValue: 6, data: { id: 't1' } });
    expect(c.dirtyCount()).toBe(1);
    c.saveAll();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', { unit: 'g/L', tatHours: 8 });
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 't1', price: 200 }]);
    expect(c.dirtyCount()).toBe(0);
  });

  it('saveAll refuses duplicate codes (case-insensitive) and sends nothing', () => {
    const { c, api, toasts } = make([hb(), hb({ id: 't2', testCode: 'X1' })]);
    c.onCellValueChanged({ colDef: { field: 'testCode' }, newValue: 'hem012', oldValue: 'X1', data: { id: 't2' } });
    c.saveAll();
    expect(toasts.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('code cells are free text today — a tenant can type the master shape (^[A-Z]{3}[0-9]+$, e.g. BIO019)', () => {
    const { c, api } = make([hb()]);
    c.onCellValueChanged({ colDef: { field: 'testCode' }, newValue: 'BIO019', oldValue: 'HEM012', data: { id: 't1' } });
    c.saveAll();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', { testCode: 'BIO019' });
  });
});

describe('Test Master grid — departments (CURRENT)', () => {
  it('buckets come from tenant departments + any test department names not in the list', () => {
    const { c } = make([hb(), hb({ id: 't2', department: { id: 'x', name: 'Serology' } })],
      [{ id: 'd1', name: 'Haematology', code: 'HEM', isActive: false }]);
    const b = c.departments();
    expect(b.map((d: any) => d.name)).toEqual(['Haematology', 'Serology']);
    expect(b[0]).toMatchObject({ id: 'd1', count: 1, isActive: false });
    expect(b[1].id).toBeNull();
  });

  it('toggleDept PATCHes /api/tenants/departments/{id} {isActive} and reloads tests', () => {
    const { c, api } = make([], [{ id: 'd1', name: 'Haematology', isActive: true }]);
    api.get.mockClear();
    c.toggleDept(c.departments()[0]);
    expect(api.patch).toHaveBeenCalledWith('/api/tenants/departments/d1', { isActive: false });
    expect(api.get).toHaveBeenCalledWith('/api/tests/');
  });

  it('toggleTestActive PATCHes the test row isActive', () => {
    const { c, api } = make([hb()]);
    c.toggleTestActive({ id: 't1', name: 'Hb', isActive: true });
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', { isActive: false });
  });
});

describe('Test Master grid — TARGET behaviour', () => {
  it.skip('TARGET phase 0/6: unit + reference range cells are DERIVED from params (read-only, no flat columns)', () => {
    const { c } = make();
    expect(col(c, 'unit').editable).toBeFalsy();
    const rr = col(c, 'referenceRange');
    expect(typeof rr.editable === 'function' ? rr.editable({ data: hb() }) : rr.editable).toBeFalsy();
    expect(rr.valueGetter({ data: hb({ adultReferenceRange: '11–16' }) })).toContain('12–17');
  });

  it('TARGET phase 2: price cell edits the tenant pricing table (never a test override) and flags ₹1 defaults', () => {
    const { c, api, pricing } = make([hb({ price: 1, priceIsDefault: true })]);
    const rule = col(c, 'price').cellClassRules?.['pf-not-priced'];
    expect(rule).toBeDefined();
    expect(rule({ data: c.rowData()[0] })).toBe(true);
    c.onCellValueChanged({ colDef: { field: 'price' }, newValue: '200', oldValue: 1, data: { id: 't1' } });
    expect(rule({ data: c.rowData()[0] })).toBe(false);   // being priced → no flag
    c.saveAll();
    expect(api.patch).not.toHaveBeenCalled();
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 't1', price: 200 }]);
  });

  it.skip('TARGET phase 1/5: tenant cannot type the reserved master code shape ^[A-Z]{3}[0-9]+$ (BIO019); tenant codes carry a hyphen (MW-0001)', () => {
    const { c, api, toasts } = make([hb({ testCode: 'MW-0001' })]);
    c.onCellValueChanged({ colDef: { field: 'testCode' }, newValue: 'BIO019', oldValue: 'MW-0001', data: { id: 't1' } });
    c.saveAll();
    expect(toasts.error).toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it.skip('TARGET phase 3: rows carry an origin badge (master | customised | branch | local)', () => {
    const { c } = make([hb({ origin: 'customised' })]);
    const originCol = col(c, 'origin');
    expect(originCol).toBeDefined();
    expect(originCol.valueGetter({ data: hb({ origin: 'customised' }) })).toBe('Customised');
  });

  it.skip('TARGET phase 5: a pending master change shows as a proposal on the overridden row', () => {
    const { c } = make([hb({ origin: 'customised', pendingProposal: { id: 'p1' } })]);
    expect(c.pendingProposalCount()).toBe(1);
  });
});

describe('Test Master grid — pricing table (phase 2)', () => {
  it('the price cell renders the "₹1 · not priced yet" pill for a default row, the ₹ value otherwise', () => {
    const { c } = make([hb({ price: 1, priceIsDefault: true }), hb({ id: 't2', testCode: 'HEM013', price: 150, priceIsDefault: false })]);
    const renderer = col(c, 'price').cellRenderer;
    const def = renderer({ data: c.rowData().find((r: any) => r.id === 't1'), value: 1, valueFormatted: '₹1' });
    expect(def.textContent).toContain('₹1 · not priced yet');
    expect(def.querySelector('svg')).not.toBeNull();       // SVG icon, not emoji
    const priced = renderer({ data: c.rowData().find((r: any) => r.id === 't2'), value: 150, valueFormatted: '₹150' });
    expect(priced.textContent).toBe('₹150');
  });

  it('price-only edits save through ONE bulk call, no test PATCH', () => {
    const { c, api, pricing } = make([hb(), hb({ id: 't2', testCode: 'X2' })]);
    c.onCellValueChanged({ colDef: { field: 'price' }, newValue: '210', oldValue: 150, data: { id: 't1' } });
    c.onCellValueChanged({ colDef: { field: 'price' }, newValue: '-3', oldValue: 150, data: { id: 't2' } });
    expect(c.dirtyCount()).toBe(2);
    c.saveAll();
    expect(api.patch).not.toHaveBeenCalled();
    expect(pricing.save).toHaveBeenCalledTimes(1);
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 't1', price: 210 }, { testId: 't2', price: 0 }]);
  });

  it('discard drops pending price edits too', () => {
    const { c, pricing } = make([hb()]);
    c.onCellValueChanged({ colDef: { field: 'price' }, newValue: '210', oldValue: 150, data: { id: 't1' } });
    c.discardChanges();
    expect(c.dirtyCount()).toBe(0);
    c.saveAll();
    expect(pricing.save).not.toHaveBeenCalled();
  });

  it('a test not offered here stays listed, greyed, with a "Not offered here" tag', () => {
    const { c } = make([hb({ isOffered: false }), hb({ id: 't2', testCode: 'X2' })]);
    expect(c.rowData().map((r: any) => r.id)).toEqual(['t1', 't2']);
    const off = c.rowData()[0];
    expect(c.getRowStyle({ data: off })).toEqual({ opacity: '0.55' });
    expect(c.getRowStyle({ data: c.rowData()[1] })).toBeUndefined();
    const nameCell = col(c, 'name').cellRenderer({ data: off, value: off.name });
    expect(nameCell.textContent).toContain('Not offered here');
  });

  it('the Pricing tab swaps the grid for the pricing table', () => {
    const { c } = make([hb()]);
    c.openPricingView();
    expect(c.pricingView()).toBe(true);
    c.setType('profile');
    expect(c.pricingView()).toBe(false);
  });
});
