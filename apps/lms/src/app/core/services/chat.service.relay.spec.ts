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
import { ChatHistoryService, ChatSyncItem } from './chat-history.service';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';

/**
 * Chat relay (2026-09-27) through ChatService: history on screen comes from
 * the device store (synced on connect, acked after storing), live + synced
 * copies never duplicate, edits/reactions go out as relayed events, and an
 * account switch never shows the previous account's history.
 */
interface Person { id: string; authId: string; tenantId: string }
const ADMIN: Person = { id: 'app-admin', authId: 'sub-admin', tenantId: 't1' };
const PRIYA: Person = { id: 'app-priya', authId: 'sub-priya', tenantId: 't1' };
const RAVI = 'sub-ravi';

const conv = (id: string, me: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, isGroup: false, name: null, createdById: me, lastMessageAt: '2026-09-27T10:00:00Z', unreadCount: 0,
  participants: [
    { userId: me, displayName: 'Me', email: '', lastReadAt: '2026-09-27T09:00:00Z' },
    { userId: RAVI, displayName: 'Ravi', email: '' },
  ],
  lastMessage: null, ...extra,
});
const msg = (id: string, from = RAVI, min = 1, conversationId = 'c1'): ChatMessage =>
  ({ id, conversationId, fromUserId: from, body: `hello ${id}`, sentAt: `2026-09-27T10:0${min}:00.000Z`, kind: 'user' });

function setup() {
  FakeHub.reset();
  const user = signal<(Person & { email: string }) | null>(null);
  let pages: Record<string, Array<{ items: ChatSyncItem[]; next: number; hasMore: boolean }>> = {};
  const api = {
    get: vi.fn((url: string): Observable<unknown> => {
      const me = user()?.authId ?? '';
      if (url === '/api/chat/conversations') return of([conv('c1', me)]);
      if (url.startsWith('/api/chat/sync')) return of((pages[me] ?? []).shift() ?? { items: [], next: 0, hasMore: false });
      return of([]);
    }),
    post: vi.fn((_u: string, _b: unknown) => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { user, getAccessToken: async () => (user() ? `jwt-${user()!.authId}` : null) } },
      { provide: ApiService, useValue: api },
      { provide: RingtoneService, useValue: { playPing: vi.fn(), playSoft: vi.fn(), muted: signal(false) } },
      { provide: ChatNotifyService, useValue: { notify: vi.fn(() => false), restore: vi.fn(), notifyBusiness: vi.fn() } },
      { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(false), getApiUrl: () => '' } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
    ],
  });
  const history = TestBed.inject(ChatHistoryService);
  history.storeOptions = { factory: new IDBFactory(), keyRange: IDBKeyRange };
  const chat = TestBed.inject(ChatService);
  const scope = TestBed.inject(SessionScopeService);
  const signInAs = (p: Person) => {
    scope.changed({ userId: p.id, tenantId: p.tenantId, authId: p.authId });
    user.set({ ...p, email: '' });
  };
  const acked = () => api.post.mock.calls.filter(c => c[0] === '/api/chat/sync/ack').flatMap(c => (c[1] as { ids: string[] }).ids);
  return { chat, history, api, signInAs, acked, setPages: (p: typeof pages) => { pages = p; } };
}

const settle = () => new Promise(r => setTimeout(r, 20));

describe('ChatService — relay: history lives on the device', () => {
  it('connects with this device\'s id, syncs pending messages, acks them, and shows them from the store', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    t.setPages({ [ADMIN.authId]: [{ items: [{ seq: 1, v: 1, kind: 'message', message: msg('m1') }], next: 1, hasMore: false }] });
    await t.chat.connect();
    const device = await t.history.deviceId();
    expect(FakeHub.last('/hubs/chat')!.url).toContain(`deviceId=${device}`);
    await vi.waitFor(() => expect(t.acked()).toEqual(['m1']));

    await t.chat.openConversation('c1');
    expect(t.chat.activeMessages().map(m => m.id)).toEqual(['m1']);
    // The list preview + unread come from the device store (server had none).
    await settle();
    const c1 = t.chat.conversations().find(c => c.id === 'c1')!;
    expect(c1.lastMessage?.id).toBe('m1');
  });

  it('a message delivered by sync AND live is shown once', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    await t.chat.openConversation('c1');
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m2'));
    hub.emit('MessageReceived', msg('m2'));
    expect(t.chat.activeMessages().filter(m => m.id === 'm2').length).toBe(1);
    await vi.waitFor(async () => expect((await t.history.recent('c1', 10)).map(m => m.id)).toEqual(['m2']));
  });

  it('scrollback and search read the device store', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    const store = await t.history.store();
    await store.putMessages(Array.from({ length: 60 }, (_, i) =>
      ({ ...msg(`h${i}`), sentAt: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), body: i === 3 ? 'Potassium critical' : `n${i}` })));
    await t.chat.openConversation('c1');
    expect(t.chat.activeMessages().length).toBe(50);
    expect(t.chat.hasMoreHistory()).toBe(true);
    expect(await t.chat.loadOlder('c1')).toBe(10);
    expect(t.chat.activeMessages()[0].id).toBe('h0');
    expect((await t.chat.searchConversation('c1', 'potassium')).map(m => m.id)).toEqual(['h3']);
  });

  it('edits and reactions go out as relayed events naming their conversation', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    await (await t.history.store()).putMessages([msg('mine', ADMIN.authId)]);
    await t.chat.openConversation('c1');
    const hub = FakeHub.last('/hubs/chat')!;

    await t.chat.editMessage('mine', ' fixed ');
    await t.chat.toggleReaction('mine', '+1');
    const relays = hub.invoked.filter(i => i.method === 'RelayEvent').map(i => i.args);
    expect(relays[0]).toEqual(['c1', 'mine', 'edit', JSON.stringify({ body: 'fixed' })]);
    expect(relays[1]).toEqual(['c1', 'mine', 'reaction', JSON.stringify({ emoji: '+1', op: 'add' })]);
    expect(hub.invoked.some(i => i.method === 'EditMessage' || i.method === 'ToggleReaction')).toBe(false);

    // The relayed reaction comes back → next toggle removes it.
    hub.emit('MessageReactionChanged', { id: 'mine', conversationId: 'c1', emoji: '+1', op: 'add', fromUserId: ADMIN.authId, eventId: 'e1' });
    await t.chat.toggleReaction('mine', '+1');
    expect(hub.invoked.filter(i => i.method === 'RelayEvent').at(-1)!.args[3]).toBe(JSON.stringify({ emoji: '+1', op: 'remove' }));
  });

  it('an edit event from someone other than the sender is ignored on screen and in the store', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    await (await t.history.store()).putMessages([msg('m1', RAVI)]);
    await t.chat.openConversation('c1');
    FakeHub.last('/hubs/chat')!.emit('MessageEdited',
      { id: 'm1', conversationId: 'c1', body: 'forged', editedAt: new Date().toISOString(), fromUserId: 'sub-mallory', eventId: 'e9' });
    expect(t.chat.activeMessages()[0].body).toBe('hello m1');
    await settle();
    expect((await (await t.history.store()).getMessage('m1'))?.body).toBe('hello m1');
  });

  it('account switch: the next account never sees the previous account\'s device history', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    t.setPages({ [ADMIN.authId]: [{ items: [{ seq: 1, v: 1, kind: 'message', message: msg('secret') }], next: 1, hasMore: false }] });
    await t.chat.connect();
    await vi.waitFor(() => expect(t.acked()).toEqual(['secret']));
    const adminDevice = await t.history.deviceId();

    t.signInAs(PRIYA);
    await t.chat.connect();
    await t.chat.openConversation('c1');
    expect(t.chat.activeMessages()).toEqual([]);
    expect(await t.chat.searchConversation('c1', 'secret')).toEqual([]);
    const priyaHub = FakeHub.last('/hubs/chat')!;
    expect(priyaHub.url).toContain('deviceId=');
    expect(priyaHub.url).not.toContain(adminDevice);     // a device id per account
  });
});
