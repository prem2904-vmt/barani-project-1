import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { HUB_FACTORY } from './hub-factory';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { LiveQueueService } from './live-queue.service';
import { WORK_EVENTS_CONFIG, WorkChange, WorkEventsService, workAreasFor } from './work-events.service';

/**
 * Live work screens — the client half. /hubs/work is a FakeHub (DI seam
 * HUB_FACTORY) so the tests see the token, the JoinBranch calls, the stop on
 * account switch, and what a late event on a stale socket does.
 */

interface Person { id: string; authId: string; tenantId: string }
const ADMIN: Person = { id: 'u-admin', authId: 'sub-admin', tenantId: 't1' };
const PRIYA: Person = { id: 'u-priya', authId: 'sub-priya', tenantId: 't1' };

const DEBOUNCE = 400;
const POLL = 60_000;

function setup() {
  FakeHub.reset();
  const user = signal<Person | null>(null);
  const activeBranchId = signal<string | null>('b-chennai');
  const auth = {
    user,
    activeBranchId,
    getAccessToken: async () => (user() ? `jwt-${user()!.authId}` : null),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: auth },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
      { provide: WORK_EVENTS_CONFIG, useValue: { debounceMs: DEBOUNCE, fallbackPollMs: POLL } },
    ],
  });
  const svc = TestBed.inject(WorkEventsService);
  const scope = TestBed.inject(SessionScopeService);
  const signInAs = (p: Person) => {
    scope.changed({ userId: p.id, tenantId: p.tenantId, authId: p.authId });
    user.set(p);
    TestBed.tick();
  };
  const hub = () => FakeHub.last('/hubs/work')!;
  /** Server confirms whichever branch was asked for. */
  const echoJoins = (h: FakeHub) => { h.responses['JoinBranch'] = (b: unknown) => (b as string) ?? 'b-default'; };
  return { svc, scope, user, activeBranchId, signInAs, hub, echoJoins };
}

/** Let awaited fake-hub promises settle. */
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('workAreasFor', () => {
  it('routes each owner-listed transition to the lists that show it', () => {
    expect(workAreasFor('order.created')).toEqual(expect.arrayContaining(['collection', 'frontdesk', 'billing']));
    expect(workAreasFor('sample.collected')).toEqual(expect.arrayContaining(['collection', 'frontdesk', 'receive']));
    expect(workAreasFor('sample.rejected')).toContain('collection');          // Can't collect
    expect(workAreasFor('sample.received')).toEqual(expect.arrayContaining(['receive', 'my_work']));
    expect(workAreasFor('result.submitted')).toEqual(expect.arrayContaining(['my_work', 'validation']));
    expect(workAreasFor('result.validated')).toEqual(expect.arrayContaining(['validation', 'reports']));
    expect(workAreasFor('report.delivered')).toContain('reports');
    expect(workAreasFor('bill.paid')).toEqual(expect.arrayContaining(['billing', 'collection']));   // pay-first gate
    expect(workAreasFor('bill.pay_later')).toContain('billing');
    expect(workAreasFor('result.draft')).toEqual(['my_work']);                // autosave never pings validators
    expect(workAreasFor('sample.brand_new_kind')).toContain('collection');   // prefix fallback
    expect(workAreasFor('nonsense')).toEqual([]);
  });
});

describe('WorkEventsService', () => {
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  it('opens /hubs/work with the user token and joins the ACTIVE branch', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    const started = t.svc.start();
    t.echoJoins(t.hub());
    await started;
    const h = t.hub();
    expect(h.token).toBe('jwt-sub-admin');
    expect(h.invoked).toEqual([{ method: 'JoinBranch', args: ['b-chennai'] }]);
    expect(t.svc.connected()).toBe(true);
    expect(t.svc.joinedBranch()).toBe('b-chennai');
  });

  it('coalesces a burst of matching events into ONE debounced refetch; other areas are ignored', async () => {
    vi.useFakeTimers();
    const t = setup();
    const refetch = vi.fn<(c: WorkChange) => void>();
    const sub = t.svc.on('collection').subscribe(refetch);

    t.svc.push({ type: 'sample.collected', id: 's1' });
    t.svc.push({ type: 'order.created' });
    vi.advanceTimersByTime(DEBOUNCE - 50);
    t.svc.push({ type: 'bill.paid', id: 'b1' });
    t.svc.push({ type: 'result.validated', id: 'r1' });      // not a collection event
    expect(refetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.calls[0][0].reason).toBe('event');

    t.svc.push({ type: 'result.validated', id: 'r2' });
    vi.advanceTimersByTime(DEBOUNCE * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });

  it('a destroyed screen stops refetching (takeUntilDestroyed cleans the subscription up)', () => {
    vi.useFakeTimers();
    const t = setup();
    const refetch = vi.fn();
    @Component({ selector: 'pf-live-host', template: '' })
    class Host {
      constructor() {
        inject(WorkEventsService).on('my_work').pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(refetch);
      }
    }
    const f = TestBed.createComponent(Host);
    t.svc.push({ type: 'sample.received' });
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);

    f.destroy();
    t.svc.push({ type: 'sample.received' });
    vi.advanceTimersByTime(DEBOUNCE);
    vi.advanceTimersByTime(POLL * 2);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('account switch: old socket stopped, a late event on it is dropped, a new socket joins for the new user', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.signInAs(ADMIN);
    const first = t.svc.start();
    t.echoJoins(t.hub());
    await first;
    const adminHub = t.hub();
    const refetch = vi.fn();
    t.svc.on('collection').subscribe(refetch);

    t.signInAs(PRIYA);                       // session reset + autostart
    await settle();
    expect(adminHub.stopped).toBe(true);
    const priyaHub = t.hub();
    expect(priyaHub).not.toBe(adminHub);
    t.echoJoins(priyaHub);
    await settle();
    expect(priyaHub.token).toBe('jwt-sub-priya');

    adminHub.emit('WorkEvent', { type: 'sample.collected', id: 'late' });
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).not.toHaveBeenCalled();

    priyaHub.emit('WorkEvent', { type: 'sample.collected', id: 'fresh' });
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.calls[0][0].event.id).toBe('fresh');
  });

  it('sign-out stops the socket and does not reconnect', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    const s = t.svc.start();
    t.echoJoins(t.hub());
    await s;
    const h = t.hub();
    t.scope.changed(null);
    t.user.set(null);
    TestBed.tick();
    await settle();
    expect(h.stopped).toBe(true);
    expect(t.svc.connected()).toBe(false);
    expect(FakeHub.all.filter(x => x.url.includes('/hubs/work')).length).toBe(1);
  });

  it('branch switch rejoins the new branch group', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    const s = t.svc.start();
    t.echoJoins(t.hub());
    await s;
    t.activeBranchId.set('b-salem');
    TestBed.tick();
    await settle();
    expect(t.hub().invoked.map(i => i.args[0])).toEqual(['b-chennai', 'b-salem']);
    expect(t.svc.joinedBranch()).toBe('b-salem');
  });

  it('fallback poll runs only while disconnected; reconnect rejoins and refetches', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.signInAs(ADMIN);
    const s = t.svc.start();
    t.echoJoins(t.hub());
    await s;
    const refetch = vi.fn<(c: WorkChange) => void>();
    t.svc.on('billing').subscribe(refetch);

    vi.advanceTimersByTime(POLL * 2 + DEBOUNCE);       // connected → no poll
    expect(refetch).not.toHaveBeenCalled();

    t.hub().drop();
    expect(t.svc.connected()).toBe(false);
    vi.advanceTimersByTime(POLL + DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.calls[0][0].reason).toBe('poll');

    await t.hub().reconnect();
    await settle();
    expect(t.svc.connected()).toBe(true);
    expect(t.hub().invoked.filter(i => i.method === 'JoinBranch').length).toBe(2);
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(2);
    expect(refetch.mock.calls[1][0].reason).toBe('reconnect');

    vi.advanceTimersByTime(POLL * 2);                   // connected again → quiet
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  it('a refused join (stale branch) counts as disconnected so the poll keeps screens fresh', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.signInAs(ADMIN);
    const s = t.svc.start();
    t.hub().responses['JoinBranch'] = () => null;
    await s;
    expect(t.svc.connected()).toBe(false);
    const refetch = vi.fn();
    t.svc.on('frontdesk').subscribe(refetch);
    vi.advanceTimersByTime(POLL + DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('tab coming back into view refetches', () => {
    vi.useFakeTimers();
    const t = setup();
    const refetch = vi.fn<(c: WorkChange) => void>();
    t.svc.on('validation').subscribe(refetch);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(DEBOUNCE);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch.mock.calls[0][0].reason).toBe('focus');
  });

  it('LiveQueueService is the same DI token (old imports + spec providers keep working)', () => {
    setup();
    expect(TestBed.inject(LiveQueueService)).toBe(TestBed.inject(WorkEventsService));
  });
});
