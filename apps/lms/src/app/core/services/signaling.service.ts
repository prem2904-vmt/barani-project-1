import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { FOREVER_RETRY, HUB_FACTORY } from './hub-factory';
import {
  ActiveSession, CallType, IncomingCallInfo, TurnCredentials
} from '../../shared/models/call.model';

/** Hub CONNECTION presence vocabulary (custom Teams-style statuses such as
 *  'busy' / 'surgery' belong to PresenceService, never to these maps). */
export const CONNECTION_STATUSES = ['active', 'away', 'in-a-call', 'offline'] as const;
const isConnectionStatus = (s: string): boolean => (CONNECTION_STATUSES as readonly string[]).includes(s);
/** Online = holds a live hub connection: 'active' or 'in-a-call'. 'away'
 *  (last connection dropped, server grace) and 'offline' are NOT online. */
export const isOnlineStatus = (s: string | undefined | null): boolean => s === 'active' || s === 'in-a-call';


/** A HubException reaches the browser as "An unexpected error occurred
 *  invoking 'StartCall' on the server. HubException: They're on another call
 *  right now." — and that whole string was toasted. Keep only the server's
 *  own sentence. */
export function cleanHubError(err: unknown): Error {
  const msg = (err as Error)?.message ?? String(err ?? '');
  const m = /HubException:\s*(.+)$/s.exec(msg);
  return m ? new Error(m[1].trim()) : (err instanceof Error ? err : new Error(msg || 'Call failed.'));
}

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
  private readonly scope = inject(SessionScopeService);
  private readonly hubFactory = inject(HUB_FACTORY);

  private connection: signalR.HubConnection | null = null;
  private connecting: Promise<void> | null = null;
  /** Identity (sub) whose token opened `connection` — see ChatService. */
  private connectedAs: string | null = null;
  private wantConnected = false;
  private lifecycleWired = false;
  private reviveTimer: ReturnType<typeof setTimeout> | null = null;
  private reviveAttempt = 0;
  /** Account switch / logout — fired so WebrtcService drops call state and
   *  the ring stops (the calls belong to the previous account). */
  readonly sessionReset$ = new Subject<void>();

  constructor() {
    // Only a real switch / sign-out resets (prev != null). The first
    // sign-in of a cold launch must NOT — a CallKit answer may already be
    // joining on this socket.
    this.scope.onChange(c => { if (c.prev) void this.disconnect(); });
  }

  private identity(): string {
    return this.auth.user()?.authId ?? this.auth.user()?.id ?? '';
  }

  readonly isConnected = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly onlineUserIds = signal<Set<string>>(new Set());
  readonly userPresences = signal<Map<string, string>>(new Map());

  // Lifecycle subjects ────────────────────────────────────────────────
  readonly reconnected$ = new Subject<void>();
  readonly userOnline = new Subject<string>();
  readonly userOffline = new Subject<string>();
  readonly userPresenceChanged = new Subject<{ userId: string; status: string; custom?: boolean }>();

  // Call lifecycle ────────────────────────────────────────────────────
  readonly incomingCall = new Subject<IncomingCallInfo>();
  /** `sessionEnded` (server ≥ 2026-09-27): false when others are still in /
   *  ringing on the call — one group member or a mid-call invitee declining
   *  must not end it for the caller. Absent on older servers. */
  readonly callRejected = new Subject<{ sessionId: string; userId: string; sessionEnded?: boolean }>();
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
    const me = this.identity();
    // Never reuse a socket another account opened (Messages RCA §1): its
    // presence, calls and identity all belong to that account.
    if (this.connection && this.connectedAs !== me) await this.disconnect();
    if (this.connection?.state === signalR.HubConnectionState.Connected) return;
    if (this.connecting) return this.connecting;
    this.wantConnected = true;
    this.wireLifecycle();
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
      const stuck = this.connection;
      this.connection = null;           // detach first: its onclose is now inert
      try { await stuck?.stop(); } catch { /* ignore */ }
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
    const conn = this.hubFactory(
      `${environment.apiUrl}/hubs/signaling`,
      async () => (await this.auth.getAccessToken()) ?? '',
      FOREVER_RETRY);
    this.connection = conn;
    this.connectedAs = this.identity();

    this.registerHandlers(conn);

    conn.onreconnected(async () => {
      if (this.connection !== conn) return;
      this.isConnected.set(true);
      this.connectionError.set(null);
      // Snapshot first, then deltas: whatever changed while we were away.
      try { await this.getOnlineUsersWithStatus(); } catch { /* best-effort */ }
      this.reconnected$.next();
    });

    conn.onreconnecting(err => {
      if (this.connection !== conn) return;
      this.isConnected.set(false);
      this.connectionError.set(err?.message ?? 'Reconnecting…');
    });

    conn.onclose(() => {
      if (this.connection !== conn) return;
      this.isConnected.set(false);
      // A closed socket's presence is stale by definition — don't keep
      // showing a frozen "who's online".
      this.onlineUserIds.set(new Set());
      this.userPresences.set(new Map());
      this.scheduleRevive();
    });

    try {
      await conn.start();
      this.isConnected.set(true);
      this.connectionError.set(null);
      this.reviveAttempt = 0;
      await this.getOnlineUsersWithStatus().catch(() => undefined);
    } catch (err) {
      this.isConnected.set(false);
      this.connectionError.set((err as Error).message);
      this.scheduleRevive();
      throw err;
    }
  }

  /** Revive a socket that closed for good while we still want it. */
  private scheduleRevive(): void {
    if (!this.wantConnected || this.reviveTimer || !this.identity()) return;
    const delay = Math.min(30000, 2000 * 2 ** Math.min(this.reviveAttempt++, 4));
    this.reviveTimer = setTimeout(() => {
      this.reviveTimer = null;
      if (!this.wantConnected || !this.identity()) return;
      void this.connect().catch(() => undefined);
    }, delay);
  }

  /** Foreground / network back / bfcache restore: a sleeping phone or frozen
   *  tab misses presence deltas and may hold a half-open socket. Revive it,
   *  or — when it claims to be connected — re-snapshot (and rebuild if the
   *  snapshot call proves the socket is dead). */
  private wireLifecycle(): void {
    if (this.lifecycleWired || typeof window === 'undefined') return;
    this.lifecycleWired = true;
    const wake = () => { void this.resync(); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') wake();
    });
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
  }

  /** Snapshot again, or reconnect when the socket is gone. */
  async resync(): Promise<void> {
    if (!this.wantConnected || !this.identity()) return;
    const conn = this.connection;
    if (!conn || conn.state === signalR.HubConnectionState.Disconnected) {
      await this.connect().catch(() => undefined);
      return;
    }
    if (conn.state !== signalR.HubConnectionState.Connected) return; // auto-reconnect is on it
    try {
      await Promise.race([
        this.getOnlineUsersWithStatus(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('snapshot timeout')), 8000)),
      ]);
    } catch {
      // Half-open socket (common after an iOS/Android resume): rebuild.
      if (this.connection === conn) {
        this.connection = null;
        try { await conn.stop(); } catch { /* ignore */ }
        await this.connect().catch(() => undefined);
      }
    }
  }

  private registerHandlers(conn: signalR.HubConnection) {
    // Bound to THIS connection: a replaced / previous-account socket's
    // events are dropped instead of leaking into the current session.
    const on = <A extends unknown[]>(name: string, fn: (...a: A) => void) =>
      conn.on(name, (...a: unknown[]) => { if (this.connection === conn) fn(...(a as A)); });

    on('UserOnline',  (p: { userId: string }) => {
      const next = new Set(this.onlineUserIds()); next.add(p.userId); this.onlineUserIds.set(next);
      if (!this.userPresences().has(p.userId)) {
        const m = new Map(this.userPresences()); m.set(p.userId, 'active'); this.userPresences.set(m);
      }
      this.userOnline.next(p.userId);
    });
    on('UserOffline', (p: { userId: string }) => {
      const next = new Set(this.onlineUserIds()); next.delete(p.userId); this.onlineUserIds.set(next);
      const m = new Map(this.userPresences()); m.delete(p.userId); this.userPresences.set(m);
      this.userOffline.next(p.userId);
    });
    on('UserPresenceChanged', (p: { userId: string; status: string; custom?: boolean }) => {
      // Connection statuses drive online/offline; custom statuses ('busy',
      // 'surgery', and the custom "away" preset — flagged `custom` by the
      // status PATCH) are PresenceService's and must not pollute these maps
      // (the people drawer used to bucket a "Busy" user as Offline).
      if (!p.custom && isConnectionStatus(p.status)) {
        const m = new Map(this.userPresences());
        if (p.status === 'offline') m.delete(p.userId); else m.set(p.userId, p.status);
        this.userPresences.set(m);
        const online = new Set(this.onlineUserIds());
        if (isOnlineStatus(p.status)) online.add(p.userId); else online.delete(p.userId);
        this.onlineUserIds.set(online);
      }
      this.userPresenceChanged.next(p);
    });

    on('IncomingCall', (info: IncomingCallInfo) => this.incomingCall.next(info));
    on('CallRejected',  (p: { sessionId: string; userId: string; sessionEnded?: boolean }) => this.callRejected.next(p));
    on('CallCancelled', (p: { sessionId: string }) => this.callCancelled.next(p));
    on('CallHandledElsewhere', (p: { sessionId: string }) => this.callHandledElsewhere.next(p));
    on('ParticipantJoined', (p: { sessionId: string; userId: string }) => this.participantJoined.next(p));
    on('ParticipantLeft',   (p: { sessionId: string; userId: string }) => this.participantLeft.next(p));

    on('SessionOffer',        (p: SessionSignal) => this.sessionOffer.next(p));
    on('SessionAnswer',       (p: SessionSignal) => this.sessionAnswer.next(p));
    on('SessionIceCandidate', (p: SessionSignal) => this.sessionIceCandidate.next(p));
    on('RemoteMuteChanged',   (p: { sessionId: string; userId: string; isMuted: boolean }) => this.remoteMuteChanged.next(p));
  }

  // ── Hub method facades ────────────────────────────────────────────

  async startCall(targetUserId: string, callType: CallType = 'audio', source?: string): Promise<{ sessionId: string }> {
    await this.connect();
    try { return await this.connection!.invoke('StartCall', targetUserId, callType, source ?? null); }
    catch (err) { throw cleanHubError(err); }
  }
  /** Rings every active group member at once. Backend resolves the
   *  conversation, filters to online members, and pushes IncomingCall
   *  with conversationId + conversationName attached. */
  async startGroupCall(conversationId: string, callType: CallType = 'audio', source?: string): Promise<{ sessionId: string; ringing?: string[] }> {
    await this.connect();
    try { return await this.connection!.invoke('StartGroupCall', conversationId, callType, source ?? null); }
    catch (err) { throw cleanHubError(err); }
  }
  async acceptCall(sessionId: string): Promise<{ sessionId: string; participants: string[] }> {
    await this.connect();
    try { return await this.connection!.invoke('AcceptCall', sessionId); }
    catch (err) { throw cleanHubError(err); }
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
    try { return await this.connection!.invoke('InviteToCall', sessionId, targetUserId); }
    catch (err) { throw cleanHubError(err); }
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
  /** The call still ringing THIS user with that id, or null once it was
   *  cancelled / answered / timed out. The answer-from-push path: a device
   *  opened from a ring notification looks the ring up by the id the push
   *  carried (the hub also re-delivers pending rings on connect). */
  async getRingingCall(sessionId: string): Promise<IncomingCallInfo | null> {
    await this.connect();
    return (await this.connection!.invoke<IncomingCallInfo | null>('GetRingingCall', sessionId)) ?? null;
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
    const conn = this.connection!;
    const res = await conn.invoke<Record<string, string>>('GetOnlineUsersWithStatus');
    if (this.connection !== conn) return res ?? {};   // replaced meanwhile
    this.applySnapshot(res ?? {});
    return res;
  }

  /** Replace the presence maps from a server snapshot. Only 'active' /
   *  'in-a-call' count as online — 'away' users (last connection dropped,
   *  inside the server's grace) used to read as online for 2 minutes. */
  applySnapshot(res: Record<string, string>): void {
    const m = new Map<string, string>();
    const online = new Set<string>();
    for (const [uid, st] of Object.entries(res)) {
      if (!isConnectionStatus(st) || st === 'offline') continue;
      m.set(uid, st);
      if (isOnlineStatus(st)) online.add(uid);
    }
    this.userPresences.set(m);
    this.onlineUserIds.set(online);
  }
  async updatePresenceStatus(status: 'active' | 'away'): Promise<void> {
    await this.connect();
    return await this.connection!.invoke('UpdatePresenceStatus', status);
  }

  /** Logout / account switch: drop the socket (and its handlers) and every
   *  presence cache; tell call state to reset. Idempotent. */
  async disconnect(): Promise<void> {
    const old = this.connection;
    this.connection = null;
    this.connectedAs = null;
    this.connecting = null;
    this.wantConnected = false;
    if (this.reviveTimer) { clearTimeout(this.reviveTimer); this.reviveTimer = null; }
    this.reviveAttempt = 0;
    this.isConnected.set(false);
    this.connectionError.set(null);
    this.onlineUserIds.set(new Set());
    this.userPresences.set(new Map());
    this.sessionReset$.next();
    if (old) { try { await old.stop(); } catch { /* ignore */ } }
  }

  ngOnDestroy(): void { void this.disconnect(); }
}
