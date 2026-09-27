import { Injectable, effect, inject, untracked } from '@angular/core';
import { PlatformService } from './platform.service';
import { WebrtcService } from './webrtc.service';
import { CallPushService, type CallPushAction } from './call-push.service';

/** window.electronAPI.calls — electron/preload.js. */
export interface ElectronCallsBridge {
  incoming(info: { callId: string; callerName: string; isGroup?: boolean; groupName?: string }): void;
  dismiss(callId: string): void;
  onAction(cb: (a: { action: CallPushAction; callId: string }) => void): () => void;
}

function bridge(): ElectronCallsBridge | null {
  const w = window as unknown as { electronAPI?: { calls?: ElectronCallsBridge } };
  return w.electronAPI?.calls ?? null;
}

/**
 * Desktop (Electron) incoming calls while the window is minimised, hidden in
 * the tray or behind other apps. The desktop app has no APNs/FCM — it keeps
 * its SignalR socket alive in the background (main.js disables background
 * throttling and hides instead of quitting), so the ring arrives as the normal
 * IncomingCall. This bridge hands it to the main process, which shows a small
 * always-on-top call window with Answer / Decline, flashes the taskbar /
 * bounces the dock, and restores the main window on Answer. The ringtone is
 * the renderer's own (CallRingService). The window is dismissed the moment
 * the ring ends on any path (answered here or elsewhere, declined, cancelled,
 * timed out).
 */
@Injectable({ providedIn: 'root' })
export class ElectronCallService {
  private readonly platform = inject(PlatformService);
  private readonly webrtc = inject(WebrtcService);
  private readonly callPush = inject(CallPushService);

  private shown: string | null = null;

  constructor() {
    const api = typeof window !== 'undefined' && this.platform.isElectron() ? bridge() : null;
    if (!api) return;

    effect(() => {
      const inc = this.webrtc.incomingCall();
      untracked(() => {
        const next = inc?.sessionId ?? null;
        if (this.shown && this.shown !== next) api.dismiss(this.shown);
        if (inc && next !== this.shown) {
          api.incoming({
            callId: inc.sessionId,
            callerName: inc.callerName || 'A colleague',
            isGroup: !!inc.isGroup,
            groupName: inc.conversationName ?? undefined,
          });
        }
        this.shown = next;
      });
    });

    api.onAction(a => void this.callPush.handle(a.action, a.callId));
  }
}
