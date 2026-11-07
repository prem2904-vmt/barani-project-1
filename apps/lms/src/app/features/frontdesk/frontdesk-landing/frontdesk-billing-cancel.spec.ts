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

