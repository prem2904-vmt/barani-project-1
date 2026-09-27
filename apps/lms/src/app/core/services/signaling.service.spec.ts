import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { SignalingService, isOnlineStatus } from './signaling.service';
import { HUB_FACTORY } from './hub-factory';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';

/**
 * Messages RCA 2026-09-27 — issue 2 ("online statuses not refreshed"):
 * snapshot on (re)connect, then deltas; 'away' is NOT online; custom
 * statuses never pollute connection presence; a closed socket's presence is
 * dropped; an account switch rebuilds the socket with the new token.
 */
function setup() {
  FakeHub.reset();
  const user = signal<{ id: string; authId: string } | null>({ id: 'app-a', authId: 'sub-a' });
  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { user, getAccessToken: async () => `jwt-${user()?.authId}` } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
    ],
  });
  const svc = TestBed.inject(SignalingService);
  const scope = TestBed.inject(SessionScopeService);
  scope.changed({ userId: 'app-a', tenantId: 't1', authId: 'sub-a' });
  return { svc, scope, user };
}

const SNAPSHOT = { 'u-online': 'active', 'u-call': 'in-a-call', 'u-away': 'away' };

describe('SignalingService presence', () => {
  it('connect → snapshot: only active / in-a-call count as online', async () => {
    const t = setup();
    FakeHub.reset();
    const connectP = t.svc.connect();
    FakeHub.last('/hubs/signaling')!.responses['GetOnlineUsersWithStatus'] = () => SNAPSHOT;
    await connectP;
    expect([...t.svc.onlineUserIds()].sort()).toEqual(['u-call', 'u-online']);
    expect(t.svc.userPresences().get('u-away')).toBe('away');
  });

  it('deltas: away drops online, active restores it, offline removes the entry', async () => {
    const t = setup();
    await t.svc.connect();
    const hub = FakeHub.last('/hubs/signaling')!;
    hub.emit('UserOnline', { userId: 'u1' });
    expect(t.svc.onlineUserIds().has('u1')).toBe(true);
    hub.emit('UserPresenceChanged', { userId: 'u1', status: 'away' });
    expect(t.svc.onlineUserIds().has('u1')).toBe(false);
    hub.emit('UserPresenceChanged', { userId: 'u1', status: 'active' });
    expect(t.svc.onlineUserIds().has('u1')).toBe(true);
    hub.emit('UserPresenceChanged', { userId: 'u1', status: 'offline' });
    expect(t.svc.onlineUserIds().has('u1')).toBe(false);
    expect(t.svc.userPresences().has('u1')).toBe(false);
  });

  it('a custom status ("busy") never enters connection presence', async () => {
    const t = setup();
    await t.svc.connect();
    const hub = FakeHub.last('/hubs/signaling')!;
    hub.emit('UserOnline', { userId: 'u1' });
    const seen: string[] = [];
    t.svc.userPresenceChanged.subscribe(p => seen.push(p.status));
    hub.emit('UserPresenceChanged', { userId: 'u1', status: 'busy' });
    expect(t.svc.userPresences().get('u1')).toBe('active');
    expect(t.svc.onlineUserIds().has('u1')).toBe(true);
    expect(seen).toEqual(['busy']);                 // still forwarded to PresenceService
  });

  it('reconnect re-snapshots (missed deltas are recovered)', async () => {
    const t = setup();
    await t.svc.connect();
    const hub = FakeHub.last('/hubs/signaling')!;
    hub.emit('UserOnline', { userId: 'ghost' });   // went offline while we were away…
    hub.responses['GetOnlineUsersWithStatus'] = () => ({ 'u-new': 'active' });
    await hub.reconnect();
    expect([...t.svc.onlineUserIds()]).toEqual(['u-new']);
  });

  it('a socket that closed for good drops its (stale) presence', async () => {
    const t = setup();
    await t.svc.connect();
    const hub = FakeHub.last('/hubs/signaling')!;
    hub.emit('UserOnline', { userId: 'u1' });
    await hub.stop();
    expect(t.svc.onlineUserIds().size).toBe(0);
    expect(t.svc.isConnected()).toBe(false);
  });

  it('account switch stops the old socket, clears presence and rebuilds with the new token', async () => {
    const t = setup();
    await t.svc.connect();
    const old = FakeHub.last('/hubs/signaling')!;
    old.emit('UserOnline', { userId: 'u1' });
    let resets = 0;
    t.svc.sessionReset$.subscribe(() => resets++);

    t.scope.changed({ userId: 'app-b', tenantId: 't1', authId: 'sub-b' });
    t.user.set({ id: 'app-b', authId: 'sub-b' });
    expect(old.stopped).toBe(true);
    expect(t.svc.onlineUserIds().size).toBe(0);
    expect(resets).toBe(1);

    await t.svc.connect();
    expect(FakeHub.last('/hubs/signaling')!.token).toBe('jwt-sub-b');
    // A late event on the old socket is ignored.
    old.emit('UserOnline', { userId: 'ghost' });
    old.emit('IncomingCall', { sessionId: 's1', callerId: 'x', callerName: 'X', callType: 'audio', participants: [] });
    expect(t.svc.onlineUserIds().has('ghost')).toBe(false);
  });

  it('the first sign-in of a cold launch does not reset (a CallKit answer may be joining)', () => {
    FakeHub.reset();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: signal(null), getAccessToken: async () => null } },
        { provide: HUB_FACTORY, useValue: fakeHubFactory },
      ],
    });
    const svc = TestBed.inject(SignalingService);
    let resets = 0;
    svc.sessionReset$.subscribe(() => resets++);
    TestBed.inject(SessionScopeService).changed({ userId: 'a', tenantId: 't', authId: 'sa' });
    expect(resets).toBe(0);
  });

  it('isOnlineStatus', () => {
    expect(isOnlineStatus('active')).toBe(true);
    expect(isOnlineStatus('in-a-call')).toBe(true);
    expect(isOnlineStatus('away')).toBe(false);
    expect(isOnlineStatus(undefined)).toBe(false);
  });
});
