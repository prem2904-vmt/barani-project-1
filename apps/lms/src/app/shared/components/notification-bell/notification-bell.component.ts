import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Notification } from '../../models/user.model';
import { NotifRoute, notificationRoute } from './notification-route';
import { canonicalNotificationType } from '../../utils/notification-type';
import { CriticalResultsService } from '../../../core/services/critical-results.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../models/api-response.model';
import { DesktopNotifyService } from '../../../core/services/desktop-notify.service';

type TypeTone = 'rose' | 'amber' | 'emerald' | 'violet' | 'sky';

@Component({
  selector: 'pf-notification-bell',
  standalone: true,
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <button type="button"
              class="pf-bell-btn press"
              [class.has-unread]="unreadCount() > 0"
              (click)="toggleOpen()"
              [attr.aria-label]="'Notifications' + (unreadCount() > 0 ? ', ' + unreadCount() + ' unread' : '')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
        </svg>
        @if (unreadCount() > 0) {
          <span class="pf-bell-badge">{{ displayCount() }}</span>
        }
      </button>

      @if (open()) {
        <div class="pf-bell-panel slide-up pf-modal-centered" role="dialog" aria-label="Notifications">
          <header class="pf-bell-header">
            <div>
              <p class="text-[11px] font-mono uppercase tracking-[0.16em]"
                 style="color: var(--text-muted);">Inbox</p>
              <p class="text-[15px] font-semibold" style="color: var(--text-primary);">Notifications</p>
            </div>
            @if (unreadCount() > 0) {
              <button type="button" class="pf-mark-all" (click)="markAllRead()">
                Mark all read
              </button>
            }
          </header>

          <div class="pf-bell-body">
            @if (items().length === 0) {
              <div class="pf-bell-empty">
                <div class="pf-empty-glow"></div>
                <p class="text-[13px]" style="color: var(--text-secondary);">You're all caught up</p>
                <p class="text-[11px] mt-1" style="color: var(--text-muted);">New alerts will land here.</p>
              </div>
            } @else {
              @for (n of items(); track n.id) {
                <button type="button"
                        class="pf-bell-row"
                        [class.is-unread]="!n.isRead"
                        (click)="onRow(n)">
                  <span class="pf-type-icon" [attr.data-tone]="toneFor(n.type)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <g [innerHTML]="pathFor(n.type)"></g>
                    </svg>
                  </span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <p class="text-[13px] font-semibold truncate" style="color: var(--text-primary);">{{ n.title }}</p>
                      @if (!n.isRead) { <span class="pf-unread-dot" aria-hidden="true"></span> }
                    </div>
                    @if (n.body) {
                      <p class="text-[12px] mt-0.5 truncate" style="color: var(--text-tertiary);">{{ n.body }}</p>
                    }
                    <p class="text-[10.5px] font-mono mt-1" style="color: var(--text-muted);">
                      {{ n.createdAt | date:'shortTime' }} · {{ typeLabel(n.type) }}
                    </p>
                  </div>
                  @if (canAcknowledge(n)) {
                    <!-- NABL: the explicit acknowledgement — reading the bell is
                         not it. Records who saw the critical value and when. -->
                    <button type="button" class="pf-bell-ack press" [disabled]="acking() === n.id"
                            (click)="$event.stopPropagation(); acknowledge(n)"
                            [attr.aria-label]="'Acknowledge critical result: ' + n.title">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                      {{ acking() === n.id ? 'Acknowledging…' : 'Acknowledge' }}
                    </button>
                  } @else if (linkFor(n)) {
                    <svg class="pf-bell-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
                  }
                </button>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }

    /* Button matches the top-strip .pf-strip-btn slot exactly. */
    .pf-bell-btn {
      position: relative;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 9999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
    }
    @media (min-width: 640px) {
      .pf-bell-btn { width: 2.75rem; height: 2.75rem; }
    }
    .pf-bell-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .pf-bell-btn.has-unread {
      color: var(--text-primary);
    }
    .pf-bell-btn.has-unread svg {
      animation: pf-bell-shake 2.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) infinite;
      transform-origin: 50% 4px;
    }

    @keyframes pf-bell-shake {
      0%, 88%, 100% { transform: rotate(0); }
      90%           { transform: rotate(-10deg); }
      93%           { transform: rotate(8deg); }
      96%           { transform: rotate(-4deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-bell-btn.has-unread svg { animation: none; }
    }

    .pf-bell-badge {
      position: absolute;
      top: 4px;
      right: 4px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      line-height: 16px;
      text-align: center;
      box-shadow: 0 2px 6px rgba(124, 58, 237, 0.45), 0 0 0 2px var(--header-bg);
      letter-spacing: 0.01em;
    }

    /* Panel --------------------------------------------------- */
    .pf-bell-panel {
      position: absolute;
      right: 0;
      margin-top: 10px;
      width: 340px;
      max-width: calc(100vw - 32px);
      border-radius: 18px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      z-index: 40;
      overflow: hidden;
    }

    .pf-bell-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 12px;
      border-bottom: 1px solid var(--border-muted);
    }

    .pf-mark-all {
      font-size: 11px;
      font-weight: 600;
      color: var(--violet-text);
      background: none;
      border: none;
      padding: 4px 8px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .pf-mark-all:hover {
      background: rgba(168, 85, 247, 0.12);
    }

    .pf-bell-body {
      max-height: 400px;
      overflow-y: auto;
    }

    .pf-bell-empty {
      position: relative;
      text-align: center;
      padding: 36px 16px;
    }
    .pf-empty-glow {
      width: 48px;
      height: 48px;
      margin: 0 auto 12px;
      border-radius: 9999px;
      background: radial-gradient(circle at center, rgba(124, 58, 237, 0.25), transparent 70%);
    }

    .pf-bell-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      width: 100%;
      padding: 12px 16px;
      text-align: left;
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--border-muted);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .pf-bell-row:last-child { border-bottom: none; }
    .pf-bell-row:hover { background: var(--bg-hover); }
    .pf-bell-row.is-unread {
      background: linear-gradient(90deg, rgba(124, 58, 237, 0.06), transparent 60%);
    }
    .pf-bell-row.is-unread:hover {
      background: linear-gradient(90deg, rgba(124, 58, 237, 0.1), var(--bg-hover) 60%);
    }
    .pf-bell-ack {
      flex-shrink: 0; align-self: center; display: inline-flex; align-items: center; gap: 5px;
      min-height: 32px; padding: 0 10px; border-radius: 9px; font-size: 12px; font-weight: 600;
      color: var(--red-text, #b91c1c); background: transparent;
      border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 45%, transparent); cursor: pointer;
    }
    .pf-bell-ack:hover:not(:disabled) { background: color-mix(in srgb, var(--red-text, #dc2626) 8%, transparent); }
    .pf-bell-ack:disabled { opacity: 0.6; cursor: default; }
    @media (hover: none) and (pointer: coarse) { .pf-bell-ack { min-height: 44px; } }
    .pf-bell-chev { flex-shrink: 0; align-self: center; color: var(--text-muted); opacity: 0.6; }
    .pf-bell-row:hover .pf-bell-chev { opacity: 1; color: var(--text-secondary); }

    .pf-type-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .pf-type-icon[data-tone='rose'] {
      background: linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(239, 68, 68, 0.08));
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--red-text);
    }
    .pf-type-icon[data-tone='amber'] {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.08));
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: var(--amber-text);
    }
    .pf-type-icon[data-tone='emerald'] {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--green-text);
    }
    .pf-type-icon[data-tone='violet'] {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(168, 85, 247, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: var(--violet-text);
    }
    .pf-type-icon[data-tone='sky'] {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: var(--sky-text);
    }

    .pf-unread-dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: var(--gradient-primary);
      box-shadow: 0 0 8px rgba(168, 85, 247, 0.7);
      flex-shrink: 0;
    }
  `]
})
export class NotificationBellComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly critical = inject(CriticalResultsService);
  private readonly toasts = inject(ToastService);

  private readonly _items = signal<Notification[]>([]);
  /** Critical rows acknowledged in this session (the button hides once done). */
  private readonly _acked = signal<Set<string>>(new Set());
  readonly acking = signal<string | null>(null);
  private readonly _open = signal(false);
  readonly items = this._items.asReadonly();
  readonly open = this._open.asReadonly();
  readonly unreadCount = computed(() => this._items().filter(n => !n.isRead).length);
  readonly displayCount = computed(() => {
    const n = this.unreadCount();
    return n > 99 ? '99+' : n.toString();
  });

  constructor() {
    // Desktop app: unread bell rows → dock / taskbar badge (0 when the bell
    // goes away, i.e. sign-out).
    const desktop = inject(DesktopNotifyService);
    if (desktop.active) {
      effect(() => {
        const n = this.unreadCount();
        untracked(() => desktop.setBellUnread(n));
      });
      inject(DestroyRef).onDestroy(() => desktop.setBellUnread(0));
    }
  }

  ngOnInit(): void { this.load(); }

  load(): void {
    this.api.get<Notification[]>('/api/notifications/').subscribe({
      next: list => this._items.set(list ?? []),
      error: () => this._items.set([])
    });
  }

  toggleOpen() {
    this._open.update(v => !v);
    if (this._open()) this.load();
  }

  /** A tap on a system push with no dedicated screen lands here: the push
   *  service broadcasts pf-open-bell so the tapped notification is visible. */
  @HostListener('window:pf-open-bell')
  onOpenRequest() {
    if (!this._open()) { this._open.set(true); this.load(); }
  }

  /** Desktop app: a click on a native bell notification → open that event's
   *  screen (same routing as tapping the row) and mark it read; no dedicated
   *  screen → open the bell. One bell instance handles it. */
  @HostListener('window:pf-open-notification', ['$event'])
  onOpenNotification(ev: Event) {
    ev.stopImmediatePropagation();
    const d = (ev as CustomEvent<{ type: string; referenceType: string | null; referenceId: string | null }>).detail
      ?? { type: '', referenceType: null, referenceId: null };
    const row = this._items().find(n => !n.isRead && (n.referenceId ?? null) === d.referenceId
      && canonicalNotificationType(n.type) === canonicalNotificationType(d.type));
    const link = notificationRoute(d.type, d.referenceType, d.referenceId, this.auth.hasPermission('validate_result'));
    if (row) this.markRead(row);
    if (link) this.router.navigate(link.commands, link.queryParams ? { queryParams: link.queryParams } : {});
    else this.onOpenRequest();
  }

  /** Live badge: ChatService broadcasts this when a BusinessNotification
   *  arrives over SignalR — refetch so the count/list update without a
   *  reload on every platform. */
  @HostListener('window:pf-notification-received')
  onLiveNotification() { this.load(); }

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this._open()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this._open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this._open()) this._open.set(false); }

  /** Tap a notification: mark it read and, when it points at something with a
   *  screen, jump there (OPS-60). Falls back to just marking read. */
  onRow(n: Notification) {
    this.markRead(n);
    const link = this.linkFor(n);
    if (link) {
      this._open.set(false);
      this.router.navigate(link.commands, link.queryParams ? { queryParams: link.queryParams } : {});
    }
  }

  /** Navigation target for a notification, or null when there's no dedicated
   *  screen (see notificationRoute). */
  linkFor(n: Notification): NotifRoute | null {
    return notificationRoute(n.type, n.referenceType, n.referenceId, this.auth.hasPermission('validate_result'));
  }

  /** Critical bells (critical_value / critical_unvalidated) referencing an
   *  order test, for a user who may act on results. */
  canAcknowledge(n: Notification): boolean {
    const t = canonicalNotificationType(n.type);
    if (t !== 'critical_value' && t !== 'critical_unvalidated') return false;
    if (n.referenceType !== 'order_test' || !n.referenceId) return false;
    if (this._acked().has(n.referenceId)) return false;
    return this.auth.hasAnyPermission?.(['enter_result', 'validate_result']) ?? false;
  }

  /** Explicit acknowledgement from the bell: writes the NABL record (via
   *  'bell'), then the row is read. A record already acknowledged by this
   *  user (or one that never existed — a legacy bell) just marks read. */
  acknowledge(n: Notification) {
    const ref = n.referenceId;
    if (!ref || this.acking()) return;
    this.acking.set(n.id);
    this.critical.acknowledgeOrderTest(ref, 'bell').subscribe({
      next: touched => {
        this.acking.set(null);
        this._acked.update(s => new Set(s).add(ref));
        this.markRead(n);
        this.toasts.success(touched.length ? 'Critical result acknowledged' : 'Already acknowledged');
      },
      error: e => { this.acking.set(null); this.toasts.error(ApiError.from(e).message); },
    });
  }

  markRead(n: Notification) {
    if (n.isRead) return;
    this.api.patch(`/api/notifications/${n.id}/read`).subscribe({
      next: () => this._items.update(list => list.map(x => x.id === n.id ? { ...x, isRead: true } : x))
    });
  }

  markAllRead() {
    const unread = this._items().filter(n => !n.isRead);
    if (unread.length === 0) return;
    unread.forEach(n => this.api.patch(`/api/notifications/${n.id}/read`).subscribe());
    this._items.update(list => list.map(n => ({ ...n, isRead: true })));
  }

  // Icon / tone / label match the CANONICAL key, so legacy "lms."-prefixed
  // rows (most of dev's tat_breach / report_ready / sample_rejection) render
  // like new ones instead of as a generic bell.
  toneFor(type: string): TypeTone {
    switch (canonicalNotificationType(type)) {
      case 'critical_value':   return 'rose';
      case 'result_rejected':  return 'rose';
      case 'sample_rejection': return 'amber';
      case 'tat_breach':       return 'amber';
      case 'report_ready':     return 'emerald';
      default:                 return 'violet';
    }
  }

  typeLabel(type: string): string {
    const t = canonicalNotificationType(type);
    switch (t) {
      case 'critical_value':   return 'critical value';
      case 'sample_rejection': return 'sample rejected';
      case 'report_ready':     return 'report ready';
      case 'tat_breach':       return 'TAT breach';
      case 'result_rejected':  return 'result rejected';
      default:                 return t.replace(/_/g, ' ');
    }
  }

  pathFor(type: string): string {
    switch (canonicalNotificationType(type)) {
      // critical value — heart-pulse
      case 'critical_value':
        return '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4 1-2 1.5 1h5.27"/>';
      // sample rejection — test tube with slash
      case 'sample_rejection':
        return '<path d="M10 3h4v5l5 9a2.5 2.5 0 0 1-2.3 3.5H7.3A2.5 2.5 0 0 1 5 17l5-9V3Z"/><path d="M2 22 22 2"/>';
      // report ready — file check
      case 'report_ready':
        return '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>';
      // TAT breach — clock with alert
      case 'tat_breach':
        return '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
      // result rejected — arrow-uturn / undo
      case 'result_rejected':
        return '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>';
      // default — bell
      default:
        return '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
    }
  }
}
