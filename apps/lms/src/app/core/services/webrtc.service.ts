import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SignalingService } from './signaling.service';
import {
  CallStatus, CallType, IceServer, IncomingCallInfo
} from '../../shared/models/call.model';

/** One peer connection state — keyed by remote userId in the mesh. */
interface PeerState {
  pc: RTCPeerConnection;
  remoteUserId: string;
  /** Used to gate offer-bursting (glare detection per perfect-negotiation). */
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
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

  // ── Public state ─────────────────────────────────────────────────
  readonly status = signal<CallStatus>('idle');
  readonly sessionId = signal<string | null>(null);
  readonly callType = signal<CallType>('audio');
  readonly micMuted = signal(false);
  readonly remoteParticipants = signal<string[]>([]);
  readonly remoteAudio = signal<Map<string, MediaStream>>(new Map());
  /** Per-remote-participant mute state, broadcast via signaling. */
  readonly remoteMuted = signal<Map<string, boolean>>(new Map());
  readonly incomingCall = signal<IncomingCallInfo | null>(null);
  readonly usingTurnRelay = signal(false);
  readonly callError = signal<string | null>(null);
  readonly localCallerName = signal<string | null>(null);
  readonly callStartedAt = signal<number | null>(null);
  readonly inCall = computed(() => this.status() === 'active' || this.status() === 'connecting');

  // ── Private state ────────────────────────────────────────────────
  private localStream: MediaStream | null = null;
  private peers = new Map<string, PeerState>();
  private iceServers: IceServer[] = [];
  private iceTtlExpires = 0;
  private subs: Subscription[] = [];
  private currentSource: string | undefined;

  constructor() {
    this.wireSignalingHandlers();

    // Beacon cleanup so the server tears the call down if the tab dies.
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        const sid = this.sessionId();
        if (sid) {
          try {
            const blob = new Blob([JSON.stringify({ sessionId: sid })], { type: 'application/json' });
            navigator.sendBeacon(`${(window as any).__apiUrl__ ?? ''}/api/call-cleanup`, blob);
          } catch { /* best-effort */ }
        }
      });
    }
  }

  // ── Initiator side ───────────────────────────────────────────────

  /** Place an outgoing call to `targetUserId`. Resolves with sessionId. */
  async startCall(targetUserId: string, source?: string): Promise<string> {
    this.assertIdle();
    this.callError.set(null);
    this.currentSource = source;
    this.callType.set('audio');
    this.status.set('outgoing');
    try {
      await this.acquireLocalStream();
      await this.refreshIceServers();
      const res = await this.signaling.startCall(targetUserId, 'audio', source);
      this.sessionId.set(res.sessionId);
      return res.sessionId;
    } catch (err) {
      this.handleFatal(err, 'startCall');
      throw err;
    }
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
    this.status.set('connecting');
    try {
      await this.acquireLocalStream();
      await this.refreshIceServers();
      const res = await this.signaling.acceptCall(info.sessionId);
      this.sessionId.set(res.sessionId);
      this.remoteParticipants.set(res.participants);
      // Existing participants will send us offers; we just answer.
      this.incomingCall.set(null);
    } catch (err) {
      this.handleFatal(err, 'acceptIncoming');
      throw err;
    }
  }

  async rejectIncoming(): Promise<void> {
    const info = this.incomingCall();
    if (!info) return;
    try { await this.signaling.rejectCall(info.sessionId); }
    finally { this.incomingCall.set(null); }
  }

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
      this.signaling.participantJoined.subscribe(p => this.onParticipantJoined(p)),
      this.signaling.participantLeft.subscribe(p => this.onParticipantLeft(p)),
      this.signaling.sessionOffer.subscribe(p => this.onSessionOffer(p)),
      this.signaling.sessionAnswer.subscribe(p => this.onSessionAnswer(p)),
      this.signaling.sessionIceCandidate.subscribe(p => this.onIceCandidate(p)),
      this.signaling.remoteMuteChanged.subscribe(p => this.onRemoteMuteChanged(p)),
      this.signaling.reconnected$.subscribe(() => this.onReconnected())
    );
  }

  private onRemoteMuteChanged(p: { sessionId: string; userId: string; isMuted: boolean }): void {
    if (p.sessionId !== this.sessionId()) return;
    const next = new Map(this.remoteMuted());
    next.set(p.userId, p.isMuted);
    this.remoteMuted.set(next);
  }

  private onIncomingCall(info: IncomingCallInfo) {
    // Ignore if we're already in a call — server should never do this but be defensive.
    if (this.inCall()) return;
    this.incomingCall.set(info);
    this.status.set('incoming');
    this.callType.set(info.callType);
    this.localCallerName.set(info.callerName);
  }

  private onCallRejected(p: { sessionId: string; userId: string }) {
    if (p.sessionId === this.sessionId()) {
      this.callError.set('Call declined.');
      this.teardown('idle');
    }
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
    // The newly-joined peer is the "impolite" caller — we (existing) initiate.
    await this.createPeerAndOffer(p.userId);
    if (this.status() !== 'active') this.markActive();
  }

  private onParticipantLeft(p: { sessionId: string; userId: string }) {
    if (p.sessionId !== this.sessionId()) return;
    this.tearDownPeer(p.userId);
    this.remoteParticipants.update(list => list.filter(u => u !== p.userId));
    if (this.remoteParticipants().length === 0) this.teardown('idle');
  }

  private async onSessionOffer(p: { sessionId: string; fromUserId: string; sdp?: string }) {
    if (p.sessionId !== this.sessionId() || !p.sdp) return;
    let peer = this.peers.get(p.fromUserId);
    if (!peer) peer = this.createPeer(p.fromUserId);
    try {
      const offer: RTCSessionDescriptionInit = JSON.parse(p.sdp);
      const collision = peer.makingOffer || peer.pc.signalingState !== 'stable';
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await peer.pc.setRemoteDescription(offer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await this.signaling.sendSessionAnswer(this.sessionId()!, p.fromUserId, JSON.stringify(peer.pc.localDescription));
      if (this.status() !== 'active') this.markActive();
    } catch (err) {
      console.warn('[webrtc] onSessionOffer failed', err);
    }
  }

  private async onSessionAnswer(p: { sessionId: string; fromUserId: string; sdp?: string }) {
    if (p.sessionId !== this.sessionId() || !p.sdp) return;
    const peer = this.peers.get(p.fromUserId);
    if (!peer) return;
    try {
      const answer: RTCSessionDescriptionInit = JSON.parse(p.sdp);
      await peer.pc.setRemoteDescription(answer);
    } catch (err) {
      console.warn('[webrtc] onSessionAnswer failed', err);
    }
  }

  private async onIceCandidate(p: { sessionId: string; fromUserId: string; candidate?: string }) {
    if (p.sessionId !== this.sessionId() || !p.candidate) return;
    const peer = this.peers.get(p.fromUserId);
    if (!peer) return;
    try {
      const cand: RTCIceCandidateInit = JSON.parse(p.candidate);
      await peer.pc.addIceCandidate(cand);
    } catch (err) {
      if (!peer.ignoreOffer) console.warn('[webrtc] addIceCandidate failed', err);
    }
  }

  private async onReconnected() {
    // After a hub reconnect, ask the server whether we had an active call;
    // if so, peers will continue exchanging ICE through the new connection.
    try {
      const active = await this.signaling.getActiveSession();
      if (!active) {
        if (this.inCall()) this.teardown('idle');
      }
    } catch { /* ignore */ }
  }

  // ── Peer-connection plumbing ─────────────────────────────────────

  private createPeer(remoteUserId: string): PeerState {
    // remoteUserId is the Supabase sub; compare in the same id space so
    // both ends derive the same polite/impolite split. Using prefrontal id
    // here would let both ends pick "impolite" → infinite glare loop.
    const localId = this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
    const polite = localId < remoteUserId; // deterministic ordering — lower id is polite
    const pc = new RTCPeerConnection({ iceServers: this.iceServers as RTCIceServer[] });

    const state: PeerState = { pc, remoteUserId, makingOffer: false, ignoreOffer: false, polite };
    this.peers.set(remoteUserId, state);

    // CRITICAL: attach event handlers BEFORE addTrack. addTrack schedules a
    // `negotiationneeded` event (microtask) — if the handler isn't set when
    // the event fires, the first SDP offer is never sent and the call
    // connects but carries no audio. This was the silent regression behind
    // "call connects, no voice on either side". Handler attachment order
    // matters here.
    pc.ontrack = ev => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      const next = new Map(this.remoteAudio());
      next.set(remoteUserId, stream);
      this.remoteAudio.set(next);
      this.detectTurnRelay(pc);
    };

    pc.onicecandidate = ev => {
      if (!ev.candidate) return;
      const sid = this.sessionId();
      if (!sid) return;
      void this.signaling.sendSessionIceCandidate(sid, remoteUserId, JSON.stringify(ev.candidate));
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        // Trigger ICE restart on the impolite side.
        if (!state.polite) {
          void this.iceRestart(state);
        }
      }
    };

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer = true;
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sid = this.sessionId();
        if (!sid) return;
        await this.signaling.sendSessionOffer(sid, remoteUserId, JSON.stringify(pc.localDescription));
      } catch (err) {
        console.warn('[webrtc] negotiationneeded failed', err);
      } finally {
        state.makingOffer = false;
      }
    };

    // NOW add local tracks — handlers are wired up, so the negotiationneeded
    // event that this schedules will hit our handler and an offer goes out.
    this.localStream?.getTracks().forEach(t => pc.addTrack(t, this.localStream!));

    return state;
  }

  private async createPeerAndOffer(remoteUserId: string): Promise<void> {
    // createPeer's onnegotiationneeded will fire when we add the local tracks,
    // so just create the peer — the offer goes out automatically.
    this.createPeer(remoteUserId);
  }

  private async iceRestart(state: PeerState) {
    try {
      const offer = await state.pc.createOffer({ iceRestart: true });
      await state.pc.setLocalDescription(offer);
      const sid = this.sessionId();
      if (!sid) return;
      await this.signaling.sendSessionOffer(sid, state.remoteUserId, JSON.stringify(state.pc.localDescription));
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
    const creds = await this.signaling.getTurnCredentials();
    this.iceServers = creds.iceServers;
    this.iceTtlExpires = Date.now() + (creds.ttl * 1000 * 0.8); // refresh at 80% of TTL
  }

  // ── State helpers ────────────────────────────────────────────────

  private markActive() {
    this.status.set('active');
    if (!this.callStartedAt()) this.callStartedAt.set(Date.now());
  }

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
    const next = new Map(this.remoteAudio()); next.delete(userId); this.remoteAudio.set(next);
  }

  private teardown(nextStatus: CallStatus) {
    for (const id of Array.from(this.peers.keys())) this.tearDownPeer(id);
    this.localStream?.getTracks().forEach(t => t.stop());
    this.localStream = null;
    this.sessionId.set(null);
    this.remoteParticipants.set([]);
    this.remoteAudio.set(new Map());
    this.remoteMuted.set(new Map());
    this.callStartedAt.set(null);
    this.localCallerName.set(null);
    this.currentSource = undefined;
    this.usingTurnRelay.set(false);
    this.micMuted.set(false);
    this.status.set(nextStatus);
  }

  private handleFatal(err: unknown, where: string) {
    console.error(`[webrtc] ${where} failed`, err);
    this.callError.set((err as Error)?.message ?? 'Call failed.');
    this.teardown('idle');
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.teardown('idle');
  }
}
