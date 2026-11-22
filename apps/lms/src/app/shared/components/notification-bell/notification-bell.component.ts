import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { DesktopNotifyService } from '../../../core/services/desktop-notify.service';
import { Notification } from '../../models/user.model';
import { NotifRoute, notificationRoute } from './notification-route';
import { canonicalNotificationType } from '../../utils/notification-type';
import { NotificationsStore } from './notifications.store';
import { MergedNotification, alertedText } from './notification-merge';
import { NOTIF_ICON_PATHS, NotifTone, kindMeta } from './notification-kinds';
import { RowAction, rowAction } from './notification-action';
import { NotificationIconComponent } from './notification-icon.component';

/** The popover shows the latest this-many rows (merged); the page has the full list. */
export const POPOVER_ROWS = 6;

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The bell + its popover (owner-approved redesign 2026-11-19).
 *
 * Popover: "Notifications · N unread" + Mark all read; the latest few alerts, duplicates merged ("alerted 2 times");
 * each row = icon tile, bold title + time, the body (wraps, never truncated), ONE action button; footer
 * "See all notifications" → /notifications. Keyboard: Esc closes, Tab is trapped inside, focus returns to the bell;
 * new arrivals are announced politely (aria-live). The badge is UNCHANGED: unread among the bell's list.
 * State lives in NotificationsStore (shared with the Notifications page).
 */
@Component({
  selector: 'pf-notification-bell',
  standalone: true,
  imports: [DatePipe, RouterLink, NotificationIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">
      <button type="button" #bellBtn
              class="pf-bell-btn press"
              [class.has-unread]="unreadCount() > 0"
              [attr.aria-expanded]="open()"
              aria-haspopup="dialog"
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
      <!-- New arrivals, announced without stealing focus. -->
      <div class="pf-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="bell-live">{{ announce() }}</div>

      @if (open()) {
        <div class="pf-bell-panel slide-up pf-modal-centered" role="dialog" aria-label="Notifications" tabindex="-1" #panel
             data-testid="bell-popover" (keydown)="onPanelKey($event)">
          <header class="pf-bell-header">
            <h2 class="pf-bell-title">Notifications <span class="pf-bell-count">@if (unreadCount() > 0) { · <span class="pf-num">{{ unreadCount() }}</span> unread } @else { · all read }</span></h2>
            @if (unreadCount() > 0) {
              <button type="button" class="pf-mark-all press" (click)="markAllRead()">Mark all read</button>
            }
          </header>

          <div class="pf-bell-body">
            @if (!loaded()) {
              <!-- Same shape as the rows: tile, title + time, two body lines, a button. -->
              <div class="pf-bell-skel" role="status" aria-label="Loading notifications">
                @for (i of skel; track i) {
                  <div class="pf-bell-skel__row" aria-hidden="true">
                    <span class="pf-bell-skel__tile"></span>
                    <span class="pf-bell-skel__txt"><i style="width: 46%"></i><i style="width: 92%"></i><i style="width: 64%"></i><b></b></span>
                  </div>
                }
              </div>
            } @else if (rows().length === 0) {
              <div class="pf-bell-empty">
                <p class="pf-bell-empty__t">You're all caught up</p>
                <p class="pf-bell-empty__s">New alerts will land here.</p>
              </div>
            } @else {
              <ul class="pf-bell-list">
                @for (r of rows(); track r.key) {
                  @let n = r.rep;
                  @let a = actionOf(r);
                  <li class="pf-bell-row" [class.is-unread]="!r.isRead">
                    <pf-notif-icon [icon]="metaOf(n.type).icon" [tone]="metaOf(n.type).tone" [label]="typeLabel(n.type)" [tile]="34"></pf-notif-icon>
                    <div class="pf-bell-main">
                      <button type="button" class="pf-bell-open" (click)="onRow(r)">
                        <span class="pf-bell-line">
                          <b class="pf-bell-rtitle">{{ n.title }}</b>
                          <time class="pf-bell-time" [attr.datetime]="n.createdAt">{{ n.createdAt | date:'h:mm a':'+0530' }}</time>
                        </span>
                        @if (n.body) { <span class="pf-bell-body-text">{{ n.body }}</span> }
                      </button>
                      @if (a || r.count > 1) {
                        <div class="pf-bell-foot">
                          @if (a) {
                            @if (a.kind === 'ack') {
                              <!-- NABL: the explicit acknowledgement — reading the bell is not it. A merged row acknowledges every alert it stands for. -->
                              <button type="button" class="pf-bell-ack press" [disabled]="acking() === r.key"
                                      (click)="acknowledge(r)"
                                      [attr.aria-label]="'Acknowledge critical result: ' + n.title">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                                {{ acking() === r.key ? 'Acknowledging…' : 'Acknowledge' }}
                              </button>
                            } @else {
                              <button type="button" class="pf-bell-act press" (click)="go(r, a)">{{ a.label }}</button>
                            }
                          }
                          @if (r.count > 1) { <span class="pf-bell-extra">{{ alerted(r.count) }}</span> }
                        </div>
                      }
                    </div>
                    @if (!r.isRead) { <span class="pf-unread-dot" aria-label="Unread"></span> } @else { <span class="pf-unread-gap" aria-hidden="true"></span> }
                  </li>
                }
              </ul>
            }
          </div>

          <a class="pf-bell-all" routerLink="/notifications" (click)="onSeeAll()" data-testid="bell-see-all">
            See all notifications
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </a>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }
    .pf-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

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
    .pf-bell-btn:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
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

    /* Popover ------------------------------------------------- */
    .pf-bell-panel {
      position: absolute;
      right: 0;
      margin-top: 10px;
      width: 420px;
      max-width: calc(100vw - 24px);
      display: flex; flex-direction: column;
      max-height: min(640px, calc(100dvh - var(--pf-botbar-h, 72px) - 28px));
      border-radius: 16px;
      background: var(--bg-card-solid);
      border: 1px solid var(--pf-line, var(--glass-border));
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      z-index: 40;
      overflow: hidden;
      outline: none;
    }
    .pf-bell-header {
      display: flex; align-items: center; gap: 10px; flex: none;
      padding: 10px 12px 10px 16px; min-height: 56px;
      border-bottom: 1px solid var(--pf-line, var(--border-muted));
    }
    .pf-bell-title { flex: 1; margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-bell-count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); }
    .pf-mark-all {
      min-height: 44px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; cursor: pointer;
      font: inherit; font-size: 12.5px; font-weight: 600; color: var(--violet-text);
    }
    .pf-mark-all:hover { background: var(--pf-chip-bg); }

    .pf-bell-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
    .pf-bell-list { list-style: none; margin: 0; padding: 0; }

    .pf-bell-row {
      display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px 12px 16px;
      border-bottom: 1px solid var(--pf-line, var(--border-muted));
    }
    .pf-bell-row:last-child { border-bottom: none; }
    .pf-bell-row.is-unread { background: color-mix(in srgb, var(--violet-text) 7%, transparent); }
    .pf-bell-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .pf-bell-open {
      display: flex; flex-direction: column; gap: 3px; width: 100%; margin: -4px; padding: 4px; border: 0; border-radius: 8px;
      background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; min-height: 44px; box-sizing: content-box;
    }
    .pf-bell-open:hover { background: var(--pf-chip-bg); }
    .pf-bell-open:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 0; }
    .pf-bell-line { display: flex; align-items: baseline; gap: 8px; }
    .pf-bell-rtitle { flex: 1; min-width: 0; font-size: 13.5px; font-weight: 600; line-height: 1.35; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-bell-time { flex: none; font-size: 11.5px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-bell-body-text { font-size: 13px; line-height: 1.4; color: var(--text-secondary); overflow-wrap: anywhere; white-space: normal; }
    .pf-bell-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .pf-bell-extra { font-size: 11.5px; color: var(--text-tertiary); }

    .pf-bell-act, .pf-bell-ack {
      display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 9px;
      font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; background: transparent; white-space: nowrap;
    }
    .pf-bell-act { color: var(--violet-text); border: 1px solid var(--pf-line, var(--border-muted)); }
    .pf-bell-act:hover { background: var(--pf-chip-bg); }
    .pf-bell-ack {
      color: var(--red-text, #b91c1c);
      border: 1px solid color-mix(in srgb, var(--red-text, #dc2626) 45%, transparent);
    }
    .pf-bell-ack:hover:not(:disabled) { background: color-mix(in srgb, var(--red-text, #dc2626) 8%, transparent); }
    .pf-bell-ack:disabled { opacity: 0.6; cursor: default; }
    .pf-bell-act:focus-visible, .pf-bell-ack:focus-visible, .pf-mark-all:focus-visible, .pf-bell-all:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    /* Touch targets >= 44px. */
    @media (hover: none) and (pointer: coarse) { .pf-bell-act, .pf-bell-ack { min-height: 44px; } }

    .pf-unread-dot { flex: none; width: 7px; height: 7px; margin-top: 7px; border-radius: 9999px; background: var(--violet-text); }
    .pf-unread-gap { flex: none; width: 7px; }

    .pf-bell-all {
      flex: none; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 48px;
      border-top: 1px solid var(--pf-line, var(--border-muted)); color: var(--violet-text);
      font-size: 13.5px; font-weight: 600; text-decoration: none;
    }
    .pf-bell-all:hover { background: var(--pf-chip-bg); }

    .pf-bell-empty { text-align: center; padding: 40px 16px; }
    .pf-bell-empty__t { margin: 0; font-size: 13.5px; color: var(--text-secondary); }
    .pf-bell-empty__s { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }

    /* Skeleton mirrors a row. */
    .pf-bell-skel__row { display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--pf-line, var(--border-muted)); }
    .pf-bell-skel__tile { flex: none; width: 34px; height: 34px; border-radius: 10px; background: var(--pf-chip-bg); }
    .pf-bell-skel__txt { flex: 1; display: flex; flex-direction: column; gap: 8px; }
    .pf-bell-skel__txt i, .pf-bell-skel__txt b { display: block; height: 11px; border-radius: 6px; background: var(--pf-chip-bg); }
    .pf-bell-skel__txt b { width: 92px; height: 32px; border-radius: 9px; }
    .pf-bell-skel__tile, .pf-bell-skel__txt i, .pf-bell-skel__txt b { animation: pf-bell-pulse 1.4s ease-in-out infinite; }
    @keyframes pf-bell-pulse { 50% { opacity: 0.55; } }
    @media (prefers-reduced-motion: reduce) { .pf-bell-skel__tile, .pf-bell-skel__txt i, .pf-bell-skel__txt b { animation: none; } }
  `]
})
export class NotificationBellComponent implements OnInit {
  private readonly store = inject(NotificationsStore);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  private readonly bellBtn = viewChild<ElementRef<HTMLButtonElement>>('bellBtn');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  private readonly _open = signal(false);
  readonly items = this.store.items;
  readonly open = this._open.asReadonly();
  readonly acking = this.store.acking;
  readonly unreadCount = this.store.unreadCount;
  readonly loaded = this.store.bellLoaded;
  readonly displayCount = computed(() => {
    const n = this.unreadCount();
    return n > 99 ? '99+' : n.toString();
  });
  /** The latest alerts, duplicates merged. */
  readonly rows = computed(() => this.store.merge(this.store.items()).slice(0, POPOVER_ROWS));
  readonly announce = signal('');
  protected readonly skel = [0, 1, 2, 3];

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
    // Polite announcement when the unread count RISES after the first load (a live arrival).
    let prev: number | null = null;
    effect(() => {
      const n = this.unreadCount();
      const ready = this.store.bellLoaded();
      untracked(() => {
        if (!ready) return;
        if (prev !== null && n > prev) this.announce.set(`${n - prev} new notification${n - prev === 1 ? '' : 's'}`);
        prev = n;
      });
    });
  }

  ngOnInit(): void { this.load(); }

  load(): void { this.store.loadBell(); }

  toggleOpen() {
    if (this._open()) { this.close(true); return; }
    this.openPanel();
  }

  private openPanel(): void {
    this._open.set(true);
    this.load();
    // Focus lands in the popover (its panel), so the keyboard user starts inside the trap.
    setTimeout(() => { this.fitPanel(); this.panel()?.nativeElement.focus(); }, 0);
  }

  /** The popover hangs from the bell's right edge; on a phone the bell is not at the screen edge, so pull the
   *  popover back until it is fully on screen (12px gutter). */
  private fitPanel(): void {
    const p = this.panel()?.nativeElement;
    if (!p) return;
    p.style.right = '';
    const r = p.getBoundingClientRect();
    if (r.width > 0 && r.left < 12) p.style.right = `${Math.round(r.left - 12)}px`;
  }

  private close(returnFocus: boolean): void {
    if (!this._open()) return;
    this._open.set(false);
    if (returnFocus) setTimeout(() => this.bellBtn()?.nativeElement.focus(), 0);
  }

  /** A tap on a system push with no dedicated screen lands here: the push
   *  service broadcasts pf-open-bell so the tapped notification is visible. */
  @HostListener('window:pf-open-bell')
  onOpenRequest() {
    if (!this._open()) this.openPanel();
  }

  /** Desktop app: a click on a native bell notification → open that event's
   *  screen (same routing as tapping the row) and mark it read; no dedicated
   *  screen → open the bell. One bell instance handles it. */
  @HostListener('window:pf-open-notification', ['$event'])
  onOpenNotification(ev: Event) {
    ev.stopImmediatePropagation();
    const d = (ev as CustomEvent<{ type: string; referenceType: string | null; referenceId: string | null }>).detail
      ?? { type: '', referenceType: null, referenceId: null };
    const row = this.items().find(n => !n.isRead && (n.referenceId ?? null) === d.referenceId
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
    if (!this.host.nativeElement.contains(ev.target as Node)) this.close(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.close(true); }

  /** Tab stays inside the popover (the bell's own button is outside it, reached again after Esc). */
  onPanelKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const root = this.panel()?.nativeElement;
    if (!root) return;
    const f = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(e => !e.hasAttribute('disabled'));
    if (!f.length) { ev.preventDefault(); root.focus(); return; }
    const first = f[0], last = f[f.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (ev.shiftKey && (active === first || active === root)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
  }

  onSeeAll(): void { this.close(false); }

  /** Tap a notification: mark it (and everything merged into it) read and, when it points at something with a
   *  screen, jump there (OPS-60). Falls back to just marking read. */
  onRow(r: MergedNotification) {
    this.store.markRowRead(r);
    const link = this.linkFor(r.rep);
    if (link) {
      this.close(false);
      this.router.navigate(link.commands, link.queryParams ? { queryParams: link.queryParams } : {});
    }
  }

  go(r: MergedNotification, a: RowAction): void {
    this.store.markRowRead(r);
    if (!a.route) return;
    this.close(false);
    this.router.navigate(a.route.commands, a.route.queryParams ? { queryParams: a.route.queryParams } : {});
  }

  /** Navigation target for a notification, or null when there's no dedicated
   *  screen (see notificationRoute). */
  linkFor(n: Notification): NotifRoute | null { return this.store.linkFor(n); }

  /** Critical bells (critical_value / critical_unvalidated) referencing an
   *  order test, for a user who may act on results. */
  canAcknowledge(n: Notification): boolean { return this.store.canAcknowledge(n); }

  actionOf(r: MergedNotification): RowAction | null { return rowAction(r.rep, this.store); }

  /** Explicit acknowledgement from the bell: writes the NABL record (via 'bell') for every alert the row stands
   *  for, then reads them. */
  acknowledge(r: MergedNotification) { this.store.acknowledge(r); }

  markRead(n: Notification) { this.store.markRead(n); }

  markAllRead() { this.store.markAllRead(); }

  alerted(count: number): string { const t = alertedText(count); return t ? t[0].toUpperCase() + t.slice(1) : ''; }

  // Icon / tone / label match the CANONICAL key, so legacy "lms."-prefixed
  // rows render like new ones instead of as a generic bell.
  metaOf(type: string) { return kindMeta(type); }

  toneFor(type: string): NotifTone { return kindMeta(type).tone; }

  /** Plain-words kind name (the icon tile's screen-reader name). */
  typeLabel(type: string): string {
    const t = canonicalNotificationType(type);
    switch (t) {
      case 'critical_value':   return 'critical value';
      case 'sample_rejection': return 'sample rejected';
      case 'report_ready':     return 'report ready';
      case 'urgent_report_ready': return 'urgent — ready to report';
      case 'tat_breach':       return 'TAT breach';
      case 'result_rejected':  return 'result rejected';
      default:                 return t.replace(/_/g, ' ');
    }
  }

  /** The kind's icon as one path string (equal kinds → equal strings). */
  pathFor(type: string): string { return (NOTIF_ICON_PATHS[kindMeta(type).icon] ?? NOTIF_ICON_PATHS.bell).join(' '); }
}
