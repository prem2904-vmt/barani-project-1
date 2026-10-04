import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { collectedItemIds, orderedItemIds } from './order-edit-items';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Owner bug (dev, LAB-2609-000146, Salem): a collected order holding the MHC
 * package (9 profiles → 65 lines). Modify → add Calcium (not in MHC or any of
 * its profiles) → "repeated test". Root cause: the edit cart was seeded with
 * the order's LEAF test ids and the collected set carried leaves + the package
 * id, so Update sent MHC beside its own 65 members and the server refused it
 * with duplicate_item naming an MHC member — never Calcium.
 *
 * Real-like shape: package → profiles → leaf tests; every order line is a
 * leaf carrying packageTestId = the top-level item.
 */
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const T = (id: string, name: string, price: number, extra: any = {}) =>
  ({ id, name, type: 'individual', price, tatHours: 4, isActive: true, ...extra });
const catalog = () => [
  T('hb', 'Haemoglobin Concentration', 100), T('plt', 'Platelet Count', 100),
  T('chol', 'Total Cholesterol', 150), T('tg', 'Triglycerides', 150),
  T('fbs', 'Fasting Blood Sugar', 80),
  T('ca', 'Calcium', 200), T('ica', 'Ionized Calcium', 400),
  T('cbc', 'CBC Basic', 300, { type: 'profile', parameters: items('hb', 'plt') }),
  T('lipid', 'Lipid Profile – 1', 400, { type: 'profile', parameters: items('chol', 'tg') }),
  T('mineral', 'Basic Mineral Profile', 600, { type: 'profile', parameters: items('ca', 'ica') }),
  T('mhc', 'MHC', 1500, { type: 'package', parameters: items('cbc', 'lipid', 'fbs') }),
];

/** GET /api/orders/{id} for an MHC order: 5 leaf lines, all via MHC. */
const mhcOrder = (collected: boolean) => ({
  id: 'o1', createdAt: '2026-09-28T16:57:57Z', patientId: 'p1', patient: { id: 'p1' },
  samples: [
    {
      status: collected ? 'dispatched' : 'pending', collectedAt: collected ? '2026-09-28T17:00:00Z' : null,
      tests: [
        { testId: 'hb', packageTestId: 'mhc', profileTestId: 'cbc', status: 'pending' },
        { testId: 'plt', packageTestId: 'mhc', profileTestId: 'cbc', status: 'pending' },
        { testId: 'chol', packageTestId: 'mhc', profileTestId: 'lipid', status: 'pending' },
        { testId: 'tg', packageTestId: 'mhc', profileTestId: 'lipid', status: 'pending' },
        { testId: 'fbs', packageTestId: 'mhc', profileTestId: null, status: 'pending' },
      ],
    },
  ],
});

function make() {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({})), patch: vi.fn(() => of({ order: {}, bill: null })) };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BranchLabConfigService, useValue: { billingMode: () => 'front_desk' } },
      { provide: ProcessWorkflowService, useValue: stub },
      { provide: AuthService, useValue: { hasPermission: () => true } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(catalog());
  return { c, api, toasts };
}

/** What the edit load does with GET /api/orders/{id} (ngOnInit, editOrderId). */
function openForEdit(c: any, o: any) {
  c.editOrderId.set(o.id);
  c._patient.set(o.patient);
  c.extractCollectedTestIds(o);
  c.preselectFromOrder(o, true);
  c.hydrateSpecimensFrom(o);
}

describe('order-edit-items — the ordered item of a line', () => {
  it('a package order yields the package once, never its member lines', () => {
    expect(orderedItemIds(mhcOrder(false))).toEqual(['mhc']);
  });
  it('a standalone test is its own item; a profile line is its profile', () => {
    const o = { samples: [{ tests: [
      { testId: 'ca', packageTestId: null },
      { testId: 'hb', packageTestId: 'cbc', profileTestId: 'cbc' },
      { testId: 'plt', packageTestId: 'cbc', profileTestId: 'cbc' },
    ] }] };
    expect(orderedItemIds(o)).toEqual(['ca', 'cbc']);
  });
  it('collected items are keyed by the ordered item (no member leaf)', () => {
    expect([...collectedItemIds(mhcOrder(true))]).toEqual(['mhc']);
    expect(collectedItemIds(mhcOrder(false)).size).toBe(0);
  });
});

describe('Modify order — adding a test to a package order', () => {
  for (const collected of [true, false]) {
    it(`(${collected ? 'collected' : 'uncollected'}) the cart holds MHC; adding Calcium is allowed and Update sends [MHC, Calcium]`, () => {
      const { c, api, toasts } = make();
      openForEdit(c, mhcOrder(collected));
      expect(c.selected()).toEqual(['mhc']);

      c.toggleTest(c.findTest('ca'));
      expect(toasts.error).not.toHaveBeenCalled();
      expect(c.selected()).toEqual(['mhc', 'ca']);

      c.submit();
      expect(api.patch).toHaveBeenCalledTimes(1);
      const [url, body] = api.patch.mock.calls[0] as unknown as [string, { testIds: string[] }];
      expect(url).toBe('/api/orders/o1/tests');
      expect(body.testIds.sort()).toEqual(['ca', 'mhc']);
      // Never the package beside its own members.
      for (const leaf of ['hb', 'plt', 'chol', 'tg', 'fbs', 'cbc', 'lipid']) expect(body.testIds).not.toContain(leaf);
    });
  }

  it('adding a real member of MHC (a profile inside it) is refused, naming the MHC line of the order', () => {
    const { c, toasts } = make();
    openForEdit(c, mhcOrder(true));
    c.togglePackage(c.findTest('lipid'));
    expect(c.selected()).toEqual(['mhc']);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“Lipid Profile – 1” is already on this order inside “MHC”/));
  });

  it('adding a leaf test inside MHC is refused, naming MHC', () => {
    const { c, toasts } = make();
    openForEdit(c, mhcOrder(false));
    c.toggleTest(c.findTest('fbs'));
    expect(c.selected()).toEqual(['mhc']);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringMatching(/“Fasting Blood Sugar” is already on this order inside “MHC”/));
  });

  it('a collected package cannot be removed from the edit cart', () => {
    const { c, toasts } = make();
    openForEdit(c, mhcOrder(true));
    c.togglePackage(c.findTest('mhc'));
    expect(c.selected()).toEqual(['mhc']);
    expect(toasts.warning).toHaveBeenCalledWith(expect.stringMatching(/Cannot remove MHC/));
  });
});
