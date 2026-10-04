import { Injectable, Injector, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PushNotifications, type Token, type PushNotificationSchema, type ActionPerformed } from '@capacitor/push-notifications';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Router } from '@angular/router';
import { PlatformService } from './platform.service';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { AuthService } from '../auth/auth.service';
import { WebrtcService } from './webrtc.service';
import { NativeRingState } from './native-ring.state';
import { SignalingService } from './signaling.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { environment } from '../../../environments/environment';
import { canonicalNotificationType } from '../../shared/utils/notification-type';

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
 *   - Call ring: iOS  — VoIP push { id, name, media } → CallKit (plugin);
 *                Android — data { kind: 'call-incoming', callId, fromName,
 *                callType } → native full-screen ringer (killed/background)
 *                or pushNotificationReceived here (foreground).
 *   - Ring stop: { kind: 'call-end', callId, reason } — iOS background push
 *                (AppDelegate → CallKit plugin), Android data message
 *                (native service cancels the ringer). Never a VoIP push.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly platform = inject(PlatformService);
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly webrtc = inject(WebrtcService);
  private readonly nativeRing = inject(NativeRingState);
  private readonly injector = inject(Injector);
  private readonly scope = inject(SessionScopeService);

  constructor() {
    // Account switch / sign-out: the reply-from-notification token of the
    // previous account is wiped from native storage at once (the server has
    // revoked it too — the device row is re-homed or deleted). The next
    // account's registration issues its own.
    // (prev == null is just boot / first sign-in — nothing of another account to wipe.)
    this.scope.onChange(c => {
      if (!c.prev) return;
      this.replyTokenFor = null;
      void this.clearNativeReply();
    });
    // Back in the foreground → re-issue if the stored token is a day old.
    try {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.syncNativeReply();
      });
    } catch { /* SSR */ }

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

    // The CHAT_MESSAGE category (Reply / Mark as read) is registered NATIVELY
    // at launch (ios/App/App/ChatReply.swift) and its actions are handled
    // there without the web UI. Registering it from JS as well would REPLACE
    // the native set (setNotificationCategories is all-or-nothing). The
    // REPLY branch above stays as a fallback for an older native shell.

    // Taps on native chat notifications (Android) and on "Couldn't send — tap
    // to open" notices arrive as prefrontal-chat://open?c=<id>.
    void import('./chat-native-reply')
      .then(m => m.wireChatOpenLinks(id => void this.router.navigate(['/messages'], { queryParams: { c: id } })))
      .catch(() => undefined);

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
    // Lazy chunk (callkit.wiring.ts): the plugin buffers events until its
    // register(), so wiring a moment after boot loses nothing.
    if (this.detectPlatform() === 'ios') {
      try {
        const { wireCallKit } = await import('./callkit.wiring');
        await wireCallKit({
          auth: this.auth, webrtc: this.webrtc, nativeRing: this.nativeRing,
          api: this.api, signaling: this.injector.get(SignalingService),
          onVoipToken: token => { this.voipToken.set(token); void this.postTokensToBackend(); },
        });
      } catch (err) { console.warn('[callkit] wiring failed', err); }
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

  /** `${userId}|${appToken}` the native reply token was last issued for, and when. */
  private replyTokenFor: string | null = null;
  private replyTokenAt = 0;

  /** Hand this device's reply-from-notification token to the native layer
   *  (Keychain / EncryptedSharedPreferences). Re-issued when the account or
   *  push token changes, or daily; the server token lives 30 days. */
  private async syncNativeReply(): Promise<void> {
    const appToken = this.appToken();
    const user = this.auth.user();
    if (!appToken || !user || !this.platform.isCapacitor()) return;
    const key = `${user.id}|${appToken}`;
    if (this.replyTokenFor === key && Date.now() - this.replyTokenAt < 24 * 3600_000) return;
    this.replyTokenFor = key;
    this.replyTokenAt = Date.now();
    try {
      const [m, { ChatHistoryService }] = await Promise.all([
        import('./chat-native-reply'), import('./chat-history.service'),
      ]);
      let deviceId: string | null = null;
      try { deviceId = await this.injector.get(ChatHistoryService).deviceId(); } catch { /* memory store */ }
      if (this.auth.user()?.id !== user.id) return; // switched meanwhile
      const ok = await m.syncReplyCredentials({
        api: this.api, apiUrl: environment.apiUrl, appToken, deviceId, userId: user.id,
      });
      if (!ok) this.replyTokenFor = null;
    } catch { this.replyTokenFor = null; }
  }

  private async clearNativeReply(): Promise<void> {
    if (!this.platform.isCapacitor()) return;
    try { await (await import('./chat-native-reply')).clearReplyCredentials(); } catch { /* old shell */ }
  }

  /** The build's APNs environment, read once from the native shell. */
  private _apnsEnv: Promise<'production' | 'development' | null> | null = null;
  private apnsEnvironment(): Promise<'production' | 'development' | null> {
    return this._apnsEnv ??= import('./chat-native-reply')
      .then(m => m.readApnsEnvironment())
      .catch(() => null);
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
          const platform = this.detectPlatform();
          // iOS: tell the server which APNs gateway these tokens belong to
          // (TestFlight = production, Xcode Debug = sandbox) — sent only when
          // known, so the field is absent on older native shells.
          const apnsEnvironment = platform === 'ios' ? await this.apnsEnvironment() : null;
          await firstValueFrom(this.api.post('/api/devices/register', {
            platform,
            appToken: this.appToken(),
            voipToken: this.voipToken(),
            appVersion: this.appVersion(),
            ...(apnsEnvironment ? { apnsEnvironment } : {}),
          }));
          void this.syncNativeReply();
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
      if (this.detectPlatform() === 'ios') {
        await import('./callkit.wiring').then(m => m.reRegisterCallKit()).catch(() => undefined);
      }
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
    // Browser Web Push subscription (plain web) — no ghost rings after logout.
    // (Lazy: the web-push service lives in the offline-calling chunk.)
    if (!this.platform.isCapacitor() && !this.platform.isElectron()) {
      await import('./web-push.service')
        .then(m => this.injector.get(m.WebPushService).unsubscribe())
        .catch(() => undefined);
    }
    if (!this.platform.isCapacitor()) return;
    // The reply-from-notification token goes BEFORE anything else.
    this.replyTokenFor = null;
    await this.clearNativeReply();
    const tok = this.appToken();
    const voip = this.voipToken();
    // Name BOTH tokens: an iPhone's PushKit token can sit in a row of its own
    // (it often registers before the APNs token) — deleting only by appToken
    // left it behind, and the logged-out phone kept ringing via CallKit.
    const q = [tok ? `appToken=${encodeURIComponent(tok)}` : '', voip ? `voipToken=${encodeURIComponent(voip)}` : '']
      .filter(Boolean).join('&');
    try {
      await PushNotifications.unregister();
      await firstValueFrom(this.api.delete(`/api/devices/me${q ? `?${q}` : ''}`));
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
    // Business kinds are matched on the canonical catalog key (M20): old
    // servers / queued pushes may still send the legacy "lms." spelling.
    const kind = canonicalNotificationType((data['kind'] as string) ?? '');
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
        // Android, app in the FOREGROUND: the native service handed the ring
        // to us instead of posting a system ringer. The live socket normally
        // already raised the in-app ring; if it lagged, fetch it by id.
        // (Killed / background rings are the native full-screen notification,
        // whose Answer / Decline / tap arrive via call-push.service.)
        const callId = data['callId'] as string;
        if (callId && this.webrtc.incomingCall()?.sessionId !== callId) {
          void import('./call-push.actions')
            .then(m => m.showRingFromPush(this.webrtc, this.injector.get(SignalingService), callId));
        }
        break;
      }
      case 'call-end':
        // The ring stopped server-side; the live socket's CallCancelled /
        // CallHandledElsewhere clears the in-app ring. Nothing to show.
        break;
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
      case 'report_ready': {
        if (opened) this.router.navigate(['/reports']);
        else if (title || body) this.toasts.info(`${title ?? ''} — ${body ?? ''}`.trim());
        break;
      }
      case 'sample_rejection':
      case 'sample_ready_collection': {
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
    // (e.g. for a forced upgrade prompt). 0.2.0 = this build renders chat
    // pushes natively (Android data messages with inline Reply) — the server
    // keeps sending older builds the plain notification message.
    return '0.2.0';
  }
}
