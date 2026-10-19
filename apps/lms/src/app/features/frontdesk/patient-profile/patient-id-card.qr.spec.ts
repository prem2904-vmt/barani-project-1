import { readFileSync } from 'node:fs';
import { patientIdCardQrUrl } from './patient-id-card.component';
import { environment } from '../../../../environments/environment';

/** Owner 2026-09-28: the Patient ID card is reachable from the profile itself
 *  (next to ABHA), and its QR opens on another phone from the native app too. */
describe('Patient ID card', () => {
  it('web: the QR uses the page origin', () => {
    expect(patientIdCardQrUrl('https://med-stg.prefrontal.health', 'p1')).toBe('https://med-stg.prefrontal.health/p/p1');
  });

  it('native app (capacitor://localhost): the QR uses the public web origin', () => {
    const base = (environment.reportPublicBaseUrl ?? '').replace(/\/+$/, '');
    expect(patientIdCardQrUrl('capacitor://localhost', 'p1')).toBe(`${base}/p/p1`);
    expect(patientIdCardQrUrl('capacitor://localhost', 'p1')).not.toContain('capacitor://');
  });

  it('the profile shows a Patient ID card section with a View card button (not only in More)', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/patient-profile/patient-profile.component.html', 'utf8');
    const sec = html.slice(html.indexOf('id="pf-pp-sec-idcard"'), html.indexOf('aria-labelledby="pf-pp-sec-abha"'));
    expect(sec).toContain('Patient ID card');
    expect(sec).toMatch(/class="pf-btn pf-btn--secondary pf-pp-idcard" \(click\)="showIdCard\.set\(true\)"/);
    expect(html.indexOf('pf-pp-sec-idcard')).toBeLessThan(html.indexOf('pf-pp-sec-abha'));
  });
});
