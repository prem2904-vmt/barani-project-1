import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Test Master single source — phase 2: order-create pricing.
 * The orderable list (GET /api/tests/?activeOnly=true) carries the EFFECTIVE
 * price for the acting branch (pricing table) + `priceIsDefault` + `isOffered`.
 * The cart totals that price (₹1 when nobody priced the test, flagged
 * just "₹1"), members covered by a package in the cart are ₹0,
 * GST is per line at each test's own `taxSlab`, and a test that isn't offered
 * here never reaches the picker.
 */
function make(tests: any[], perms: string[] = []) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: stub },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BranchLabConfigService, useValue: stub },
      { provide: ProcessWorkflowService, useValue: stub },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(tests);
  return c;
}

const T = (id: string, price: number | undefined, extra: any = {}) =>
  ({ id, name: id.toUpperCase(), type: 'individual', price, tatHours: 4, isActive: true, ...extra });

describe('OrderCreate pricing (pricing-table DTO)', () => {
  it('subtotal = Σ effective price of the cart; a missing price is the ₹1 default', () => {
    const c = make([T('cbc', 300), T('esr', 120), T('crp', undefined)]);
    c._selected.set(['cbc', 'esr', 'crp']);
    expect(c.subtotal()).toBe(421);
  });

  it('a real ₹0 tenant price stays ₹0 (only "not priced" means ₹1)', () => {
    const c = make([T('free', 0, { priceIsDefault: false })]);
    c._selected.set(['free']);
    expect(c.subtotal()).toBe(0);
    expect(c.isNotPriced('free')).toBe(false);
  });

  it('a member covered by a package in the cart is ₹0 (billed inside the package price)', () => {
    const pkg = T('pkg', 500, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'cbc' }, { testId: 'esr' }] }) });
    const c = make([T('cbc', 300), T('esr', 120), pkg]);
    c._selected.set(['cbc', 'pkg']);
    expect(c.subtotal()).toBe(500);
    expect(c.isCoveredMember('cbc')).toBe(true);
    expect(c.coveringPackageName('cbc')).toBe('PKG');
  });

  it('package suggestion savings = Σ member price − package price (members identified by TEST ID)', () => {
    const pkg = T('pkg', 350, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'cbc' }, { testId: 'esr' }] }) });
    const c = make([T('cbc', 300), T('esr', 120), pkg]);
    c._selected.set(['cbc', 'esr']);
    const [s] = c.packageSuggestions();
    expect(s.package.id).toBe('pkg');
    expect(s.individualSum).toBe(420);
    expect(s.savings).toBe(70);
  });

  it('discount is a preview on (subtotal + GST) and is capped by role permission', () => {
    const c = make([T('cbc', 1000, { taxSlab: 18 })], ['give_discount']);
    c._selected.set(['cbc']);
    c.maxDiscountPct.set(10);
    c.setDiscountKind('percent');
    c.setDiscountValue('20');
    expect(c.discountAmount()).toBe(236);            // 20% of 1180
    expect(c.discountOverCap()).toBe(true);
  });

  it('owner bug: a 17–25% discount on a small (₹3) cart stays within the 25% cap', () => {
    // Three ₹1 (unpriced) tests, GST off. Rounding the percent to whole rupees
    // made 17% → ₹1 = 33% → "exceeds your limit of 25%".
    const c = make([T('a', 1), T('b', 1), T('c', 1)], ['give_discount', 'override_discount']);
    c._selected.set(['a', 'b', 'c']);
    c.gstEnabled.set(false);
    c.maxDiscountPct.set(10);
    c.overrideDiscountPct.set(25);
    expect(c.discountCapPct()).toBe(25);
    c.setDiscountKind('percent');
    for (const pct of ['17', '20', '24', '25']) {
      c.setDiscountValue(pct);
      expect(c.discountPct()).toBeLessThanOrEqual(Number(pct));
      expect(c.discountOverCap()).toBe(false);
    }
    c.setDiscountValue('25');
    expect(c.discountAmount()).toBe(0.75);
    c.setDiscountValue('26');
    expect(c.discountOverCap()).toBe(true);
  });

  it('percent of a GST cart resolves on the gross the server measures (25% of 1180 = ₹295)', () => {
    const c = make([T('cbc', 1000, { taxSlab: 18 })], ['override_discount']);
    c._selected.set(['cbc']);
    c.overrideDiscountPct.set(25);
    c.setDiscountKind('percent');
    c.setDiscountValue('25');
    expect(c.discountAmount()).toBe(295);
    expect(c.discountOverCap()).toBe(false);
  });

  it('an unpriced test defaults to ₹1 (data knows it is the default; the UI shows just the price)', () => {
    const c = make([T('new', 1, { priceIsDefault: true })]);
    c._selected.set(['new']);
    expect(c.subtotal()).toBe(1);
    expect(c.isNotPriced('new')).toBe(true);
    expect(c.notPriced(c._tests()[0])).toBe(true);
    expect(c.priceOf(c._tests()[0])).toBe(1);
  });

  it('price comes from the DTO (pricing table): a tenant price overrides the ₹1 default', () => {
    const c = make([T('cbc', 1, { priceIsDefault: true }), T('esr', 150, { priceIsDefault: false })]);
    c._selected.set(['cbc', 'esr']);
    expect(c.subtotal()).toBe(151);
    expect(c.isNotPriced('cbc')).toBe(true);
    expect(c.isNotPriced('esr')).toBe(false);
  });

  it.skip('TARGET phase 5: bundle members resolve by catalogKey (ids differ between master and override rows)', () => {
    const pkg = T('pkg', 350, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'master-cbc', catalogKey: 'HEM012' }] }) });
    const c = make([T('tenant-cbc', 300, { catalogKey: 'HEM012' }), pkg]);
    c._selected.set(['tenant-cbc', 'pkg']);
    expect(c.isCoveredMember('tenant-cbc')).toBe(true);
  });
});

describe('OrderCreate GST (per-test taxSlab, not a flat 18%)', () => {
  it('GST = Σ per line at each test\'s own slab (CGST+SGST halves rounded to paise); 0 when the switch is off', () => {
    const c = make([T('cbc', 305, { taxSlab: 18 }), T('esr', 100, { taxSlab: 5 }), T('lab', 500, { taxSlab: 0 })]);
    c._selected.set(['cbc', 'esr', 'lab']);
    // 305 @18% → 2 × 27.45 = 54.90 ; 100 @5% → 2 × 2.50 = 5.00 ; 500 @0% → 0
    expect(c.gst()).toBe(59.9);
    expect(c.gstLabel()).toBe('GST');
    c.gstEnabled.set(false);
    expect(c.gst()).toBe(0);
  });

  it('lab tests at a 0% slab carry no GST (the old flat 18% overcharged them)', () => {
    const c = make([T('cbc', 1000)]);
    c._selected.set(['cbc']);
    expect(c.gst()).toBe(0);
  });

  it('one shared slab is named in the label; covered members add no GST', () => {
    const pkg = T('pkg', 500, { type: 'package', taxSlab: 12, parameters: JSON.stringify({ items: [{ testId: 'cbc' }] }) });
    const c = make([T('cbc', 300, { taxSlab: 12 }), pkg]);
    c._selected.set(['cbc', 'pkg']);
    expect(c.gst()).toBe(60);
    expect(c.gstLabel()).toBe('GST · 12%');
  });
});

describe('OrderCreate — not offered here', () => {
  it('the orderable list drops isOffered=false tests (and inactive ones)', () => {
    const c = make([]);
    c.api.get.mockReturnValueOnce(of([T('a', 10), T('b', 10, { isOffered: false }), T('c', 10, { isActive: false })]));
    c.loadOrderableTests();
    expect(c._tests().map((t: any) => t.id)).toEqual(['a']);
  });

  it('a 409 not_offered on order submit explains it and re-syncs the picker', () => {
    const c = make([]);
    const toasts = c.toasts;
    const spy = vi.spyOn(toasts, 'error');
    c.surfaceMutationError({ error: { error: 'not_offered', message: 'Test not offered' } });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('not offered'));
    expect(c.api.get).toHaveBeenCalledWith('/api/tests/?activeOnly=true&view=summary');
  });
});
