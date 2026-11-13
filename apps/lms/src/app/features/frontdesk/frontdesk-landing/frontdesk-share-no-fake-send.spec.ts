import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Owner 2026-11-13: the old SMS / Email items only toasted a fake "sent" — they stay gone. The real
 *  Email (server send) and SMS Chat (Messages app) rows go through CommsShareService / ReportActionsService
 *  (frontdesk-share-channels.spec.ts covers them). */
const dir = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(resolve(process.cwd(), dir, 'frontdesk-landing.component.html'), 'utf8');
const ts = readFileSync(resolve(process.cwd(), dir, 'frontdesk-landing.component.ts'), 'utf8');

describe('front desk Share menu: no fake SMS / Email', () => {
  it('never the old fake handlers or toasts, and no bulk SMS', () => {
    expect(html).not.toMatch(/shareReportSMS|shareReportEmail|bulkSms/);
    expect(ts).not.toMatch(/sent via SMS|sent via Email|SMS queued/);
    // The real rows call the real paths.
    expect(html).toMatch(/emailReport\(o, 'patient'\)/);
    expect(html).toMatch(/smsReport\(row\.order, 'patient'\)/);
  });
  it('the Share button shows whenever at least one channel can share (otherwise its menu would be empty)', () => {
    expect(html).toMatch(/@if \(o\.status !== 'delivered' && shareAvailable\(o\)\)/);
    expect(html).toMatch(/@if \(row\.order\.status !== 'delivered' && shareAvailable\(row\.order\)\)/);
    expect(html).not.toMatch(/status !== 'delivered' && waShareMode\(\)\)/);
  });
});
