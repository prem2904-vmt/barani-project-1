/**
 * Duplicate alerts collapse into ONE row.
 *
 * The same kind about the same entity inside a short window ("critical result for order-test X" firing twice) is one
 * thing the person must deal with, so the inbox shows one row — "alerted 2 times" — instead of a wall. Acknowledging
 * or reading the merged row acts on EVERY notification it stands for.
 *
 * Merge key = canonical kind + referenceType + referenceId. A row with no referenceId never merges (nothing says it is
 * the same thing). A chain merges while each next-older alert is within MERGE_WINDOW_MS of the previous one.
 * Pure — unit-tested. The unread COUNT is never taken from merged rows: it is always the plain count of unread
 * notifications (the bell badge's logic), see `unreadOf`.
 */
import { Notification } from '../../models/user.model';
import { canonicalNotificationType } from '../../utils/notification-type';
import { NotifGroup, kindMeta } from './notification-kinds';

/** Two alerts of the same kind about the same entity within this long are the same alert. */
export const MERGE_WINDOW_MS = 60 * 60_000;

export interface MergedNotification {
  /** Stable key: the newest member's id. */
  key: string;
  /** The newest member — what the row shows. */
  rep: Notification;
  /** Every member's id, newest first (rep.id first). */
  ids: string[];
  /** Distinct referenceIds across the members (usually one). */
  refs: string[];
  /** How many notifications this row stands for. */
  count: number;
  /** Read only when EVERY member is read. */
  isRead: boolean;
  /** Members that are still unread. */
  unread: number;
  kind: string;
  group: NotifGroup;
  createdAt: string;
}

const time = (n: Notification) => new Date(n.createdAt).getTime();

export function mergeNotifications(list: readonly Notification[], windowMs = MERGE_WINDOW_MS): MergedNotification[] {
  const sorted = [...list].sort((a, b) => time(b) - time(a));
  const out: MergedNotification[] = [];
  /** merge key → the open group last extended (the chain's oldest member time is `last`). */
  const open = new Map<string, { row: MergedNotification; last: number }>();
  for (const n of sorted) {
    const kind = canonicalNotificationType(n.type);
    const entity = n.referenceId ? `${n.referenceType ?? ''}:${n.referenceId}` : null;
    const key = entity ? `${kind}|${entity}` : null;
    const t = time(n);
    const hit = key ? open.get(key) : undefined;
    if (hit && hit.last - t <= windowMs) {
      hit.row.ids.push(n.id);
      if (n.referenceId && !hit.row.refs.includes(n.referenceId)) hit.row.refs.push(n.referenceId);
      hit.row.count += 1;
      if (!n.isRead) { hit.row.unread += 1; hit.row.isRead = false; }
      hit.last = t;
      continue;
    }
    const row: MergedNotification = {
      key: n.id, rep: n, ids: [n.id], refs: n.referenceId ? [n.referenceId] : [], count: 1,
      isRead: !!n.isRead, unread: n.isRead ? 0 : 1, kind, group: kindMeta(n.type).group, createdAt: n.createdAt,
    };
    out.push(row);
    if (key) open.set(key, { row, last: t });
  }
  return out;
}

/** The bell badge's logic, exactly: how many notifications are unread. */
export const unreadOf = (list: readonly Notification[]): number => list.filter(n => !n.isRead).length;

/** "alerted 2 times" for a merged row; '' for a single alert. */
export const alertedText = (count: number): string => count > 1 ? `alerted ${count} times` : '';
