import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OutsourcingService } from './outsourcing.service';
import { OutsourcedPage, OutsourcedTube } from '../../features/frontdesk/outsourced/outsourced-view';

/**
 * Server paging (release 2026-10-01): `load()` / `loadMore()` call the paged
 * endpoint (status / partnerId pushed server-side); changing status or
 * partnerId resets to page 1 (a different filter is a different page 1, not
 * a client-side slice of the same one). An older server's plain array is
 * still accepted (no paging support) — same contract as report-summary.ts.
 */
describe('OutsourcingService — server paging', () => {
  let ctl: HttpTestingController;
  let svc: OutsourcingService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    ctl = TestBed.inject(HttpTestingController);
    svc = TestBed.inject(OutsourcingService);
  });
  afterEach(() => ctl.verify());

  const tube = (id: string): OutsourcedTube => ({
    sampleId: id, barcode: `OUT-${id}`, sampleStatus: 'dispatched', orderId: `o-${id}`, orderNumber: `LAB-${id}`,
    patientId: `p-${id}`, patientName: 'Test Patient', partnerLabId: 'pl1', partnerLabName: 'Partner',
    createdAt: '2026-09-25T00:00:00Z', status: 'outsourced', hasReport: false,
    tests: [{ orderTestId: `t-${id}`, testId: 'x', testName: 'Vitamin D', status: 'outsourced', completed: false }],
  });
  const page = (items: OutsourcedTube[], total: number, p: number, hasMore: boolean): OutsourcedPage => ({
    items, total, page: p, pageSize: 2, hasMore, counts: { outsourced: total, completed: 0 },
  });
  const flush = (body: unknown) => {
    const req = ctl.expectOne(r => r.urlWithParams.includes('/api/samples/outsourced'));
    req.flush({ success: true, data: body });
    return req;
  };

  it('load() requests page 1 with status + days + pageSize', async () => {
    const p = svc.load();
    const req = flush(page([tube('1'), tube('2')], 5, 1, true));
    await p;
    expect(req.request.urlWithParams).toContain('days=90');
    expect(req.request.urlWithParams).toContain('page=1');
    expect(req.request.urlWithParams).toContain('pageSize=');
    expect(req.request.urlWithParams).toContain('status=outsourced'); // the default status
    expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2']);
    expect(svc.hasMore()).toBe(true);
    expect(svc.nextCount()).toBe(3);
    expect(svc.counts()).toEqual({ outsourced: 5, completed: 0 });
  });

  it('loadMore() appends the next page, deduped, and stops once every row is loaded', async () => {
    const p1 = svc.load();
    flush(page([tube('1'), tube('2')], 3, 1, true));
    await p1;

    const p2 = svc.loadMore();
    const req2 = flush(page([tube('2'), tube('3')], 3, 2, false)); // tube 2 repeated — must not duplicate
    await p2;
    expect(req2.request.urlWithParams).toContain('page=2');
    expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2', '3']);
    expect(svc.hasMore()).toBe(false);

    // Nothing left to load — a further call makes no request.
    await svc.loadMore();
  });

  it('changing status resets to page 1 (server-side, not a client slice)', async () => {
    const p1 = svc.load();
    flush(page([tube('1')], 1, 1, false));
    await p1;

    svc.status.set('completed');
    TestBed.tick(); // flushes the status/partnerId → refetch effect
    const req = flush(page([tube('9')], 1, 1, false));
    await Promise.resolve();
    expect(req.request.urlWithParams).toContain('status=completed');
    expect(svc.rows().map(r => r.sampleId)).toEqual(['9']); // replaced, not appended
  });

  it('changing partnerId resets to page 1 and includes partnerLabId in the request', async () => {
    const p1 = svc.load();
    flush(page([tube('1')], 1, 1, false));
    await p1;

    svc.partnerId.set('partner-xyz');
    TestBed.tick();
    const req = flush(page([tube('2')], 1, 1, false));
    await Promise.resolve();
    expect(req.request.urlWithParams).toContain('partnerLabId=partner-xyz');
  });

  it('an older (unpaged) server answering a plain array still works — no paging, no crash', async () => {
    const p = svc.load();
    const req = ctl.expectOne(r => r.urlWithParams.includes('/api/samples/outsourced'));
    req.flush({ success: true, data: [tube('1'), tube('2')] });
    await p;
    expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2']);
    expect(svc.hasMore()).toBe(false); // no total known — nothing more to load
  });

  it('a failed fetch on reset clears the rows rather than throwing', async () => {
    const p = svc.load();
    const req = ctl.expectOne(r => r.urlWithParams.includes('/api/samples/outsourced'));
    req.flush({ success: false, message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await p;
    expect(svc.rows()).toEqual([]);
  });

  it('reset() drops cached rows AND the paging state (branch switch)', async () => {
    const p = svc.load();
    flush(page([tube('1')], 5, 1, true));
    await p;
    expect(svc.hasMore()).toBe(true);

    svc.reset();
    expect(svc.rows()).toEqual([]);
    expect(svc.hasMore()).toBe(false);
  });
});
