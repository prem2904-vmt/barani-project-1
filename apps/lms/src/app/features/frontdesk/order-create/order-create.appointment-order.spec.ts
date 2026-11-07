import { readFileSync } from 'node:fs';
import { planConfirmOrder, cartKey } from './pending-order';

/** OPS-74: Confirm from an appointment that already has an order adopts it instead of creating another. */
const ts = readFileSync('apps/lms/src/app/features/frontdesk/order-create/order-create.component.ts', 'utf8');

describe('order-create — appointment already has an order', () => {
  it('an adopted order (empty key) is re-synced (patch) to the cart, never created again', () => {
    const key = cartKey(['t1'], null);
    expect(planConfirmOrder({ id: 'o1', patientId: 'p1', key: '' }, 'p1', key)).toEqual({ action: 'patch', orderId: 'o1' });
  });
  it('confirmPayment looks the order up before it would create one', () => {
    const at = ts.indexOf('existingAppointmentOrderId(appointmentId)');
    const plan = ts.indexOf('planConfirmOrder(pending, p.id, key)');
    expect(at).toBeGreaterThan(-1);
    expect(plan).toBeGreaterThan(at);
    expect(ts).toContain('/api/orders/by-appointment/');
  });
});
