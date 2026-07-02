import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import {
  ActiveSession, CallType, IncomingCallInfo, TurnCredentials
} from '../../shared/models/call.model';

/** SDP / ICE payload exchanged via SendSessionOffer/Answer/IceCandidate. */
export interface SessionSignal {
  sessionId: string;
  fromUserId: string;
  sdp?: string;
  candidate?: string;
}

/**
 * Thin SignalR wrapper around the prefrontal-mw SignalingHub. Owns the
 * single connection, exposes Subjects for SDP/ICE relay + call lifecycle
 * events, and gives the WebRTC service hub-method facades it can call
 * without knowing about SignalR.
 *
 * Reconnection is handled by SignalR's withAutomaticReconnect; the
 * `reconnected$` subject fires after the connection comes back so the
 * WebRTC service can re-sync presence + active call state.
 */
@Injectable({ providedIn: 'root' })
export class SignalingService implements OnDestroy {
  private readonly auth = inject(AuthService);

  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;

  readonly isConnected = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly onlineUserIds = signal<Set<string>>(new Set());
  readonly userPresences = signal<Map<string, string>>(new Map());

  // Lifecycle subjects ────────────────────────────────────────────────
  readonly reconnected$ = new Subject<void>();
  readonly userOnline = new Subject<string>();
  readonly userOffline = new Subject<string>();
  readonly userPresenceChanged = new Subject<{ userId: string; status: string }>();

  // Call lifecycle ────────────────────────────────────────────────────
  readonly incomingCall = new Subject<IncomingCallInfo>();
  readonly callRejected = new Subject<{ sessionId: string; userId: string }>();
  readonly callCancelled = new Subject<{ sessionId: string }>();
  /** This user accepted/declined the call on ANOTHER device — dismiss the
   *  ring here (multi-device). */
  readonly callHandledElsewhere = new Subject<{ sessionId: string }>();
  readonly participantJoined = new Subject<{ sessionId: string; userId: string }>();
  readonly participantLeft = new Subject<{ sessionId: string; userId: string }>();

  // SDP / ICE relay ───────────────────────────────────────────────────
  readonly sessionOffer = new Subject<SessionSignal>();
  readonly sessionAnswer = new Subject<SessionSignal>();
  readonly sessionIceCandidate = new Subject<SessionSignal>();
  readonly remoteMuteChanged = new Subject<{ sessionId: string; userId: string; isMuted: boolean }>();

  // ── Connection lifecycle ──────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.ensureConnected();
    try { await this.connecting; } finally { this.connecting = null; }
  }

  /** Drive the connection to Connected. A connection that is mid-(re)connect —
   *  e.g. after a background/lockscreen stall when answering a call — is given a
   *  few seconds to settle; if it's stuck, it's dropped and rebuilt fresh.
   *  Without this, callers invoked hub methods on a Reconnecting connection and
   *  the invoke threw "connection disconnected". */
  private async ensureConnected(): Promise<void> {
    const S = signalR.HubConnectionState;
    if (this.connection && this.connection.state !== S.Disconnected) {
      if (await this.waitForConnected(6000)) return;
      try { await this.connection.stop(); } catch { /* ignore */ }
      this.connection = null;
    }
    await this._connect();
  }

  private waitForConnected(timeoutMs: number): Promise<boolean> {
    const S = signalR.HubConnectionState;
    return new Promise<boolean>(resolve => {
      const start = Date.now();
      const tick = () => {
        if (this.connection?.state === S.Connected) { resolve(true); return; }
        if (Date.now() - start > timeoutMs) { resolve(false); return; }
        setTimeout(tick, 150);
      };
      tick();
    });
  }

  private async _connect(): Promise<void> {
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(`${environment.apiUrl}/hubs/signaling`, {
        accessTokenFactory: async () => {
          const t = await this.auth.getAccessToken();
          return t ?? '';
        },
        transport: signalR.HttpTransportType.WebSockets,
        skipNegotiation: true
      })
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.registerHandlers();

    this.connection.onreconnected(async () => {
      this.isConnected.set(true);
      this.connectionError.set(null);
      try { await this.getOnlineUsersWithStatus(); } catch { /* best-effort */ }
      this.reconnected$.next();
    });

    this.connection.onreconnecting(err => {
      this.isConnected.set(false);
      this.connectionError.set(err?.message ?? 'Reconnecting…');
    });

    this.connection.onclose(() => this.isConnected.set(false));

    try {
      await this.connection.start();
      this.isConnected.set(true);
      this.connectionError.set(null);
      await this.getOnlineUsersWithStatus().catch(() => undefined);
    } catch (err) {
      this.isConnected.set(false);
      this.connectionError.set((err as Error).message);
      throw err;
    }
  }

  private registerHandlers() {
    if (!this.connection) return;

    this.connection.on('UserOnline',  (p: { userId: string }) => {
      const next = new Set(this.onlineUserIds()); next.add(p.userId); this.onlineUserIds.set(next);
      this.userOnline.next(p.userId);
    });
    this.connection.on('UserOffline', (p: { userId: string }) => {
      const next = new Set(this.onlineUserIds()); next.delete(p.userId); this.onlineUserIds.set(next);
      const m = new Map(this.userPresences()); m.delete(p.userId); this.userPresences.set(m);
      this.userOffline.next(p.userId);
    });
    this.connection.on('UserPresenceChanged', (p: { userId: string; status: string }) => {
      const m = new Map(this.userPresences()); m.set(p.userId, p.status); this.userPresences.set(m);
      this.userPresenceChanged.next(p);
    });

    this.connection.on('IncomingCall', (info: IncomingCallInfo) => this.incomingCall.next(info));
    this.connection.on('CallRejected',  (p: { sessionId: string; userId: string }) => this.callRejected.next(p));
    this.connection.on('CallCancelled', (p: { sessionId: string }) => this.callCancelled.next(p));
    this.connection.on('CallHandledElsewhere', (p: { sessionId: string }) => this.callHandledElsewhere.next(p));
    this.connection.on('ParticipantJoined', (p: { sessionId: string; userId: string }) => this.participantJoined.next(p));
    this.connection.on('ParticipantLeft',   (p: { sessionId: string; userId: string }) => this.participantLeft.next(p));

    this.connection.on('SessionOffer',        (p: SessionSignal) => this.sessionOffer.next(p));
    this.connection.on('SessionAnswer',       (p: SessionSignal) => this.sessionAnswer.next(p));
    this.connection.on('SessionIceCandidate', (p: SessionSignal) => this.sessionIceCandidate.next(p));
    this.connection.on('RemoteMuteChanged',   (p: { sessionId: string; userId: string; isMuted: boolean }) => this.remoteMuteChanged.next(p));
  }

  // ── Hub method facades ────────────────────────────────────────────

  async startCall(targetUserId: string, callType: CallType = 'audio', source?: string): Promise<{ sessionId: string }> {
    await this.connect();
    return await this.connection!.invoke('StartCall', targetUserId, callType, source ?? null);
  }
  /** Rings every active group member at once. Backend resolves the
   *  conversation, filters to online members, and pushes IncomingCall
   *  with conversationId + conversationName attached. */
  async startGroupCall(conversationId: string, callType: CallType = 'audio', source?: string): Promise<{ sessionId: string; ringing?: string[] }> {
    await this.connect();
    return await this.connection!.invoke('StartGroupCall', conversationId, callType, source ?? null);
  }
  async acceptCall(sessionId: string): Promise<{ sessionId: string; participants: string[] }> {
    await this.connect();
    return await this.connection!.invoke('AcceptCall', sessionId);
  }
  async rejectCall(sessionId: string): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('RejectCall', sessionId);
  }
  async cancelCall(sessionId: string): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('CancelCall', sessionId);
  }
  async inviteToCall(sessionId: string, targetUserId: string): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('InviteToCall', sessionId, targetUserId);
  }
  async leaveCall(sessionId: string): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('LeaveCall', sessionId);
  }
  async sendSessionOffer(sessionId: string, targetUserId: string, sdp: string): Promise<void> {
    return await this.connection!.invoke('SendSessionOffer', sessionId, targetUserId, sdp);
  }
  async sendSessionAnswer(sessionId: string, targetUserId: string, sdp: string): Promise<void> {
    return await this.connection!.invoke('SendSessionAnswer', sessionId, targetUserId, sdp);
  }
  async sendSessionIceCandidate(sessionId: string, targetUserId: string, candidate: string): Promise<void> {
    return await this.connection!.invoke('SendSessionIceCandidate', sessionId, targetUserId, candidate);
  }
  async setMuteState(sessionId: string, isMuted: boolean): Promise<void> {
    return await this.connection!.invoke('SetMuteState', sessionId, isMuted);
  }
  async getTurnCredentials(): Promise<TurnCredentials> {
    await this.connect();
    return await this.connection!.invoke('GetTurnCredentials');
  }
  async getActiveSession(): Promise<ActiveSession | null> {
    await this.connect();
    return await this.connection!.invoke('GetActiveSession');
  }
  async getOnlineUsers(): Promise<string[]> {
    await this.connect();
    return await this.connection!.invoke('GetOnlineUsers');
  }
  async getOnlineUsersWithStatus(): Promise<Record<string, string>> {
    await this.connect();
    const res = await this.connection!.invoke<Record<string, string>>('GetOnlineUsersWithStatus');
    // Mirror into the local signals so any consumer can read them sync.
    const m = new Map(Object.entries(res));
    this.userPresences.set(m);
    this.onlineUserIds.set(new Set(m.keys()));
    return res;
  }
  async updatePresenceStatus(status: 'active' | 'away'): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('UpdatePresenceStatus', status);
  }

  async disconnect(): Promise<void> {
    if (!this.connection) return;
    try { await this.connection.stop(); } catch { /* ignore */ }
    this.connection = null;
    this.isConnected.set(false);

    // Clear all stateful signals on disconnect (logout)
    this.connectionError.set(null);
    this.onlineUserIds.set(new Set());
    this.userPresences.set(new Map());
  }

  ngOnDestroy(): void { void this.disconnect(); }
}
