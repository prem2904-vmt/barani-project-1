import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Order & Payments — LOADING FEEDBACK (ND-PATTERN "Loading feedback"):
 * every button that waits on the server (Update order, Confirm payment, the
 * paid-order Print / Receipt / WhatsApp) turns busy in the same frame —
 * disabled + aria-busy, repeat presses swallowed — and shows the kit's dots
 * only once the wait passes 150ms.
 */
const CATALOGUE = [
  { id: 't1', name: 'Haemoglobin', testCode: 'HEM011', type: 'individual', price: 10, tatHours: 2, isActive: true, department: { name: 'Haematology' } },
];

function render(opts: { patch$?: Subject<any>; tests$?: Subject<any> } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover') ? true : q.includes('min-width: 1024px') ? true : q.includes('max-width: 640px') ? false : true,
    addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/tests/?') && opts.tests$ ? opts.tests$ : of(url.startsWith('/api/tests/') ? CATALOGUE : [])),
    post: vi.fn(() => of({})), patch: vi.fn(() => opts.patch$ ?? of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map([['patientId', 'x']])), snapshot: { paramMap: new Map(), queryParamMap: new Map([['patientId', 'x']]) } } },
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
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api };
}

const footBtn = (el: HTMLElement, text: RegExp) =>
  [...el.querySelectorAll<HTMLButtonElement>('.pf-oc-bill__foot button')].find(b => text.test(b.textContent ?? ''))!;

describe('Order & Payments — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first open: the test catalogue is a skeleton of its rows, never "No recent tests yet"', () => {
    const tests$ = new Subject<any>();
    const { f, el } = render({ tests$ });
    const list = () => el.querySelector('.pf-oc-cat__list')!;
    expect(list().querySelector('pf-skeleton-rows')).not.toBeNull();
    expect(list().textContent).not.toMatch(/No recent tests yet|No tests configured/);
    tests$.next(CATALOGUE);
    tests$.complete();
    vi.advanceTimersByTime(700);                           // the 600ms hold
    f.detectChanges();
    expect(list().querySelector('pf-skeleton-rows')).toBeNull();
  });

  it('Modify → "Update order & reconcile": disabled + aria-busy at once, dots after 150ms, released on answer', () => {
    const patch$ = new Subject<any>();
    const { f, el, c, api } = render({ patch$ });
    c.editOrderId.set('o1');
    c._patient.set({ id: 'x', displayName: 'Ms. Sansa Stark' });
    c._selected.set(['t1']);
    c.billPhase.set('pay');
    f.detectChanges();
    const btn = () => footBtn(el, /Update order/);
    expect(btn().disabled).toBe(false);
    btn().click();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute('aria-busy')).toBe('true');
    expect(btn().querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(200);
    f.detectChanges();
    expect(btn().querySelector('pf-busy')).not.toBeNull();
    btn().click();                                       // swallowed
    expect(api.patch).toHaveBeenCalledTimes(1);
    patch$.error({ status: 500 });
    vi.advanceTimersByTime(400);
    f.detectChanges();
    expect(btn().disabled).toBe(false);
    expect(btn().getAttribute('aria-busy')).toBeNull();
    expect(btn().querySelector('pf-busy')).toBeNull();
  });

  it('Confirm payment: the footer CTA and the panel are busy while the payment posts', () => {
    const { f, el, c } = render();
    c._patient.set({ id: 'x', displayName: 'Ms. Sansa Stark' });
    c._selected.set(['t1']);
    c.billPhase.set('pay');
    f.detectChanges();
    c.confirming.set(true);
    f.detectChanges();
    const cta = footBtn(el, /Processing/);
    expect(cta.disabled).toBe(true);
    expect(cta.getAttribute('aria-busy')).toBe('true');
    c.confirming.set(false);
    f.detectChanges();
    expect(el.querySelector('.pf-oc-bill__foot [aria-busy="true"]')).toBeNull();
  });

  it('paid order: Print invoice is busy while its PDF is built; Receipt / WhatsApp stay free', async () => {
    const { f, el, c } = render();
    c._patient.set({ id: 'x', displayName: 'Ms. Sansa Stark', phone: '9876543210' });
    c._selected.set(['t1']);
    c.paidOrderId.set('o1');
    c._paidBill.set({ id: 'b1', orderId: 'o1', invoiceNumber: 'INV-1', totalPayable: 10, totalPaid: 10, balance: 0, payments: [] });
    c.billPhase.set('pay');
    f.detectChanges();
    let finish!: () => void;
    const build = vi.spyOn(c, 'emitPaidInvoice').mockImplementation(() => new Promise<void>(r => { finish = r; }));
    const acts = () => [...el.querySelectorAll<HTMLButtonElement>('.pf-oc-paid-acts .pf-oc-act')];
    const print = () => acts().find(b => /Print invoice/.test(b.textContent ?? ''))!;
    const receipt = () => acts().find(b => /Receipt/.test(b.textContent ?? ''))!;
    print().click();
    f.detectChanges();
    expect(build).toHaveBeenCalledWith('print');
    expect(print().disabled).toBe(true);
    expect(print().getAttribute('aria-busy')).toBe('true');
    expect(receipt().disabled).toBe(false);
    expect(receipt().getAttribute('aria-busy')).toBeNull();
    print().click();                                     // swallowed
    expect(build).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve(); await Promise.resolve();
    f.detectChanges();
    expect(print().disabled).toBe(false);
    expect(print().getAttribute('aria-busy')).toBeNull();
  });
});
