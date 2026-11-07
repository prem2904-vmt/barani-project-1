import { appointmentResumeTarget } from './appointment-resume';

const A = { id: 'appt-1', patientId: 'pat-1' };

describe('appointmentResumeTarget (OPS-74 / OPS-29 #12)', () => {
  it('no order yet: the order page with the pre-booked tests', () => {
    expect(appointmentResumeTarget(A, null, true)).toEqual({
      path: ['/frontdesk/order'], queryParams: { patientId: 'pat-1', appointmentId: 'appt-1' },
    });
  });
  it('an order exists and this desk collects: straight to sample collection', () => {
    expect(appointmentResumeTarget(A, 'ord-9', true)).toEqual({
      path: ['/lab/collect'], queryParams: { orderId: 'ord-9' },
    });
  });
  it('an order exists but collection is elsewhere: the order itself, never a new order', () => {
    const t = appointmentResumeTarget(A, 'ord-9', false);
    expect(t.path).toEqual(['/frontdesk/order']);
    expect(t.queryParams).toEqual({ patientId: 'pat-1', fromOrderId: 'ord-9' });
    expect(t.queryParams['appointmentId']).toBeUndefined();
  });
});

import { readFileSync } from 'node:fs';
describe('board card for an appointment that already has an order', () => {
  it('shows "Order created" and an "Open order" action, driven by the feed\'s orderId', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    expect(html).toContain('@if (a.orderId)');
    expect(html).toContain("a.orderId ? 'Open order' : 'Resume order'");
  });
});
