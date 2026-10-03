import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';

/** `window.electronAPI` already fires this on 'menu-action' (preload.js
 *  `onMenuAction`, reserved there for exactly this). electron/tray.js sends
 *  it for "Open Instruments" and "Unmatched results today" — the only
 *  payload shape today is a plain route navigation. */
export interface MenuActionPayload { action: string; path?: string }

export interface ElectronMenuBridge {
  /** @returns an unsubscribe function. */
  onMenuAction(cb: (payload: MenuActionPayload) => void): () => void;
}

/** Where the bridge comes from — swapped in specs, mirrors
 *  desktop-window.service.ts's ELECTRON_WINDOW_SOURCE pattern so this stays
 *  testable without `vi.mock` on a relative import. */
export const ELECTRON_MENU_ACTION_SOURCE = new InjectionToken<() => ElectronMenuBridge | undefined>(
  'ELECTRON_MENU_ACTION_SOURCE',
  {
    providedIn: 'root',
    factory: () => () => {
      if (typeof window === 'undefined') return undefined;
      const api = (window as unknown as {
        electronAPI?: { isElectron?: boolean; onMenuAction?: (cb: (e: unknown, payload: MenuActionPayload) => void) => void };
      }).electronAPI;
      if (!api?.isElectron || typeof api.onMenuAction !== 'function') return undefined;
      return {
        onMenuAction: (cb) => {
          const handler = (_e: unknown, payload: MenuActionPayload) => cb(payload);
          api.onMenuAction!(handler);
          // preload.js's onMenuAction has no "off" counterpart (it's a bare
          // ipcRenderer.on — see its own comment, "reserved for future menu
          // actions"); this service is the app's one eager, lifetime-long
          // subscriber, so there is nothing to unsubscribe in practice.
          return () => undefined;
        },
      };
    },
  },
);

/**
 * Tray / native-menu → renderer navigation. electron/tray.js's "Open
 * Instruments" and "Unmatched results today" items restore the window and
 * send `{ action: 'navigate', path }`; this is the one place that turns
 * that into a route change. No-op outside Electron (no bridge).
 */
@Injectable({ providedIn: 'root' })
export class ElectronMenuActionService {
  private readonly bridge = inject(ELECTRON_MENU_ACTION_SOURCE)();
  private readonly router = inject(Router);

  constructor() {
    const bridge = this.bridge;
    if (!bridge) return;
    const destroyRef = inject(DestroyRef);
    const off = bridge.onMenuAction((payload) => {
      if (payload && payload.action === 'navigate' && typeof payload.path === 'string') {
        void this.router.navigateByUrl(payload.path);
      }
    });
    destroyRef.onDestroy(off);
  }
}
