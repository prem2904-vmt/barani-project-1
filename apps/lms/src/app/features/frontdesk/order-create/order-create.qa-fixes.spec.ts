import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { InlinePaymentPanelComponent } from './inline-payment-panel.component';
import { byName, mergeRecent, planRepeat, sortByName } from './catalogue-order';
import { filterTestListStrict } from '../../../shared/utils/test-search';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * QA #3 / #4 / #5 — Order & Payments:
 *   #3a the discount is locked (and the editable totals give way to the final
 *       summary) once payment is recorded;
 *   #3b a pay-later advance above the bill is an inline error that blocks
 *       Confirm (never silently clamped) — the billing counter uses this panel;
 *   #4a Recent shows what was just ordered, most recent first;
 *   #4b lists read A→Z by name, search = relevance then name;
 *   #5  Repeat reproduces the source order's items (server-resolved ids) and
 *       wins over a stale draft; unavailable items are named.
 */

const CATALOGUE = [
  { id: 't1', name: 'Haemoglobin', testCode: 'HEM011', type: 'individual', price: 100, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Haematology' } },
  { id: 't2', name: 'Albumin', testCode: 'BIO002', type: 'individual', price: 50, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Biochemistry' } },
  { id: 't3', name: 'Creatinine', testCode: 'BIO001', type: 'individual', price: 50, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Biochemistry' } },
  { id: 'p2', name: 'Lipid Profile', testCode: 'PRO001', type: 'profile', price: 400, priceIsDefault: false, tatHours: 8, isActive: true,
    department: { name: 'Biochemistry' }, parameters: JSON.stringify({ items: [{ testId: 't2' }] }) },
  { id: 'p1', name: 'Diabetes Panel', testCode: 'PRO002', type: 'profile', price: 400, priceIsDefault: false, tatHours: 8, isActive: true,
    department: { name: 'Biochemistry' }, parameters: JSON.stringify({ items: [{ testId: 't3' }] }) },
  { id: 'k2', name: 'Wellness Basic', testCode: 'PKG001', type: 'package', price: 999, priceIsDefault: false, tatHours: 24, isActive: true,
    department: { name: 'Packages' }, parameters: JSON.stringify({ items: [{ testId: 't1' }] }) },
  { id: 'k1', name: 'Full Body Checkup', testCode: 'PKG002', type: 'package', price: 1999, priceIsDefault: false, tatHours: 24, isActive: true,
    department: { name: 'Packages' }, parameters: JSON.stringify({ items: [{ testId: 't1' }] }) },
];

interface Opts { query?: Map<string, string>; routes?: Record<string, unknown>; recent?: string[] }

function render(opts: Opts = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? true : q.includes('min-width: 1024px') ? true : q.includes('max-width: 640px') ? false : true,
    addEventListener() {}, removeEventListener() {} });
  const query = opts.query ?? new Map<string, string>();
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  let recent = opts.recent ?? [];
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    if (url.startsWith('/api/test-picker/recent')) return of(recent);
    for (const [k, v] of Object.entries(opts.routes ?? {})) if (url.startsWith(k)) return of(v);
    return of([]);
  });
  const post = vi.fn((url: string, body?: any) => {
    if (url === '/api/orders/') return of({ id: 'o-new' });
    if (url === '/api/billing/') return of({ id: 'b1', orderId: 'o-new', totalPayable: 150, totalPaid: 0, balance: 150, totalDiscount: 0 });
    if (url.endsWith('/payment')) return of({ id: 'b1', orderId: 'o-new', totalPayable: 150, totalPaid: body.amount, balance: 150 - body.amount, totalDiscount: 0 });
    return of({});
  });
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post, patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: toasts },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(query), snapshot: { paramMap: new Map(), queryParamMap: query } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  return {
    f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, get, post, toasts,
    setServerRecent: (ids: string[]) => { recent = ids; },
  };
}

const PATIENT = { id: 'pt1', firstName: 'Asha', lastName: 'K', phone: '9000000000' };

// ── #3a discount locked after payment ─────────────────────────────────────

describe('QA #3a — Order & Payments after payment', () => {
  it('replaces subtotal + the discount input with a read-only final summary', () => {
    const { f, el, c } = render();
    c._patient.set(PATIENT);
    c._selected.set(['t1', 't2']);
    c.billPhase.set('pay');
    f.detectChanges();
    expect(el.querySelector('.pf-cart-totals')?.textContent).toContain('Subtotal');

    c._paidBill.set({ id: 'b1', orderId: 'o1', totalPayable: 135, totalPaid: 135, balance: 0, totalDiscount: 15 });
    c.paidOrderId.set('o1');
    f.detectChanges();

    expect(el.querySelector('.pf-cart-totals')).toBeNull();
    expect(el.querySelector('.pf-cart-disc__input')).toBeNull();
    expect(el.textContent).not.toContain('Subtotal');
    const disc = el.querySelector('[data-testid="paid-discount"]');
    expect(disc?.textContent).toContain('Discount applied');
    expect(disc?.textContent).toContain('15');
    expect(el.querySelector('.pf-paid__summary')?.textContent).toContain('Payment completed');
  });

  it('ignores discount edits once paid (and in a read-only order)', () => {
    const { c } = render();
    c.discountValue.set('10');
    c.paidOrderId.set('o1');
    expect(c.discountLocked()).toBe(true);
    c.setDiscountValue('90');
    c.setDiscountKind('percent');
    expect(c.discountValue()).toBe('10');
    expect(c.discountKind()).toBe('flat');
  });

  it('no discount line when none was given', () => {
    const { f, el, c } = render();
    c._patient.set(PATIENT);
    c._selected.set(['t1']);
    c.billPhase.set('pay');
    c._paidBill.set({ id: 'b1', orderId: 'o1', totalPayable: 100, totalPaid: 100, balance: 0, totalDiscount: 0 });
    c.paidOrderId.set('o1');
    f.detectChanges();
    expect(el.querySelector('[data-testid="paid-discount"]')).toBeNull();
  });
});

// ── #3b advance cap (the panel both Order & Payments and the counter use) ──

describe('QA #3b — pay-later advance is capped at the balance', () => {
  function panel(amount: number) {
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: { get: vi.fn(() => of([])) } }] });
    const fixture = TestBed.createComponent(InlinePaymentPanelComponent);
    fixture.componentRef.setInput('amount', amount);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('an advance above the bill shows an inline error and blocks Confirm', () => {
    const { fixture, c, el } = panel(500);
    c.setKind('later');
    c.setAdvance('800');
    fixture.detectChanges();
    expect(c.advanceOver()).toBe(true);
    expect(c.confirmDisabled()).toBe(true);
    const err = el.querySelector('.pf-ipp__err');
    expect(err?.textContent).toContain("Advance can't be more than the bill");
    expect(err?.getAttribute('role')).toBe('alert');
    const input = el.querySelector('.pf-ipp__input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // Never silently clamped to the bill.
    expect(c.advanceNum()).toBe(800);
    expect(c.confirmLabel()).toBe('Place order, ₹500.00 due');
  });

  it('an advance equal to or under the bill is fine and rides the result', () => {
    const { fixture, c, el } = panel(500);
    const out: any[] = [];
    c.confirm.subscribe(r => out.push(r));
    c.setKind('later');
    c.setAdvance('500');
    fixture.detectChanges();
    expect(c.advanceOver()).toBe(false);
    expect(el.querySelector('.pf-ipp__err')).toBeNull();
    c.setAdvance('200');
    c.emit();
    expect(out[0]).toEqual({ mode: 'later', advanceAmount: 200, advanceMode: 'cash' });
  });

  it('Order & Payments never posts more than the bill balance', async () => {
    const { c, post } = render();
    c._patient.set(PATIENT);
    c._selected.set(['t1', 't2']);            // cart preview ₹150
    await c.confirmPayment({ mode: 'later', advanceAmount: 150, advanceMode: 'cash' });
    const pay = post.mock.calls.find(([u]) => String(u).endsWith('/payment'));
    expect(pay?.[1]).toMatchObject({ amount: 150, mode: 'cash' });
  });
});

// ── #4a Recent ───────────────────────────────────────────────────────────

describe('QA #4a — Recent shows what was just ordered', () => {
  it('an order placed on this (reused) screen goes to the top of Recent, most recent first', async () => {
    const r = render({ recent: ['t3'] });
    const { c } = r;
    expect(c.recentTests().map((t: any) => t.id)).toEqual(['t3']);
    c._patient.set(PATIENT);
    c._selected.set(['p1', 't1']);
    await c.confirmPayment({ mode: 'later' });
    // The server list may not include the new order yet — it still shows.
    expect(c.recentTests().map((t: any) => t.id)).toEqual(['p1', 't1', 't3']);
    expect(r.get.mock.calls.filter(([u]) => String(u).startsWith('/api/test-picker/recent')).length).toBeGreaterThan(1);
  });

  it('mergeRecent: newest first, de-duplicated', () => {
    expect(mergeRecent(['a', 'b'], ['c', 'a', 'd'])).toEqual(['a', 'b', 'c', 'd']);
    expect(mergeRecent([], ['x', 'x'])).toEqual(['x']);
  });
});

// ── #4b sorting ──────────────────────────────────────────────────────────

describe('QA #4b — catalogue lists read A→Z by name', () => {
  it('All tests (per department), Profiles, Packages and Favourites are sorted by name', () => {
    const { c } = render();
    const bio = c.filteredTestsByDept().find((g: any) => g.department === 'Biochemistry');
    expect(bio.tests.map((t: any) => t.name)).toEqual(['Albumin', 'Creatinine']);   // code order was Creatinine first
    expect(c.profilesByDept()[0].tests.map((t: any) => t.name)).toEqual(['Diabetes Panel', 'Lipid Profile']);
    expect(c.packages().map((t: any) => t.name)).toEqual(['Full Body Checkup', 'Wellness Basic']);
    c.favouriteIds.set(new Set(['t1', 't3', 't2']));
    expect(c.favouriteTests().map((t: any) => t.name)).toEqual(['Albumin', 'Creatinine', 'Haemoglobin']);
  });

  it('the department filter keeps the name order', () => {
    const { c } = render();
    c.setDeptFilter('Biochemistry');
    expect(c.filteredTests().slice().sort(byName).map((t: any) => t.id)).toEqual(['t2', 't3']);
    expect(c.filteredTestsByDept()[0].tests.map((t: any) => t.id)).toEqual(['t2', 't3']);
  });

  it('Recent stays most-recent-first (not re-sorted)', () => {
    const { c } = render({ recent: ['t3', 't1', 't2'] });
    expect(c.recentTests().map((t: any) => t.id)).toEqual(['t3', 't1', 't2']);
  });

  it('search: relevance first, then name', () => {
    const list = [
      { id: 'b', name: 'Beta Glucose', testCode: 'X2' },
      { id: 'a', name: 'Alpha Glucose', testCode: 'X1' },
      { id: 'g', name: 'Glucose Fasting', testCode: 'X3' },
    ];
    // "glucose" is a name-prefix hit only for Glucose Fasting's first word…
    // all three are word-prefix hits (same score) → A→Z by name.
    expect(filterTestListStrict(list, 'glucose').map(t => t.id)).toEqual(['a', 'b', 'g']);
    // an exact code beats name order.
    expect(filterTestListStrict(list, 'x3')[0].id).toBe('g');
  });

  it('sortByName is case-insensitive and numeric-aware, never mutating', () => {
    const src = [{ name: 'vitamin B12' }, { name: 'Vitamin B2' }, { name: 'albumin' }];
    expect(sortByName(src).map(t => t.name)).toEqual(['albumin', 'Vitamin B2', 'vitamin B12']);
    expect(src[0].name).toBe('vitamin B12');
  });
});

// ── #5 Repeat ────────────────────────────────────────────────────────────

describe('QA #5 — Repeat reproduces the source order', () => {
  it('planRepeat keeps profiles/packages whole, follows the resolved (override) id and names what is gone', () => {
    const plan = planRepeat([
      { orderedId: 'master-hb', id: 't1', name: 'Haemoglobin' },   // reference mode: master id → tenant override t1
      { orderedId: 'p1', id: 'p1', name: 'Diabetes Panel', type: 'profile' },
      { orderedId: 'k1', id: 'k1', name: 'Full Body Checkup', type: 'package' },
      { orderedId: 'gone', id: null, name: 'Old ESR' },
      { orderedId: 'p1', id: 'p1', name: 'Diabetes Panel' },        // duplicate collapses
    ], CATALOGUE);
    expect(plan).toEqual({ ids: ['t1', 'p1', 'k1'], unavailable: ['Old ESR'] });
  });

  it('a resolved id that is not orderable here is reported, never swapped for another test', () => {
    expect(planRepeat([{ orderedId: 'x', id: 'not-offered', name: 'TSH' }], CATALOGUE))
      .toEqual({ ids: [], unavailable: ['TSH'] });
  });

  it('?fromOrderId= fills the cart from the server items, over a saved draft, with a notice', () => {
    // A leftover draft for the same patient must NOT win over the Repeat.
    const store = new Map<string, string>([['pf:order-draft:pt1', JSON.stringify({ savedAt: Date.now(), testIds: ['t2'] })]]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const { c, get, toasts } = render({
      query: new Map([['patientId', 'pt1'], ['fromOrderId', 'o-src']]),
      routes: {
        '/api/patients/pt1': { patient: PATIENT, history: [] },
        '/api/orders/o-src/repeat-items': [
          { orderedId: 'p1', id: 'p1', name: 'Diabetes Panel', type: 'profile' },
          { orderedId: 'm1', id: 't1', name: 'Haemoglobin', type: 'individual' },
          { orderedId: 'x9', id: null, name: 'Old ESR', type: 'individual' },
        ],
      },
    });
    expect(get).toHaveBeenCalledWith('/api/orders/o-src/repeat-items');
    expect(c.selected()).toEqual(['p1', 't1']);
    expect(toasts.warning).toHaveBeenCalledWith('Repeated 2 items. No longer available: Old ESR');
    vi.unstubAllGlobals();
  });

  it('everything available → a success notice', () => {
    const { c, toasts } = render();
    c.applyRepeat([{ orderedId: 'k1', id: 'k1', name: 'Full Body Checkup' }]);
    expect(c.selected()).toEqual(['k1']);
    expect(toasts.success).toHaveBeenCalledWith('Repeated 1 item');
  });
});
