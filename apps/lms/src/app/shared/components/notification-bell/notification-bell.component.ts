import { ChangeDetectionStrategy, Component, ElementRef, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';
import { Notification } from '../../models/user.model';

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
        <div class="pf-bell-panel slide-up" role="dialog" aria-label="Notifications">
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
                        (click)="markRead(n)">
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
      color: #c4b5fd;
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
      color: #fca5a5;
    }
    .pf-type-icon[data-tone='amber'] {
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(245, 158, 11, 0.08));
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #fcd34d;
    }
    .pf-type-icon[data-tone='emerald'] {
      background: linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(16, 185, 129, 0.08));
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: #6ee7b7;
    }
    .pf-type-icon[data-tone='violet'] {
      background: linear-gradient(135deg, rgba(124, 58, 237, 0.22), rgba(168, 85, 247, 0.08));
      border: 1px solid rgba(168, 85, 247, 0.3);
      color: #c4b5fd;
    }
    .pf-type-icon[data-tone='sky'] {
      background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0.08));
      border: 1px solid rgba(56, 189, 248, 0.3);
      color: #7dd3fc;
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

  private readonly _items = signal<Notification[]>([]);
  private readonly _open = signal(false);
  readonly items = this._items.asReadonly();
  readonly open = this._open.asReadonly();
  readonly unreadCount = computed(() => this._items().filter(n => !n.isRead).length);
  readonly displayCount = computed(() => {
    const n = this.unreadCount();
    return n > 99 ? '99+' : n.toString();
  });

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

  @HostListener('document:click', ['$event'])
  onDocClick(ev: MouseEvent) {
    if (!this._open()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) this._open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this._open()) this._open.set(false); }

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

  toneFor(type: string): TypeTone {
    switch (type) {
      case 'critical_value':   return 'rose';
      case 'result_rejected':  return 'rose';
      case 'sample_rejection': return 'amber';
      case 'tat_breach':       return 'amber';
      case 'report_ready':     return 'emerald';
      default:                 return 'violet';
    }
  }

  typeLabel(type: string): string {
    switch (type) {
      case 'critical_value':   return 'critical value';
      case 'sample_rejection': return 'sample rejected';
      case 'report_ready':     return 'report ready';
      case 'tat_breach':       return 'TAT breach';
      case 'result_rejected':  return 'result rejected';
      default:                 return type.replace(/_/g, ' ');
    }
  }

  pathFor(type: string): string {
    switch (type) {
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
