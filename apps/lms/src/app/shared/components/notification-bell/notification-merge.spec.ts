import { Notification } from '../../models/user.model';
import { MERGE_WINDOW_MS, alertedText, mergeNotifications, unreadOf } from './notification-merge';
import { notificationDayLabel } from '../../utils/notification-day';

const T0 = new Date('2026-11-19T08:00:00Z').getTime();
const at = (minAgo: number) => new Date(T0 - minAgo * 60_000).toISOString();
const n = (id: string, type: string, minAgo: number, over: Partial<Notification> = {}): Notification => ({
  id, tenantId: 't', recipientId: 'u', type, title: 'T ' + id, isRead: false, createdAt: at(minAgo),
  referenceType: 'order_test', referenceId: 'ot-1', ...over,
});

describe('mergeNotifications', () => {
  it('collapses the same kind about the same entity into ONE row ("alerted 2 times")', () => {
    const rows = mergeNotifications([n('a', 'critical_value', 5), n('b', 'critical_value', 20)]);
    expect(rows.length).toBe(1);
    expect(rows[0].count).toBe(2);
    expect(rows[0].rep.id).toBe('a');           // the newest shows
    expect(rows[0].ids).toEqual(['a', 'b']);
    expect(alertedText(rows[0].count)).toBe('alerted 2 times');
    expect(alertedText(1)).toBe('');
  });

  it('treats lms.-prefixed and bare spellings as the same kind', () => {
    expect(mergeNotifications([n('a', 'critical_value', 1), n('b', 'lms.critical_value', 2)]).length).toBe(1);
  });

  it('does not merge different kinds, different entities, or alerts with no entity', () => {
    expect(mergeNotifications([n('a', 'critical_value', 1), n('b', 'critical_unvalidated', 2)]).length).toBe(2);
    expect(mergeNotifications([n('a', 'critical_value', 1), n('b', 'critical_value', 2, { referenceId: 'ot-2' })]).length).toBe(2);
    expect(mergeNotifications([n('a', 'tat_breach', 1, { referenceId: undefined }), n('b', 'tat_breach', 2, { referenceId: undefined })]).length).toBe(2);
  });

  it('merges only inside the window; a chain keeps merging while each step is within it', () => {
    const w = MERGE_WINDOW_MS / 60_000;
    expect(mergeNotifications([n('a', 'critical_value', 0), n('b', 'critical_value', w + 1)]).length).toBe(2);
    const chain = mergeNotifications([n('a', 'critical_value', 0), n('b', 'critical_value', w - 5), n('c', 'critical_value', 2 * w - 10)]);
    expect(chain.length).toBe(1);
    expect(chain[0].count).toBe(3);
  });

  it('is unread while ANY member is unread, read only when all are', () => {
    const mixed = mergeNotifications([n('a', 'critical_value', 1, { isRead: true }), n('b', 'critical_value', 2)]);
    expect(mixed[0].isRead).toBe(false);
    expect(mixed[0].unread).toBe(1);
    const read = mergeNotifications([n('a', 'critical_value', 1, { isRead: true }), n('b', 'critical_value', 2, { isRead: true })]);
    expect(read[0].isRead).toBe(true);
  });

  it('collects the distinct referenceIds, files the row by its kind group, and keeps newest-first order', () => {
    const rows = mergeNotifications([n('o', 'report_ready', 50, { referenceType: 'report', referenceId: 'r1' }), n('a', 'critical_value', 1), n('b', 'critical_value', 3)]);
    expect(rows.map(r => r.rep.id)).toEqual(['a', 'o']);
    expect(rows[0].refs).toEqual(['ot-1']);
    expect(rows[0].group).toBe('critical');
    expect(rows[1].group).toBe('reports');
  });

  it('does not mutate its input', () => {
    const list = [n('a', 'critical_value', 5), n('b', 'critical_value', 20)];
    const snap = JSON.stringify(list);
    mergeNotifications(list);
    expect(JSON.stringify(list)).toBe(snap);
  });
});

describe('unreadOf — the bell badge logic', () => {
  it('counts every unread notification (never merged rows)', () => {
    const list = [n('a', 'critical_value', 1), n('b', 'critical_value', 2), n('c', 'report_ready', 3, { isRead: true })];
    expect(unreadOf(list)).toBe(2);
    expect(mergeNotifications(list).length).toBe(2);
    expect(unreadOf([])).toBe(0);
  });
});

describe('notificationDayLabel (IST business day)', () => {
  const now = new Date('2026-11-19T08:00:00Z');
  it('says TODAY, YESTERDAY · 18 NOV and a plain date', () => {
    expect(notificationDayLabel('2026-11-19T02:00:00Z', now)).toBe('TODAY');
    expect(notificationDayLabel('2026-11-18T10:00:00Z', now)).toBe('YESTERDAY · 18 NOV');
    expect(notificationDayLabel('2026-11-05T10:00:00Z', now)).toBe('5 NOV');
  });
  it('uses the IST day, not the device day (18:30 UTC is already tomorrow in India)', () => {
    expect(notificationDayLabel('2026-11-18T19:00:00Z', now)).toBe('TODAY');
  });
});
