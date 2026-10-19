import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { ChatService } from './chat.service';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { HUB_FACTORY } from './hub-factory';
import { SignalingService } from './signaling.service';
import { ToastService } from './toast.service';
import { WebrtcService } from './webrtc.service';
import { NativeRingState } from './native-ring.state';
import { CallKitWiring, type CallKitPlugin, type PendingAnswer } from './callkit.wiring';

/**
 * iOS LOCK-SCREEN ANSWER (owner 2026-09-28). An AUDIO CallKit answer on a
 * locked iPhone leaves the app in the background and this WebView suspended —
 * the native layer tells the server "answering" itself and HOLDS the answer;
 * the web app joins when it next runs. Freezes:
 *  · a held (pending) answer is joined on attach (cold start) and on resume —
 *    exactly one AcceptCall, then callConnected({id}) clears the native hold;
 *  · the live callAnswered event + the held answer + the in-app Answer button
 *    never make a second AcceptCall;
 *  · the caller: "CallAnswering" swaps "Ringing…" + the 60 s no-answer timer
 *    for "Answered — connecting…" and a 120 s join window.
 */

class FakePc {
  connectionState = 'new'; signalingState = 'stable'; iceGatheringState = 'complete';
  localDescription: unknown = null; remoteDescription: unknown = null;
  ontrack: unknown; onicecandidate: unknown; oniceconnectionstatechange: unknown;
  onsignalingstatechange: unknown; onconnectionstatechange: unknown;
  addTrack() { /* */ }
  async createOffer() { return { type: 'offer', sdp: 'o' }; }
  async createAnswer() { return { type: 'answer', sdp: 'a' }; }
  async setLocalDescription(d: unknown) { this.localDescription = d; }
  async setRemoteDescription(d: unknown) { this.remoteDescription = d; }
  async addIceCandidate() { /* */ }
  async getStats() { return new Map(); }
  addEventListener() { /* */ } removeEventListener() { /* */ }
  close() { /* */ }
}

const RING = { sessionId: 'ring123', callerId: 'sub-b', callerName: 'Bala Iyer', callType: 'audio', participants: ['sub-b'] };

/** The native plugin, faked: listeners by name, a held pending answer. */
class FakeCallKit implements CallKitPlugin {
  readonly listeners = new Map<string, Array<(d: never) => void>>();
  pending: PendingAnswer = {};
  readonly connected: Array<string | undefined> = [];
  readonly endRings: string[] = [];
  async register() { /* */ }
  async endCall() { /* */ }
  async endRing(o: { id: string }) { this.endRings.push(o.id); }
  async callConnected(o?: { id?: string }) { this.connected.push(o?.id); this.pending = {}; }
  async getPendingAnswer() { return this.pending; }
  async addListener(name: string, fn: (d: never) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
    return {};
  }
  fire(name: string, data: unknown = {}) { for (const fn of this.listeners.get(name) ?? []) fn(data as never); }
}

async function setup() {
  FakeHub.reset();
  const track = { stop: vi.fn(), enabled: true, kind: 'audio' };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true, value: { getUserMedia: vi.fn(async () => stream) },
  });
  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakePc;
  (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription = class { constructor(public d: unknown) {} };

  const toast = { info: vi.fn(), error: vi.fn(), success: vi.fn(), show: vi.fn() };
  const user = signal({ id: 'app-me', authId: 'sub-me', displayName: 'Me Myself' });
  const api = { get: vi.fn(() => of([])), post: vi.fn(() => of({ declined: true })), delete: vi.fn(() => of({})) };
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, getAccessToken: async () => 'jwt-me', waitForAuth: async () => undefined } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
      { provide: ToastService, useValue: toast },
      { provide: ChatService, useValue: { conversations: signal([]) } },
      { provide: ApiService, useValue: api },
    ],
  });
  TestBed.inject(SessionScopeService).changed({ userId: 'app-me', tenantId: 't1', authId: 'sub-me' });
  const signaling = TestBed.inject(SignalingService);
  await signaling.connect();
  const hub = FakeHub.last('/hubs/signaling')!;
  hub.responses['GetTurnCredentials'] = () => ({ iceServers: [], ttl: 600, provider: 'static' });
  hub.responses['StartCall'] = () => ({ sessionId: 's-out' });
  hub.responses['AcceptCall'] = (sid: unknown) => ({ sessionId: sid, participants: ['sub-b'] });
  hub.responses['GetRingingCall'] = () => null; // answered natively → no longer a ring
  const svc = TestBed.inject(WebrtcService);
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
  const invoked = (m: string) => hub.invoked.filter(i => i.method === m);

  const plugin = new FakeCallKit();
  let resume: (() => void) | null = null;
  const wiring = new CallKitWiring({
    auth: TestBed.inject(AuthService), webrtc: svc, nativeRing: TestBed.inject(NativeRingState),
    api: TestBed.inject(ApiService), signaling, onVoipToken: () => undefined,
    plugin, lifecycle: { onResume: fn => { resume = fn; } },
  });
  return { svc, hub, toast, settle, invoked, signaling, plugin, wiring, resume: () => resume?.() };
}

describe('iOS lock-screen answer — callee (the web app joins the answer the native layer holds)', () => {
  afterEach(() => vi.useRealTimers());

  it('cold start: an answer held natively is joined on attach — ONE AcceptCall, then callConnected clears the hold', async () => {
    const t = await setup();
    t.plugin.pending = { id: 'ring123', media: 'audio', name: 'Bala Iyer', audioActive: true };
    await t.wiring.attach();
    await t.settle();
    expect(t.invoked('AcceptCall').map(i => i.args[0])).toEqual(['ring123']);
    expect(t.svc.sessionId()).toBe('ring123');
    expect(t.plugin.connected).toEqual(['ring123']);
  });

  it('locked + backgrounded: nothing runs until the app resumes; the resume joins it once, a 2nd resume does nothing', async () => {
    const t = await setup();
    await t.wiring.attach();
    await t.settle();
    expect(t.invoked('AcceptCall')).toHaveLength(0);

    // Answered on the lock screen while the WebView was suspended: the event
    // never ran. The user opens the app → resume.
    t.plugin.pending = { id: 'ring123', audioActive: true };
    t.resume();
    await t.settle();
    expect(t.invoked('AcceptCall')).toHaveLength(1);
    expect(t.plugin.connected).toEqual(['ring123']);

    t.plugin.pending = { id: 'ring123', audioActive: true }; // a stale re-read
    t.resume();
    await t.settle();
    expect(t.invoked('AcceptCall')).toHaveLength(1);
  });

  it('the live callAnswered event AND the held answer on resume make ONE AcceptCall (joined after the audio session is up)', async () => {
    const t = await setup();
    await t.wiring.attach();
    t.plugin.fire('callAnswered', { id: 'ring123', media: 'audio', name: 'Bala Iyer', duration: '0' });
    await t.settle();
    expect(t.invoked('AcceptCall')).toHaveLength(0); // waits for CallKit's audio session
    t.plugin.pending = { id: 'ring123', audioActive: true };
    t.resume();
    t.plugin.fire('audioSessionActivated');
    await t.settle();
    expect(t.invoked('AcceptCall').map(i => i.args[0])).toEqual(['ring123']);
  });

  it('in-app Answer tapped while the CallKit answer is joining: never a second AcceptCall', async () => {
    const t = await setup();
    await t.wiring.attach();
    t.hub.emit('IncomingCall', RING); // the in-app ring card is up too
    expect(t.svc.incomingCall()?.sessionId).toBe('ring123');

    t.plugin.fire('callAnswered', { id: 'ring123' });
    t.plugin.fire('audioSessionActivated');
    const inApp = t.svc.acceptIncoming(); // the user also taps Answer in the app
    await inApp;
    await t.settle();
    expect(t.invoked('AcceptCall')).toHaveLength(1);
    expect(t.svc.incomingCall()).toBeNull();
    expect(t.svc.status()).toBe('connecting');
  });

  it('the ring replayed while we are joining that very call is never declined', async () => {
    const t = await setup();
    await t.wiring.attach();
    t.plugin.fire('callAnswered', { id: 'ring123' });
    t.plugin.fire('audioSessionActivated');
    await t.settle();
    t.hub.emit('IncomingCall', RING);
    await t.settle();
    expect(t.invoked('RejectCall')).toHaveLength(0);
    expect(t.svc.sessionId()).toBe('ring123');
  });

  it('the caller\'s offer landing before AcceptCall returns is not dropped (session id is set first)', async () => {
    const t = await setup();
    let release!: () => void;
    t.hub.responses['AcceptCall'] = (sid: unknown) => new Promise(r => { release = () => r({ sessionId: sid, participants: ['sub-b'] }); });
    const p = t.svc.acceptBySessionId('ring123');
    await t.settle();
    expect(t.svc.sessionId()).toBe('ring123');
    t.hub.emit('SessionOffer', { sessionId: 'ring123', fromUserId: 'sub-b', sdp: JSON.stringify({ type: 'offer', sdp: 'o' }) });
    await t.settle();
    expect(t.invoked('SendSessionAnswer').map(i => i.args[0])).toEqual(['ring123']);
    release();
    await p;
  });
});

describe('iOS lock-screen answer — caller (never stuck on "Ringing" after the callee answered)', () => {
  afterEach(() => vi.useRealTimers());

  it('CallAnswering → "Answered — connecting…", the 60 s no-answer is replaced by a 120 s join window', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b', 'messages', 'Bala Iyer');
    expect(t.svc.status()).toBe('outgoing');
    vi.useFakeTimers();
    t.hub.emit('CallAnswering', { sessionId: 's-out', userId: 'sub-b' });
    expect(t.svc.calleeAnswering()).toBe(true);

    vi.advanceTimersByTime(90_000); // past the old 60 s "No answer"
    expect(t.svc.status()).toBe('outgoing');
    expect(t.toast.info).not.toHaveBeenCalledWith('No answer.');

    vi.advanceTimersByTime(30_000); // 120 s after the answer, still no join
    vi.useRealTimers();
    await t.settle();
    expect(t.invoked('CancelCall').map(i => i.args[0])).toEqual(['s-out']);
    expect(t.svc.status()).toBe('idle');
    expect(t.svc.calleeAnswering()).toBe(false);
  });

  it('the callee then joins → the call goes active and the join timer is gone', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b');
    t.hub.emit('CallAnswering', { sessionId: 's-out', userId: 'sub-b' });
    t.hub.emit('ParticipantJoined', { sessionId: 's-out', userId: 'sub-b' });
    await t.settle();
    expect(t.svc.status()).toBe('active');
    vi.useFakeTimers();
    vi.advanceTimersByTime(200_000);
    vi.useRealTimers();
    expect(t.invoked('CancelCall')).toHaveLength(0);
  });

  it('CallAnswering for another call, or once not ringing, is ignored', async () => {
    const t = await setup();
    await t.svc.startCall('sub-b');
    t.hub.emit('CallAnswering', { sessionId: 'other', userId: 'sub-b' });
    expect(t.svc.calleeAnswering()).toBe(false);
  });
});
