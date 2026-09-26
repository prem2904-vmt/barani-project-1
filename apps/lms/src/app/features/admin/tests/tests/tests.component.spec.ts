import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../../../shared/models/api-response.model';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * Test Master single-source — Stage 1 safety net for the Test Master GRID.
 * TODAY the grid edits the tenant's own test rows in place: unit and the
 * FLAT reference range are typed cells (flat columns win over params for
 * single-band tests), content edits batch into per-row PATCH /api/tests/{id},
 * and a department toggle PATCHes /api/tenants/departments/{id}.
 * Phase 2: the PRICE cell shows the pricing-table price and writes ONLY
 * through the bulk price endpoint (TestPricingService), never the test row.
 */
function make(tests: any[] = [], depts: any[] = [], opts: { proposals?: any[]; confirm?: boolean } = {}) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? tests
      : url.startsWith('/api/catalog-proposals') ? (opts.proposals ?? []) : depts)),
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
      { provide: DialogService, useValue: { confirm: vi.fn(async () => opts.confirm ?? false) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new TestsComponent()) as any;
  c.ngOnInit();
  return { c, api, toasts, pricing, dialog: TestBed.inject(DialogService) as any };
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
  it('individual view exposes an EDITABLE price (pricing-table value); unit is derived, read-only', () => {
    const { c } = make([hb()]);
    expect(col(c, 'price').editable).toBe(true);
    expect(col(c, 'price').field).toBe('price');
    expect(col(c, 'unit').editable).toBe(false);
    expect(col(c, 'unit').valueGetter({ data: hb({ unit: 'stale' }) })).toBe('g/dL');
    expect(col(c, 'unit').valueGetter({ data: hb({ derivedUnit: 'mmol/L' }) })).toBe('mmol/L');
  });

  it('price parser clamps negatives to 0 and keeps the old value on garbage; formatter prints ₹ en-IN', () => {
    const { c } = make([hb()]);
    const p = col(c, 'price');
    expect(p.valueParser({ newValue: '-4', oldValue: 10 })).toBe(0);
    expect(p.valueParser({ newValue: 'abc', oldValue: 10 })).toBe(10);
    expect(p.valueFormatter({ value: 125000 })).toBe('₹1,25,000');
    expect(p.valueFormatter({ value: null })).toBe('');
  });

  it('reference range: the server-derived range wins; the flat column is never shown', () => {
    const { c } = make();
    const rr = col(c, 'referenceRange');
    expect(rr.valueGetter({ data: hb({ derivedReferenceRange: '12–17', derivedUnit: 'g/dL' }) })).toBe('12–17 g/dL');
    expect(rr.valueGetter({ data: hb({ adultReferenceRange: '11–16' }) })).not.toContain('11–16');
    expect(rr.valueGetter({ data: hb() })).toContain('g/dL');
  });

  it('reference range: multi-band tests show every band (read-only like every row)', () => {
    const { c } = make();
    const multi = hb({ adultReferenceRange: 'stale flat text', parameters: params([{ name: 'hb', referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] }]) });
    const rr = col(c, 'referenceRange');
    expect(rr.editable).toBe(false);
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

  it('the Code column is read-only (server-assigned) and sorts naturally (BIO002 < BIO010 < BIO901 < BIO1000)', () => {
    const { c } = make([hb()]);
    const code = col(c, 'testCode');
    expect(code.editable).toBe(false);
    expect(['BIO1000', 'BIO901', 'BIO010', 'BIO002'].sort(code.comparator)).toEqual(['BIO002', 'BIO010', 'BIO901', 'BIO1000']);
  });

  it('the profile/package tree lists rows in natural code order, codeless rows after', () => {
    const { c } = make([hb({ id: 'a', type: 'profile', testCode: 'HEM1000' }), hb({ id: 'p', type: 'package', testCode: null, name: 'Wellness' }),
      hb({ id: 'b', type: 'profile', testCode: 'HEM012' }), hb({ id: 'x', type: 'profile', testCode: 'HEM900' })]);
    c.setType('profile');
    const codes = c.rowData().filter((r: any) => r.type === 'profile').map((r: any) => r.testCode);
    expect(codes).toEqual(['HEM012', 'HEM900', 'HEM1000']);
  });

  it('a server refusal (e.g. code_readonly) shows the server\'s message', () => {
    const { c, api, toasts } = make([hb({ testCode: 'HEM900' })]);
    api.patch.mockReturnValueOnce(throwError(() => new ApiError('Test codes are assigned automatically', 'code_readonly')));
    c.onCellValueChanged({ colDef: { field: 'name' }, newValue: 'Hb', oldValue: 'Haemoglobin', data: { id: 't1' } });
    c.saveAll();
    expect(toasts.error).toHaveBeenCalledWith('Test codes are assigned automatically');
  });

  it('restore to default says prices are kept (never "reset to 0")', async () => {
    const { c, dialog } = make([hb()]);
    await c.restoreDefaults();
    const msg = dialog.confirm.mock.calls[0][0].message as string;
    expect(msg).toContain('Prices');
    expect(msg).not.toMatch(/reset to (₹)?0/);
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

  it('toggleDept PATCHes /api/tenants/departments/{id} {isActive} and reloads tests (OFF after the confirm)', async () => {
    const { c, api } = make([], [{ id: 'd1', name: 'Haematology', isActive: true }], { confirm: true });
    api.get.mockClear();
    await c.toggleDept(c.departments()[0]);
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
  it('TARGET phase 0/6: unit + reference range cells are DERIVED from params (read-only, no flat columns)', () => {
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

  it('TARGET phase 3: rows carry an origin badge (master | customised | branch | local)', () => {
    const { c } = make([hb({ origin: 'customised' })]);
    const originCol = col(c, 'origin');
    expect(originCol).toBeDefined();
    expect(originCol.valueGetter({ data: hb({ origin: 'customised' }) })).toBe('Customised');
  });

  it('TARGET phase 5: a pending master change shows as a proposal on the overridden row', () => {
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

describe('Test Master grid — copy-on-write (phases 3 + 5)', () => {
  it('the origin column renders the quiet chip with an SVG glyph; Own test for local rows', () => {
    const { c } = make([hb({ origin: 'local' })]);
    const originCol = col(c, 'origin');
    expect(originCol.valueGetter({ data: hb({ origin: 'local' }) })).toBe('Own test');
    expect(originCol.valueGetter({ data: hb({ origin: 'master' }) })).toBe('Master');
    const el = originCol.cellRenderer({ data: hb({ origin: 'branch', pendingProposal: { id: 'p1' } }) });
    expect(el.textContent).toContain('Branch');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.querySelector('[title*="update is waiting"]')).not.toBeNull();
  });

  it('profiles/packages view shows the origin column and derived read-only unit/range too', () => {
    const { c } = make([hb({ type: 'profile' })]);
    c.setType('profile');
    expect(col(c, 'origin')).toBeDefined();
    expect(col(c, 'unit').editable).toBe(false);
  });

  it('"Revert to master" is offered only on customised / branch rows', () => {
    const { c } = make();
    const actions = col(c, 'actions');
    const ctx = { revert: vi.fn() };
    const btns = (origin: string) => actions.cellRenderer({ data: hb({ origin }), context: ctx }).querySelectorAll('button').length;
    expect(btns('customised')).toBe(2);
    expect(btns('branch')).toBe(2);
    expect(btns('master')).toBe(1);
    expect(btns('local')).toBe(1);
    const el = actions.cellRenderer({ data: hb({ origin: 'customised' }), context: ctx });
    (el.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(ctx.revert).toHaveBeenCalled();
  });

  it('revert asks through DialogService and POSTs revert-to-master, then reloads', async () => {
    const { c, api, dialog } = make([hb({ origin: 'customised' })], [], { confirm: true });
    api.get.mockClear();
    await c.revertToMaster(hb({ origin: 'customised' }));
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Revert to master' }));
    expect(api.post).toHaveBeenCalledWith('/api/tests/t1/revert-to-master', {});
    expect(api.get).toHaveBeenCalledWith('/api/tests/');
  });

  it('clone mode: no revert button (the lab holds its own copy; nothing to revert to)', () => {
    const { c } = make();
    const actions = col(c, 'actions');
    const el = actions.cellRenderer({ data: hb({ origin: 'customised', catalogMode: 'clone' }), context: { revert: vi.fn() } });
    expect(el.querySelectorAll('button').length).toBe(1);
  });

  it('revert cancelled in the dialog sends nothing', async () => {
    const { c, api } = make([hb({ origin: 'customised' })]);
    await c.revertToMaster(hb({ origin: 'customised' }));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('pending proposals are loaded on init and counted with the rows\' markers (distinct)', () => {
    const { c, api } = make([hb({ origin: 'customised', pendingProposal: { id: 'p1' } })], [],
      { proposals: [{ id: 'p1', catalogKey: 'HEM012', kind: 'update', createdAt: '' }, { id: 'p2', catalogKey: 'BIO019', kind: 'update', branchId: 'b1', createdAt: '' }] });
    expect(api.get).toHaveBeenCalledWith('/api/catalog-proposals');
    expect(c.pendingProposalCount()).toBe(2);
    expect(c.proposals().length).toBe(2);
  });
});
