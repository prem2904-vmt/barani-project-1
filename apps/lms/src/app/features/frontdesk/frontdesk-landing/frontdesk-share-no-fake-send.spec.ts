import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Owner 2026-11-13: there is no SMS / Email sending yet, so the Share menu must not offer them (they only toasted "sent"). */
const dir = 'apps/lms/src/app/features/frontdesk/frontdesk-landing';
const html = readFileSync(resolve(process.cwd(), dir, 'frontdesk-landing.component.html'), 'utf8');
const ts = readFileSync(resolve(process.cwd(), dir, 'frontdesk-landing.component.ts'), 'utf8');

describe('front desk Share menu: no fake SMS / Email', () => {
  it('offers no SMS or Email item and no bulk SMS', () => {
    expect(html).not.toMatch(/shareReportSMS|shareReportEmail|bulkSms/);
    expect(html).not.toMatch(/<span>SMS<\/span>|<span>Email<\/span>/);
    expect(ts).not.toMatch(/sent via SMS|sent via Email|SMS queued/);
  });
  it('the Share button only shows when WhatsApp can share (otherwise its menu would be empty)', () => {
    expect(html).toMatch(/@if \(o\.status !== 'delivered' && waShareMode\(\)\)/);
    expect(html).toMatch(/@if \(row\.order\.status !== 'delivered' && waShareMode\(\)\)/);
  });
});
