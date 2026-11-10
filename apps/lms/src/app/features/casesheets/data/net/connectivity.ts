import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * Is this device online? The browser's own signal (navigator.onLine plus the
 * `online` / `offline` events). Coarse by design: it says "no network at all",
 * never "the server is down" (the pages say that in their own words).
 */
@Injectable({ providedIn: 'root' })
export class Connectivity {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  /** Set for a few seconds after the network comes back, so the banner can say so. */
  readonly backOnline = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const up = () => {
      if (!this.online()) {
        this.backOnline.set(true);
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.backOnline.set(false), BACK_ONLINE_MS);
      }
      this.online.set(true);
    };
    const down = () => {
      if (this.timer) clearTimeout(this.timer);
      this.backOnline.set(false);
      this.online.set(false);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      if (this.timer) clearTimeout(this.timer);
    });
  }
}

export const BACK_ONLINE_MS = 4000;
export const OFFLINE_TEXT = "You're offline. What you type is kept on this device and sent when you're back.";
export const BACK_ONLINE_TEXT = "You're back online. Everything is being sent.";
