import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { NotificationsStore, PAGE_FIRST, PAGE_STEP } from './notifications.store';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { Notification } from '../../models/user.model';
import { mergeNotifications } from './notification-merge';
import { rowAction } from './notification-action';

const NOW = Date.now();
const row = (id: string, type: string, minAgo: number, over: Partial<Notification> = {}): Notification => ({
  id, tenantId: 't', recipientId: 'u', type, title: 'T ' + id, body: 'b', isRead: false,
  createdAt: new Date(NOW - minAgo * 60_000).toISOString(), referenceType: 'order_test', referenceId: 'ot-' + id, ...over,
});

function setup(list: Notification[], opts: { perms?: boolean; ackFails?: string[] } = {}) {
  const api = {
    get: vi.fn((url: string): Observable<Notification[]> => {
      const m = /limit=(\d+)/.exec(url);
      return of(m ? list.slice(0, Number(m[1])) : list.slice(0, 50));
    }),
    patch: vi.fn(() => of({})),
  };
  const critical = {
    acknowledgeOrderTest: vi.fn((ref: string) => opts.ackFails?.includes(ref)
      ? throwError(() => new Error('boom')) : of([{ id: 'e-' + ref, status: 'acknowledged' }])),
  };
  const toasts = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { hasPermission: () => !!(opts.perms ?? true), hasAnyPermission: () => !!(opts.perms ?? true) } },
      { provide: CriticalResultsService, useValue: critical },
      { provide: ToastService, useValue: toasts },
    ],
  });
  return { store: TestBed.inject(NotificationsStore), api, critical, toasts };
}

describe('NotificationsStore', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('the badge counts unread notifications of the bell list — same logic as before the redesign', () => {
    const { store, api } = setup([row('1', 'critical_value', 1), row('2', 'critical_value', 2), row('3', 'report_ready', 3, { isRead: true })]);
    store.loadBell();
    expect(api.get).toHaveBeenCalledWith('/api/notifications/');
    expect(store.unreadCount()).toBe(2);              // 2 unread NOTIFICATIONS, even though they merge to 1 row
    expect(store.merge(store.items()).length).toBe(3);   // different order tests: three rows
  });

  it('marking a merged row read reads every notification it stands for, in the bell list AND the page list', () => {
    const list = [row('a', 'tat_breach', 1, { referenceId: 'x', referenceType: 'order_sample' }), row('b', 'tat_breach', 10, { referenceId: 'x', referenceType: 'order_sample' })];
    const { store, api } = setup(list);
    store.loadBell(); store.loadPage();
    const merged = mergeNotifications(store.items());
    expect(merged.length).toBe(1);
    store.markRowRead(merged[0]);
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/a/read');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/b/read');
    expect(store.unreadCount()).toBe(0);
    expect(store.pageUnread()).toBe(0);
  });

  it('acknowledging a merged row acknowledges EVERY result it stands for, then reads every member', () => {
    const { store, api, critical, toasts } = setup([row('a', 'critical_value', 1), row('b', 'critical_value', 2)]);
    store.loadBell();
    // Two alerts, two different order tests, merged into one row by hand (the data shape a wider merge key would give).
    const merged = mergeNotifications(store.items());
    expect(merged.length).toBe(2);
    const one = { ...merged[0], ids: ['a', 'b'], refs: ['ot-a', 'ot-b'], count: 2, unread: 2 };
    store.acknowledge(one);
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledTimes(2);
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledWith('ot-a', 'bell');
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledWith('ot-b', 'bell');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/a/read');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/b/read');
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith('Critical result acknowledged');
    expect(store.acking()).toBeNull();
    expect(store.unreadCount()).toBe(0);
  });

  it('a duplicate pair for the SAME result is one acknowledgement and two reads', () => {
    const { store, api, critical } = setup([row('a', 'critical_value', 1, { referenceId: 'ot-9' }), row('b', 'critical_value', 5, { referenceId: 'ot-9' })]);
    store.loadBell();
    const merged = mergeNotifications(store.items());
    expect(merged.length).toBe(1);
    expect(merged[0].count).toBe(2);
    store.acknowledge(merged[0]);
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledTimes(1);
    expect(critical.acknowledgeOrderTest).toHaveBeenCalledWith('ot-9', 'bell');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/a/read');
    expect(api.patch).toHaveBeenCalledWith('/api/notifications/b/read');
    expect(store.canAcknowledge(store.items()[0])).toBe(false);   // the button goes away
  });

  it('a failed acknowledgement reads nothing and says why', () => {
    const { store, api, toasts } = setup([row('a', 'critical_value', 1)], { ackFails: ['ot-a'] });
    store.loadBell();
    store.acknowledge(mergeNotifications(store.items())[0]);
    expect(api.patch).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalled();
    expect(store.unreadCount()).toBe(1);
    expect(store.acking()).toBeNull();
  });

  it('only a person who may act on results can acknowledge, and only critical kinds on an order test', () => {
    const crit = row('a', 'critical_value', 1);
    expect(setup([crit], { perms: true }).store.canAcknowledge(crit)).toBe(true);
    TestBed.resetTestingModule();
    expect(setup([crit], { perms: false }).store.canAcknowledge(crit)).toBe(false);
    TestBed.resetTestingModule();
    const { store } = setup([]);
    expect(store.canAcknowledge(row('b', 'report_ready', 1, { referenceType: 'report' }))).toBe(false);
    expect(store.canAcknowledge(row('c', 'critical_value', 1, { referenceId: undefined }))).toBe(false);
  });

  it('Mark all read patches every unread one once (bell list; the page list too when asked)', () => {
    const list = [row('1', 'report_ready', 1), row('2', 'tat_breach', 2), row('3', 'tat_breach', 3, { isRead: true })];
    const { store, api } = setup(list);
    store.loadBell(); store.loadPage();
    store.markAllRead(true);
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(store.unreadCount()).toBe(0);
    expect(store.pageUnread()).toBe(0);
  });

  it('the page list grows with infinite scroll: first PAGE_FIRST, then PAGE_STEP more while the server fills the ask', () => {
    const list = Array.from({ length: 230 }, (_, i) => row('n' + i, 'report_ready', i + 1));
    const { store, api } = setup(list);
    store.loadPage();
    expect(api.get).toHaveBeenLastCalledWith(`/api/notifications/?limit=${PAGE_FIRST}`);
    expect(store.pageItems().length).toBe(100);
    expect(store.pageHasMore()).toBe(true);
    store.loadMore();
    expect(api.get).toHaveBeenLastCalledWith(`/api/notifications/?limit=${PAGE_FIRST + PAGE_STEP}`);
    expect(store.pageItems().length).toBe(200);
    store.loadMore();
    expect(store.pageItems().length).toBe(230);
    expect(store.pageHasMore()).toBe(false);          // server returned fewer than asked: the end
  });
});

describe('rowAction — one in-place action per row, always an existing flow', () => {
  const policy = (canAck: boolean) => ({
    canAcknowledge: () => canAck,
    linkFor: (n: Notification) => n.referenceType ? { commands: ['/x'] } : null,
  });
  it('Acknowledge for a critical result the person can acknowledge', () => {
    expect(rowAction(row('1', 'critical_value', 1), policy(true))).toMatchObject({ kind: 'ack', label: 'Acknowledge', danger: true });
  });
  it('otherwise a verb that fits the screen it opens', () => {
    expect(rowAction(row('1', 'critical_value', 1), policy(false))?.label).toBe('View');
    expect(rowAction(row('2', 'tat_breach', 1, { referenceType: 'order_sample' }), policy(false))?.label).toBe('Open sample');
    expect(rowAction(row('3', 'billed_not_collected', 1, { referenceType: 'order' }), policy(false))?.label).toBe('Open order');
    expect(rowAction(row('4', 'result_comment_added', 1), policy(false))?.label).toBe('Reply');
    expect(rowAction(row('5', 'report_blocked', 1, { referenceType: 'order' }), policy(false))).toMatchObject({ label: 'Retry', route: { commands: ['/reports'] } });
    expect(rowAction(row('6', 'report_ready', 1, { referenceType: 'report' }), policy(false))?.label).toBe('View');
  });
  it('no screen and nothing to acknowledge → no button', () => {
    expect(rowAction(row('7', 'user_created', 1, { referenceType: undefined, referenceId: undefined }), policy(false))).toBeNull();
  });
});
