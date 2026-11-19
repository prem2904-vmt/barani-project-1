import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { HeroBandComponent } from '../../shared/components/hero-band/hero-band.component';
import { NotificationIconComponent } from '../../shared/components/notification-bell/notification-icon.component';
import { NotificationsStore } from '../../shared/components/notification-bell/notifications.store';
import { MergedNotification, alertedText } from '../../shared/components/notification-bell/notification-merge';
import { RowAction, orderRefOf, rowAction } from '../../shared/components/notification-bell/notification-action';
import { NOTIF_GROUPS, NOTIF_GROUP_LABEL, NotifFilter, kindMeta } from '../../shared/components/notification-bell/notification-kinds';
import { notificationDayLabel } from '../../shared/utils/notification-day';
import { SegmentedComponent, SegmentedOption } from '../../shared/primitives/segmented.component';
import { TM_TWO_PANEL_STYLES, mediaSignal } from '../admin/tests/tests/tm-two-panel';

/** Rows drawn at first and per scroll step (the list is windowed; the server list grows with the same scroll). */
const SHOW_FIRST = 40;
const SHOW_STEP = 40;

interface DayGroup { label: string; rows: MergedNotification[]; }

/**
 * Notifications — the full inbox (owner-approved 2026-11-19), at /notifications.
 *
 * Two panels (Test Master's frame): the band (back, lab, "Mark all read", search pill) over an INBOX side card on the
 * LEFT (All · Critical results · Running late · Reports & sharing · Samples · Messages · System — each with its dot and
 * unread badge) and the list in the main card on the RIGHT (head: group, "N unread", Unread | All), grouped by day.
 * Rows: unread dot, icon tile, a full sentence (bold title, then the body — wraps, never truncated), a meta line,
 * the time and ONE action. Duplicate alerts merge into one row ("alerted 2 times"). Infinite scroll inside the card;
 * the page never scrolls. Phone: one card, the kinds in a filter sheet opened from its head.
 */
@Component({
  selector: 'pf-notifications-page',
  standalone: true,
  imports: [DatePipe, RouterLink, HeroBandComponent, NotificationIconComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page nt" data-testid="nt-page">
      <pf-hero-band [back]="true" placeholder="Search notifications by patient, order or test…" [value]="q()" (valueChange)="q.set($event)">
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" data-testid="nt-mark-all"
                  [disabled]="totalUnread() === 0" (click)="markAllRead()" aria-label="Mark all read">
            <!-- The band shows only the icon on a phone. -->
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>
            Mark all read
          </button>
        </ng-container>
      </pf-hero-band>

      <div class="pf-body pf-body--split nt__body">
        <section class="pf-card nt__main" aria-label="Notifications" data-testid="nt-main">
          <header class="pf-card__head nt__head">
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            </span>
            @if (narrow()) {
              <!-- Phone / narrow: the kinds live in a filter sheet. -->
              <button type="button" class="nt__pick press" #pickBtn data-testid="nt-filter" aria-haspopup="dialog" [attr.aria-expanded]="sheet()"
                      [attr.aria-label]="'Kind of notification: ' + pickLabel()" (click)="openSheet()">
                <span class="nt__pick-name">{{ pickLabel() }}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            } @else {
              <span class="pf-card__label" data-testid="nt-group">{{ groupLabel() }}</span>
            }
            <span class="nt__count" data-testid="nt-count"><span class="pf-num">{{ groupUnread() }}</span> unread</span>
            <span class="nt__spacer"></span>
            <pf-segmented size="sm" ariaLabel="Show" [options]="viewOptions()" [value]="view()" (valueChange)="view.set($any($event))"></pf-segmented>
          </header>

          <div class="nt__scroll" #scroller data-testid="nt-scroll" [attr.aria-busy]="!loaded()">
            @if (!loaded()) {
              <!-- The list's own shape: a day heading, then rows (dot, tile, two text lines, time, button). -->
              <div class="nt-skel" role="status" aria-label="Loading notifications">
                <div class="nt-skel__day" aria-hidden="true"></div>
                @for (i of skel; track i) {
                  <div class="nt-skel__row" aria-hidden="true">
                    <span class="nt-skel__tile"></span>
                    <span class="nt-skel__txt"><i style="width: 78%"></i><i style="width: 40%"></i></span>
                    <span class="nt-skel__time"></span>
                    <span class="nt-skel__btn"></span>
                  </div>
                }
              </div>
            } @else if (days().length === 0) {
              <div class="nt-empty" data-testid="nt-empty">
                <p class="nt-empty__t">{{ emptyTitle() }}</p>
                <p class="nt-empty__s">{{ emptyHint() }}</p>
                @if (view() === 'unread' && !q().trim()) {
                  <button type="button" class="pf-btn pf-btn--secondary press" (click)="view.set('all')">Show all notifications</button>
                }
              </div>
            } @else {
              @for (g of days(); track g.label) {
                <h3 class="nt-day">{{ g.label }}</h3>
                <ul class="nt-list">
                  @for (r of g.rows; track r.key) {
                    @let n = r.rep;
                    @let meta = metaOf(n.type);
                    @let a = actionOf(r);
                    <li class="nt-row" [class.is-unread]="!r.isRead" data-testid="nt-row" [attr.data-kind]="r.kind" [attr.data-count]="r.count">
                      <span class="nt-dot" [class.on]="!r.isRead" [attr.aria-label]="r.isRead ? null : 'Unread'" [attr.role]="r.isRead ? null : 'img'"></span>
                      <pf-notif-icon class="nt-tile" [icon]="meta.icon" [tone]="meta.tone" [label]="meta.label" [tile]="38"></pf-notif-icon>
                      <button type="button" class="nt-open" (click)="open(r)" data-testid="nt-open">
                        <span class="nt-sentence"><b class="nt-title" data-testid="nt-title">{{ n.title }}</b>@if (n.body) { <span class="nt-sep"> — </span><span class="nt-text">{{ n.body }}</span> }</span>
                        <span class="nt-meta">{{ metaLine(r) }}</span>
                      </button>
                      <time class="nt-time" [attr.datetime]="n.createdAt">{{ n.createdAt | date:'h:mm a':'+0530' }}</time>
                      <span class="nt-act">
                        @if (a) {
                          @if (a.kind === 'ack') {
                            <button type="button" class="nt-btn nt-btn--danger press" data-testid="nt-ack" [disabled]="acking() === r.key"
                                    (click)="acknowledge(r)" [attr.aria-label]="'Acknowledge critical result: ' + n.title">
                              {{ acking() === r.key ? 'Acknowledging…' : 'Acknowledge' }}
                            </button>
                          } @else {
                            <button type="button" class="nt-btn press" data-testid="nt-go" (click)="go(r, a)">{{ a.label }}</button>
                          }
                        }
                      </span>
                    </li>
                  }
                </ul>
              }
              <!-- Infinite scroll: reaching this line draws more rows, then asks the server for more. -->
              <div class="nt-more" #sentinel aria-hidden="true">@if (store.pageLoading() || moreAvailable()) { <span class="nt-more__dot"></span> }</div>
            }
            <div class="pf-sr-only" role="status" aria-live="polite">{{ liveNote() }}</div>
          </div>
        </section>

        @if (narrow() && sheet()) {
          <div class="nt-sheet-backdrop" (click)="closeSheet()"></div>
          <aside class="pf-card nt-sheet" role="dialog" aria-modal="true" aria-label="Inbox" tabindex="-1" #sheetEl data-testid="nt-sheet" (keydown)="onSheetKey($event)">
            <span class="nt-sheet__handle" aria-hidden="true"></span>
            <header class="pf-card__head">
              <span class="pf-card__label">Inbox</span>
              <span class="nt__spacer"></span>
              <button type="button" class="pf-btn pf-btn--icon press nt-sheet__close" aria-label="Close" (click)="closeSheet()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </header>
            <ul class="pf-card__body pf-side-list nt__kinds">
              @for (k of kinds(); track k.id) {
                <li>
                  <button type="button" class="pf-side-item nt__kind" [attr.aria-pressed]="kind() === k.id" [attr.data-testid]="'nt-sheet-kind-' + k.id" (click)="setKind(k.id); closeSheet()">
                    <span class="nt__kdot" [attr.data-tone]="k.tone" aria-hidden="true"></span>
                    <span class="nt__kname">{{ k.label }}</span>
                    <span class="nt__kbadge pf-num" [class.nt__kbadge--on]="k.unread > 0">{{ k.unread > 0 ? k.unread : '—' }}</span>
                  </button>
                </li>
              }
            </ul>
          </aside>
        }
        @if (!narrow()) {
          <aside class="pf-card nt__side" aria-label="Inbox" data-testid="nt-side">
            <header class="pf-card__head">
              <span class="pf-card__icon" aria-hidden="true">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/></svg>
              </span>
              <span class="pf-card__label">Inbox</span>
            </header>
            <ul class="pf-card__body pf-side-list nt__kinds">
              @for (k of kinds(); track k.id) {
                <li>
                  <button type="button" class="pf-side-item nt__kind" [attr.aria-pressed]="kind() === k.id" [attr.data-testid]="'nt-kind-' + k.id" (click)="setKind(k.id)">
                    <span class="nt__kdot" [attr.data-tone]="k.tone" aria-hidden="true"></span>
                    <span class="nt__kname">{{ k.label }}</span>
                    <span class="nt__kbadge pf-num" [class.nt__kbadge--on]="k.unread > 0">{{ k.unread > 0 ? k.unread : '—' }}</span>
                  </button>
                </li>
              }
            </ul>
            @if (canConfigure()) {
              <div class="nt__prefs">
                <a class="nt__prefs-link press" routerLink="/admin/lab/alerts" data-testid="nt-prefs">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><path d="M14 4v4M8 10v4M16 16v4"/></svg>
                  What I get notified about
                </a>
              </div>
            }
          </aside>
        }
      </div>
    </section>
  `,
  styles: [TM_TWO_PANEL_STYLES, `
    :host { display: contents; }
    .pf-sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    @media (min-width: 1024px) {
      .nt__body.pf-body--split { grid-template-columns: var(--pf-side-w, 340px) minmax(0, 1fr); }
      .nt__body.pf-body--split > :first-child { grid-column: 2; }
      .nt__body.pf-body--split > :nth-child(2) { grid-column: 1; }
    }
    .nt__body { padding-inline: 0; gap: 16px; }
    .nt__main, .nt__side { min-height: 0; }
    .nt__head { flex-wrap: nowrap; min-height: 56px; }
    .nt__count { font-size: 12.5px; font-weight: 500; color: var(--text-tertiary); white-space: nowrap; }
    .nt__spacer { flex: 1; }
    .nt__pick {
      display: inline-flex; align-items: center; gap: 6px; min-width: 0; min-height: 44px; padding: 0 10px; margin-left: -6px;
      border: 1px solid var(--pf-line); border-radius: 10px; background: transparent; color: var(--text-primary);
      font: inherit; font-size: 13.5px; font-weight: 600; text-align: left; cursor: pointer;
    }
    .nt__pick:hover { background: var(--pf-chip-bg); }
    .nt__pick:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .nt__pick-name { min-width: 0; overflow-wrap: anywhere; }
    .nt__pick svg { flex: none; color: var(--text-tertiary); }

    /* Filter sheet (phone / narrow): the Inbox side card, risen from the bottom above the nav. */
    .nt-sheet-backdrop { position: fixed; inset: 0 0 var(--pf-botbar-h, 0px) 0; z-index: 1001; background: rgba(0, 0, 0, 0.45); animation: nt-fade 200ms ease both; }
    .nt-sheet {
      position: fixed; left: 0; right: 0; bottom: var(--pf-botbar-h, 0px); z-index: 1002; display: flex; flex-direction: column; outline: none;
      max-height: min(80dvh, calc(100dvh - env(safe-area-inset-top, 0px) - var(--pf-botbar-h, 0px) - 8px));
      border-radius: 20px 20px 0 0; background: var(--bg-card-solid); animation: nt-rise 260ms ease both;
    }
    @media (min-width: 641px) { .nt-sheet { left: max(16px, calc(50% - 300px)); right: max(16px, calc(50% - 300px)); } }
    .nt-sheet__handle { display: block; flex: none; width: 40px; height: 5px; margin: 8px auto 2px; border-radius: 999px; background: var(--pf-line); }
    .nt-sheet__close { min-width: 44px; min-height: 44px; }
    .nt-sheet .pf-card__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: max(8px, env(safe-area-inset-bottom)); }
    .nt-sheet .pf-side-item { min-height: 48px; }
    @keyframes nt-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes nt-rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .nt-sheet, .nt-sheet-backdrop { animation: none; } }

    /* Side card: Test Master's rows + a dot and a count. */
    .nt__kind { gap: 10px; }
    .nt__kdot { flex: none; width: 8px; height: 8px; border-radius: 99px; background: var(--text-muted); }
    .nt__kdot[data-tone='rose'] { background: var(--red-text); }
    .nt__kdot[data-tone='amber'] { background: color-mix(in srgb, var(--red-text) 62%, var(--pf-card-bg, #fff)); }
    .nt__kdot[data-tone='emerald'] { background: var(--green-text); }
    .nt__kdot[data-tone='sky'] { background: var(--sky-text); }
    .nt__kdot[data-tone='violet'] { background: var(--violet-text); }
    .nt__kdot[data-tone='slate'] { background: var(--text-tertiary); }
    .nt__kname { flex: 1; min-width: 0; }
    .nt__kbadge { font-size: 12px; color: var(--text-muted); }
    .nt__kbadge--on { min-width: 22px; height: 20px; padding: 0 6px; border-radius: 99px; display: inline-flex; align-items: center; justify-content: center;
      background: var(--pf-chip-bg); color: var(--text-primary); font-size: 11.5px; font-weight: 600; }
    .nt__prefs { flex: none; padding: 4px 8px 8px; border-top: 1px solid var(--pf-line); }
    .nt__prefs-link { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 10px; border-radius: 10px; color: var(--violet-text);
      font-size: 13.5px; font-weight: 600; text-decoration: none; }
    .nt__prefs-link:hover { background: var(--pf-chip-bg); }
    .nt__prefs-link:focus-visible, .nt-btn:focus-visible, .nt-open:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 1px; }
    .nt__side { display: flex; flex-direction: column; }
    .nt__side > .pf-card__body { flex: 1 1 auto; }

    /* The list: the only scroller (the page never scrolls). */
    .nt__scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding-bottom: 8px; position: relative; }
    .nt-day { margin: 0; padding: 14px 18px 6px; font-size: 11.5px; font-weight: 700; letter-spacing: .1em; color: var(--text-tertiary); }
    .nt-list { list-style: none; margin: 0; padding: 0; }
    .nt-row {
      display: grid; align-items: center; column-gap: 12px; row-gap: 6px; min-height: 64px; padding: 8px 18px 8px 10px;
      grid-template-columns: 7px 38px minmax(0, 1fr) 72px 150px;
      border-bottom: 1px solid var(--pf-line);
    }
    .nt-row.is-unread { background: color-mix(in srgb, var(--violet-text) 7%, transparent); }
    .nt-dot { width: 7px; height: 7px; border-radius: 99px; }
    .nt-dot.on { background: var(--violet-text); }
    .nt-open {
      display: flex; flex-direction: column; gap: 3px; min-width: 0; min-height: 44px; justify-content: center; margin: 0; padding: 4px 6px;
      border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer;
    }
    .nt-open:hover { background: var(--pf-chip-bg); }
    .nt-sentence { font-size: 14px; line-height: 1.4; color: var(--text-primary); overflow-wrap: anywhere; white-space: normal; }
    .nt-title { font-weight: 600; }
    .nt-sep, .nt-text { color: var(--text-secondary); }
    .nt-meta { font-size: 12px; line-height: 1.35; color: var(--text-tertiary); overflow-wrap: anywhere; font-family: inherit; }
    .nt-time { font-size: 12px; color: var(--text-tertiary); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .nt-act { display: flex; justify-content: flex-end; }
    .nt-btn {
      min-height: 44px; padding: 0 14px; border-radius: 10px; font: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer;
      background: transparent; color: var(--violet-text); border: 1px solid var(--pf-line);
    }
    .nt-btn:hover:not(:disabled) { background: var(--pf-chip-bg); }
    .nt-btn:disabled { opacity: .6; cursor: default; }
    .nt-btn--danger { color: var(--red-text); border-color: color-mix(in srgb, var(--red-text) 45%, transparent); }
    .nt-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--red-text) 8%, transparent); }
    .nt-more { height: 28px; display: flex; align-items: center; justify-content: center; }
    .nt-more__dot { width: 18px; height: 18px; border-radius: 99px; border: 2px solid var(--pf-line); border-top-color: var(--violet-text); animation: nt-spin .8s linear infinite; }
    @keyframes nt-spin { to { transform: rotate(360deg); } }

    .nt-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 56px 16px; text-align: center; }
    .nt-empty__t { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .nt-empty__s { margin: 0 0 8px; font-size: 13px; color: var(--text-tertiary); }

    /* Skeleton = the row grid. */
    .nt-skel__day { height: 11px; width: 64px; margin: 18px 18px 8px; border-radius: 6px; background: var(--pf-chip-bg); }
    .nt-skel__row { display: grid; align-items: center; column-gap: 12px; min-height: 64px; padding: 8px 18px 8px 29px; grid-template-columns: 38px minmax(0, 1fr) 72px 150px; border-bottom: 1px solid var(--pf-line); }
    .nt-skel__tile { width: 38px; height: 38px; border-radius: 10px; background: var(--pf-chip-bg); }
    .nt-skel__txt { display: flex; flex-direction: column; gap: 8px; }
    .nt-skel__txt i { display: block; height: 11px; border-radius: 6px; background: var(--pf-chip-bg); }
    .nt-skel__time { height: 10px; border-radius: 6px; background: var(--pf-chip-bg); }
    .nt-skel__btn { height: 44px; border-radius: 10px; background: var(--pf-chip-bg); }
    .nt-skel__tile, .nt-skel__txt i, .nt-skel__time, .nt-skel__btn, .nt-skel__day { animation: nt-pulse 1.4s ease-in-out infinite; }
    @keyframes nt-pulse { 50% { opacity: .55; } }
    @media (prefers-reduced-motion: reduce) { .nt-skel__tile, .nt-skel__txt i, .nt-skel__time, .nt-skel__btn, .nt-skel__day, .nt-more__dot { animation: none; } }

    /* Phone / narrow: one card; the row stacks (text, then time + action). */
    @media (max-width: 760px) {
      .nt-row { grid-template-columns: 7px 38px minmax(0, 1fr) auto; padding: 10px 12px 10px 8px; }
      .nt-open { grid-column: 3 / 4; }
      .nt-time { grid-column: 4; grid-row: 1; align-self: start; padding-top: 6px; }
      .nt-act { grid-column: 3 / 5; grid-row: 2; justify-content: flex-start; padding-left: 6px; }
      .nt-dot { grid-row: 1; align-self: start; margin-top: 20px; } .nt-tile { grid-row: 1; align-self: start; margin-top: 4px; }
      .nt-skel__row { grid-template-columns: 38px minmax(0, 1fr) 56px; padding-left: 20px; }
      .nt-skel__btn { display: none; }
    }
  `],
})
export class NotificationsPage implements OnInit, AfterViewInit {
  protected readonly store = inject(NotificationsStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly theme = inject(ThemeService);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly pickBtn = viewChild<ElementRef<HTMLButtonElement>>('pickBtn');
  private readonly sheetEl = viewChild<ElementRef<HTMLElement>>('sheetEl');

  readonly narrow = mediaSignal('(max-width: 1023px)', this.destroyRef);
  readonly kind = signal<NotifFilter>('all');
  readonly view = signal<'unread' | 'all'>('unread');
  readonly q = signal('');
  readonly shown = signal(SHOW_FIRST);
  readonly liveNote = signal('');
  protected readonly skel = [0, 1, 2, 3, 4, 5];

  readonly loaded = this.store.pageLoaded;
  readonly acking = this.store.acking;
  readonly totalUnread = this.store.pageUnread;

  /** Every merged row of the loaded list (newest first). */
  private readonly merged = computed(() => this.store.merge(this.store.pageItems()));

  /** Per-group unread badge — plain unread notifications, the bell badge's logic. */
  readonly kinds = computed(() => {
    const all = this.store.pageItems();
    const byGroup = new Map<string, number>();
    for (const n of all) if (!n.isRead) { const g = kindMeta(n.type).group; byGroup.set(g, (byGroup.get(g) ?? 0) + 1); }
    return [
      { id: 'all' as NotifFilter, label: 'All', tone: 'slate', unread: this.totalUnread() },
      ...NOTIF_GROUPS.map(g => ({ id: g.id as NotifFilter, label: g.label, tone: g.tone as string, unread: byGroup.get(g.id) ?? 0 })),
    ];
  });
  /** The filter button's words on a phone ("All", "Critical results"). */
  readonly pickLabel = computed(() => NOTIF_GROUP_LABEL[this.kind()]);
  readonly sheet = signal(false);
  readonly groupLabel = computed(() => NOTIF_GROUP_LABEL[this.kind()].toUpperCase());
  readonly groupUnread = computed(() => this.kinds().find(k => k.id === this.kind())?.unread ?? 0);
  readonly viewOptions = computed<SegmentedOption<string>[]>(() => [
    { value: 'unread', label: 'Unread' },
    { value: 'all', label: 'All' },
  ]);

  /** The rows after the kind, Unread | All and search filters. */
  private readonly filtered = computed(() => {
    const k = this.kind(), v = this.view(), term = this.q().trim().toLowerCase();
    return this.merged().filter(r => {
      if (k !== 'all' && r.group !== k) return false;
      if (v === 'unread' && r.isRead) return false;
      if (term && !this.haystack(r).includes(term)) return false;
      return true;
    });
  });
  readonly moreAvailable = computed(() => this.shown() < this.filtered().length || this.store.pageHasMore());

  /** The drawn window, grouped by day. */
  readonly days = computed<DayGroup[]>(() => {
    const out: DayGroup[] = [];
    for (const r of this.filtered().slice(0, this.shown())) {
      const label = notificationDayLabel(r.createdAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(r); else out.push({ label, rows: [r] });
    }
    return out;
  });

  readonly canConfigure = computed(() => this.auth.hasAnyPermission?.(['manage_tenant', 'manage_notifications']) ?? false);
  readonly emptyTitle = computed(() => this.q().trim() ? 'Nothing matches your search' : this.view() === 'unread' ? "You're all caught up" : 'No notifications here');
  readonly emptyHint = computed(() => this.q().trim() ? 'Try a patient name, an order number or a test.' : this.view() === 'unread' ? 'New alerts will land here.' : 'Alerts of this kind will show up here.');

  constructor() {
    // A new filter / view / search starts from the top again.
    effect(() => {
      this.kind(); this.view(); this.q();
      this.shown.set(SHOW_FIRST);
      queueMicrotask(() => { const s = this.scroller()?.nativeElement; if (s) s.scrollTop = 0; });
    });
    // Live arrivals: say so politely when a refresh brings MORE unread than the list had (never on the first load).
    let prevUnread: number | null = null;
    effect(() => {
      const n = this.store.pageUnread();
      const ready = this.store.pageLoaded();
      untracked(() => {
        if (!ready) return;
        if (prevUnread !== null && n > prevUnread) { const d = n - prevUnread; this.liveNote.set(`${d} new notification${d === 1 ? '' : 's'}`); }
        prevUnread = n;
      });
    });
    // The sheet belongs to the narrow layout only.
    effect(() => { if (!this.narrow()) untracked(() => this.sheet.set(false)); });
    // When the window is short of the card (a tall screen, a narrow filter) keep drawing until it overflows or ends.
    effect(() => {
      this.days();
      queueMicrotask(() => this.fillIfShort());
    });
  }

  ngOnInit(): void {
    const k = this.route.snapshot.queryParamMap.get('kind');
    if (k && ['all', ...NOTIF_GROUPS.map(g => g.id)].includes(k)) this.kind.set(k as NotifFilter);
    this.store.loadPage();
  }

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) this.more(); }, { root: this.scroller()?.nativeElement, rootMargin: '240px' });
    // The sentinel is re-created as the list renders; observe whichever one is current.
    const watch = () => { io.disconnect(); const s = this.sentinel()?.nativeElement; if (s) io.observe(s); };
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(watch) : null;
    const root = this.scroller()?.nativeElement;
    if (mo && root) mo.observe(root, { childList: true, subtree: true });
    watch();
    this.destroyRef.onDestroy(() => { io.disconnect(); mo?.disconnect(); });
  }

  /** Live arrivals (SignalR → pf-notification-received): refresh the list in place, announce politely. */
  @HostListener('window:pf-notification-received')
  onLive(): void { this.store.loadPage(true); }

  // ── filter sheet (phone) ────────────────────────────────────────────
  openSheet(): void {
    this.sheet.set(true);
    setTimeout(() => this.sheetEl()?.nativeElement.focus(), 0);
  }

  closeSheet(): void {
    if (!this.sheet()) return;
    this.sheet.set(false);
    setTimeout(() => this.pickBtn()?.nativeElement.focus(), 0);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeSheet(); }

  /** Tab stays inside the sheet while it is open. */
  onSheetKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Tab') return;
    const root = this.sheetEl()?.nativeElement;
    if (!root) return;
    const f = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'));
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], active = document.activeElement;
    if (ev.shiftKey && (active === first || active === root)) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && active === last) { ev.preventDefault(); first.focus(); }
  }

  private haystack(r: MergedNotification): string {
    const n = r.rep;
    return `${n.title} ${n.body ?? ''} ${kindMeta(n.type).label} ${orderRefOf(n) ?? ''}`.toLowerCase();
  }

  private more(): void {
    if (this.shown() < this.filtered().length) this.shown.update(v => v + SHOW_STEP);
    else if (this.store.pageHasMore()) this.store.loadMore();
  }

  private fillIfShort(): void {
    const s = this.scroller()?.nativeElement;
    if (!s || !this.loaded()) return;
    if (s.scrollHeight <= s.clientHeight + 8 && this.moreAvailable() && !this.store.pageLoading()) this.more();
  }

  setKind(k: NotifFilter): void {
    this.kind.set(k);
    this.router.navigate([], { relativeTo: this.route, queryParams: { kind: k === 'all' ? null : k }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  metaOf(type: string) { return kindMeta(type); }
  actionOf(r: MergedNotification): RowAction | null { return rowAction(r.rep, this.store); }

  metaLine(r: MergedNotification): string {
    return [orderRefOf(r.rep), kindMeta(r.rep.type).label, alertedText(r.count)].filter(Boolean).join(' · ');
  }

  markAllRead(): void { this.store.markAllRead(true); }
  acknowledge(r: MergedNotification): void { this.store.acknowledge(r); }

  open(r: MergedNotification): void {
    this.store.markRowRead(r);
    const link = this.store.linkFor(r.rep);
    if (link) this.router.navigate(link.commands, link.queryParams ? { queryParams: link.queryParams } : {});
  }

  go(r: MergedNotification, a: RowAction): void {
    this.store.markRowRead(r);
    if (a.route) this.router.navigate(a.route.commands, a.route.queryParams ? { queryParams: a.route.queryParams } : {});
  }
}
