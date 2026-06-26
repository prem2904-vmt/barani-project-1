import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { CallKitVoip, type CallToken, type CallData } from 'capacitor-plugin-callkit-voip';
import { Router } from '@angular/router';
import { PlatformService } from './platform.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { AuthService } from '../auth/auth.service';
import { WebrtcService } from './webrtc.service';

/**
 * Push notification + CallKit/VoIP orchestration for the Capacitor app.
 *
 * Flow on app start (only on native — web is a no-op):
 *   1. Request push permission.
 *   2. Register with APNs (iOS) / FCM (Android).
 *   3. Register PushKit (iOS only — VoIP token for CallKit).
 *   4. POST both tokens to /api/devices/register with {userId, tenant,
 *      platform, appToken, voipToken}.
 *
 * Server contract:
 *   POST /api/devices/register { platform, appToken, voipToken?, appVersion }
 *   DELETE /api/devices/{tokenId}
 *   Server uses these to fan out chat-message and incoming-call pushes.
 *
 * Incoming push payload shape (sent by backend):
 *   - Message:   { kind: 'chat-message', conversationId, fromName, body }
 *   - Call ring: { kind: 'call-incoming', callId, fromName, callType } via
 *                VoIP push (iOS) so CallKit can show the system ringer
 *                before the app is even running.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly platform = inject(PlatformService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly webrtc = inject(WebrtcService);

  constructor() {
    // The APNs/VoIP tokens usually arrive at app startup BEFORE the user logs
    // in, so the first POST /api/devices/register returns 401 and the backend
    // never gets the token. Re-post whenever we're authenticated AND hold a
    // token (idempotent server-side: upsert on userId+platform). Covers login,
    // session restore, and account switches.
    effect(() => {
      const authed = !!this.auth.user();
      const hasToken = !!(this.appToken() || this.voipToken());
      if (authed && hasToken) void this.postTokensToBackend();
    });
  }

  /** Last APNs/FCM token we registered. */
  readonly appToken = signal<string | null>(null);
  /** Last VoIP/PushKit token (iOS only). */
  readonly voipToken = signal<string | null>(null);
  /** Permission state — 'granted' once user accepts; 'denied' if they decline. */
  readonly permission = signal<'prompt' | 'granted' | 'denied' | 'prompt-with-rationale'>('prompt');

  private _initialised = false;
  /** Session id of a CallKit answer awaiting audio-session activation before we
   *  join WebRTC (so mic capture routes correctly on a background answer). */
  private _pendingAcceptId: string | null = null;

  /** Join the pending answered call exactly once (whichever of
   *  audioSessionActivated / the 1s fallback fires first). */
  private flushPendingAccept(): void {
    const id = this._pendingAcceptId;
    if (!id) return;
    this._pendingAcceptId = null;
    void (async () => {
      // On a cold launch the session may still be restoring — don't connect
      // SignalR with no/expired token (the hub handshake would 401 and drop).
      await this.auth.waitForAuth();
      await this.webrtc.acceptBySessionId(id);
      // Release the native background task now that the WebRTC call is up.
      try { await CallKitVoip.callConnected(); } catch { /* ignore */ }
    })().catch(err => console.warn('[callkit] accept failed', err));
  }

  /** Wire up listeners + request permission. Safe to call multiple times. */
  async init(): Promise<void> {
    if (this._initialised) return;
    if (!this.platform.isCapacitor()) {
      this._initialised = true;
      return;
    }

    this._initialised = true;

    // ── (1) Permissions ─────────────────────────────────────────────
    try {
      const status = await PushNotifications.checkPermissions();
      if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
        const req = await PushNotifications.requestPermissions();
        this.permission.set(req.receive);
        if (req.receive !== 'granted') {
          // Permission denied — bail cleanly. We don't register tokens.
          return;
        }
      } else {
        this.permission.set(status.receive);
        if (status.receive !== 'granted') return;
      }
    } catch {
      // Plugin not present (web/electron) — nothing to do.
      return;
    }

    // ── (2) APNs / FCM token registration ───────────────────────────
    PushNotifications.addListener('registration', (t: Token) => {
      this.appToken.set(t.value);
      void this.postTokensToBackend();
    });

    PushNotifications.addListener('registrationError', err => {
      // eslint-disable-next-line no-console
      console.warn('[push] registrationError', err);
    });

    // ── (3) Foreground delivery — show in-app toast and route ──────
    PushNotifications.addListener('pushNotificationReceived', (n: PushNotificationSchema) => {
      this.handleIncomingPayload(n.data ?? {}, /*opened=*/ false, n.title, n.body);
    });

    // ── (4) Cold-start / background tap — user pressed the notification
    PushNotifications.addListener('pushNotificationActionPerformed', (a: ActionPerformed) => {
      this.handleIncomingPayload(a.notification?.data ?? {}, /*opened=*/ true,
        a.notification?.title, a.notification?.body);
    });

    try {
      await PushNotifications.register();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[push] register() failed', err);
    }

    // ── (5) CallKit / VoIP / PushKit (iOS only) ─────────────────────
    try {
      await CallKitVoip.addListener('registration', (t: CallToken) => {
        this.voipToken.set(t.value);
        void this.postTokensToBackend();
      });

      await CallKitVoip.addListener('callAnswered', (call: CallData) => {
        // Answered on the lockscreen ringer. Do NOT join WebRTC yet — wait for
        // the CallKit audio session to activate (audioSessionActivated) so the
        // mic capture routes correctly. The fallback is a long safety net (the
        // app may still be foregrounding/booting on a cold launch); the real
        // trigger is audioSessionActivated.
        this._pendingAcceptId = call.id;
        setTimeout(() => this.flushPendingAccept(), 4000);
      });

      await CallKitVoip.addListener('audioSessionActivated', () => {
        this.flushPendingAccept();
      });

      await CallKitVoip.addListener('callEnded', (_call: CallData) => {
        // With the patched plugin, the CallKit call is kept alive through the
        // whole call, so callEnded now means a REAL end (red button or our own
        // endCall). Tear the WebRTC call down.
        this._pendingAcceptId = null;
        window.dispatchEvent(new CustomEvent('pf-callkit-ended'));
      });

      // When our WebRTC call fully ends (any path), dismiss the native CallKit
      // UI that we kept alive for background audio.
      window.addEventListener('pf-end-callkit', () => { void CallKitVoip.endCall().catch(() => undefined); });

      await CallKitVoip.register();
    } catch (err) {
      // Plugin only ships an iOS implementation; Android is a no-op stub.
      // eslint-disable-next-line no-console
      console.warn('[callkit] register skipped or failed', err);
    }
  }

  /** Send both tokens (if present) to the backend. Idempotent: server
   *  upserts on (userId, platform). */
  private async postTokensToBackend(): Promise<void> {
    if (!this.appToken() && !this.voipToken()) return;
    try {
      await firstValueFrom(this.api.post('/api/devices/register', {
        platform: this.detectPlatform(),
        appToken: this.appToken(),
        voipToken: this.voipToken(),
        appVersion: this.appVersion()
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[push] register-with-backend failed', err);
    }
  }

  /** Called on logout — server deletes the row so we stop receiving
   *  pushes for this device. */
  async unregister(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try {
      await PushNotifications.unregister();
      await firstValueFrom(this.api.delete('/api/devices/me'));
    } catch { /* non-fatal */ }
    this.appToken.set(null);
    this.voipToken.set(null);
  }

  /** Route an incoming push payload to the right screen. `opened=true`
   *  means the user tapped a system notification — we navigate. When
   *  `opened=false` we're in-app already; show a tap-to-open toast. */
  private handleIncomingPayload(
    data: Record<string, unknown>,
    opened: boolean,
    title?: string,
    body?: string
  ): void {
    const kind = (data['kind'] as string) ?? '';
    switch (kind) {
      case 'chat-message': {
        const conv = data['conversationId'] as string;
        if (opened && conv) {
          this.router.navigate(['/messages'], { queryParams: { open: conv } });
        } else if (title || body) {
          // Foreground delivery: subtle toast so the user can tap to jump.
          this.toasts.info(`${title ?? 'New message'} — ${body ?? ''}`);
        }
        break;
      }
      case 'call-incoming': {
        // For VoIP push on iOS, CallKit already showed the ringer before
        // we got here. On Android we fall through to a high-priority
        // notification + route into the in-app call screen on tap.
        const callId = data['callId'] as string;
        if (opened && callId) {
          this.router.navigate(['/messages'], { queryParams: { acceptCall: callId } });
        }
        break;
      }
      default:
        // Unknown payload — show as a generic toast so it's visible during
        // development without throwing.
        if (title || body) this.toasts.info(`${title ?? ''} ${body ?? ''}`.trim());
    }
  }

  private detectPlatform(): 'ios' | 'android' | 'web' {
    const w = window as unknown as { Capacitor?: { getPlatform?: () => string } };
    const p = w.Capacitor?.getPlatform?.();
    if (p === 'ios' || p === 'android') return p;
    return 'web';
  }

  private appVersion(): string {
    // App version is bumped in package.json — we report it so the
    // backend can target pushes to specific app versions if needed
    // (e.g. for a forced upgrade prompt).
    return '0.1.0';
  }
}
