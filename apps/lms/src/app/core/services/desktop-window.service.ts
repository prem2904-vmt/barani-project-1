import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { installEscToLeaveFullScreen } from './desktop-fullscreen-esc';

/** window.electronAPI.window — electron/preload.js (fullscreen.js in main). */
export interface ElectronWindowBridge {
  isFullScreen(): Promise<boolean>;
  setFullScreen(on: boolean): Promise<boolean>;
  onFullScreenChange(cb: (on: boolean) => void): () => void;
}

/** Where the bridge comes from — swapped in specs. Web / iPad / Android have
 *  no `electronAPI.window`, so everything below stays off there. An older
 *  desktop build without the bridge is treated the same way. */
export const ELECTRON_WINDOW_SOURCE = new InjectionToken<() => ElectronWindowBridge | undefined>(
  'ELECTRON_WINDOW_SOURCE',
  {
    providedIn: 'root',
    factory: () => () => {
      if (typeof window === 'undefined') return undefined;
      const api = (window as unknown as { electronAPI?: { isElectron?: boolean; window?: ElectronWindowBridge } }).electronAPI;
      return api?.isElectron && api.window ? api.window : undefined;
    },
  },
);

/**
 * Desktop (Electron) kiosk full screen, renderer side.
 *
 *   • `isFullScreen` follows the window (launch, Esc, F11 / Ctrl+Cmd+F, the
 *     green button, the avatar-menu item) — false everywhere but Electron.
 *   • `showClock`: the top strip's date + time, only while full screen on the
 *     desktop app (the OS clock is hidden then).
 *   • Esc leaves full screen only when the app didn't use it
 *     (desktop-fullscreen-esc.ts).
 *
 * Eager-injected by App so the Esc rule works on every screen, /login too.
 */
@Injectable({ providedIn: 'root' })
export class DesktopWindowService {
  private readonly bridge = inject(ELECTRON_WINDOW_SOURCE)();

  /** The desktop app with the full-screen bridge. */
  readonly available = !!this.bridge;

  private readonly _full = signal(false);
  readonly isFullScreen = this._full.asReadonly();

  /** Top-strip clock: desktop app AND full screen. */
  readonly showClock = computed(() => this.available && this._full());

  constructor() {
    const b = this.bridge;
    if (!b) return;
    const destroyRef = inject(DestroyRef);
    const offChange = safe(() => b.onFullScreenChange(on => this._full.set(on === true)), () => undefined);
    void b.isFullScreen().then(on => this._full.set(on === true), () => undefined);
    const offEsc = typeof window !== 'undefined'
      ? installEscToLeaveFullScreen(window, () => this._full(), () => void this.setFullScreen(false))
      : () => undefined;
    destroyRef.onDestroy(() => { offEsc(); offChange?.(); });
  }

  /** Enter / leave full screen. The signal updates from main's event. */
  async setFullScreen(on: boolean): Promise<void> {
    if (!this.bridge) return;
    try { await this.bridge.setFullScreen(on); } catch { /* window gone / refused */ }
  }
}

function safe<T>(fn: () => T, fallback: () => T): T {
  try { return fn(); } catch { return fallback(); }
}
