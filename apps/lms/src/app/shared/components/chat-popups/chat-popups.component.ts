import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ChatPopup, ChatPopupService } from '../../../core/services/chat-popup.service';
import { ChatService } from '../../../core/services/chat.service';
import { ChatWindowsService } from '../../../core/services/chat-windows.service';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * "New message" pop-ups (Messages RCA 2026-09-27, issue 3). ND style:
 * neutral card, neutral initials avatar, sender + one-line preview + time;
 * bottom-right on web / iPad (clear of the chat-head rail and above any
 * docked windows), top of the screen on phones. Clicking opens that
 * conversation the same way the Messages panel does (docked window on
 * web/iPad in the new design, the thread page on phones / classic).
 * Hover or focus pauses the auto-dismiss. Palette only; no motion under
 * prefers-reduced-motion.
 */
@Component({
  selector: 'pf-chat-popups',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (popups().length) {
      <section class="pf-cpop" [class.pf-cpop--lifted]="lifted()" role="region" aria-label="New messages"
               aria-live="polite" (mouseenter)="svc.pause()" (mouseleave)="svc.resume()"
               (focusin)="svc.pause()" (focusout)="svc.resume()">
        @for (p of popups(); track p.id) {
          <article class="pf-cpop__card" data-testid="chat-popup" [attr.data-conversation]="p.conversationId">
            <button type="button" class="pf-cpop__main" (click)="openConversation(p)"
                    [attr.aria-label]="ariaLabel(p)">
              <span class="pf-cpop__avatar" aria-hidden="true">{{ initials(p.senderName) }}</span>
              <span class="pf-cpop__text">
                <span class="pf-cpop__top">
                  <span class="pf-cpop__name">{{ p.senderName }}</span>
                  <time class="pf-cpop__time" [attr.datetime]="p.sentAt">{{ time(p.sentAt) }}</time>
                </span>
                @if (p.count > 1) {
                  <span class="pf-cpop__count" data-testid="chat-popup-count">
                    <span class="pf-cpop__dot" aria-hidden="true"></span>{{ countLabel(p) }}
                  </span>
                } @else if (p.groupName) {
                  <span class="pf-cpop__group">in {{ p.groupName }}</span>
                }
                <span class="pf-cpop__preview">{{ p.preview }}</span>
              </span>
            </button>
            <button type="button" class="pf-cpop__close" (click)="svc.dismiss(p.id)" aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                   stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12"/>
              </svg>
            </button>
          </article>
        }
      </section>
    }
  `,
  styles: [`
    .pf-cpop {
      position: fixed;
      right: 72px;                                   /* clear of the chat-head rail */
      bottom: calc(var(--pf-botbar-h, 0px) + 16px);
      z-index: 55;                                   /* above docked windows (48), below toasts (60) */
      display: flex; flex-direction: column-reverse; gap: 10px;
      width: min(340px, calc(100vw - 32px));
      font-family: 'Noto Sans', var(--font-sans, system-ui), sans-serif;
    }
    /* A docked window is open → sit above it instead of on top of it. */
    .pf-cpop--lifted { bottom: calc(var(--pf-botbar-h, 0px) + 12px + min(460px, 62vh) + 12px); }

    .pf-cpop__card {
      position: relative;
      display: flex; align-items: stretch;
      background: var(--nd-card-bg, var(--bg-card-solid, #fff));
      border: 1px solid var(--nd-line, var(--border-muted, #e5e7eb));
      border-radius: var(--nd-radius, 12px);
      box-shadow: var(--nd-shadow-sm), 0 12px 32px rgba(15, 23, 42, 0.10);
      overflow: hidden;
      animation: pf-cpop-in var(--nd-dur, 320ms) var(--nd-spring, cubic-bezier(0.32, 0.72, 0, 1)) both;
    }
    @keyframes pf-cpop-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

    .pf-cpop__main {
      flex: 1; min-width: 0;
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 8px 12px 14px;
      background: transparent; border: 0; text-align: left; cursor: pointer;
      color: var(--text-primary);
      min-height: 64px;
    }
    .pf-cpop__card:hover { background: color-mix(in srgb, var(--nd-sel-bg, #eceff2) 55%, var(--nd-card-bg, #fff)); }
    .pf-cpop__main:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: -2px; }

    /* The app's neutral initials avatar (Messages / chat windows anatomy). */
    .pf-cpop__avatar {
      flex: none;
      display: inline-flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 9999px;
      background: var(--nd-chip-bg, #f3f4f6);
      border: 1px solid var(--nd-line, var(--border-muted));
      color: var(--text-secondary);
      font-size: 13px; font-weight: 600;
    }
    .pf-cpop__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .pf-cpop__top { display: flex; align-items: baseline; gap: 8px; }
    .pf-cpop__name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; line-height: 1.3; }
    .pf-cpop__time {
      flex: none; font-size: 12px; color: var(--text-muted);
      font-variant-numeric: tabular-nums;
    }
    .pf-cpop__group { font-size: 12px; color: var(--text-muted); }
    .pf-cpop__count {
      display: inline-flex; align-items: center; gap: 6px; align-self: flex-start;
      padding: 1px 8px; border-radius: var(--nd-radius-chip, 8px);
      background: var(--nd-chip-bg, #f3f4f6); color: var(--text-secondary);
      font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums;
    }
    .pf-cpop__dot { width: 6px; height: 6px; border-radius: 9999px; background: var(--color-primary, #7c3aed); }
    .pf-cpop__preview {
      font-size: 13px; line-height: 1.4; color: var(--text-secondary);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;   /* ONE row by design */
    }
    .pf-cpop__close {
      flex: none; align-self: flex-start;
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; margin: 8px 8px 0 0; border-radius: 9999px;
      background: transparent; border: 0; color: var(--text-muted); cursor: pointer;
    }
    .pf-cpop__close:hover { background: var(--nd-chip-bg, #f3f4f6); color: var(--text-primary); }
    .pf-cpop__close:focus-visible { outline: 2px solid var(--color-primary, #7c3aed); outline-offset: 1px; }

    /* Phones: top of the screen, full width inside the gutters. */
    @media (max-width: 767px) {
      .pf-cpop, .pf-cpop--lifted {
        top: calc(env(safe-area-inset-top, 0px) + 8px);
        bottom: auto; left: 12px; right: 12px; width: auto;
        flex-direction: column;
      }
      .pf-cpop__main { min-height: 56px; }
      .pf-cpop__close { width: 44px; height: 44px; margin: 4px 4px 0 0; }
      @keyframes pf-cpop-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
    }
    @media (prefers-reduced-motion: reduce) {
      .pf-cpop__card { animation: none; }
    }
  `],
})
export class ChatPopupsComponent {
  protected readonly svc = inject(ChatPopupService);
  private readonly chat = inject(ChatService);
  private readonly windows = inject(ChatWindowsService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);

  protected readonly popups = this.svc.popups;
  protected readonly lifted = computed(() => !this.windows.isPhone() && this.windows.open().length > 0);

  protected initials(name: string): string {
    const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  }

  protected time(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  protected countLabel(p: ChatPopup): string {
    return `${p.count} new messages`;
  }

  protected ariaLabel(p: ChatPopup): string {
    const who = p.groupName ? `${p.senderName} in ${p.groupName}` : p.senderName;
    const what = p.count > 1 ? `${p.count} new messages from ${who}` : `New message from ${who}`;
    return `${what}: ${p.preview}. Open conversation.`;
  }

  /** Same routing as the Messages panel (top-strip openConvo). */
  protected openConversation(p: ChatPopup): void {
    this.svc.dismiss(p.id);
    // Already on /messages → open it in the page itself.
    if (this.router.url.split('?')[0] === '/messages') {
      void this.chat.openConversation(p.conversationId);
      return;
    }
    if (this.theme.isNewDesign() && !this.windows.isPhone()) {
      this.windows.openWindow(p.conversationId);
      void this.chat.loadThread(p.conversationId);
      return;
    }
    void this.router.navigate(['/messages'], { queryParams: { c: p.conversationId } });
  }
}
