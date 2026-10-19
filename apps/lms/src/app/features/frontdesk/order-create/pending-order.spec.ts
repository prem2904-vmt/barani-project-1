import { cartKey, discountNeedsSync, planConfirmOrder } from './pending-order';

describe('planConfirmOrder (bug 3 — a failed billing never duplicates the order)', () => {
  const key = cartKey(['b', 'a'], { a: 'Serum' });

  it('creates an order when nothing is pending', () => {
    expect(planConfirmOrder(null, 'p1', key)).toEqual({ action: 'create' });
  });
  it('reuses the SAME order on retry when the cart is unchanged', () => {
    expect(planConfirmOrder({ id: 'o1', patientId: 'p1', key }, 'p1', key)).toEqual({ action: 'reuse', orderId: 'o1' });
  });
  it('re-syncs the pending order when the cart changed (still the same order)', () => {
    const changed = cartKey(['a', 'b', 'c'], { a: 'Serum' });
    expect(planConfirmOrder({ id: 'o1', patientId: 'p1', key }, 'p1', changed)).toEqual({ action: 'patch', orderId: 'o1' });
  });
  it('a different patient never inherits the pending order', () => {
    expect(planConfirmOrder({ id: 'o1', patientId: 'p1', key }, 'p2', key)).toEqual({ action: 'create' });
  });
  it('cart key ignores test order', () => {
    expect(cartKey(['a', 'b'], null)).toBe(cartKey(['b', 'a'], null));
  });
});

describe('discountNeedsSync', () => {
  const bill = (totalDiscount: number, over: object = {}) => ({ totalDiscount, balance: 100, totalPaid: 0, status: 'pending', ...over });
  it('false when the existing bill already carries the cart discount', () => {
    expect(discountNeedsSync(bill(295), 295)).toBe(false);
    expect(discountNeedsSync(bill(0), 0)).toBe(false);
  });
  it('true when the cart discount differs on an unsettled bill', () => {
    expect(discountNeedsSync(bill(200), 295)).toBe(true);
    expect(discountNeedsSync(bill(200), 0)).toBe(true);
  });
  it('never on a settled bill (server rejects bill_settled)', () => {
    expect(discountNeedsSync(bill(200, { status: 'paid', balance: 0, totalPaid: 900 }), 295)).toBe(false);
  });
});
