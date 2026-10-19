import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';
import { ChatService } from './chat.service';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { HUB_FACTORY } from './hub-factory';
import { SignalingService, cleanHubError } from './signaling.service';
import { ToastService } from './toast.service';
import { WebrtcService } from './webrtc.service';

/**
 * WebrtcService call state machine (calls test pass 2026-09-27) — driven
 * through the REAL SignalingService over a fake hub: server events in,
 * hub invocations out. Media is stubbed (fake getUserMedia + a minimal
 * RTCPeerConnection); the real media plane is covered by the Playwright
 * calls-real.local.spec.ts run.
 */

class FakePc {
  static all: FakePc[] = [];
  connectionState = 'new';
  signalingState = 'stable';
  iceGatheringState = 'complete';
  localDescription: { type: string; sdp: string } | null = null;
  remoteDescription: unknown = null;
  ontrack: unknown; onicecandidate: unknown; oniceconnectionstatechange: unknown;
  onsignalingstatechange: unknown; onconnectionstatechange: unknown;
  closed = false;
  constructor() { FakePc.all.push(this); }
  addTrack() { /* */ }
  async createOffer() { return { type: 'offer', sdp: 'o' }; }
  async createAnswer() { return { type: 'answer', sdp: 'a' }; }
  async setLocalDescription(d: { type: string; sdp: string }) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d; }
  async addIceCandidate() { /* */ }
  getReceivers() { return []; }
  async getStats() { return new Map(); }
  addEventListener() { /* */ }
  removeEventListener() { /* */ }
  close() { this.closed = true; this.connectionState = 'closed'; }
}

const PEOPLE = [
  { userId: 'sub-me', displayName: 'Me Myself', email: '' },
  { userId: 'sub-b', displayName: 'Bala Iyer', email: '' },
  { userId: 'sub-c', displayName: 'Chitra Nair', email: '' },
];

async function setup() {
  FakeHub.reset();
  FakePc.all = [];
  const track = { stop: vi.fn(), enabled: true, kind: 'audio' };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia: vi.fn(async () => stream) },
  });
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePc;
  (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription = class { constructor(public d: unknown) {} };
  const sendBeacon = vi.fn(() => true);
  Object.defineProperty(globalThis.navigator, 'sendBeacon', { configurable: true, value: sendBeacon });

  const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn(), show: vi.fn() };
  const user = signal({ id: 'app-me', authId: 'sub-me', displayName: 'Me Myself' });
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, getAccessToken: async () => 'jwt-me' } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
      { provide: ToastService, useValue: toast },
      { provide: ChatService, useValue: { conversations: signal([{ id: 'c1', isGroup: false, participants: PEOPLE }]) } },
      { provide: ApiService, useValue: { get: () => of([]) } },
    ],
  });
  TestBed.inject(SessionScopeService).changed({ userId: 'app-me', tenantId: 't1', authId: 'sub-me' });
  const signaling = TestBed.inject(SignalingService);
  await signaling.connect();
  const hub = FakeHub.last('/hubs/signaling')!;
  hub.responses['GetTurnCredentials'] = () => ({ iceServers: [], ttl: 600, provider: 'static' });
  hub.responses['StartCall'] = () => ({ sessionId: 's-out' });
  hub.responses['StartGroupCall'] = () => ({ sessionId: 's-grp', ringing: ['sub-b', 'sub-c'] });
  hub.responses['AcceptCall'] = (sid: unknown) => ({ sessionId: sid, participants: ['sub-b'] });
  const svc = TestBed.inject(WebrtcService);
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
  const invoked = (m: string) => hub.invoked.filter(i => i.method === m);
  return { svc, hub, toast, settle, invoked, sendBeacon, track };
}

/** Caller side: ring out, then the callee answers (mesh offer goes out). */
async function inActiveCall(t: Awaited<ReturnType<typeof setup>>) {
  await t.svc.startCall('sub-b');
  t.hub.emit('ParticipantJoined', { sessionId: 's-out', userId: 'sub-b' });
  await t.settle();
  expect(t.svc.status()).toBe('active');
}

describe('WebrtcService call state machine', () => {
  afterEach(() => vi.useRealTimers());

  it('outgoing 1:1 → callee declines: idle, and the caller is TOLD (toast, not a hidden banner)', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b');
    expect(t.svc.status()).toBe('outgoing');
    expect(t.invoked('StartCall')[0].args[0]).toBe('sub-b');
    t.hub.emit('CallRejected', { sessionId: 's-out', userId: 'sub-b', sessionEnded: true });
    expect(t.svc.status()).toBe('idle');
    expect(t.toast.info).toHaveBeenCalledWith('Bala Iyer declined the call.');
  });

  it('a group member declining (sessionEnded:false) does NOT end the caller\'s live call', async () => {
    const t = await setup();
    await inActiveCall(t);
    t.hub.emit('CallRejected', { sessionId: 's-out', userId: 'sub-c', sessionEnded: false });
    expect(t.svc.status()).toBe('active');
    expect(t.svc.remoteParticipants()).toEqual(['sub-b']);
    expect(t.toast.info).toHaveBeenCalledWith('Chitra Nair declined.');
  });

  it('older server (no sessionEnded): a decline while others are on the call keeps it', async () => {
    const t = await setup();
    await inActiveCall(t);
    t.hub.emit('CallRejected', { sessionId: 's-out', userId: 'sub-c' });
    expect(t.svc.status()).toBe('active');
  });

  it('a ring for ANOTHER call while ringing out is declined (busy) and never clobbers the outgoing call', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b');
    t.hub.emit('IncomingCall', { sessionId: 's-other', callerId: 'sub-c', callerName: 'Chitra Nair', callType: 'audio', participants: ['sub-c'] });
    await t.settle();
    expect(t.svc.status()).toBe('outgoing');
    expect(t.svc.incomingCall()).toBeNull();
    expect(t.svc.sessionId()).toBe('s-out');
    expect(t.invoked('RejectCall').map(i => i.args[0])).toEqual(['s-other']);
  });

  it('a ring while on a call is declined so the caller hears "busy" at once', async () => {
    const t = await setup();
    await inActiveCall(t);
    t.hub.emit('IncomingCall', { sessionId: 's-other', callerId: 'sub-c', callerName: 'Chitra Nair', callType: 'audio', participants: ['sub-c'] });
    await t.settle();
    expect(t.svc.status()).toBe('active');
    expect(t.invoked('RejectCall').map(i => i.args[0])).toEqual(['s-other']);
  });

  it('a duplicate IncomingCall for the ringing call is ignored (no self-decline)', async () => {
    const t = await setup();
    const ring = { sessionId: 's-in', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: ['sub-b'] };
    t.hub.emit('IncomingCall', ring);
    t.hub.emit('IncomingCall', ring);
    await t.settle();
    expect(t.svc.status()).toBe('incoming');
    expect(t.invoked('RejectCall')).toHaveLength(0);
  });

  it('accept clears a previous call\'s error; CallHandledElsewhere dismisses a ring', async () => {
    const t = await setup();
    t.svc.callError.set('Call declined.');
    t.hub.emit('IncomingCall', { sessionId: 's-in', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: ['sub-b'] });
    await t.svc.acceptIncoming();
    expect(t.svc.callError()).toBeNull();
    expect(t.svc.sessionId()).toBe('s-in');
    expect(t.svc.status()).toBe('connecting');

    t.hub.emit('IncomingCall', { sessionId: 's-2', callerId: 'sub-c', callerName: 'C', callType: 'audio', participants: [] });
    await t.settle();
    expect(t.invoked('RejectCall').map(i => i.args[0])).toEqual(['s-2']); // busy while connecting
  });

  it('CallHandledElsewhere / CallCancelled dismiss the ring on this device', async () => {
    const t = await setup();
    t.hub.emit('IncomingCall', { sessionId: 's-a', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: [] });
    t.hub.emit('CallHandledElsewhere', { sessionId: 's-a' });
    expect(t.svc.incomingCall()).toBeNull();
    expect(t.svc.status()).toBe('idle');
    t.hub.emit('IncomingCall', { sessionId: 's-b', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: [] });
    t.hub.emit('CallCancelled', { sessionId: 's-b' });
    expect(t.svc.incomingCall()).toBeNull();
    expect(t.svc.status()).toBe('idle');
  });

  it('left alone after the others hang up → LeaveCall on the server too (no ghost "in a call")', async () => {
    const t = await setup();
    await inActiveCall(t);
    t.hub.emit('ParticipantLeft', { sessionId: 's-out', userId: 'sub-b' });
    await t.settle();
    expect(t.invoked('LeaveCall').map(i => i.args[0])).toEqual(['s-out']);
    expect(t.svc.status()).toBe('idle');
    expect(FakePc.all.every(pc => pc.closed)).toBe(true);
  });

  it('mute disables the mic track and tells the server; hang-up leaves and stops the mic', async () => {
    const t = await setup();
    await inActiveCall(t);
    expect(t.svc.toggleMute()).toBe(true);
    expect(t.track.enabled).toBe(false);
    expect(t.invoked('SetMuteState')[0].args).toEqual(['s-out', true]);
    t.svc.toggleMute();
    expect(t.track.enabled).toBe(true);
    await t.svc.leaveCall();
    expect(t.invoked('LeaveCall')).toHaveLength(1);
    expect(t.track.stop).toHaveBeenCalled();
    expect(t.svc.status()).toBe('idle');
  });

  it('unanswered outgoing call auto-cancels after 60s and says "No answer."', async () => {
    const t = await setup();
    vi.useFakeTimers();
    const p = t.svc.startCall('sub-b');
    await vi.advanceTimersByTimeAsync(10);
    await p;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.invoked('CancelCall').map(i => i.args[0])).toEqual(['s-out']);
    expect(t.toast.info).toHaveBeenCalledWith('No answer.');
    expect(t.svc.status()).toBe('idle');
  });

  it('a server refusal surfaces as the server\'s own sentence, not the SignalR wrapper', async () => {
    const t = await setup();
    t.hub.responses['StartCall'] = () => { throw new Error("An unexpected error occurred invoking 'StartCall' on the server. HubException: They're on another call right now."); };
    await expect(t.svc.startCall('sub-b')).rejects.toThrow(/^They're on another call right now\.$/);
    expect(t.svc.status()).toBe('idle');
    expect(t.svc.callError()).toBe("They're on another call right now.");
  });

  it('tab close sends the cleanup beacon to the API host (not the UI origin)', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b');
    window.dispatchEvent(new Event('beforeunload'));
    expect(t.sendBeacon).toHaveBeenCalledTimes(1);
    expect((t.sendBeacon.mock.calls[0] as unknown[])[0]).toBe(`${environment.apiUrl}/api/call-cleanup`);
  });

  it('logout / account switch mid-ring drops the ring and every call timer', async () => {
    const t = await setup();
    t.hub.emit('IncomingCall', { sessionId: 's-in', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: [] });
    await TestBed.inject(SignalingService).disconnect();
    expect(t.svc.incomingCall()).toBeNull();
    expect(t.svc.status()).toBe('idle');
  });
});

describe('cleanHubError', () => {
  it('keeps the server sentence, passes other errors through', () => {
    expect(cleanHubError(new Error("An unexpected error occurred invoking 'StartGroupCall' on the server. HubException: They're in surgery right now — do not disturb.")).message)
      .toBe("They're in surgery right now — do not disturb.");
    expect(cleanHubError(new Error('socket closed')).message).toBe('socket closed');
  });
});
