import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SignalingService, cleanHubError, isOnlineStatus } from './signaling.service';
import { ToastService } from './toast.service';
import { ChatService } from './chat.service';
import { ApiService } from './api.service';
import { environment } from '../../../environments/environment';
import {
  CallStatus, CallType, IceServer, IncomingCallInfo
} from '../../shared/models/call.model';

/** One peer connection state — keyed by remote userId in the mesh. */
interface PeerState {
  pc: RTCPeerConnection;
  remoteUserId: string;
  /** Tracks whether we're mid-rollback so duplicate handling is graceful. */
  rolledBack: boolean;
}

/**
 * Audio-only WebRTC mesh service. Owns one local MediaStream + a Map of
 * RTCPeerConnections (one per remote participant). Subscribes to
 * SignalingService for SDP/ICE relay and the call lifecycle.
 *
 * Audio-only by design — getUserMedia is `{ audio: true, video: false }`,
 * no video tile UI, no resolution/bitrate hacks. Mesh up to 5 (enforced
 * server-side by SignalingHub.MaxParticipants).
 *
 * Glare resolved with the perfect-negotiation pattern: the participant with
 * the lower userId is "polite" and rolls back its own offer on collision.
 */
@Injectable({ providedIn: 'root' })
export class WebrtcService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly signaling = inject(SignalingService);
  private readonly toast = inject(ToastService);
  private readonly chat = inject(ChatService);
  private readonly api = inject(ApiService);

  /** Who the OUTGOING call is to — the ringing card showed "Calling" / "C"
   *  because the callee's name was never recorded. Group calls carry the
   *  group name. Cleared on teardown. */
  readonly outgoingPeer = signal<{ id: string; name: string; isGroup: boolean } | null>(null);
  /** The 1:1 callee had no live connection when we dialled: the server is
   *  ringing their phone / browser by PUSH. The outgoing card says "Ringing
   *  their devices…" instead of "Ringing…". Same 60 s "No answer" timeout. */
  readonly ringingDevices = signal(false);
  /** The callee answered on their phone's native call screen (iOS CallKit on
   *  the lock screen) and their app is coming up to join. The outgoing card
   *  says "Answered — connecting…" instead of "Ringing…", and the 60 s
   *  "No answer" timer gives way to a longer join window. */
  readonly calleeAnswering = signal(false);
  /** How long the caller waits for a natively-answered callee to join
   *  (matches the server's AnsweringTimeout). */
  static readonly ANSWERING_JOIN_MS = 120_000;

  // ── Public state ─────────────────────────────────────────────────
  readonly status = signal<CallStatus>('idle');
  readonly sessionId = signal<string | null>(null);
  readonly callType = signal<CallType>('audio');
  readonly micMuted = signal(false);
  readonly remoteParticipants = signal<string[]>([]);
  readonly remoteAudio = signal<Map<string, MediaStream>>(new Map());
  /** Per-remote-participant mute state, broadcast via signaling. */
  readonly remoteMuted = signal<Map<string, boolean>>(new Map());

  // ── Call-duration cap ────────────────────────────────────────────
  /** Hard caps: 10 minutes for 1:1, 30 minutes when the call has ever
   *  had 3+ participants. "Group → individual" downgrade does NOT shrink
   *  the cap (would be jarring); once group, the larger cap sticks. */
  private static readonly CAP_INDIVIDUAL_MS = 10 * 60 * 1000;
  private static readonly CAP_GROUP_MS      = 30 * 60 * 1000;
  /** Highest participant count seen this call (me + remotes). */
  private readonly _maxParticipantsSeen = signal(0);
  /** Active cap for this call. */
  readonly callCapMs = computed(() =>
    this._maxParticipantsSeen() > 2 ? WebrtcService.CAP_GROUP_MS : WebrtcService.CAP_INDIVIDUAL_MS
  );
  /** Tracks the wall clock so duration / remaining values update in real time. */
  private readonly _capNow = signal(Date.now());
  /** Milliseconds left before the call auto-ends. Zero outside active calls. */
  readonly remainingMs = computed(() => {
    const start = this.callStartedAt();
    if (!start || !this.inCall()) return 0;
    return Math.max(0, this.callCapMs() - (this._capNow() - start));
  });
  readonly incomingCall = signal<IncomingCallInfo | null>(null);
  readonly usingTurnRelay = signal(false);
  readonly callError = signal<string | null>(null);
  readonly localCallerName = signal<string | null>(null);
  readonly callStartedAt = signal<number | null>(null);
  readonly inCall = computed(() => this.status() === 'active' || this.status() === 'connecting');

  // ── Private state ────────────────────────────────────────────────
  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerState>();
  /** ICE candidates that arrived before setRemoteDescription — drained
   *  once the remote SDP is applied. Without this buffer, ~30% of cross-
   *  network calls in mesh lose half their audio because trickle ICE
   *  packets race ahead of the SDP exchange and get dropped silently. */
  private pendingIceCandidates = new Map<string, RTCIceCandidateInit[]>();
  private iceServers: IceServer[] = [];
  private iceTtlExpires = 0;
  private subs: Subscription[] = [];
  /** Looping silent audio kept playing during a call to stop iOS suspending the
   *  WKWebView WebContent process when the screen locks (which kills WebRTC). */
  private _keepAlive: HTMLAudioElement | null = null;

  private startKeepAlive(): void {
    if (this._keepAlive || typeof Audio === 'undefined') return;
    try {
      const sampleRate = 8000, numSamples = sampleRate; // 1s of silence
      const buf = new ArrayBuffer(44 + numSamples * 2);
      const v = new DataView(buf);
      const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + numSamples * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
      v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
      v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, numSamples * 2, true);
      const a = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
      a.loop = true;
      (a as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      void a.play().catch(() => undefined);
      this._keepAlive = a;
    } catch { /* best-effort */ }
  }

  private stopKeepAlive(): void {
    if (this._keepAlive) { try { this._keepAlive.pause(); } catch { /* ignore */ } this._keepAlive = null; }
  }
  private currentSource: string | undefined;

  /** Tracks whether we've already shown the 60-sec warning for this call. */
  private _warned60s = false;
  /** Wall-clock ticker — drives _capNow + duration display. */
  private _capTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.wireSignalingHandlers();

    // CallKit red-button / system-ended a call (push.service dispatches this on
    // the PushKit callEnded event). Tear down whatever call state we're in so
    // peers disconnect and the UI clears.
    if (typeof window !== 'undefined') {
      window.addEventListener('pf-callkit-ended', () => {
        if (this.status() === 'outgoing') void this.cancelOutgoing();
        else if (this.incomingCall()) void this.rejectIncoming();
        else if (this.inCall() || this.sessionId()) void this.leaveCall();
        else this.teardown('idle');
      });
      // iOS freezes the WKWebView WebContent process when the app backgrounds
      // (screen lock) — which kills the in-webview WebRTC call. A continuously
      // PLAYING audio element gives iOS a reason to keep the process awake.
      // Re-prime when we return to the foreground (WebAudio can stall on resume).
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this._keepAlive) void this._keepAlive.play().catch(() => undefined);
      });
    }

    // Beacon cleanup so the server tears the call down if the tab dies.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        const sid = this.sessionId();
        if (sid) {
          try {
            const blob = new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' });
            // The API host — `window.__apiUrl__` was never defined, so the
            // beacon went to the UI's own origin and never reached the server.
            navigator.sendBeacon(`${environment.apiUrl}/api/call-cleanup`, blob);
          } catch { /* best-effort */ }
        }
      });
    }

    // Watch participant count to set the cap. me + remotes. _maxParticipantsSeen
    // only ever grows — a group that drops to 2 keeps the 30-min cap so the
    // call doesn't get yanked the instant someone hangs up.
    effect(() => {
      const total = 1 + this.remoteParticipants().length;
      if (total > this._maxParticipantsSeen()) this._maxParticipantsSeen.set(total);
    });

    // 1Hz wall-clock during a call. Drives remainingMs + the duration UI.
    // Outside a call the timer is off (no needless renders).
    effect(() => {
      const active = this.inCall();
      if (active && !this._capTimer) {
        this._capTimer = setInterval(() => this._capNow.set(Date.now()), 1000);
      } else if (!active && this._capTimer) {
        clearInterval(this._capTimer);
        this._capTimer = null;
        this._warned60s = false;
      }
    });

    // Cap enforcement: warn at 60s left, hard-end at 0.
    effect(() => {
      if (!this.inCall()) return;
      const left = this.remainingMs();
      if (left > 0 && left <= 60_000 && !this._warned60s) {
        this._warned60s = true;
        const isGroup = this._maxParticipantsSeen() > 2;
        const cap = isGroup ? '30-minute group' : '10-minute 1:1';
        this.toast.info(`Call ends in 60 seconds (${cap} cap)`);
      }
      if (left === 0) {
        // Don't double-end if we're already tearing down.
        if (this.status() === 'active') {
          this.toast.info('Time is up — ending call.');
          void this.leaveCall();
        }
      }
    });
  }

  // ── Initiator side ───────────────────────────────────────────────

  /** Place an outgoing call to `targetUserId`. Resolves with sessionId. */
  async startCall(targetUserId: string, source?: string, displayName?: string): Promise<string> {
    this.assertIdle();
    this.callError.set(null);
    this.currentSource = source;
    this.setOutgoingPeer(targetUserId, displayName);
    // Presence never blocks a call: an offline / away callee is rung on their
    // registered devices by the server (VoIP / FCM / Web Push).
    this.ringingDevices.set(!isOnlineStatus(this.signaling.userPresences().get(targetUserId)));
    this.callType.set('audio');
    this.status.set('outgoing');
    try {
      await this.acquireLocalStream();
      await this.refreshIceServers();
      const res = await this.signaling.startCall(targetUserId, 'audio', source);
      this.sessionId.set(res.sessionId);
      this.armOutgoingRingTimeout();
      return res.sessionId;
    } catch (err) {
      this.handleFatal(err, 'startCall');
      throw err;
    }
  }

  /**
   * Ring every online member of a group conversation simultaneously.
   * Backend pushes IncomingCall to each, and they each accept independently
   * — the mesh grows as each "Accept" lands. Members who are offline
   * simply don't ring; the call still works for everyone who is.
   */
  async startGroupCall(conversationId: string, source?: string): Promise<string> {
    this.assertIdle();
    this.callError.set(null);
    this.currentSource = source ?? 'messages_group';
    const conv = this.chat.conversations().find(c => c.id === conversationId);
    this.outgoingPeer.set({ id: conversationId, name: conv?.name || 'Group call', isGroup: true });
    this.callType.set('audio');
    this.status.set('outgoing');
    try {
      await this.acquireLocalStream();
      await this.refreshIceServers();
      const res = await this.signaling.startGroupCall(conversationId, 'audio', this.currentSource);
      this.sessionId.set(res.sessionId);
      this.armOutgoingRingTimeout();
      return res.sessionId;
    } catch (err) {
      this.handleFatal(err, 'startGroupCall');
      throw err;
    }
  }

  /** Resolve the callee's display name: caller-supplied → a conversation
   *  participant → the tenant directory (async). */
  private setOutgoingPeer(userId: string, displayName?: string): void {
    const fromConv = this.chat.conversations()
      .flatMap(c => c.participants ?? [])
      .find(p => p.userId === userId)?.displayName;
    const name = displayName || fromConv || '';
    this.outgoingPeer.set({ id: userId, name, isGroup: false });
    if (name) return;
    void firstValueFrom(this.api.get<Array<{ id: string; displayName: string }>>('/api/directory/users'))
      .then(list => {
        const hit = (list ?? []).find(u => u.id === userId)?.displayName;
        const cur = this.outgoingPeer();
        if (hit && cur?.id === userId) this.outgoingPeer.set({ ...cur, name: hit });
      })
      .catch(() => undefined);
  }

  /** Add a third party to an in-flight call (e.g. interpreter). */
  async inviteToCall(targetUserId: string): Promise<void> {
    const sid = this.sessionId();
    if (!sid) throw new Error('No active session');
    await this.signaling.inviteToCall(sid, targetUserId);
  }

  /** Cancel a call that hasn't been answered yet. */
  async cancelOutgoing(): Promise<void> {
    const sid = this.sessionId();
    if (!sid) return;
    try { await this.signaling.cancelCall(sid); }
    finally { this.teardown('idle'); }
  }

  // ── Callee side ──────────────────────────────────────────────────

  async acceptIncoming(): Promise<void> {
    const info = this.incomingCall();
    if (!info) return;
    this.clearIncomingRingTimer();
    this.callError.set(null); // a previous call's "Call declined." must not show on this one
    // One accept path: the in-app Answer and a CallKit answer for the same
    // call (both tapped, or racing) share a single AcceptCall.
    return this.acceptBySessionId(info.sessionId, 1);
  }

  async rejectIncoming(): Promise<void> {
    const info = this.incomingCall();
    if (!info) return;
    // Clear locally FIRST so the ring stops instantly even if the hub is slow.
    this.incomingCall.set(null);
    this.clearIncomingRingTimer();
    try { await this.signaling.rejectCall(info.sessionId); }
    finally {
      // Status used to stay 'incoming' (and its 90s timer armed) after a
      // decline; only reset when no other call started meanwhile.
      if (this.status() === 'incoming' && !this.incomingCall()) this.teardown('idle');
    }
  }

  /** Accept a call identified ONLY by its session id — the path taken when the
   *  user answers via the iOS CallKit lockscreen ringer. On a cold launch from
   *  a VoIP push the in-app incomingCall() signal may not be populated, so we
   *  accept the session directly (signaling.acceptCall awaits connect()). */
  async acceptBySessionId(sessionId: string, attempts = 6): Promise<void> {
    // Already on it (answered in-app AND on the CallKit screen, or the native
    // pending answer replayed on resume): never a second AcceptCall.
    if (this.acceptInFlight?.sessionId === sessionId) return this.acceptInFlight.promise;
    if (this.sessionId() === sessionId && this.inCall()) return;
    const promise = this.doAcceptBySessionId(sessionId, attempts);
    this.acceptInFlight = { sessionId, promise };
    try { await promise; }
    finally { if (this.acceptInFlight?.promise === promise) this.acceptInFlight = null; }
  }

  private acceptInFlight: { sessionId: string; promise: Promise<void> } | null = null;

  private async doAcceptBySessionId(sessionId: string, attempts: number): Promise<void> {
    this.clearIncomingRingTimer();
    this.status.set('connecting');
    try {
      await this.acquireLocalStream();
      await this.refreshIceServers();
      // Set the session id BEFORE AcceptCall: the server's ParticipantJoined
      // makes the caller send its offer at once, and onSessionOffer drops an
      // offer for a session id we don't hold yet.
      this.sessionId.set(sessionId);
      // Cold / lockscreen answer: the SignalR connection is usually mid-
      // (re)connect as the app foregrounds, so the first AcceptCall can fail
      // ("connection disconnected"). connect() now drives to Connected; retry a
      // few times to ride out the transition instead of dropping the call.
      let res: { sessionId: string; participants: string[] } | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < attempts; attempt++) {
        try { res = await this.signaling.acceptCall(sessionId); break; }
        catch (err) { lastErr = err; if (attempt < attempts - 1) await new Promise(r => setTimeout(r, 800)); }
      }
      if (!res) throw lastErr ?? new Error('acceptCall failed after retries');
      this.sessionId.set(res.sessionId);
      // MERGE: an offer / join may already have landed during the accept.
      this.remoteParticipants.update(cur => [...new Set([...res!.participants, ...cur])]);
      this.incomingCall.set(null);
    } catch (err) {
      this.handleFatal(err, 'acceptBySessionId');
      throw err;
    }
  }

  /** Present a ring obtained out of band (looked up by id after a push —
   *  see call-push.actions.ts). Same rules as a live IncomingCall event. */
  receiveIncoming(info: IncomingCallInfo): void { this.onIncomingCall(info); }

  // ── In-call controls ─────────────────────────────────────────────

  toggleMute(): boolean {
    const next = !this.micMuted();
    this.micMuted.set(next);
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = !next; });
    // Broadcast so remote participants see a "muted" badge on my card.
    const sid = this.sessionId();
    if (sid) void this.signaling.setMuteState(sid, next).catch(() => undefined);
    return next;
  }

  async leaveCall(): Promise<void> {
    const sid = this.sessionId();
    if (!sid) { this.teardown('idle'); return; }
    this.status.set('ending');
    try { await this.signaling.leaveCall(sid); }
    finally { this.teardown('idle'); }
  }

  // ── Signaling event wiring ───────────────────────────────────────

  private wireSignalingHandlers() {
    this.subs.push(
      this.signaling.incomingCall.subscribe(info => this.onIncomingCall(info)),
      this.signaling.callRejected.subscribe(p => this.onCallRejected(p)),
      this.signaling.callCancelled.subscribe(p => this.onCallCancelled(p)),
      this.signaling.callHandledElsewhere.subscribe(p => this.onCallHandledElsewhere(p)),
      this.signaling.callAnswering.subscribe(p => this.onCallAnswering(p)),
      this.signaling.participantJoined.subscribe(p => this.onParticipantJoined(p)),
      this.signaling.participantLeft.subscribe(p => this.onParticipantLeft(p)),
      this.signaling.sessionOffer.subscribe(p => this.onSessionOffer(p)),
      this.signaling.sessionAnswer.subscribe(p => this.onSessionAnswer(p)),
      this.signaling.sessionIceCandidate.subscribe(p => this.onIceCandidate(p)),
      this.signaling.remoteMuteChanged.subscribe(p => this.onRemoteMuteChanged(p)),
      this.signaling.reconnected$.subscribe(() => this.onReconnected()),
      // Account switch / logout: every call, ring and timer belonged to the
      // previous account.
      this.signaling.sessionReset$.subscribe(() => {
        const busy = this.status() !== 'idle' || !!this.incomingCall() || !!this.sessionId();
        this.incomingCall.set(null);
        this.callError.set(null);
        if (busy) this.teardown('idle');
      })
    );
  }

  private onRemoteMuteChanged(p: { sessionId: string; userId: string; isMuted: boolean }): void {
    if (p.sessionId !== this.sessionId()) return;
    const next = new Map(this.remoteMuted());
    next.set(p.userId, p.isMuted);
    this.remoteMuted.set(next);
  }

  private onIncomingCall(info: IncomingCallInfo) {
    // Busy here (on a call, ringing out, or already ringing for ANOTHER call):
    // decline the new one so its caller is told at once. It used to be
    // accepted as the incoming call even while ringing out — clobbering the
    // outgoing call's state (and its no-answer timer) — or silently ignored
    // while the caller rang into the 60s timeout.
    const cur = this.incomingCall();
    if (cur?.sessionId === info.sessionId) return;
    // The call we are joining / on (a ring replayed while a CallKit answer is
    // being accepted) — never decline our own call.
    if (info.sessionId === this.sessionId()) return;
    // Mid-answer from CallKit (session id not known yet) — this ring may be
    // the very call being answered; never decline it.
    if (this.status() === 'connecting' && !this.sessionId()) return;
    if (this.inCall() || this.status() === 'outgoing' || this.status() === 'ending' || cur) {
      void this.signaling.rejectCall(info.sessionId).catch(() => undefined);
      return;
    }
    this.callError.set(null);
    this.incomingCall.set(info);
    this.status.set('incoming');
    this.callType.set(info.callType);
    this.localCallerName.set(info.callerName);
    this.armIncomingRingTimeout();
  }

  /** Caller side: the callee answered on their phone's native call screen
   *  and is joining. Stop "Ringing…" and the 60 s no-answer timer; wait up
   *  to ANSWERING_JOIN_MS for their ParticipantJoined (which ends ringing
   *  via markActive) before giving up. */
  private onCallAnswering(p: { sessionId: string; userId: string }) {
    if (p.sessionId !== this.sessionId() || this.status() !== 'outgoing') return;
    this.calleeAnswering.set(true);
    this.clearOutgoingRingTimer();
    this.outgoingRingTimer = setTimeout(() => {
      if (this.status() === 'outgoing') {
        this.callError.set('Could not connect.');
        this.toast.info('They answered, but the call could not connect.');
        void this.cancelOutgoing();
      }
    }, WebrtcService.ANSWERING_JOIN_MS);
  }

  /** This user accepted/declined on ANOTHER device — dismiss the ring here.
   *  On the device that actually handled the call this is a no-op (its
   *  incoming state is already cleared and the session is live). */
  private onCallHandledElsewhere(p: { sessionId: string }) {
    const inc = this.incomingCall();
    if (inc?.sessionId === p.sessionId && this.status() === 'incoming') {
      this.incomingCall.set(null);
      this.teardown('idle'); // dismisses CallKit via pf-end-callkit
    }
  }

  private onCallRejected(p: { sessionId: string; userId: string; sessionEnded?: boolean }) {
    if (p.sessionId !== this.sessionId()) return;
    // One group member / a mid-call invitee declining is not the end of the
    // call — it used to tear down the caller's live call with everyone else.
    const ended = p.sessionEnded ?? this.remoteParticipants().length === 0;
    if (!ended) {
      this.toast.info(`${this.nameOf(p.userId) ?? 'They'} declined.`);
      return;
    }
    this.callError.set('Call declined.');
    // The call screens are gone after teardown — say it where it's seen.
    this.toast.info(`${this.outgoingPeer()?.isGroup ? 'Everyone' : (this.nameOf(p.userId) ?? 'They')} declined the call.`);
    this.teardown('idle');
  }

  /** Display name of a user we share a conversation with (best effort). */
  private nameOf(userId: string): string | null {
    const op = this.outgoingPeer();
    if (op && !op.isGroup && op.id === userId && op.name) return op.name;
    return this.chat.conversations()
      .flatMap(c => c.participants ?? [])
      .find(p => p.userId === userId)?.displayName ?? null;
  }

  private onCallCancelled(p: { sessionId: string }) {
    const sid = this.sessionId();
    const inc = this.incomingCall();
    if (sid === p.sessionId || inc?.sessionId === p.sessionId) {
      this.incomingCall.set(null);
      this.teardown('idle');
    }
  }

  private async onParticipantJoined(p: { sessionId: string; userId: string }) {
    if (p.sessionId !== this.sessionId()) return;
    if (this.remoteParticipants().includes(p.userId)) return;
    this.remoteParticipants.update(list => [...list, p.userId]);
    // Existing participant explicitly initiates the offer to the new joiner.
    // HMS pattern: no reliance on onnegotiationneeded.
    await this.createOfferForPeer(p.userId);
    if (this.status() !== 'active') this.markActive();
  }

  private onParticipantLeft(p: { sessionId: string; userId: string }) {
    if (p.sessionId !== this.sessionId()) return;
    this.tearDownPeer(p.userId);
    this.remoteParticipants.update(list => list.filter(u => u !== p.userId));
    // Alone now: LEAVE on the server too. A local-only teardown left us in
    // the server session (shown "in a call", reported busy) while members
    // still ringing could "accept" into a call nobody was on.
    if (this.remoteParticipants().length === 0) void this.leaveCall().catch(() => this.teardown('idle'));
  }

  /**
   * Existing-participant side: explicitly create offer → wait for ICE
   * gathering → send SDP with bundled candidates. Matches HMS pattern
   * exactly; far more reliable than relying on onnegotiationneeded which
   * is timing-fragile and could fire before the handler is wired.
   */
  private async createOfferForPeer(remoteUserId: string): Promise<void> {
    const sid = this.sessionId();
    if (!sid) return;
    const peer = this.createPeer(remoteUserId);
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await this.waitForIceGathering(peer.pc);
      const sdpWithCandidates = peer.pc.localDescription;
      if (!sdpWithCandidates) return;
      await this.signaling.sendSessionOffer(sid, remoteUserId, JSON.stringify(sdpWithCandidates));
    } catch (err) {
      console.warn('[webrtc] createOfferForPeer failed', err);
    }
  }

  /**
   * Wait until ICE gathering completes (or 5s timeout). Sending an offer/
   * answer AFTER gathering bundles every candidate inside the SDP — the
   * remote end gets everything in one shot. Trickle-only signaling is
   * fragile on lossy networks and is the primary reason "the call connects
   * but I can only hear one side" in mesh setups.
   */
  private waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise<void>(resolve => {
      const cleanup = () => pc.removeEventListener('icegatheringstatechange', onStateChange);
      // 2.5s cap (was 5s): host+srflx typically land <1s and a reachable TURN
      // <2s — waiting longer only helps when TURN is DOWN, where waiting is
      // pointless anyway. Both offer and answer legs pay this wait, so the
      // saving is doubled on the answer→audio path.
      const timer = setTimeout(() => { cleanup(); resolve(); }, 2500);
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer); cleanup(); resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  /**
   * New-joiner side: add peer, apply remote offer, drain any ICE
   * candidates that arrived before the SDP, create answer, wait for ICE
   * gathering, send answer with bundled candidates.
   */
  private async onSessionOffer(p: { sessionId: string; fromUserId: string; sdp?: string }) {
    if (p.sessionId !== this.sessionId() || !p.sdp) return;
    const sid = this.sessionId();
    if (!sid) return;
    let peer = this.peers.get(p.fromUserId);
    if (!peer) peer = this.createPeer(p.fromUserId);
    try {
      const offer: RTCSessionDescriptionInit = JSON.parse(p.sdp);

      // Glare: I sent my own offer at the same time as the remote. Roll
      // back mine and accept theirs. With explicit createOfferForPeer
      // this is rare but possible if both ends invite each other.
      if (peer.pc.signalingState === 'have-local-offer') {
        try { await peer.pc.setLocalDescription({ type: 'rollback' }); } catch { /* ignore */ }
        peer.rolledBack = true;
      }

      await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingIceCandidates(p.fromUserId);

      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.waitForIceGathering(peer.pc);
      const sdpWithCandidates = peer.pc.localDescription;
      if (!sdpWithCandidates) return;
      await this.signaling.sendSessionAnswer(sid, p.fromUserId, JSON.stringify(sdpWithCandidates));
      if (this.status() !== 'active') this.markActive();
    } catch (err) {
      console.warn('[webrtc] onSessionOffer failed', err);
    }
  }

  private async onSessionAnswer(p: { sessionId: string; fromUserId: string; sdp?: string }) {
    if (p.sessionId !== this.sessionId() || !p.sdp) return;
    const peer = this.peers.get(p.fromUserId);
    if (!peer) return;

    // Only accept answer when we actually have a local offer pending.
    if (peer.pc.signalingState !== 'have-local-offer') {
      // Likely a late answer after rollback — ignore silently.
      return;
    }

    try {
      const answer: RTCSessionDescriptionInit = JSON.parse(p.sdp);
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingIceCandidates(p.fromUserId);
    } catch (err) {
      console.warn('[webrtc] onSessionAnswer failed', err);
    }
  }

  private async onIceCandidate(p: { sessionId: string; fromUserId: string; candidate?: string }) {
    if (p.sessionId !== this.sessionId() || !p.candidate) return;
    let candidate: RTCIceCandidateInit;
    try { candidate = JSON.parse(p.candidate); } catch { return; }

    const peer = this.peers.get(p.fromUserId);
    // Buffer if the peer isn't ready yet — addIceCandidate on a pc with
    // no remoteDescription throws, and the candidate would be lost.
    if (!peer || !peer.pc.remoteDescription) {
      const queue = this.pendingIceCandidates.get(p.fromUserId) ?? [];
      queue.push(candidate);
      this.pendingIceCandidates.set(p.fromUserId, queue);
      return;
    }
    try { await peer.pc.addIceCandidate(candidate); }
    catch (err) { console.warn('[webrtc] addIceCandidate failed', err); }
  }

  /** Drain any candidates that arrived before setRemoteDescription. */
  private async flushPendingIceCandidates(userId: string): Promise<void> {
    const queue = this.pendingIceCandidates.get(userId);
    if (!queue || queue.length === 0) return;
    this.pendingIceCandidates.delete(userId);
    const peer = this.peers.get(userId);
    if (!peer) return;
    for (const c of queue) {
      try { await peer.pc.addIceCandidate(c); }
      catch (err) { console.warn('[webrtc] flush addIceCandidate failed', err); }
    }
  }

  private async onReconnected() {
    // After a hub reconnect, ask the server whether we had an active call.
    // CRITICAL: a connected P2P call survives a signaling reconnect, and on a
    // lockscreen answer our socket often drops mid-accept so the server's
    // session map no longer lists us — tearing down here killed a call that was
    // actually connected (the lockscreen-answer bug). Only abandon if we have
    // NO live peer connection.
    try {
      const active = await this.signaling.getActiveSession();
      if (active) return;
      const hasLivePeer = Array.from(this.peers.values()).some(p =>
        p.pc.connectionState === 'connected' || p.pc.connectionState === 'connecting');
      if (this.inCall() && !hasLivePeer) this.teardown('idle');
    } catch { /* ignore */ }
  }

  // ── Peer-connection plumbing ─────────────────────────────────────

  private createPeer(remoteUserId: string): PeerState {
    console.log('[webrtc] createPeer →', remoteUserId, 'iceServers:', this.iceServers.length);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });

    const state: PeerState = { pc, remoteUserId, rolledBack: false };
    this.peers.set(remoteUserId, state);

    // Wire all handlers BEFORE addTrack. Even though we no longer rely on
    // onnegotiationneeded for initial offer creation (explicit createOffer
    // is used now), ontrack must still be ready before remote tracks land.
    pc.ontrack = ev => {
      console.log('[webrtc] ontrack from', remoteUserId, 'kind:', ev.track.kind, 'streams:', ev.streams.length);
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      const next = new Map(this.remoteAudio());
      next.set(remoteUserId, stream);
      this.remoteAudio.set(next);
      this.detectTurnRelay(pc);
    };

    pc.onicecandidate = ev => {
      if (!ev.candidate) {
        console.log('[webrtc] ICE gathering complete for', remoteUserId);
        return;
      }
      const sid = this.sessionId();
      if (!sid) return;
      // Trickle individual candidates too; harmless on the receiver side
      // since we also bundle them into the SDP. Belt-and-braces — if the
      // peer's pc remoteDescription isn't yet set when this arrives, our
      // onIceCandidate handler buffers it.
      void this.signaling.sendSessionIceCandidate(sid, remoteUserId, JSON.stringify(ev.candidate));
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[webrtc] iceConnectionState for', remoteUserId, '→', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        void this.iceRestart(state);
      }
    };

    pc.onsignalingstatechange = () => {
      console.log('[webrtc] signalingState for', remoteUserId, '→', pc.signalingState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[webrtc] connectionState for', remoteUserId, '→', pc.connectionState);
    };

    // Add local tracks last. With the explicit-initiator pattern this no
    // longer relies on onnegotiationneeded firing — createOfferForPeer
    // drives the SDP exchange after this returns.
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => {
        console.log('[webrtc] addTrack', t.kind, 'to peer', remoteUserId);
        pc.addTrack(t, this.localStream!);
      });
    } else {
      console.warn('[webrtc] createPeer called with no localStream — peer will have no outbound audio');
    }

    return state;
  }

  /**
   * ICE restart — used when iceConnectionState drops to 'failed'. Both
   * sides race, but only one wins (the one whose remote description gets
   * applied first); the other's offer becomes a no-op via state guard in
   * onSessionAnswer. This is far simpler than the polite/impolite dance
   * and works fine in mesh.
   */
  private async iceRestart(state: PeerState) {
    try {
      const sid = this.sessionId();
      if (!sid) return;
      console.log('[webrtc] iceRestart for', state.remoteUserId);
      const offer = await state.pc.createOffer({ iceRestart: true });
      await state.pc.setLocalDescription(offer);
      await this.waitForIceGathering(state.pc);
      const sdp = state.pc.localDescription;
      if (!sdp) return;
      await this.signaling.sendSessionOffer(sid, state.remoteUserId, JSON.stringify(sdp));
    } catch (err) {
      console.warn('[webrtc] iceRestart failed', err);
    }
  }

  private async detectTurnRelay(pc: RTCPeerConnection) {
    try {
      const stats = await pc.getStats();
      stats.forEach(r => {
        if (r.type === 'candidate-pair' && (r as any).state === 'succeeded') {
          const localId = (r as any).localCandidateId;
          const localCand = Array.from(stats.values()).find((c: any) => c.id === localId) as any;
          if (localCand?.candidateType === 'relay') this.usingTurnRelay.set(true);
        }
      });
    } catch { /* non-critical */ }
  }

  // ── Local media + TURN ──────────────────────────────────────────

  private async acquireLocalStream(): Promise<void> {
    if (this.localStream) return;
    try {
      // Pin echoCancellation / noiseSuppression / autoGainControl ON across
      // all browsers — defaults vary subtly and Safari has flipped these
      // historically. Defensive lock so behaviour is identical everywhere.
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      this.micMuted.set(false);
    } catch (err) {
      this.callError.set('Microphone permission denied or unavailable.');
      throw err;
    }
  }

  private async refreshIceServers(): Promise<void> {
    if (this.iceServers.length > 0 && Date.now() < this.iceTtlExpires) return;
    // Public Google STUN servers as fallback — same as HMS. If Cloudflare
    // TURN is briefly unreachable, ICE can still surface server-reflexive
    // (srflx) candidates so peers behind NAT can usually still connect.
    // Listed AFTER TURN so the browser prefers Cloudflare for relay.
    const stunFallback: IceServer[] = [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['stun:stun1.l.google.com:19302'] }
    ];
    // Never let a slow TURN-credential fetch sit on the call-setup path — it
    // used to block start/accept for up to the server's Cloudflare HTTP
    // timeout (~10s), a big slice of the observed answer→audio lag. Cap the
    // wait at 3s and proceed STUN-only; the fetch keeps running in the
    // background and warms the cache for the next call.
    const fetch = this.signaling.getTurnCredentials()
      .then(creds => {
        this.iceServers = [...creds.iceServers, ...stunFallback];
        this.iceTtlExpires = Date.now() + (creds.ttl * 1000 * 0.8); // refresh at 80% of TTL
        console.log('[webrtc] iceServers refreshed — count:', this.iceServers.length,
          'urls:', this.iceServers.flatMap(s => s.urls));
      })
      .catch(err => console.warn('[webrtc] getTurnCredentials failed — STUN-only', err));
    await Promise.race([fetch, new Promise<void>(r => setTimeout(r, 3000))]);
    if (this.iceServers.length === 0) {
      console.warn('[webrtc] TURN creds not ready in 3s — proceeding STUN-only');
      this.iceServers = stunFallback;
      this.iceTtlExpires = 0; // retry the fetch on the next call
    }
  }

  // ── State helpers ────────────────────────────────────────────────

  private markActive() {
    this.status.set('active');
    this.clearRingTimers();
    if (!this.callStartedAt()) this.callStartedAt.set(Date.now());
    this.startKeepAlive();
  }

  // ── Ring timeouts ────────────────────────────────────────────────
  // Caller: an unanswered outgoing call auto-cancels after 60s ("No answer")
  // instead of ringing forever. Callee: an incoming ring auto-dismisses after
  // 90s — covers a caller whose tab/app died without sending CancelCall (the
  // server reaper also backstops this, but the client shouldn't depend on it).
  private outgoingRingTimer: ReturnType<typeof setTimeout> | null = null;
  private incomingRingTimer: ReturnType<typeof setTimeout> | null = null;

  private armOutgoingRingTimeout() {
    this.clearOutgoingRingTimer();
    this.outgoingRingTimer = setTimeout(() => {
      if (this.status() === 'outgoing') {
        this.callError.set('No answer.');
        this.toast.info('No answer.');
        void this.cancelOutgoing();
      }
    }, 60_000);
  }

  private armIncomingRingTimeout() {
    this.clearIncomingRingTimer();
    this.incomingRingTimer = setTimeout(() => {
      if (this.status() === 'incoming' && this.incomingCall()) {
        this.incomingCall.set(null);
        this.teardown('idle'); // dismisses CallKit via pf-end-callkit
      }
    }, 90_000);
  }

  private clearOutgoingRingTimer() {
    if (this.outgoingRingTimer) { clearTimeout(this.outgoingRingTimer); this.outgoingRingTimer = null; }
  }
  private clearIncomingRingTimer() {
    if (this.incomingRingTimer) { clearTimeout(this.incomingRingTimer); this.incomingRingTimer = null; }
  }
  private clearRingTimers() { this.clearOutgoingRingTimer(); this.clearIncomingRingTimer(); }

  private assertIdle() {
    if (this.inCall() || this.status() === 'outgoing') {
      throw new Error('Already in a call.');
    }
  }

  private tearDownPeer(userId: string) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    try { peer.pc.close(); } catch { /* ignore */ }
    this.peers.delete(userId);
    this.pendingIceCandidates.delete(userId);
    const next = new Map(this.remoteAudio()); next.delete(userId); this.remoteAudio.set(next);
  }

  private teardown(nextStatus: CallStatus) {
    this.stopKeepAlive();
    this.clearRingTimers();
    for (const id of Array.from(this.peers.keys())) this.tearDownPeer(id);
    this.pendingIceCandidates.clear();
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.sessionId.set(null);
    this.remoteParticipants.set([]);
    this.remoteAudio.set(new Map());
    this.remoteMuted.set(new Map());
    this._maxParticipantsSeen.set(0);
    this.callStartedAt.set(null);
    this.localCallerName.set(null);
    this.outgoingPeer.set(null);
    this.ringingDevices.set(false);
    this.calleeAnswering.set(false);
    this.currentSource = undefined;
    this.usingTurnRelay.set(false);
    this.micMuted.set(false);
    this.status.set(nextStatus);
    // Call fully ended — dismiss the native CallKit UI (kept alive during the
    // call so background audio works). push.service owns the CallKitVoip plugin
    // and listens for this. No-op on web / if no CallKit call is active.
    if (nextStatus === 'idle' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('pf-end-callkit'));
    }
  }

  private handleFatal(err: unknown, where: string) {
    console.error(`[webrtc] ${where} failed`, err);
    this.callError.set(cleanHubError(err).message);
    this.teardown('idle');
  }

  reset(): void {
    this.teardown('idle');
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.teardown('idle');
  }
}
