import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/**
 * OPS-95: the desk's Scan QR knew /o/, /track/ and ABHA only, so a patient
 * ID card (`<origin>/p/<patientId>`) fell through to the patient search and
 * said "No patient matches". It now opens the patient like the top-strip scan.
 */
const ID = '3f2b8c1e-9a47-4d6b-8e21-5c7a90b1d4ef';

function run(code: string) {
  const router = { navigate: vi.fn() };
  const api = { get: vi.fn() };
  const toasts = { warning: vi.fn() };
  const self = { router, api, toasts, _qrScannerOpen: { set: vi.fn() } };
  (FrontdeskLandingComponent.prototype as any).onQrScanned.call(self, code);
  return { router, api, toasts };
}

describe('Frontdesk landing — onQrScanned', () => {
  it('a patient ID-card QR opens that patient, without searching', () => {
    const { router, api, toasts } = run(`https://app.prefrontal.health/p/${ID}`);
    expect(router.navigate).toHaveBeenCalledWith(['/p', ID]);
    expect(api.get).not.toHaveBeenCalled();
    expect(toasts.warning).not.toHaveBeenCalled();
  });

  it('an invoice order QR still opens the order', () => {
    const { router } = run(`https://app.prefrontal.health/o/${ID}`);
    expect(router.navigate).toHaveBeenCalledWith(['/o', ID]);
  });

  it('a patient-tracking link still goes to /track', () => {
    const { router } = run('https://app.prefrontal.health/track/abc123');
    expect(router.navigate).toHaveBeenCalledWith(['/track', 'abc123']);
  });
});
