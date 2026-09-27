import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { CallKitVoip, type CallToken, type CallData } from 'capacitor-plugin-callkit-voip';
import { LocalNotifications } from '@capacitor/local-notifications';
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
      // Logout→login in the same app session: unregister() dropped the OS
      // registration and cleared the tokens, and init() is a once-only guard —
      // so without this, push stays dead until the app is force-quit. Listeners
      // are still wired from init(); re-running register() mints a fresh token
      // which flows through the 'registration' listener → postTokensToBackend.
      else if (authed && this._initialised) void this.reactivate();
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

    // ── (1) Listeners + category FIRST ──────────────────────────────
    // CRITICAL for the lock-screen Reply: when the phone is locked and the app
    // is KILLED, iOS relaunches it in the background purely to deliver the
    // notification action. Capacitor fires `pushNotificationActionPerformed`
    // ONCE and does not buffer it — so the listener must be attached before any
    // `await` (the permission round-trip below) or the reply is silently lost.
    PushNotifications.addListener('registration', (t: Token) => {
      this.appToken.set(t.value);
      void this.postTokensToBackend();
    });

    PushNotifications.addListener('registrationError', err => {
      // eslint-disable-next-line no-console
      console.warn('[push] registrationError', err);
    });

    // Foreground delivery — show in-app toast and route.
    PushNotifications.addListener('pushNotificationReceived', (n: PushNotificationSchema) => {
      this.handleIncomingPayload(n.data ?? {}, /*opened=*/ false, n.title, n.body);
    });

    // Cold-start / background tap OR inline lock-screen reply.
    PushNotifications.addListener('pushNotificationActionPerformed', (a: ActionPerformed) => {
      const data = a.notification?.data ?? {};
      const reply = (a as ActionPerformed & { inputValue?: string }).inputValue;
      // WhatsApp-style inline reply: the user typed into the notification's
      // Reply action and hit send — deliver it WITHOUT opening the app.
      if (a.actionId === 'REPLY' && reply && data['kind'] === 'chat-message' && data['conversationId']) {
        void this.sendInlineReply(String(data['conversationId']), reply);
        return;
      }
      // Otherwise it's a tap on the notification body — route into the app.
      this.handleIncomingPayload(data, /*opened=*/ true, a.notification?.title, a.notification?.body);
    });

    // Register the chat-message notification category so iOS shows an inline
    // "Reply" text field on the lockscreen/banner. Shares the system
    // UNUserNotificationCenter, so it matches the APNs aps.category we send.
    try {
      await LocalNotifications.registerActionTypes({
        types: [{
          id: 'CHAT_MESSAGE',
          actions: [{ id: 'REPLY', title: 'Reply', input: true, inputButtonTitle: 'Send', inputPlaceholder: 'Message…' }],
        }],
      });
    } catch (err) { console.warn('[push] registerActionTypes failed', err); }

    // Android 8+ requires the notification channel to EXIST before a push
    // referencing it can display. The FCM payload hardcodes
    // channel_id "pf_messages", but nothing ever created it — so pushes
    // could silently no-op on Android.
    if (this.detectPlatform() === 'android') {
      try {
        await PushNotifications.createChannel({
          id: 'pf_messages',
          name: 'Messages & alerts',
          description: 'Chat messages, lab work and critical alerts',
          importance: 5,
          visibility: 1,
          sound: 'default',
          vibration: true,
        });
      } catch (err) { console.warn('[push] createChannel failed', err); }
    }

    // ── (2) Permissions ─────────────────────────────────────────────
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

    // ── (3) APNs / FCM token registration ───────────────────────────
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

  /** Send a lock-screen inline reply. Runs in a tightly time-boxed background
   *  window when the app was woken just to handle the action, so it must not
   *  hang: we race session-restore against a short timeout, then POST. If the
   *  send fails (offline / session gone) we surface a local notification so the
   *  reply is never SILENTLY dropped — the user can reopen and resend. */
  private async sendInlineReply(conversationId: string, body: string): Promise<void> {
    try {
      // HTTP send (not SignalR) — reliable from a backgrounded/killed app where
      // the hub can't be trusted to connect for a one-shot reply.
      await Promise.race([
        this.auth.waitForAuth(),
        new Promise<void>(resolve => setTimeout(resolve, 4000)),
      ]);
      await firstValueFrom(this.api.post(
        `/api/chat/conversations/${conversationId}/messages`, { body }));
    } catch (err) {
      console.warn('[push] inline reply failed', err);
      try {
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Date.now() % 100000),
            title: 'Message not sent',
            body: 'Tap to open the conversation and resend.',
            extra: { kind: 'chat-message', conversationId },
          }],
        });
      } catch { /* best-effort */ }
    }
  }

  /** Guards against overlapping registration runs (the auth effect can fire
   *  several times in quick succession on boot/login). */
  private _registering = false;

  /** Send both tokens (if present) to the backend. Idempotent: server
   *  upserts on (userId, platform).
   *
   *  A failed registration means the backend keeps a STALE token and pushes go
   *  nowhere — exactly the "no push when the app is closed" symptom — so a
   *  transient network blip on boot (the observed `status 0`) must not be
   *  swallowed. Retry with backoff until it lands. */
  private async postTokensToBackend(): Promise<void> {
    if (!this.appToken() && !this.voipToken()) return;
    // Tokens routinely arrive before login — a POST now can only 401, and the
    // retry loop was hammering the backend with guaranteed failures. The auth
    // effect in the constructor re-posts the moment we're signed in.
    if (!this.auth.user()) return;
    if (this._registering) return;
    this._registering = true;
    const delays = [0, 2000, 5000, 10000, 20000]; // ~37s of attempts
    try {
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await new Promise(r => setTimeout(r, delays[i]));
        try {
          await firstValueFrom(this.api.post('/api/devices/register', {
            platform: this.detectPlatform(),
            appToken: this.appToken(),
            voipToken: this.voipToken(),
            appVersion: this.appVersion()
          }));
          return; // landed
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[push] register-with-backend failed (attempt ${i + 1}/${delays.length})`, err);
        }
      }
    } finally {
      this._registering = false;
    }
  }

  /** Re-arm OS push registration after unregister(). Permission was already
   *  granted (or not) in init(); we only redo the registration step. */
  private _reactivating = false;
  private async reactivate(): Promise<void> {
    if (this._reactivating || !this.platform.isCapacitor()) return;
    this._reactivating = true;
    try {
      const status = await PushNotifications.checkPermissions();
      if (status.receive !== 'granted') return;
      await PushNotifications.register();
      try { await CallKitVoip.register(); } catch { /* iOS only */ }
    } catch (err) {
      console.warn('[push] reactivate failed', err);
    } finally {
      this._reactivating = false;
    }
  }

  /** Called on logout — server deletes the row so we stop receiving
   *  pushes for this device. Scoped to THIS device's token: deleting all of
   *  the user's rows would silence their other devices (phone logout must
   *  not kill the tablet's pushes). */
  async unregister(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    const tok = this.appToken();
    try {
      await PushNotifications.unregister();
      await firstValueFrom(this.api.delete(
        `/api/devices/me${tok ? `?appToken=${encodeURIComponent(tok)}` : ''}`));
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
          // `c` is the param /messages reads (it used to send `open`, which
          // the page ignored — a tapped push landed on the list).
          this.router.navigate(['/messages'], { queryParams: { c: conv } });
        }
        // Foreground delivery: no toast. The live hub already raised the
        // in-app pop-up (Android) and iOS presents its own banner in the
        // foreground (presentationOptions) — a toast here was a third copy
        // that also ignored mute and the open thread.
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
      // Business notifications (now pushed to devices, not just the bell) —
      // a TAP routes to the screen where the work lives; foreground delivery
      // stays a toast.
      case 'critical_value':
      case 'test_assigned':
      case 'tests_assigned':
      case 'result_rejected': {
        if (opened) this.router.navigate(['/lab/my-work']);
        else if (title || body) this.toasts.info(`${title ?? ''} — ${body ?? ''}`.trim());
        break;
      }
      case 'lms.report_ready': {
        if (opened) this.router.navigate(['/reports']);
        else if (title || body) this.toasts.info(`${title ?? ''} — ${body ?? ''}`.trim());
        break;
      }
      case 'lms.sample_rejection':
      case 'lms.sample_ready_collection': {
        if (opened) this.router.navigate(['/frontdesk']);
        else if (title || body) this.toasts.info(`${title ?? ''} — ${body ?? ''}`.trim());
        break;
      }
      default:
        // The catalog has ~40 business types and only the ones above get a
        // dedicated screen. A TAP on anything else must still land somewhere
        // meaningful: open the notification bell so the tapped item is visible
        // (double-dispatch covers a cold start where the bell mounts late).
        if (opened) {
          window.dispatchEvent(new CustomEvent('pf-open-bell'));
          setTimeout(() => window.dispatchEvent(new CustomEvent('pf-open-bell')), 1500);
        } else if (title || body) {
          this.toasts.info(`${title ?? ''} ${body ?? ''}`.trim());
        }
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
