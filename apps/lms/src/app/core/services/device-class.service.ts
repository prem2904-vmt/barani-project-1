import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { DeviceClass, applyDeviceClass, detectDeviceClass, readDeviceEnv } from './device-class';

/**
 * Keeps `html.device-touch` / `device-tablet` / `device-phone` /
 * `device-desktop` in sync for the life of the app.
 *
 * index.html already set the class inline before the first paint; this
 * service re-derives it at boot (same rules, see device-class.ts) and again
 * when the inputs change: a mouse / keyboard-trackpad attached or detached
 * (a convertible folding into tablet mode) or the window moving to another
 * screen. Rotation never changes the class — tablet vs phone keys on the
 * screen's SHORT side.
 */
@Injectable({ providedIn: 'root' })
export class DeviceClassService {
  private readonly doc = inject(DOCUMENT);
  private readonly win = this.doc.defaultView;

  private readonly _cls = signal<DeviceClass>(this.detect());
  /** 'desktop' | 'tablet' | 'phone'. */
  readonly deviceClass = this._cls.asReadonly();
  /** Touch-first device: the tablet / phone layout at every width. */
  readonly isTouch = computed(() => this._cls() !== 'desktop');

  constructor() {
    this.apply();
    const win = this.win;
    if (!win) return;
    const refresh = () => {
      const next = this.detect();
      if (next !== this._cls()) {
        this._cls.set(next);
        this.apply();
      }
    };
    for (const q of ['(any-pointer: fine)', '(any-pointer: coarse)', '(pointer: coarse)']) {
      try {
        const mql = win.matchMedia?.(q);
        mql?.addEventListener?.('change', refresh);
      } catch { /* old engine */ }
    }
    win.addEventListener?.('resize', refresh, { passive: true });
  }

  private detect(): DeviceClass {
    return this.win ? detectDeviceClass(readDeviceEnv(this.win)) : 'desktop';
  }

  private apply(): void {
    applyDeviceClass(this.doc.documentElement, this._cls());
  }
}
