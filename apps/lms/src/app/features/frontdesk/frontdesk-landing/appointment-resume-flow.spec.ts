import { of, throwError } from 'rxjs';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/** OPS-74 / OPS-29 #12: "Resume order" asks the server whether the appointment already has an order. */
const A = { id: 'appt-1', patientId: 'pat-1' } as any;

function run(lookup: unknown, canCollect: boolean, appt: any = A) {
  const router = { navigate: vi.fn() };
  const api = { get: vi.fn(() => lookup) };
  const self: any = {
    router, api,
    labCfg: { collectsAtFrontdesk: () => canCollect },
    auth: { hasPermission: (p: string) => p === 'collect_sample' },
  };
  self.goResume = (FrontdeskLandingComponent.prototype as any).goResume.bind(self);
  (FrontdeskLandingComponent.prototype as any).resumeAppointmentOrder.call(self, appt);
  return { router, api };
}

describe('Frontdesk landing — resumeAppointmentOrder', () => {
  it('an existing order goes to collection (not to payment / a second order)', () => {
    const { router, api } = run(of({ orderId: 'ord-9' }), true);
    expect(api.get).toHaveBeenCalledWith('/api/orders/by-appointment/appt-1');
    expect(router.navigate).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { orderId: 'ord-9' } });
  });
  it('no order yet reopens the order page with the appointment', () => {
    const { router } = run(of({ orderId: null }), true);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'pat-1', appointmentId: 'appt-1' } });
  });
  it('a failed lookup falls back to the order page', () => {
    const { router } = run(throwError(() => new Error('x')), true);
    expect(router.navigate).toHaveBeenCalledWith(['/frontdesk/order'], { queryParams: { patientId: 'pat-1', appointmentId: 'appt-1' } });
  });
  it('a card that already carries its order goes straight to collection, with no lookup', () => {
    const { router, api } = run(of({}), true, { ...A, orderId: 'ord-7' });
    expect(api.get).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/lab/collect'], { queryParams: { orderId: 'ord-7' } });
  });
});
