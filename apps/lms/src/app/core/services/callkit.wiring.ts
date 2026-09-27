import { CallKitVoip, type CallToken, type CallData } from 'capacitor-plugin-callkit-voip';
import type { AuthService } from '../auth/auth.service';
import type { WebrtcService } from './webrtc.service';
import type { NativeRingState } from './native-ring.state';
import type { ApiService } from './api.service';
import type { SignalingService } from './signaling.service';
import { declineFromPush, showRingFromPush } from './call-push.actions';

/** Methods our patch adds to capacitor-plugin-callkit-voip (patches/). */
interface CallKitExtras {
  endRing(o: { id: string }): Promise<void>;
}

export interface CallKitDeps {
  auth: AuthService;
  webrtc: WebrtcService;
  nativeRing: NativeRingState;
  api: ApiService;
  signaling: SignalingService;
  /** A (new) PushKit VoIP token — the caller stores + registers it. */
  onVoipToken(token: string): void;
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

class CallKitWiring {
  /** Session id of a CallKit answer awaiting audio-session activation before we
   *  join WebRTC (so mic capture routes correctly on a background answer). */
  private pendingAcceptId: string | null = null;
  /** CallKit rings the user answered (a later callEnded is a hang-up, not a decline). */
  private readonly answered = new Set<string>();

  constructor(private readonly d: CallKitDeps) {}

  /** Join the pending answered call exactly once (whichever of
   *  audioSessionActivated / the fallback fires first). */
  private flushPendingAccept(): void {
    const id = this.pendingAcceptId;
    if (!id) return;
    this.pendingAcceptId = null;
    void (async () => {
      // On a cold launch the session may still be restoring — don't connect
      // SignalR with no/expired token (the hub handshake would 401 and drop).
      await this.d.auth.waitForAuth();
      await this.d.webrtc.acceptBySessionId(id);
      // Release the native background task now that the WebRTC call is up.
      try { await CallKitVoip.callConnected(); } catch { /* ignore */ }
    })().catch(err => console.warn('[callkit] accept failed', err));
  }

  async attach(): Promise<void> {
    const { auth, webrtc, nativeRing } = this.d;
    try {
      await CallKitVoip.addListener('registration', (t: CallToken) => this.d.onVoipToken(t.value));

      // A VoIP push rang CallKit (possibly cold-launching the app in the
      // background). Keep the web ringtone quiet for it, and once signed in +
      // connected, confirm it is STILL ringing on the server — a caller who
      // cancelled before the app booted must not leave CallKit ringing.
      await CallKitVoip.addListener('callIncoming' as 'callStarted', (call: CallData) => {
        if (!call?.id) return;
        nativeRing.add(call.id);
        void (async () => {
          await Promise.race([auth.waitForAuth(), new Promise<void>(r => setTimeout(r, 15_000))]);
          if (!auth.user()) return;
          const ringing = await showRingFromPush(webrtc, this.d.signaling, call.id);
          if (!ringing && !this.answered.has(call.id)) {
            nativeRing.remove(call.id);
            await (CallKitVoip as unknown as CallKitExtras).endRing({ id: call.id }).catch(() => undefined);
          }
        })().catch(err => console.warn('[callkit] ring check failed', err));
      });

      // An unanswered ring was stopped natively (ring-stop push, 60 s timeout).
      await CallKitVoip.addListener('callRemoteEnded' as 'callStarted', (call: CallData) => {
        if (call?.id) nativeRing.remove(call.id);
      });

      await CallKitVoip.addListener('callAnswered', (call: CallData) => {
        if (call?.id) { this.answered.add(call.id); nativeRing.remove(call.id); }
        // Answered on the lockscreen ringer. Do NOT join WebRTC yet — wait for
        // the CallKit audio session to activate (audioSessionActivated) so the
        // mic capture routes correctly. The fallback is a long safety net (the
        // app may still be foregrounding/booting on a cold launch); the real
        // trigger is audioSessionActivated.
        this.pendingAcceptId = call.id;
        setTimeout(() => this.flushPendingAccept(), 4000);
      });

      await CallKitVoip.addListener('audioSessionActivated', () => this.flushPendingAccept());

      await CallKitVoip.addListener('callEnded', (call: CallData & { answered?: boolean }) => {
        // With the patched plugin, the CallKit call is kept alive through the
        // whole call, so callEnded means a REAL end (red button or our endCall).
        const id = call?.id;
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
    } catch (err) {
      console.warn('[callkit] register skipped or failed', err);
    }
  }
}
