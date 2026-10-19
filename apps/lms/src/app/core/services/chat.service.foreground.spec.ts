import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { RingtoneService } from './ringtone.service';
import { ChatNotifyService } from './chat-notify.service';
import { PlatformService } from './platform.service';
import { HUB_FACTORY } from './hub-factory';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { ChatHistoryService } from './chat-history.service';

/**
 * Chat push suppression, client side: once the chat socket is up, ChatService
 * tells the hub what THIS device shows — (visible, on-screen thread ids, the
 * device's push handle) — so the server skips a push only to a device that is
 * showing that thread. A browser reports its Web Push endpoint; a device with
 * no push handle reports nothing.
 */
const ME = { id: 'app-me', authId: 'sub-me', tenantId: 't1', email: '' };
const ENDPOINT = 'https://push.example.invalid/sub/abc';

function setup(endpoint: string | null) {
  FakeHub.reset();
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: async () => ({ pushManager: { getSubscription: async () => (endpoint ? { endpoint } : null) } }),
      addEventListener: () => undefined,
    },
  });
  const user = signal<typeof ME | null>(null);
  const api = {
    get: vi.fn((url: string): Observable<unknown> =>
      url.startsWith('/api/chat/sync') ? of({ items: [], next: 0, hasMore: false }) : of([])),
    post: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { user, getAccessToken: async () => (user() ? 'jwt' : null) } },
      { provide: ApiService, useValue: api },
      { provide: RingtoneService, useValue: { playPing: vi.fn(), playSoft: vi.fn(), muted: signal(false) } },
      { provide: ChatNotifyService, useValue: { notify: vi.fn(() => false), restore: vi.fn(), notifyBusiness: vi.fn() } },
      { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(false), getApiUrl: () => '' } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
    ],
  });
  TestBed.inject(ChatHistoryService).storeOptions = { factory: new IDBFactory(), keyRange: IDBKeyRange };
  const chat = TestBed.inject(ChatService);
  TestBed.inject(SessionScopeService).changed({ userId: ME.id, tenantId: ME.tenantId, authId: ME.authId });
  user.set(ME);
  const reports = () => FakeHub.last('/hubs/chat')!.invoked.filter(i => i.method === 'ReportForeground').map(i => i.args);
  return { chat, reports };
}

describe('ChatService — foreground reporting for push suppression', () => {
  afterEach(() => { delete (navigator as unknown as Record<string, unknown>)['serviceWorker']; });

  it('reports the thread a reader shows, with this browser\'s push endpoint', async () => {
    const t = setup(ENDPOINT);
    await t.chat.connect();
    const current = signal<string | null>('c1');
    const off = t.chat.registerViewer('reader', () => [current()]);
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([true, ['c1'], ENDPOINT]));
    expect(t.chat.viewedConversationIds()).toEqual(['c1']);

    // Switching threads updates the report.
    current.set('c2');
    TestBed.tick();
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([true, ['c2'], ENDPOINT]));

    // Leaving the page → still visible, but no thread on screen → pushes resume.
    off();
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([true, [], ENDPOINT]));
  });

  it('a hidden page shows nothing', async () => {
    const t = setup(ENDPOINT);
    await t.chat.connect();
    t.chat.registerViewer('reader', () => ['c1']);
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(t.chat.viewedConversationIds()).toEqual([]);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([false, [], ENDPOINT]));
    vis.mockRestore();
  });

  it('native app going inactive reports "not viewing" at once, and resuming reports the thread again', async () => {
    const t = setup(ENDPOINT);
    await t.chat.connect();
    t.chat.registerViewer('reader', () => ['c1']);
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([true, ['c1'], ENDPOINT]));

    // Minimised: the web view may still claim "visible" (kept alive in the
    // background) — the native state wins, and the report goes out in the
    // same tick (no debounce / await the OS could freeze in between).
    const before = t.reports().length;
    t.chat.appActiveChanged(false);
    expect(t.reports().length).toBe(before + 1);
    expect(t.reports().at(-1)).toEqual([false, [], ENDPOINT]);
    expect(t.chat.viewedConversationIds()).toEqual([]);

    t.chat.appActiveChanged(true);
    await vi.waitFor(() => expect(t.reports().at(-1)).toEqual([true, ['c1'], ENDPOINT]));
  });

  it('with no push subscription there is nothing to suppress — no report', async () => {
    const t = setup(null);
    await t.chat.connect();
    t.chat.registerViewer('reader', () => ['c1']);
    await new Promise(r => setTimeout(r, 400));
    expect(t.reports()).toEqual([]);
  });
});
