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
import { CallReachService, callHint } from './call-reach.service';
import { CallPushService, parseCallPushLink } from './call-push.service';
import { NativeRingState } from './native-ring.state';
import { CallRingService } from './call-ring.service';
import { RingtoneService } from './ringtone.service';
import { ElectronCallService, type ElectronCallsBridge } from './electron-call.service';
import { PlatformService } from './platform.service';
import { vapidKeyToBytes } from './web-push.service';
import { answerFromPush, declineFromPush, showRingFromPush } from './call-push.actions';

/**
 * OFFLINE CALLING (UI): calling someone with no live connection starts the
 * call anyway ("Ringing their devices…", 60 s "No answer"); a device woken by
 * a ring push answers / declines / shows the call by id; the native ringer and
 * the web ringtone never double up; Electron gets its call window hand-off.
 * Driven through the REAL SignalingService over the fake hub.
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

async function setup(opts: { reachable?: string[]; electron?: ElectronCallsBridge } = {}) {
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
  const posts: string[] = [];
  const api = {
    get: vi.fn((path: string) => of(path === '/api/devices/reachable' ? (opts.reachable ?? []) : [])),
    post: vi.fn((path: string) => { posts.push(path); return of({ declined: true }); }),
    delete: vi.fn(() => of({})),
  };
  const providers: unknown[] = [
    { provide: AuthService, useValue: { user, getAccessToken: async () => 'jwt-me', waitForAuth: async () => undefined } },
    { provide: HUB_FACTORY, useValue: fakeHubFactory },
    { provide: ToastService, useValue: toast },
    { provide: ChatService, useValue: { conversations: signal([]) } },
    { provide: ApiService, useValue: api },
  ];
  if (opts.electron) {
    (window as unknown as { electronAPI?: unknown }).electronAPI = { isElectron: true, calls: opts.electron };
    providers.push({ provide: PlatformService, useValue: { isElectron: signal(true), isCapacitor: signal(false) } });
  }
  TestBed.configureTestingModule({ providers: providers as never[] });
  TestBed.inject(SessionScopeService).changed({ userId: 'app-me', tenantId: 't1', authId: 'sub-me' });
  const signaling = TestBed.inject(SignalingService);
  await signaling.connect();
  const hub = FakeHub.last('/hubs/signaling')!;
  hub.responses['GetTurnCredentials'] = () => ({ iceServers: [], ttl: 600, provider: 'static' });
  hub.responses['StartCall'] = () => ({ sessionId: 's-out' });
  hub.responses['AcceptCall'] = (sid: unknown) => ({ sessionId: sid, participants: ['sub-b'] });
  const svc = TestBed.inject(WebrtcService);
  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
  const invoked = (m: string) => hub.invoked.filter(i => i.method === m);
  return { svc, hub, toast, settle, invoked, api, posts, signaling };
}

describe('Offline calling — caller side', () => {
  afterEach(() => { vi.useRealTimers(); delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

  it('calling an OFFLINE colleague starts the call anyway, says "ringing their devices", and times out at 60 s with "No answer"', async () => {
    const t = await setup();
    t.signaling.applySnapshot({}); // sub-b has no live connection
    await t.svc.startCall('sub-b', 'messages', 'Bala Iyer');
    expect(t.invoked('StartCall')[0].args[0]).toBe('sub-b');
    expect(t.svc.status()).toBe('outgoing');
    expect(t.svc.ringingDevices()).toBe(true);

    vi.useFakeTimers();
    // (the ring timer was armed with real timers before; re-arm under fakes)
    (t.svc as unknown as { armOutgoingRingTimeout(): void }).armOutgoingRingTimeout();
    vi.advanceTimersByTime(59_000);
    expect(t.svc.status()).toBe('outgoing');
    vi.advanceTimersByTime(1_000);
    vi.useRealTimers();
    await t.settle();
    expect(t.toast.info).toHaveBeenCalledWith('No answer.');
    expect(t.invoked('CancelCall').map(i => i.args[0])).toEqual(['s-out']);
    expect(t.svc.status()).toBe('idle');
    expect(t.svc.ringingDevices()).toBe(false);
  });

  it('an ONLINE callee is a plain "Ringing…" call', async () => {
    const t = await setup();
    t.signaling.applySnapshot({ 'sub-b': 'active' });
    await t.svc.startCall('sub-b');
    expect(t.svc.ringingDevices()).toBe(false);
  });

  it('busy is still refused — the server error surfaces and nothing keeps ringing', async () => {
    const t = await setup();
    t.hub.responses['StartCall'] = () => { throw new Error("HubException: They're on another call right now."); };
    await expect(t.svc.startCall('sub-b')).rejects.toThrow();
    expect(t.svc.status()).toBe('idle');
    expect(t.svc.callError()).toBe("They're on another call right now.");
  });
});

describe('Offline calling — callee answering from a push', () => {
  it('answering from a push with no in-app ring accepts the session by id (cold start from the notification)', async () => {
    const t = await setup();
    await answerFromPush(t.svc, 'ring123');
    expect(t.invoked('AcceptCall').map(i => i.args[0])).toEqual(['ring123']);
    expect(t.svc.sessionId()).toBe('ring123');
    expect(t.svc.status()).toBe('connecting');
  });

  it('the hub re-delivering the ring on connect shows it; answering from the push then accepts it', async () => {
    const t = await setup();
    t.hub.emit('IncomingCall', RING);
    expect(t.svc.incomingCall()?.sessionId).toBe('ring123');
    await answerFromPush(t.svc, 'ring123');
    expect(t.invoked('AcceptCall')).toHaveLength(1);
    expect(t.svc.incomingCall()).toBeNull();
  });

  it('opening from a ring looks it up by id — false once the call is gone', async () => {
    const t = await setup();
    t.hub.responses['GetRingingCall'] = () => null;
    expect(await showRingFromPush(t.svc, t.signaling, 'ring123')).toBe(false);
    expect(t.svc.incomingCall()).toBeNull();

    t.hub.responses['GetRingingCall'] = () => RING;
    expect(await showRingFromPush(t.svc, t.signaling, 'ring123')).toBe(true);
    expect(t.svc.incomingCall()?.callerName).toBe('Bala Iyer');
    expect(t.svc.status()).toBe('incoming');
  });

  it('declining from a push goes to the server: HTTP with no live ring, the hub when the ring is up', async () => {
    const t = await setup();
    await declineFromPush(t.svc, TestBed.inject(ApiService), 'ring123');
    expect(t.posts).toEqual(['/api/calls/ring123/decline']);
    expect(t.invoked('RejectCall')).toHaveLength(0);

    t.hub.emit('IncomingCall', RING);
    await declineFromPush(t.svc, TestBed.inject(ApiService), 'ring123');
    expect(t.invoked('RejectCall').map(i => i.args[0])).toEqual(['ring123']);
    expect(t.svc.incomingCall()).toBeNull();
  });

  it('CallPushService: ?pfCall / prefrontal-call:// links route to answer / decline / show, deduped', async () => {
    const t = await setup();
    const push = TestBed.inject(CallPushService);
    await push.handle('answer', 'ring123');
    await push.handle('answer', 'ring123'); // cold start delivers the link twice
    expect(t.invoked('AcceptCall')).toHaveLength(1);

    await push.handle('decline', 'other456');
    expect(t.posts).toContain('/api/calls/other456/decline');

    t.hub.responses['GetRingingCall'] = () => null;
    await push.handle('show', 'gone789');
    expect(t.toast.info).toHaveBeenCalledWith('That call has ended.');

    await push.handle('answer', '../../etc'); // malformed ids never reach the server
    expect(t.invoked('AcceptCall')).toHaveLength(1);
  });
});

describe('parseCallPushLink', () => {
  it('reads Android intents and web / Electron links, rejects junk', () => {
    expect(parseCallPushLink('prefrontal-call://answer?callId=abc123def456')).toEqual({ action: 'answer', callId: 'abc123def456' });
    expect(parseCallPushLink('prefrontal-call://decline/?callId=abc123def456')).toEqual({ action: 'decline', callId: 'abc123def456' });
    expect(parseCallPushLink('https://med.example/?pfCall=show:abc123def456')).toEqual({ action: 'show', callId: 'abc123def456' });
    expect(parseCallPushLink('https://med.example/#/x?pfCall=answer%3Aabc123def456')).toEqual({ action: 'answer', callId: 'abc123def456' });
    expect(parseCallPushLink('prefrontal-call://hijack?callId=abc123def456')).toBeNull();
    expect(parseCallPushLink('https://med.example/?pfCall=answer:<script>')).toBeNull();
    expect(parseCallPushLink(null)).toBeNull();
  });
});

describe('Offline calling — presence stays honest', () => {
  it('a push-reachable colleague with no connection is "away" and callable ("Will ring their devices")', async () => {
    const t = await setup({ reachable: ['sub-b'] });
    const reach = TestBed.inject(CallReachService);
    await reach.refresh();
    t.signaling.applySnapshot({ 'sub-c': 'active' });
    expect(reach.reachOf('sub-c')).toBe('online');
    expect(reach.reachOf('sub-b')).toBe('push');
    expect(reach.reachOf('sub-x')).toBe('offline');
    expect(reach.displayConnection('sub-b')).toBe('away');
    expect(reach.displayConnection('sub-x')).toBe('offline');
    expect(reach.hint('sub-b')).toBe('Will ring their devices');
    expect(callHint('online', 'Chitra')).toBe('Voice call Chitra');
  });
});

describe('Native ringer vs the web ringtone', () => {
  it('a call the OS is already ringing (CallKit / Android notification) never rings a second time in-app', () => {
    const incomingCall = signal<typeof RING | null>(null);
    const status = signal<string>('idle');
    let tone: string | null = null;
    TestBed.configureTestingModule({
      providers: [
        { provide: WebrtcService, useValue: { incomingCall, status } },
        { provide: RingtoneService, useValue: { play: (x: string) => { tone = x; }, stop: () => { tone = null; }, activeTone: () => tone } },
      ],
    });
    TestBed.inject(SessionScopeService).changed({ userId: 'a', tenantId: 't', authId: 'sa' });
    TestBed.inject(CallRingService);
    const native = TestBed.inject(NativeRingState);
    native.add('ring123');
    incomingCall.set(RING); status.set('incoming'); TestBed.tick();
    expect(tone).toBeNull();
    native.remove('ring123'); TestBed.tick();
    expect(tone).toBe('ringtone');
  });
});

describe('Electron — minimised / tray incoming call', () => {
  afterEach(() => { delete (window as unknown as { electronAPI?: unknown }).electronAPI; });

  it('hands the ring to the main process, dismisses it when the ring ends, and routes Answer back', async () => {
    let onAction: ((a: { action: 'answer' | 'decline' | 'show'; callId: string }) => void) | null = null;
    const bridge: ElectronCallsBridge = {
      incoming: vi.fn(), dismiss: vi.fn(),
      onAction: (cb) => { onAction = cb; return () => undefined; },
    };
    const t = await setup({ electron: bridge });
    TestBed.inject(ElectronCallService);

    t.hub.emit('IncomingCall', RING); TestBed.tick();
    expect(bridge.incoming).toHaveBeenCalledWith(expect.objectContaining({ callId: 'ring123', callerName: 'Bala Iyer' }));

    onAction!({ action: 'answer', callId: 'ring123' });
    await t.settle(); await t.settle();
    expect(t.invoked('AcceptCall').map(i => i.args[0])).toEqual(['ring123']);
    TestBed.tick();
    expect(bridge.dismiss).toHaveBeenCalledWith('ring123');
  });
});

describe('Web Push helpers', () => {
  it('decodes a base64url VAPID key', () => {
    expect(Array.from(vapidKeyToBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
