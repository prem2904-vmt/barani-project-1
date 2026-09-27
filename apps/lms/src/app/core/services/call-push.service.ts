import { Injectable, effect, inject, untracked } from '@angular/core';
import { App } from '@capacitor/app';
import { registerPlugin } from '@capacitor/core';
import { AuthService } from '../auth/auth.service';
import { PlatformService } from './platform.service';
import { ToastService } from './toast.service';
import { WebrtcService } from './webrtc.service';
import { NativeRingState } from './native-ring.state';
import { ApiService } from './api.service';
import { SignalingService } from './signaling.service';
import { answerFromPush, declineFromPush, showRingFromPush } from './call-push.actions';

/** What the user did on a push-driven ringer. */
export type CallPushAction = 'answer' | 'decline' | 'show';

export interface CallPushIntent { action: CallPushAction; callId: string; }

const CALL_ID = /^[A-Za-z0-9_-]{6,64}$/;
const ACTIONS: readonly CallPushAction[] = ['answer', 'decline', 'show'];

/**
 * Parse a push-ringer hand-off into { action, callId }:
 *   • Android notification intents: prefrontal-call://answer?callId=abc
 *   • web notification click / Electron: ?pfCall=answer:abc (query or hash)
 * Anything else (or a malformed id) → null.
 */
export function parseCallPushLink(url: string | null | undefined): CallPushIntent | null {
  if (!url) return null;
  const native = /^prefrontal-call:\/\/(answer|decline|show)\/?\?(?:.*&)?callId=([^&#]+)/i.exec(url);
  if (native) {
    const callId = decodeURIComponent(native[2]);
    return CALL_ID.test(callId) ? { action: native[1].toLowerCase() as CallPushAction, callId } : null;
  }
  const web = /[?&#]pfCall=(answer|decline|show)(?::|%3A)([^&#]+)/i.exec(url);
  if (web) {
    const callId = decodeURIComponent(web[2]);
    return CALL_ID.test(callId) ? { action: web[1].toLowerCase() as CallPushAction, callId } : null;
  }
  return null;
}

/** Android-only native bridge (android/.../calls/CallRingPlugin.java). */
interface CallRingPlugin {
  cancelRing(o: { callId: string }): Promise<void>;
  startCallService(): Promise<void>;
  stopCallService(): Promise<void>;
}
const CallRing = registerPlugin<CallRingPlugin>('CallRing');

/**
 * THE router for answering / declining a call from outside the in-app ring
 * card — the OFFLINE CALLING hand-offs:
 *   • Android full-screen call notification (Answer / Decline / tap) → an
 *     explicit prefrontal-call:// intent → App appUrlOpen (warm) or
 *     App.getLaunchUrl (cold start);
 *   • browser Web Push notification (service worker) → postMessage to an open
 *     tab, or a new tab opened with ?pfCall=action:id;
 *   • Electron call window → electron-call.service calls {@link handle}.
 * (iOS CallKit answer / decline is wired in push.service — the plugin events.)
 *
 * Every action waits for auth (a cold start restores the session first), then:
 *   answer  → answerFromPush (joins the session the server kept ringing),
 *   decline → declineFromPush (HTTP decline — no hub needed),
 *   show    → showRingFromPush (the in-app ring card, if still ringing).
 * Also owns the Android side effects of call state: the ring notification is
 * cancelled once the in-app ring ends, and the microphone foreground service
 * runs while a call is live.
 */
@Injectable({ providedIn: 'root' })
export class CallPushService {
  private readonly webrtc = inject(WebrtcService);
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly toast = inject(ToastService);
  private readonly nativeRing = inject(NativeRingState);
  private readonly api = inject(ApiService);
  private readonly signaling = inject(SignalingService);

  private initialised = false;
  /** action:callId → handled at (ms) — cold start delivers the same link via
   *  getLaunchUrl AND appUrlOpen; a notification can be clicked twice. */
  private readonly recent = new Map<string, number>();
  private lastIncoming: string | null = null;
  private serviceRunning = false;

  private isAndroid(): boolean {
    const w = window as unknown as { Capacitor?: { getPlatform?: () => string } };
    return this.platform.isCapacitor() && w.Capacitor?.getPlatform?.() === 'android';
  }

  constructor() {
    // Android: once the in-app ring for a call ends (answered, declined,
    // cancelled, handled elsewhere), its system ringer must stop too.
    effect(() => {
      const inc = this.webrtc.incomingCall()?.sessionId ?? null;
      untracked(() => {
        const prev = this.lastIncoming;
        this.lastIncoming = inc;
        if (prev && prev !== inc) {
          this.nativeRing.remove(prev);
          if (this.isAndroid()) void CallRing.cancelRing({ callId: prev }).catch(() => undefined);
        }
      });
    });
    // Android: microphone foreground service for the life of a call.
    effect(() => {
      const live = this.webrtc.inCall();
      untracked(() => {
        if (!this.isAndroid() || live === this.serviceRunning) return;
        this.serviceRunning = live;
        void (live ? CallRing.startCallService() : CallRing.stopCallService()).catch(() => undefined);
      });
    });
  }

  /** Wire the hand-off listeners for this host. Idempotent; call at boot
   *  with the URL the app was OPENED with (captured before the router's
   *  first navigation — it carries a web push's ?pfCall=action:id). */
  async init(bootHref: string = typeof window !== 'undefined' ? window.location.href : ''): Promise<void> {
    if (this.initialised || typeof window === 'undefined') return;
    this.initialised = true;

    // Web / Electron: a ?pfCall=action:id the app was opened with.
    const boot = parseCallPushLink(bootHref);
    if (boot) {
      this.stripBootParam();
      void this.handle(boot.action, boot.callId);
    }

    // Web: the service worker relays notification clicks to an open tab.
    if (!this.platform.isCapacitor() && !this.platform.isElectron() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (ev: MessageEvent) => {
        const d = ev.data as { type?: string; action?: string; callId?: string } | null;
        if (d?.type !== 'pf-call' || !d.callId || !ACTIONS.includes(d.action as CallPushAction)) return;
        if (!CALL_ID.test(d.callId)) return;
        void this.handle(d.action as CallPushAction, d.callId);
      });
    }

    // Android: ring-notification intents.
    if (this.isAndroid()) {
      try {
        await App.addListener('appUrlOpen', e => {
          const p = parseCallPushLink(e.url);
          if (p) void this.handle(p.action, p.callId, { fromBackground: true });
        });
        const launch = await App.getLaunchUrl();
        const p = parseCallPushLink(launch?.url);
        if (p) void this.handle(p.action, p.callId, { fromBackground: true });
      } catch (err) { console.warn('[call-push] App plugin unavailable', err); }
    }
  }

  /** Answer / decline / show a call rung by push. Never throws. */
  async handle(action: CallPushAction, callId: string, opts: { fromBackground?: boolean } = {}): Promise<void> {
    if (!CALL_ID.test(callId)) return;
    const key = `${action}:${callId}`;
    const now = Date.now();
    for (const [k, t] of this.recent) if (now - t > 30_000) this.recent.delete(k);
    if (this.recent.has(key)) return;
    this.recent.set(key, now);

    // Cold start: the stored session is restored before any hub / API call.
    await Promise.race([this.auth.waitForAuth(), new Promise<void>(r => setTimeout(r, 15_000))]);
    if (!this.auth.user()) return; // signed out on this device — nothing to join

    try {
      if (action === 'answer') {
        this.nativeRing.remove(callId);
        await answerFromPush(this.webrtc, callId);
      } else if (action === 'decline') {
        this.nativeRing.remove(callId);
        await declineFromPush(this.webrtc, this.api, callId);
        // Opened only to decline from the notification — go back to where
        // the user was instead of leaving the app on screen.
        if (opts.fromBackground && this.isAndroid()) void App.minimizeApp().catch(() => undefined);
      } else {
        // The OS ringer (Android insistent notification) keeps ringing while
        // the in-app card is up — keep the web ringtone quiet meanwhile.
        if (this.isAndroid()) this.nativeRing.add(callId);
        const ringing = await showRingFromPush(this.webrtc, this.signaling, callId);
        if (!ringing) {
          this.nativeRing.remove(callId);
          if (this.isAndroid()) void CallRing.cancelRing({ callId }).catch(() => undefined);
          this.toast.info('That call has ended.');
        }
      }
    } catch (err) {
      console.warn(`[call-push] ${action} failed`, err);
      if (action === 'answer') this.toast.error('Could not join the call — it may have ended.');
    }
  }

  private stripBootParam(): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('pfCall');
      const hash = url.hash.replace(/([?&])pfCall=[^&]*&?/, '$1').replace(/[?&]$/, '');
      history.replaceState(history.state, '', url.pathname + url.search + hash);
    } catch { /* cosmetic */ }
  }
}
