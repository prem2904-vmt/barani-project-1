import { of } from 'rxjs';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { Order } from '../../../shared/models/order.model';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/**
 * OPS-76: no "Bill" in the Dispatch slot when billing is a separate counter.
 * OPS-75: the cancel dialog offers refund only when money is actually held.
 */
const proto = FrontdeskLandingComponent.prototype as any;
const held = { id: 'o1', status: 'sample_collected', paymentHold: true, createdAt: '2026-09-27T08:00:00Z',
  samples: [{ id: 's1', status: 'collected', collectedAt: '2026-09-27T08:05:00Z' }] } as unknown as Order;

function fd(billingMode: string, perms = ['create_bill', 'dispatch_sample'], extra: Record<string, unknown> = {}) {
  const h = Object.create(proto);
  Object.assign(h, {
    auth: { hasPermission: (p: string) => perms.includes(p) },
    labCfg: { billingMode: () => billingMode, collectsAtFrontdesk: () => true },
    ...extra,
  });
  return h;
}

describe('OPS-76 Bill-instead-of-Dispatch follows the billing mode', () => {
  it('front-desk billing: a held order offers Bill', () => {
    expect(fd('front_desk').showBillInsteadOfDispatch(held)).toBe(true);
  });
  it('separate counter: no Bill at the front desk (and still no Dispatch while held)', () => {
    const c = fd('separate_counter');
    expect(c.showBillInsteadOfDispatch(held)).toBe(false);
    expect(c.showDispatchOn(held)).toBe(false);
  });
});

describe('OPS-75 cancel dialog', () => {
  const o = (netPaid: number | null | undefined, billStatus?: string) => ({ id: 'o1', netPaid, billStatus } as unknown as Order);

  it('nothing paid -> no refund; paid -> refund; unknown -> refund unless unbilled', () => {
    const c = fd('front_desk');
    expect(c.cancelHasPayment(o(0, 'unpaid'))).toBe(false);
    expect(c.cancelHasPayment(o(250, 'paid'))).toBe(true);
    expect(c.cancelHasPayment(o(undefined, 'unbilled'))).toBe(false);
    expect(c.cancelHasPayment(o(undefined, 'paid'))).toBe(true);
    expect(c.cancelHasPayment(null)).toBe(false);
  });

  function cancelHarness(order: Order) {
    const patch = vi.fn(() => of({}));
    const h = fd('front_desk', [], {
      api: { patch }, toasts: { success: vi.fn(), error: vi.fn() },
      cancelTarget: signal<Order | null>(order), cancelReason: signal(' no show '),
      cancelRefundMode: signal('upi'), cancelling: signal(false),
      _selectedOrder: signal<unknown>(null), refresh: vi.fn(),
    });
    return { h, patch };
  }

  it('0 paid: the request carries no refundMode', () => {
    const { h, patch } = cancelHarness({ id: 'o1', netPaid: 0 } as unknown as Order);
    h.confirmCancel();
    expect(patch).toHaveBeenCalledWith('/api/orders/o1/cancel', { reason: 'no show' });
  });

  it('paid: the chosen refund mode is sent', () => {
    const { h, patch } = cancelHarness({ id: 'o1', netPaid: 100 } as unknown as Order);
    h.confirmCancel();
    expect(patch).toHaveBeenCalledWith('/api/orders/o1/cancel', { reason: 'no show', refundMode: 'upi' });
  });
});
