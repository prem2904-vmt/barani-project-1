import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { SessionScopeService } from '../auth/session-scope.service';
import { AuthService } from '../auth/auth.service';
import { ChatWindowsService } from './chat-windows.service';
import { RingtoneService } from './ringtone.service';
import { PresenceService } from './presence.service';
import { ApiService } from './api.service';
import { SignalingService } from './signaling.service';

/**
 * Messages RCA 2026-09-27 §1: persistent messaging state on a shared lab
 * machine is namespaced per tenant + user — chat-head favourites, the
 * message-sounds mute and my presence status no longer leak from one
 * account to the next.
 */
const A = { userId: 'app-admin', tenantId: 't1', authId: 'sub-admin' };
const B = { userId: 'app-priya', tenantId: 't1', authId: 'sub-priya' };

describe('messaging storage keys are per account', () => {
  afterEach(() => vi.unstubAllGlobals());
  // In-memory Storage (the runner's own localStorage may be missing).
  beforeEach(() => {
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user: signal(null), getAccessToken: async () => null } },
        { provide: ApiService, useValue: { patch: () => of({}) } },
        { provide: SignalingService, useValue: { userPresenceChanged: { subscribe: () => ({}) } } },
      ],
    });
  });

  it('SessionScopeService.storageKey namespaces by tenant + user', () => {
    const scope = TestBed.inject(SessionScopeService);
    expect(scope.storageKey('pf.x')).toBe('pf.x:anon');
    scope.changed(A);
    expect(scope.storageKey('pf.x')).toBe('pf.x:t1:app-admin');
  });

  it('chat-head favourites belong to the account that pinned them', () => {
    const scope = TestBed.inject(SessionScopeService);
    const win = TestBed.inject(ChatWindowsService);
    scope.changed(A);
    win.toggleFavourite('c-admin');
    expect(localStorage.getItem('pf.chat.favourites:t1:app-admin')).toBe('["c-admin"]');
    expect(localStorage.getItem('pf.chat.favourites')).toBeNull();

    scope.changed(B);
    expect(win.favourites()).toEqual([]);
    win.openWindow('c-priya');
    scope.changed(A);
    expect(win.favourites()).toEqual(['c-admin']);
    expect(win.open()).toEqual([]);                 // B's windows didn't follow
  });

  it('a legacy device-wide favourites key moves to the first account once', () => {
    localStorage.setItem('pf.chat.favourites', '["old"]');
    const scope = TestBed.inject(SessionScopeService);
    const win = TestBed.inject(ChatWindowsService);
    scope.changed(A);
    expect(win.favourites()).toEqual(['old']);
    expect(localStorage.getItem('pf.chat.favourites')).toBeNull();
    scope.changed(B);
    expect(win.favourites()).toEqual([]);
  });

  it('the message-sounds mute is per account', () => {
    const scope = TestBed.inject(SessionScopeService);
    const ring = TestBed.inject(RingtoneService);
    scope.changed(A);
    ring.setMuted(true);
    expect(localStorage.getItem('pf.chat.sounds.muted:t1:app-admin')).toBe('1');
    scope.changed(B);
    expect(ring.muted()).toBe(false);
    scope.changed(A);
    expect(ring.muted()).toBe(true);
  });

  it('my presence status is per account', () => {
    const scope = TestBed.inject(SessionScopeService);
    scope.changed(A);
    localStorage.setItem('pf.myPresenceStatus:t1:app-admin', 'surgery');
    const presence = TestBed.inject(PresenceService);
    expect(presence.myStatus()).toBe('surgery');
    scope.changed(B);
    expect(presence.myStatus()).toBe('available');
  });
});

describe('DirectoryService (messaging people list)', () => {
  it('excludes ME by AuthId and forgets the list on account switch', async () => {
    const { DirectoryService } = await import('./directory.service');
    const user = signal<{ id: string; authId: string } | null>({ id: 'app-me', authId: 'sub-me' });
    let calls = 0;
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user } },
        { provide: ApiService, useValue: { get: () => { calls++; return of([
          { id: 'sub-me', displayName: 'Me Myself', email: '', isActive: true },
          { id: 'sub-fd', displayName: 'Front Desk', email: '', isActive: true },
        ]); } } },
      ],
    });
    const scope = TestBed.inject(SessionScopeService);
    scope.changed({ userId: 'app-me', tenantId: 't', authId: 'sub-me' });
    const dir = TestBed.inject(DirectoryService);
    await dir.load();
    expect(dir.others().map(u => u.id)).toEqual(['sub-fd']);
    scope.changed({ userId: 'app-other', tenantId: 't', authId: 'sub-other' });
    expect(dir.users()).toEqual([]);
    await dir.load();
    expect(calls).toBe(2);
  });
});
