import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { Notification } from '../../models/user.model';
import { canonicalNotificationType } from '../../utils/notification-type';
import { MergedNotification, mergeNotifications, unreadOf } from './notification-merge';
import { NotifRoute, notificationRoute } from './notification-route';

/** How many rows the Notifications page asks for first, and per extra page (the API takes only `limit`). */
export const PAGE_FIRST = 100;
export const PAGE_STEP = 100;
export const PAGE_MAX = 1000;

/**
 * The ONE notification state shared by the bell popover and the Notifications page.
 *
 * - `items`      = the bell's list (GET /api/notifications/, the server's default 50) — the badge and the popover read
 *                  ONLY this, so the unread count is exactly today's badge logic.
 * - `pageItems`  = the page's list, fetched with a growing `limit` (infinite scroll).
 * Reading / acknowledging updates BOTH, so the badge and the page never disagree.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly critical = inject(CriticalResultsService);
  private readonly toasts = inject(ToastService);

  private readonly _items = signal<Notification[]>([]);
  private readonly _page = signal<Notification[]>([]);
  private readonly _acked = signal<Set<string>>(new Set());
  readonly items = this._items.asReadonly();
  readonly pageItems = this._page.asReadonly();
  /** Merged-row key being acknowledged right now. */
  readonly acking = signal<string | null>(null);
  readonly pageLoading = signal(false);
  readonly pageLoaded = signal(false);
  readonly pageHasMore = signal(false);
  /** True once the bell's first fetch has answered (the live-region announcer waits for it). */
  readonly bellLoaded = signal(false);
  private pageLimit = 0;

  /** The bell badge: unread among the bell's list. UNCHANGED logic. */
  readonly unreadCount = computed(() => unreadOf(this._items()));
  readonly pageUnread = computed(() => unreadOf(this._page()));

  // ── loading ─────────────────────────────────────────────────────────
  loadBell(): void {
    this.api.get<Notification[]>('/api/notifications/').subscribe({
      next: list => { this._items.set(list ?? []); this.bellLoaded.set(true); },
      error: () => { this._items.set([]); this.bellLoaded.set(true); },
    });
  }

  /** First page (or a refresh keeping the rows already shown). */
  loadPage(refresh = false): void {
    if (this.pageLoading()) return;
    this.pageLimit = refresh && this.pageLimit ? this.pageLimit : PAGE_FIRST;
    this.fetchPage();
  }

  /** Infinite scroll: ask for the next step of rows. */
  loadMore(): void {
    if (this.pageLoading() || !this.pageHasMore()) return;
    this.pageLimit = Math.min(PAGE_MAX, this.pageLimit + PAGE_STEP);
    this.fetchPage();
  }

  private fetchPage(): void {
    const asked = this.pageLimit;
    this.pageLoading.set(true);
    this.api.get<Notification[]>(`/api/notifications/?limit=${asked}`).subscribe({
      next: list => {
        const rows = list ?? [];
        this._page.set(rows);
        this.pageHasMore.set(rows.length >= asked && asked < PAGE_MAX);
        this.pageLoading.set(false);
        this.pageLoaded.set(true);
      },
      error: () => { this.pageLoading.set(false); this.pageLoaded.set(true); this.pageHasMore.set(false); },
    });
  }

  // ── reading ─────────────────────────────────────────────────────────
  private patchRead(ids: ReadonlySet<string>): void {
    const upd = (list: Notification[]) => list.map(x => ids.has(x.id) ? { ...x, isRead: true } : x);
    this._items.update(upd);
    this._page.update(upd);
  }

  markRead(n: Notification): void {
    if (n.isRead) return;
    this.api.patch(`/api/notifications/${n.id}/read`).subscribe({ next: () => this.patchRead(new Set([n.id])) });
  }

  /** Read every notification a (merged) row stands for — only the ones still unread. */
  markRowRead(row: MergedNotification): void {
    const unread = this.membersOf(row).filter(n => !n.isRead);
    if (!unread.length) return;
    const ids = new Set(unread.map(n => n.id));
    unread.forEach(n => this.api.patch(`/api/notifications/${n.id}/read`).subscribe());
    this.patchRead(ids);
  }

  /** The bell's "Mark all read" (today's behaviour: the bell's own list). */
  markAllRead(includePage = false): void {
    const unread = new Map<string, Notification>();
    for (const n of this._items()) if (!n.isRead) unread.set(n.id, n);
    if (includePage) for (const n of this._page()) if (!n.isRead) unread.set(n.id, n);
    if (unread.size === 0) return;
    unread.forEach(n => this.api.patch(`/api/notifications/${n.id}/read`).subscribe());
    this.patchRead(new Set(unread.keys()));
  }

  private membersOf(row: MergedNotification): Notification[] {
    const ids = new Set(row.ids);
    const seen = new Map<string, Notification>();
    for (const n of [...this._items(), ...this._page()]) if (ids.has(n.id)) seen.set(n.id, n);
    return [...seen.values()];
  }

  // ── actions (existing flows) ────────────────────────────────────────
  linkFor(n: Notification): NotifRoute | null {
    return notificationRoute(n.type, n.referenceType, n.referenceId, this.auth.hasPermission('validate_result'));
  }

  /** Critical bells referencing an order test, for a user who may act on results, not yet acknowledged this session. */
  canAcknowledge(n: Notification): boolean {
    const t = canonicalNotificationType(n.type);
    if (t !== 'critical_value' && t !== 'critical_unvalidated') return false;
    if (n.referenceType !== 'order_test' || !n.referenceId) return false;
    if (this._acked().has(n.referenceId)) return false;
    return this.auth.hasAnyPermission?.(['enter_result', 'validate_result']) ?? false;
  }

  /**
   * NABL: the explicit acknowledgement (the existing flow, via 'bell'). A merged row acknowledges EVERY result it
   * stands for (one POST per distinct referenceId) and then reads every member. Reading alone is never the record.
   */
  acknowledge(row: MergedNotification): void {
    if (!row.refs.length || this.acking()) return;
    this.acking.set(row.key);
    const refs = [...row.refs];
    let pending = refs.length, touchedAny = false, failed = false;
    const done = () => {
      if (--pending > 0) return;
      this.acking.set(null);
      if (failed) return;
      this.markRowRead(row);
      this.toasts.success(touchedAny ? 'Critical result acknowledged' : 'Already acknowledged');
    };
    for (const ref of refs) {
      this.critical.acknowledgeOrderTest(ref, 'bell').subscribe({
        next: touched => {
          if (touched.length) touchedAny = true;
          this._acked.update(s => new Set(s).add(ref));
          done();
        },
        error: e => {
          if (!failed) this.toasts.error(ApiError.from(e).message);
          failed = true; done();
        },
      });
    }
  }

  /** Merged rows for a list (newest first). */
  merge(list: readonly Notification[]): MergedNotification[] { return mergeNotifications(list); }
}
