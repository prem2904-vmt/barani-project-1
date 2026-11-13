import { readFileSync } from 'node:fs';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';

/** OPS-130: a drawn tube of a part-collected (series) order must stay dispatchable from the row. */
const t = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, ...extra });
const order = (samples: any[], extra: Record<string, unknown> = {}) => ({ id: 'o1', status: 'sample_collected', samples, ...extra }) as any;
const call = (o: any, perms = ['dispatch_sample']) =>
  (FrontdeskLandingComponent.prototype as any).showDispatchDrawn.call({ auth: { hasPermission: (p: string) => perms.includes(p) } }, o);

describe('Front desk row: Dispatch for drawn tubes while others are still to come (OPS-130)', () => {
  it('offers Dispatch when one tube is drawn and a later draw is pending', () => {
    expect(call(order([t('a', 'collected', { repeatOffsetMin: 0 }), t('b', 'pending', { repeatOffsetMin: 120 })]))).toBe(true);
  });
  it('not when nothing is drawn, nothing is left (classic Dispatch covers it), under a payment hold, or without permission', () => {
    expect(call(order([t('a', 'pending'), t('b', 'pending')]))).toBe(false);
    expect(call(order([t('a', 'collected'), t('b', 'collected')]))).toBe(false);
    expect(call(order([t('a', 'collected'), t('b', 'pending')], { paymentHold: true }))).toBe(false);
    expect(call(order([t('a', 'collected'), t('b', 'pending')]), [])).toBe(false);
  });
  it('already dispatched tubes alone do not re-offer it', () => {
    expect(call(order([t('a', 'dispatched'), t('b', 'pending')]))).toBe(false);
  });
  it('both row templates render the button next to Collect', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
    expect(html).toContain('@if (showDispatchDrawn(o))');
    expect(html).toContain('@if (showDispatchDrawn(row.order))');
  });
});
