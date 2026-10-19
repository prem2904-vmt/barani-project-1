import { CallKitVoip, type CallToken, type CallData } from 'capacitor-plugin-callkit-voip';
import { App } from '@capacitor/app';
import type { AuthService } from '../auth/auth.service';
import type { WebrtcService } from './webrtc.service';
import type { NativeRingState } from './native-ring.state';
import type { ApiService } from './api.service';
import type { SignalingService } from './signaling.service';
import { declineFromPush, showRingFromPush } from './call-push.actions';

/** A CallKit call the user ANSWERED that the web app has not joined yet —
 *  held natively (the plugin) so an answer made while this WebView was
 *  suspended, reloaded or not yet booted is never lost. */
export interface PendingAnswer {
  id?: string;
  media?: string;
  name?: string;
  /** CallKit already activated the call's audio session (didActivate). */
  audioActive?: boolean;
}

/** The slice of the (patched, see patches/) CallKitVoip plugin this uses. */
export interface CallKitPlugin {
  register(): Promise<void>;
  endCall(): Promise<void>;
  endRing(o: { id: string }): Promise<void>;
  callConnected(o?: { id?: string }): Promise<void>;
  getPendingAnswer(): Promise<PendingAnswer>;
  addListener(eventName: string, fn: (data: never) => void): Promise<unknown>;
}

/** App lifecycle hook (resume) — @capacitor/app in the app, a fake in specs. */
export interface AppLifecycle {
  onResume(fn: () => void): void;
}

export interface CallKitDeps {
  auth: AuthService;
  webrtc: WebrtcService;
  nativeRing: NativeRingState;
  api: ApiService;
  signaling: SignalingService;
  /** A (new) PushKit VoIP token — the caller stores + registers it. */
  onVoipToken(token: string): void;
  /** Specs only: stand-ins for the native plugin / app lifecycle. */
  plugin?: CallKitPlugin;
  lifecycle?: AppLifecycle;
}

let wired: CallKitWiring | null = null;

/**
 * iOS CallKit / PushKit wiring (lazy — kept off the initial bundle; loaded by
 * PushService.init on iOS only). The patched capacitor-plugin-callkit-voip
 * buffers every event fired before register(), so attaching here a moment
 * after boot loses nothing (cold VoIP-push launches included).
 */
export async function wireCallKit(deps: CallKitDeps): Promise<void> {
  if (wired) return;
  wired = new CallKitWiring(deps);
  await wired.attach();
}

/** Re-arm PushKit after logout → login (fresh VoIP token). */
export async function reRegisterCallKit(): Promise<void> {
  try { await CallKitVoip.register(); } catch { /* iOS only */ }
}

const capacitorLifecycle: AppLifecycle = {
  onResume: fn => { void App.addListener('resume', fn).catch(() => undefined); },
};

/**
 * Answer → join, whatever state the WebView was in when the user answered:
 *
 *  • App open: callAnswered arrives live → wait for CallKit's audio session
 *    (audioSessionActivated) → AcceptCall.
 *  • Locked / backgrounded: the answer is an AUDIO CallKit answer, so iOS keeps
 *    the app in the background and this WebView is suspended — JS cannot run
 *    the join. The native layer has ALREADY told the server "answering" over
 *    HTTPS (so the caller stops seeing "Ringing") and holds the answer; the
 *    user opens the app → resume → getPendingAnswer() → join.
 *  • Killed (cold launch by the VoIP push): the plugin buffers callAnswered
 *    until register(); getPendingAnswer() covers a WebView that was reloaded.
 *
 * Every path funnels into ONE accept per call id
 * (WebrtcService.acceptBySessionId, which also dedupes against the in-app
 * Answer button), then tells the native side the call is connected.
 */
export class CallKitWiring {
  /** Session id of a CallKit answer awaiting audio-session activation before we
   *  join WebRTC (so mic capture routes correctly on a background answer). */
  private pendingAcceptId: string | null = null;
  /** CallKit rings the user answered (a later callEnded is a hang-up, not a decline). */
  private readonly answered = new Set<string>();
  /** Answered calls already handed to the accept path — a replay (event +
   *  pending-answer on resume) never joins twice. */
  private readonly accepting = new Set<string>();
  /** CallKit's audio session is active for the current call. */
  private audioActive = false;
  private readonly plugin: CallKitPlugin;
  private readonly lifecycle: AppLifecycle;

  constructor(private readonly d: CallKitDeps) {
    this.plugin = d.plugin ?? (CallKitVoip as unknown as CallKitPlugin);
    this.lifecycle = d.lifecycle ?? capacitorLifecycle;
  }

  /** An answered call id to join (from the live event or the native hold). */
  private queueAccept(id: string, now: boolean): void {
    if (!id || this.accepting.has(id)) return;
    this.answered.add(id);
    this.d.nativeRing.remove(id);
    this.pendingAcceptId = id;
    // Answered on the CallKit ringer. Do NOT join WebRTC before the CallKit
    // audio session is active (mic capture must route through it). The
    // timeout is a long safety net (the app may still be foregrounding /
    // booting); the real trigger is audioSessionActivated.
    if (now || this.audioActive) this.flushPendingAccept();
    else setTimeout(() => this.flushPendingAccept(), 4000);
  }

  /** Join the pending answered call exactly once (whichever of
   *  audioSessionActivated / the fallback / resume fires first). */
  private flushPendingAccept(): void {
    const id = this.pendingAcceptId;
    if (!id || this.accepting.has(id)) return;
    this.pendingAcceptId = null;
    this.accepting.add(id);
    void (async () => {
      // On a cold launch the session may still be restoring — don't connect
      // SignalR with no/expired token (the hub handshake would 401 and drop).
      await this.d.auth.waitForAuth();
      // By id with retries — on a lock-screen / cold answer the hub is usually
      // still (re)connecting. Deduped against the in-app Answer button.
      await this.d.webrtc.acceptBySessionId(id);
      // Clear the native hold + release its background task.
      try { await this.plugin.callConnected({ id }); } catch { /* ignore */ }
    })().catch(err => console.warn('[callkit] accept failed', err));
  }

  /** Pick up an answer the native layer is holding (made while this WebView
   *  was suspended / reloading / booting). Safe to call any time. */
  async consumePendingAnswer(): Promise<void> {
    try {
      const p = await this.plugin.getPendingAnswer();
      if (!p?.id) return;
      if (p.audioActive) this.audioActive = true;
      this.queueAccept(p.id, !!p.audioActive);
    } catch { /* older native build without the method */ }
  }

  async attach(): Promise<void> {
    const { auth, webrtc, nativeRing } = this.d;
    const CallKitVoip = this.plugin;
    try {
      await CallKitVoip.addListener('registration', (t: CallToken) => this.d.onVoipToken(t.value));

      // A VoIP push rang CallKit (possibly cold-launching the app in the
      // background). Keep the web ringtone quiet for it, and once signed in +
      // connected, confirm it is STILL ringing on the server — a caller who
      // cancelled before the app booted must not leave CallKit ringing.
      await CallKitVoip.addListener('callIncoming', (call: CallData) => {
        if (!call?.id) return;
        nativeRing.add(call.id);
        void (async () => {
          await Promise.race([auth.waitForAuth(), new Promise<void>(r => setTimeout(r, 15_000))]);
          if (!auth.user()) return;
          const ringing = await showRingFromPush(webrtc, this.d.signaling, call.id);
          if (!ringing && !this.answered.has(call.id)) {
            nativeRing.remove(call.id);
            await CallKitVoip.endRing({ id: call.id }).catch(() => undefined);
          }
        })().catch(err => console.warn('[callkit] ring check failed', err));
      });

      // An unanswered ring was stopped natively (ring-stop push, 60 s timeout).
      await CallKitVoip.addListener('callRemoteEnded', (call: CallData) => {
        if (call?.id) nativeRing.remove(call.id);
      });

      await CallKitVoip.addListener('callAnswered', (call: CallData) => {
        if (call?.id) this.queueAccept(call.id, false);
      });

      await CallKitVoip.addListener('audioSessionActivated', () => {
        this.audioActive = true;
        this.flushPendingAccept();
      });

      await CallKitVoip.addListener('callEnded', (call: CallData & { answered?: boolean }) => {
        // With the patched plugin, the CallKit call is kept alive through the
        // whole call, so callEnded means a REAL end (red button or our endCall).
        const id = call?.id;
        this.audioActive = false;
        if (id) this.accepting.delete(id);
        if (id && call.answered === false && !this.answered.has(id)) {
          // Red "Decline" on an UNANSWERED lockscreen ring — possibly with the
          // app cold-launched in the background: tell the server (HTTP, no hub
          // needed) so the caller stops ringing at once.
          nativeRing.remove(id);
          if (this.pendingAcceptId === id) this.pendingAcceptId = null;
          void declineFromPush(webrtc, this.d.api, id);
          return;
        }
        if (id) this.answered.delete(id);
        // Hang-up of a live call: tear the WebRTC call down.
        this.pendingAcceptId = null;
        window.dispatchEvent(new CustomEvent('pf-callkit-ended'));
      });

      // When our WebRTC call fully ends (any path), dismiss the native CallKit
      // UI that we kept alive for background audio.
      window.addEventListener('pf-end-callkit', () => { void CallKitVoip.endCall().catch(() => undefined); });

      await CallKitVoip.register();

      // An answer the native layer held while this WebView was suspended /
      // reloading: join it now, and every time the app comes back.
      await this.consumePendingAnswer();
      this.lifecycle.onResume(() => { void this.consumePendingAnswer(); });
    } catch (err) {
      console.warn('[callkit] register skipped or failed', err);
    }
  }
}
