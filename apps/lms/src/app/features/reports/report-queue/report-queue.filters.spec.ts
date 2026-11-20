import {
  activeCount, clientActive, dateActive, doctorNames, inDayRange, NO_CLIENT_FILTERS, partialPasses, presetRange, reportPasses,
  SCAN_PAGES_DATE, SCAN_PAGES_NO_DATE, shouldScan, viaKeys, viaLabel, withShares, type RqClientFilters,
} from './report-queue.filters';

const rep = (id: string, extra: Record<string, unknown> = {}) => ({
  id, orderId: `o-${id}`, patientId: 'p', type: 'final', status: 'generated', deliveryStatus: 'pending',
  createdAt: '2026-11-20T06:00:00Z', order: { id: `o-${id}`, refDoctorName: null as string | null },
  ...extra,
}) as any;
const po = (extra: Record<string, unknown> = {}) => ({ id: 'po', createdAt: '2026-11-20T06:00:00Z', refDoctorName: null, ...extra }) as any;
const f = (x: Partial<RqClientFilters>): RqClientFilters => ({ ...NO_CLIENT_FILTERS, ...x });

describe('Results filters — date presets (IST)', () => {
  it('All = no limit; Today / 7 days / This month end today', () => {
    expect(presetRange('all', '2026-11-20')).toEqual({ from: null, to: null });
    expect(presetRange('today', '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(presetRange('7d', '2026-11-20')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
    expect(presetRange('month', '2026-11-20')).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(presetRange('7d', '2026-03-03')).toEqual({ from: '2026-02-25', to: '2026-03-03' });   // across a month end
    expect(presetRange('custom', '2026-11-20')).toEqual({ from: null, to: null });
  });

  it('inDayRange reads the IST day of the instant (19:00 UTC = 00:30 IST the next day)', () => {
    const today = { from: '2026-11-20', to: '2026-11-20' };
    expect(inDayRange('2026-11-19T19:00:00Z', today)).toBe(true);
    expect(inDayRange('2026-11-19T18:00:00Z', today)).toBe(false);   // 23:30 IST on the 19th
    expect(inDayRange('2026-11-20T18:29:00Z', today)).toBe(true);    // 23:59 IST
    expect(inDayRange('2026-11-20T18:31:00Z', today)).toBe(false);   // 00:01 IST on the 21st
    expect(inDayRange(undefined, today)).toBe(false);
    expect(inDayRange(undefined, { from: null, to: null })).toBe(true);
    // Open ends.
    expect(inDayRange('2026-01-01T06:00:00Z', { from: null, to: '2026-11-20' })).toBe(true);
    expect(inDayRange('2026-01-01T06:00:00Z', { from: '2026-11-01', to: null })).toBe(false);
    expect(dateActive({ from: null, to: null })).toBe(false);
    expect(dateActive({ from: '2026-11-01', to: null })).toBe(true);
  });
});

describe('Results filters — rows', () => {
  it('combined: dates AND doctor AND channel; each off = passes', () => {
    const r = rep('a', { deliveryStatus: 'delivered', deliveredVia: 'WhatsApp', order: { id: 'o', refDoctorName: ' Dr. Meena R ' } });
    expect(reportPasses(r, NO_CLIENT_FILTERS)).toBe(true);
    expect(reportPasses(r, f({ doctor: 'dr. meena r' }))).toBe(true);
    expect(reportPasses(r, f({ doctor: 'Dr. Arun' }))).toBe(false);
    expect(reportPasses(r, f({ via: 'whatsapp' }))).toBe(true);
    expect(reportPasses(r, f({ via: 'print' }))).toBe(false);
    expect(reportPasses(r, f({ range: { from: '2026-11-20', to: '2026-11-20' }, doctor: 'Dr. Meena R', via: 'whatsapp' }))).toBe(true);
    expect(reportPasses(r, f({ range: { from: '2026-11-21', to: null }, doctor: 'Dr. Meena R' }))).toBe(false);
  });

  it('a channel filter keeps only delivered reports (a pending row has no channel yet)', () => {
    expect(reportPasses(rep('p', { deliveredVia: 'print' }), f({ via: 'print' }))).toBe(false);
  });

  it('partly-reported orders: dated by the order, matched by doctor, never by a channel', () => {
    expect(partialPasses(po(), NO_CLIENT_FILTERS)).toBe(true);
    expect(partialPasses(po(), f({ via: 'print' }))).toBe(false);
    expect(partialPasses(po({ refDoctorName: 'Dr. Meena R' }), f({ doctor: 'Dr. Meena R' }))).toBe(true);
    expect(partialPasses(po(), f({ doctor: 'Dr. Meena R' }))).toBe(false);
    expect(partialPasses(po(), f({ range: { from: '2026-11-21', to: null } }))).toBe(false);
  });

  it('doctor options: distinct (case / spaces folded), A→Z, from reports and partly-reported orders', () => {
    const rows = [rep('a', { order: { id: 'o', refDoctorName: 'Dr. Zara' } }), rep('b', { order: { id: 'o', refDoctorName: 'dr. zara ' } }),
      rep('c'), rep('d', { order: { id: 'o', refDoctorName: 'Dr. Arun' } })];
    expect(doctorNames(rows, [po({ refDoctorName: 'Dr. Meena' })])).toEqual(['Dr. Arun', 'Dr. Meena', 'Dr. Zara']);
    expect(doctorNames([rep('x')])).toEqual([]);
  });

  it('channel options: only delivered rows, WhatsApp · Print · Email · SMS order, labels in words', () => {
    const rows = [rep('a', { deliveryStatus: 'delivered', deliveredVia: 'print' }), rep('b', { deliveryStatus: 'delivered', deliveredVia: 'whatsapp' }),
      rep('c', { deliveryStatus: 'pending', deliveredVia: 'email' }), rep('d', { deliveryStatus: 'delivered', deliveredVia: 'courier' })];
    expect(viaKeys(rows)).toEqual(['whatsapp', 'print', 'courier']);
    expect(['whatsapp', 'print', 'email', 'sms', 'courier'].map(viaLabel)).toEqual(['WhatsApp', 'Print', 'Email', 'SMS', 'Courier']);
  });
});

describe('Results filters — breakdown, badge, scan', () => {
  it('shares are each row of the group total (0 when the group is empty)', () => {
    expect(withShares([{ key: 'a', label: 'A', count: 3, dot: 'x' }, { key: 'b', label: 'B', count: 1, dot: 'y' }]).map(r => r.share)).toEqual([75, 25]);
    expect(withShares([{ key: 'a', label: 'A', count: 0, dot: 'x' }]).map(r => r.share)).toEqual([0]);
  });

  it('the badge counts each filter that is on', () => {
    expect(activeCount('all', NO_CLIENT_FILTERS)).toBe(0);
    expect(activeCount('pending', NO_CLIENT_FILTERS)).toBe(1);
    expect(activeCount('delivered', f({ range: { from: '2026-11-20', to: '2026-11-20' }, doctor: 'Dr. A', via: 'print' }))).toBe(4);
    expect(clientActive(NO_CLIENT_FILTERS)).toBe(false);
    expect(clientActive(f({ via: 'print' }))).toBe(true);
  });

  it('scan: pages keep loading until the range is complete (newest first) or the cap; never while busy', () => {
    const base = { active: true, hasMore: true, busy: false, pages: 1, from: '2026-11-20', oldestIso: '2026-11-20T03:00:00Z' };
    expect(shouldScan(base)).toBe(true);
    expect(shouldScan({ ...base, oldestIso: '2026-11-19T10:00:00Z' })).toBe(false);   // past the range's start
    expect(shouldScan({ ...base, busy: true })).toBe(false);
    expect(shouldScan({ ...base, hasMore: false })).toBe(false);
    expect(shouldScan({ ...base, active: false })).toBe(false);
    expect(shouldScan({ ...base, pages: SCAN_PAGES_DATE })).toBe(false);
    expect(shouldScan({ ...base, from: null, pages: SCAN_PAGES_NO_DATE - 1 })).toBe(true);
    expect(shouldScan({ ...base, from: null, pages: SCAN_PAGES_NO_DATE })).toBe(false);
  });
});
