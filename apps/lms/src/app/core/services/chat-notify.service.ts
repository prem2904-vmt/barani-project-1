import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Browser Notification API + tab-title flasher for new chat messages.
 * Separate from RingtoneService so the audible ping and the visual
 * notification can evolve independently (e.g. mute-while-focused).
 *
 * Permission model: we don't auto-request on bootstrap (browsers
 * penalise that with permanent denial). The /messages page calls
 * ensurePermission() once, gated behind a user gesture (page mount
 * after click-through is acceptable in all major browsers).
 *
 * Flashing is a 1.5s alternating title between original and the
 * unread-count prefix until the tab regains focus, then restored.
 */
@Injectable({ providedIn: 'root' })
export class ChatNotifyService implements OnDestroy {
  private readonly router = inject(Router);
  private originalTitle = typeof document !== 'undefined' ? document.title : 'Prefrontal';
  private flashTimer: number | null = null;
  private flashState = false;
  private unreadCountForTitle = 0;
  private focusHandler = () => this.restore();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', this.focusHandler);
      // Some browsers fire visibilitychange but NOT focus when the tab
      // becomes visible from a hidden state; cover both.
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /**
   * Ask the user for Notification permission. Idempotent — safe to call
   * multiple times. Returns the resulting permission state. Will be a
   * no-op on browsers without the API (Safari iOS in non-PWA mode).
   */
  async ensurePermission(): Promise<NotificationPermission | 'unsupported'> {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted' || Notification.permission === 'denied') {
      return Notification.permission;
    }
    try { return await Notification.requestPermission(); }
    catch { return 'default'; }
  }

  /**
   * Show a notification + flash the title. If the tab is focused, we
   * skip the OS notification (it would be redundant) but still bump
   * the title flash for peripheral awareness in tiled-window setups.
   */
  notify(title: string, body: string, conversationId: string): void {
    const tabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.unreadCountForTitle += 1;
    this.startFlashing();

    if (!tabHidden) return;                                      // focused → ping is enough
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;

    try {
      const n = new Notification(title, {
        body: body.length > 140 ? body.slice(0, 140) + '…' : body,
        tag: `pf-chat-${conversationId}`,                        // collapse multiple from same convo
        silent: true,                                            // our ringtone.playPing handles audio
        icon: '/favicon.ico'
      });
      n.onclick = () => {
        try { window.focus(); } catch { /* ignore */ }
        void this.router.navigate(['/messages']);
        try { n.close(); } catch { /* ignore */ }
      };
    } catch { /* swallow — Notification ctor can throw on Safari iOS */ }
  }

  /** Reset the title + clear unread counter (called on tab focus). */
  restore(): void {
    if (this.flashTimer !== null) {
      clearInterval(this.flashTimer);
      this.flashTimer = null;
    }
    this.flashState = false;
    this.unreadCountForTitle = 0;
    if (typeof document !== 'undefined') document.title = this.originalTitle;
  }

  private onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') this.restore();
  };

  private startFlashing(): void {
    if (typeof document === 'undefined') return;
    // Already running — the interval handler will pick up the bumped count.
    if (this.flashTimer !== null) return;
    this.flashTimer = window.setInterval(() => {
      this.flashState = !this.flashState;
      document.title = this.flashState
        ? `(${this.unreadCountForTitle}) New message · ${this.originalTitle}`
        : this.originalTitle;
    }, 1500);
  }

  ngOnDestroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', this.focusHandler);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.restore();
  }
}
