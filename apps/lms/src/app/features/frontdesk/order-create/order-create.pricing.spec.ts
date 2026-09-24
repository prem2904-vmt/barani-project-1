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
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Test Master single-source — Stage 1 safety net for order-create pricing.
 * TODAY the cart prices every line from the loaded test row's `t.price`
 * (GET /api/tests/?activeOnly=true), members covered by a package in the
 * cart are ₹0, and GST is a flat 18% preview. Phase 2 moves the price to the
 * per-tenant pricing table (₹1 default + "not priced yet" flag).
 */
function make(tests: any[], perms: string[] = []) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: stub },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: FrontdeskSettingsService, useValue: stub },
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

describe('OrderCreate pricing (CURRENT: t.price from the test row)', () => {
  it('subtotal = Σ t.price of the cart; a missing price counts as 0', () => {
    const c = make([T('cbc', 300), T('esr', 120), T('crp', undefined)]);
    c._selected.set(['cbc', 'esr', 'crp']);
    expect(c.subtotal()).toBe(420);
  });

  it('GST preview is a flat 18% (rounded) when enabled, 0 when the tenant switch is off', () => {
    const c = make([T('cbc', 305)]);
    c._selected.set(['cbc']);
    expect(c.gst()).toBe(55);
    c.gstEnabled.set(false);
    expect(c.gst()).toBe(0);
  });

  it('a member covered by a package in the cart is ₹0 (billed inside the package price)', () => {
    const pkg = T('pkg', 500, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'cbc' }, { testId: 'esr' }] }) });
    const c = make([T('cbc', 300), T('esr', 120), pkg]);
    c._selected.set(['cbc', 'pkg']);
    expect(c.subtotal()).toBe(500);
    expect(c.isCoveredMember('cbc')).toBe(true);
    expect(c.coveringPackageName('cbc')).toBe('PKG');
  });

  it('package suggestion savings = Σ member t.price − package.price (members identified by TEST ID)', () => {
    const pkg = T('pkg', 350, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'cbc' }, { testId: 'esr' }] }) });
    const c = make([T('cbc', 300), T('esr', 120), pkg]);
    c._selected.set(['cbc', 'esr']);
    const [s] = c.packageSuggestions();
    expect(s.package.id).toBe('pkg');
    expect(s.individualSum).toBe(420);
    expect(s.savings).toBe(70);
  });

  it('discount is a preview on (subtotal + GST) and is capped by role permission', () => {
    const c = make([T('cbc', 1000)], ['give_discount']);
    c._selected.set(['cbc']);
    c.maxDiscountPct.set(10);
    c.setDiscountKind('percent');
    c.setDiscountValue('20');
    expect(c.discountAmount()).toBe(236);            // 20% of 1180
    expect(c.discountOverCap()).toBe(true);
  });

  it('a ₹0 test is orderable and carries no "not priced yet" marker today', () => {
    const c = make([T('new', 0)]);
    c._selected.set(['new']);
    expect(c.subtotal()).toBe(0);
    expect(c.isNotPriced?.('new')).toBeUndefined();
  });

  it.skip('TARGET phase 2: an unpriced test defaults to ₹1 and is flagged "₹1 · not priced yet" in the cart', () => {
    const c = make([T('new', undefined)]);
    c._selected.set(['new']);
    expect(c.subtotal()).toBe(1);
    expect(c.isNotPriced('new')).toBe(true);
  });

  it.skip('TARGET phase 2: price comes from the tenant/branch pricing table, not the test row', () => {
    // The orderable list endpoint returns the derived price for the acting branch
    // (DTO: price/discount/tax + origin); a tenant price overrides the ₹1 default.
    const c = make([T('cbc', 1, { priceSource: 'default' }), T('esr', 150, { priceSource: 'tenant' })]);
    c._selected.set(['cbc', 'esr']);
    expect(c.subtotal()).toBe(151);
  });

  it.skip('TARGET phase 5: bundle members resolve by catalogKey (ids differ between master and override rows)', () => {
    const pkg = T('pkg', 350, { type: 'package', parameters: JSON.stringify({ items: [{ testId: 'master-cbc', catalogKey: 'HEM012' }] }) });
    const c = make([T('tenant-cbc', 300, { catalogKey: 'HEM012' }), pkg]);
    c._selected.set(['tenant-cbc', 'pkg']);
    expect(c.isCoveredMember('tenant-cbc')).toBe(true);
  });
});
