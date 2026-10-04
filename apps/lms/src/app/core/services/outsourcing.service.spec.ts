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

  /** Polls for the next outstanding request a few microtasks out — `fetch()`
   *  awaits the previous one's whole async chain (seq check, signal writes)
   *  before `loadAll()`'s while-loop issues the next, so the next HTTP call
   *  doesn't exist yet on the very same microtask as the previous flush. */
  async function nextRequest(tries = 20) {
    for (let i = 0; i < tries; i++) {
      const [req] = ctl.match(r => r.urlWithParams.includes('/api/samples/outsourced'));
      if (req) return req;
      await Promise.resolve();
    }
    throw new Error('no further /api/samples/outsourced request appeared');
  }

  describe('loadAll() — the frontdesk merged list needs the WHOLE window, not one page', () => {
    it('fetches every page until hasMore() is false, merging them in order', async () => {
      const p = svc.loadAll();
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 5, 1, true) });
      (await nextRequest()).flush({ success: true, data: page([tube('3'), tube('4')], 5, 2, true) });
      (await nextRequest()).flush({ success: true, data: page([tube('5')], 5, 3, false) });
      await p;
      expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2', '3', '4', '5']);
      expect(svc.hasMore()).toBe(false);
      expect(svc.truncated()).toBe(false);
      ctl.verify();
    });

    it('stops at the cap and reports truncated() — never silently drops the "more exist" fact', async () => {
      const p = svc.loadAll(3); // cap of 3 for this test, well under a real window
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 10, 1, true) });
      (await nextRequest()).flush({ success: true, data: page([tube('3'), tube('4')], 10, 2, true) });
      await p;
      expect(svc.rows().length).toBe(4); // stopped once length >= cap (3), not mid-page
      expect(svc.hasMore()).toBe(true); // the server still has more
      expect(svc.truncated()).toBe(true);
      ctl.verify();
    });

    it('P0-1 regression — a SHIFTING window (a new tube inserted ahead of the offset) never loops forever', async () => {
      // total never reaches what _rows().length counts, because every "later"
      // page the server returns is entirely rows we already have (the window
      // shifted under us) — the OLD bug derived hasMore from rows().length <
      // total, which this would make permanently true. The server's own
      // `hasMore` is what must end the loop instead.
      const p = svc.loadAll();
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 5, 1, true) });
      // page 2 comes back FULL (pageSize items) but entirely duplicates of
      // page 1 — a real shift would never duplicate ALL of them, but this is
      // the worst case: 0 NEW rows from a full-size page.
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 5, 2, true) });
      await p;
      expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2']); // nothing new was added
      ctl.verify(); // exactly 2 requests — it did NOT keep fetching page 3, 4, 5…
    });

    it('P0-1 regression — an EMPTY "more" page (rawCount 0) stops the loop, however hasMore reads', async () => {
      const p = svc.loadAll();
      (await nextRequest()).flush({ success: true, data: page([tube('1')], 5, 1, true) });
      // The server still (perhaps wrongly) claims hasMore, but hands back
      // nothing — loadAll must not spin fetching empty pages forever.
      (await nextRequest()).flush({ success: true, data: page([], 5, 2, true) });
      await p;
      expect(svc.rows().map(r => r.sampleId)).toEqual(['1']);
      ctl.verify(); // exactly 2 requests
    });

    it('is a no-op once already fully loaded for the current status/partnerId — no request at all', async () => {
      const p1 = svc.loadAll();
      (await nextRequest()).flush({ success: true, data: page([tube('1')], 1, 1, false) });
      await p1;
      ctl.verify(); // exactly one request so far

      await svc.loadAll(); // same filter, already fully loaded — must not hit the network
      ctl.verify();
    });

    it('resumes a PARTIAL load for the same filter instead of restarting from page 1', async () => {
      // ensureLoaded() (or load()) leaves page 1 only…
      const p1 = svc.load();
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 5, 1, true) });
      await p1;

      // …loadAll() continues from page 2, not a fresh reset.
      const p2 = svc.loadAll();
      const req2 = await nextRequest();
      expect(req2.request.urlWithParams).toContain('page=2');
      req2.flush({ success: true, data: page([tube('3'), tube('4')], 5, 2, true) });
      (await nextRequest()).flush({ success: true, data: page([tube('5')], 5, 3, false) });
      await p2;
      expect(svc.rows().map(r => r.sampleId)).toEqual(['1', '2', '3', '4', '5']);
    });

    it('a status change after loadAll() clears truncated() on the next load (fetch resets it)', async () => {
      const p1 = svc.loadAll(2);
      (await nextRequest()).flush({ success: true, data: page([tube('1'), tube('2')], 5, 1, true) });
      await p1;
      expect(svc.truncated()).toBe(true);

      svc.status.set('completed');
      TestBed.tick();
      (await nextRequest()).flush({ success: true, data: page([tube('9')], 1, 1, false) });
      await Promise.resolve();
      expect(svc.truncated()).toBe(false);
    });
  });

  describe('ensureLoaded() — the dedicated Outsourced tab must not re-fetch what the merged list already loaded', () => {
    it('fetches when nothing is loaded yet', async () => {
      const p = svc.ensureLoaded();
      (await nextRequest()).flush({ success: true, data: page([tube('1')], 1, 1, false) });
      await p;
      expect(svc.rows().map(r => r.sampleId)).toEqual(['1']);
    });

    it('is a no-op when the SAME status/partnerId is already loaded', async () => {
      const p1 = svc.ensureLoaded();
      (await nextRequest()).flush({ success: true, data: page([tube('1')], 1, 1, false) });
      await p1;
      ctl.verify();

      await svc.ensureLoaded(); // same filter ('outsourced', no partner) — no request
      ctl.verify();
    });

    it('still fetches for a DIFFERENT status/partnerId (a real filter change, e.g. classic design narrowing)', async () => {
      const p1 = svc.ensureLoaded();
      (await nextRequest()).flush({ success: true, data: page([tube('1')], 1, 1, false) });
      await p1;

      svc.status.set('completed');
      TestBed.tick(); // the refetch-on-filter-change effect already fetches once…
      (await nextRequest()).flush({ success: true, data: page([tube('2')], 1, 1, false) });
      await Promise.resolve();

      // …so by the time ensureLoaded() is asked, 'completed' is already current — no second request.
      await svc.ensureLoaded();
      ctl.verify();
    });
  });
});
