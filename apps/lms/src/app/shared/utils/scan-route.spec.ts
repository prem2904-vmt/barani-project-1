import { describe, expect, it } from 'vitest';
import { appRecordRoute } from './scan-route';

const ID = '3f2b8c1e-9a47-4d6b-8e21-5c7a90b1d4ef';

describe('appRecordRoute', () => {
  it('reads a patient ID-card QR (/p/<id>) from any origin', () => {
    expect(appRecordRoute(`https://app.prefrontal.health/p/${ID}`)).toEqual(['/p', ID]);
    expect(appRecordRoute(`  http://localhost:4200/p/${ID}  `)).toEqual(['/p', ID]);
  });
  it('reads an order QR (/o/<id>)', () => {
    expect(appRecordRoute(`https://x.test/o/${ID}`)).toEqual(['/o', ID]);
  });
  it('is null for anything else', () => {
    expect(appRecordRoute('')).toBeNull();
    expect(appRecordRoute(null)).toBeNull();
    expect(appRecordRoute('2607-00001')).toBeNull();
    expect(appRecordRoute('https://x.test/track/abc123')).toBeNull();
    expect(appRecordRoute('https://x.test/p/12345')).toBeNull();
  });
});
