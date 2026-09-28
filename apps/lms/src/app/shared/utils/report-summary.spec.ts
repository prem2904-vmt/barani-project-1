import { of } from 'rxjs';
import { vi } from 'vitest';
import { ensureFullReport, REPORT_QUEUE_SUMMARY_URL, reportByOrderSummaryUrl, reportQueuePageUrl, reportQueueServerStatus } from './report-summary';

describe('report summary reads (DB optimisation phase 2)', () => {
  it('list URLs ask for the summary view', () => {
    expect(REPORT_QUEUE_SUMMARY_URL).toBe('/api/reports/queue?view=summary');
    expect(reportByOrderSummaryUrl('o1')).toBe('/api/reports/by-order/o1?view=summary');
  });

  it('a summary row is completed from GET /api/reports/{id}; the row\'s order / patient are kept', async () => {
    const api = { get: vi.fn(() => of({ id: 'r1', type: 'final', data: '{"tests":[]}' })) };
    const row = { id: 'r1', type: 'final', deliveryStatus: 'pending', order: { orderNumber: 'ORD-1', patient: { displayName: 'Arun' } } };
    const full = await ensureFullReport(api as never, row as { id: string; data?: string | null; order?: unknown });
    expect(api.get).toHaveBeenCalledWith('/api/reports/r1');
    expect(full).toEqual({ ...row, data: '{"tests":[]}' });
  });

  it('a row that already carries its data is used as is (no extra read)', async () => {
    const api = { get: vi.fn() };
    const row = { id: 'r1', data: '{}' };
    expect(await ensureFullReport(api as never, row)).toBe(row);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('a missing report throws (the caller shows its render-failed toast)', async () => {
    const api = { get: vi.fn(() => of(null)) };
    await expect(ensureFullReport(api as never, { id: 'gone' })).rejects.toThrow();
  });
});


describe('report queue paging URLs (DB optimisation phase 3)', () => {
  it('builds the paged summary URL; a blank search is left out, a real one is encoded', () => {
    expect(reportQueuePageUrl({ page: 2, pageSize: 50, status: 'pending', q: '  ' }))
      .toBe('/api/reports/queue?view=summary&page=2&pageSize=50&status=pending');
    expect(reportQueuePageUrl({ page: 1, pageSize: 100, status: 'all', q: ' Dr. A&B ' }))
      .toBe('/api/reports/queue?view=summary&page=1&pageSize=100&status=all&q=Dr.%20A%26B');
  });

  it('maps tabs to server statuses (All / Partial read the whole queue)', () => {
    expect(reportQueueServerStatus('pending')).toBe('pending');
    expect(reportQueueServerStatus('delivered')).toBe('delivered');
    expect(reportQueueServerStatus('failed')).toBe('failed');
    expect(reportQueueServerStatus('all')).toBe('all');
    expect(reportQueueServerStatus('partial')).toBe('all');
  });
});
