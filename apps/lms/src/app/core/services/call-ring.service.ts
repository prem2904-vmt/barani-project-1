import { Injectable, OnDestroy, effect, inject, untracked } from '@angular/core';
import { SessionScopeService } from '../auth/session-scope.service';
import { RingtoneService } from './ringtone.service';
import { WebrtcService } from './webrtc.service';
import { NativeRingState } from './native-ring.state';

type RingMsg =
  | { type: 'claim'; sessionId: string; tab: string; visible: boolean }
  | { type: 'stop'; sessionId: string; tab: string };

/**
 * THE call-ring controller (Messages RCA §5). One root owner for the
 * incoming ringtone and the outgoing ringback, driven only by call state —
 * so every terminal state (answer, decline, cancel, timeout, handled on
 * another device, account switch, logout) stops it, regardless of which
 * screen is mounted. It used to live in an effect inside the call overlay,
 * which dies with the shell: "Add account" mid-ring left the loop playing
 * forever.
 *
 * Cross-tab: tabs of the SAME account (channel is scoped per tenant+user)
 * elect ONE ringer per call — a visible tab claims at once, a hidden tab
 * waits briefly and only rings if nobody claimed. Every tab still shows the
 * incoming card; answering anywhere stops all (server CallHandledElsewhere).
 *
 * Hard cap: a ring never outlives RING_CAP_MS even if a terminal event is lost.
 */
@Injectable({ providedIn: 'root' })
export class CallRingService implements OnDestroy {
  private readonly webrtc = inject(WebrtcService);
  private readonly ringtone = inject(RingtoneService);
  private readonly scope = inject(SessionScopeService);
  private readonly nativeRing = inject(NativeRingState);

  static readonly RING_CAP_MS = 95_000;
  static readonly HIDDEN_CLAIM_WAIT_MS = 350;

  private readonly tab = Math.random().toString(36).slice(2, 10);
  private channel: BroadcastChannel | null = null;
  private channelKey = '';
  /** sessionId → another tab of mine is ringing it. */
  private readonly claimedElsewhere = new Set<string>();
  private ringingFor: string | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.scope.onChange(() => { this.stopAll(); this.openChannel(); });
    this.openChannel();

    effect(() => {
      const incoming = this.webrtc.incomingCall();
      const status = this.webrtc.status();
      // A call the OS is already ringing (CallKit / Android call notification)
      // must not ring a second time from the web layer.
      const native = !!incoming && this.nativeRing.has(incoming.sessionId);
      untracked(() => {
        if (incoming && native) this.stopAll();
        else if (incoming) this.ringIncoming(incoming.sessionId);
        else if (status === 'outgoing') this.ringOut();
        else this.stopAll();
      });
    });
  }

  private ringIncoming(sessionId: string): void {
    if (this.ringingFor === sessionId && this.ringtone.activeTone() === 'ringtone') return;
    if (this.claimTimer && this.ringingFor === sessionId) return;
    this.clearTimers();
    this.ringingFor = sessionId;
    const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const start = () => {
      this.claimTimer = null;
      if (this.ringingFor !== sessionId || this.claimedElsewhere.has(sessionId)) return;
      this.post({ type: 'claim', sessionId, tab: this.tab, visible });
      this.ringtone.play('ringtone');
      this.armCap();
    };
    if (visible || !this.channel) start();
    else this.claimTimer = setTimeout(start, CallRingService.HIDDEN_CLAIM_WAIT_MS);
  }

  private ringOut(): void {
    if (this.ringtone.activeTone() === 'ringback') return;
    this.clearTimers();
    this.ringingFor = null;
    this.ringtone.play('ringback');
    this.armCap();
  }

  private stopAll(): void {
    const sid = this.ringingFor;
    this.clearTimers();
    this.ringingFor = null;
    this.ringtone.stop();
    if (sid) this.post({ type: 'stop', sessionId: sid, tab: this.tab });
  }

  private armCap(): void {
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => { this.capTimer = null; this.ringtone.stop(); }, CallRingService.RING_CAP_MS);
  }

  private clearTimers(): void {
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null; }
    if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; }
  }

  private openChannel(): void {
    const key = `pf-call-ring:${this.scope.scopeKey()}`;
    if (key === this.channelKey && this.channel) return;
    try { this.channel?.close(); } catch { /* ignore */ }
    this.channel = null;
    this.channelKey = key;
    this.claimedElsewhere.clear();
    if (typeof BroadcastChannel === 'undefined' || !this.scope.identity()) return;
    try {
      this.channel = new BroadcastChannel(key);
      this.channel.onmessage = (ev: MessageEvent<RingMsg>) => this.onPeer(ev.data);
    } catch { this.channel = null; }
  }

  private onPeer(msg: RingMsg): void {
    if (!msg || msg.tab === this.tab) return;
    if (msg.type === 'claim') {
      this.claimedElsewhere.add(msg.sessionId);
      // A visible tab outranks a hidden one already ringing the same call.
      const meVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
      if (this.ringingFor === msg.sessionId && msg.visible && !meVisible) {
        this.ringtone.stop();
        this.clearTimers();
      }
    } else if (msg.type === 'stop') {
      this.claimedElsewhere.delete(msg.sessionId);
    }
  }

  private post(msg: RingMsg): void {
    try { this.channel?.postMessage(msg); } catch { /* channel closed */ }
  }

  ngOnDestroy(): void {
    this.stopAll();
    try { this.channel?.close(); } catch { /* ignore */ }
  }
}
