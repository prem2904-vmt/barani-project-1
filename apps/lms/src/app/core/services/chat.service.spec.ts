import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ChatService, messagePreview } from './chat.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { RingtoneService } from './ringtone.service';
import { ChatNotifyService } from './chat-notify.service';
import { PlatformService } from './platform.service';
import { ChatPopupService } from './chat-popup.service';
import { ChatWindowsService } from './chat-windows.service';
import { HUB_FACTORY } from './hub-factory';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';

/**
 * Messages RCA 2026-09-27 — issue 1 (account switch bleed) + issue 3 (pop-up).
 * The chat hub is a FakeHub (DI seam HUB_FACTORY), so the tests see exactly
 * which token each socket was opened with, whether the old one was stopped,
 * and what a late event on a stale socket does to the new account's store.
 */

interface Person { id: string; authId: string; tenantId: string; displayName: string }
const ADMIN: Person = { id: 'app-admin', authId: 'sub-admin', tenantId: 't1', displayName: 'Admin User' };
const PRIYA: Person = { id: 'app-priya', authId: 'sub-priya', tenantId: 't1', displayName: 'Priya Sharma' };
const RAVI = 'sub-ravi';

const conv = (id: string, me: string, other: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, isGroup: false, name: null, createdById: me, lastMessageAt: '2026-09-27T10:00:00Z', unreadCount: 0,
  participants: [
    { userId: me, displayName: me === ADMIN.authId ? 'Admin User' : 'Priya Sharma', email: '' },
    { userId: other, displayName: other === RAVI ? 'Ravi Kumar' : other === ADMIN.authId ? 'Admin User' : 'Priya Sharma', email: '' },
  ],
  lastMessage: null, ...extra,
});

const msg = (id: string, conversationId: string, fromUserId: string, body = 'hello'): ChatMessage =>
  ({ id, conversationId, fromUserId, body, sentAt: '2026-09-27T10:05:00Z', kind: 'user' });

function setup(opts: { hidden?: boolean } = {}) {
  FakeHub.reset();
  const user = signal<(Person & { email: string }) | null>(null);
  const lists: Record<string, Conversation[]> = {
    [ADMIN.authId]: [conv('c-admin-ravi', ADMIN.authId, RAVI), conv('c-shared', ADMIN.authId, PRIYA.authId)],
    [PRIYA.authId]: [conv('c-shared', PRIYA.authId, ADMIN.authId), conv('c-priya-ravi', PRIYA.authId, RAVI)],
  };
  const auth = {
    user,
    getAccessToken: async () => (user() ? `jwt-${user()!.authId}` : null),
  };
  const api = {
    get: vi.fn((url: string) => of(url.includes('/conversations') ? (lists[user()?.authId ?? ''] ?? []) : [])),
    post: vi.fn(() => of({})),
  };
  const ringtone = { playPing: vi.fn(), playSoft: vi.fn(), muted: signal(false) };
  const notify = { notify: vi.fn(() => !!opts.hidden), restore: vi.fn(), notifyBusiness: vi.fn() };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
      { provide: ApiService, useValue: api },
      { provide: RingtoneService, useValue: ringtone },
      { provide: ChatNotifyService, useValue: notify },
      { provide: PlatformService, useValue: { isCapacitor: signal(false) } },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
    ],
  });
  const chat = TestBed.inject(ChatService);
  const scope = TestBed.inject(SessionScopeService);
  const popups = TestBed.inject(ChatPopupService);
  const windows = TestBed.inject(ChatWindowsService);

  /** What AuthService.loadProfile does: scope event FIRST, then the user. */
  const signInAs = (p: Person) => {
    scope.changed({ userId: p.id, tenantId: p.tenantId, authId: p.authId });
    user.set({ ...p, email: '' });
  };
  return { chat, scope, popups, windows, user, api, ringtone, notify, signInAs };
}

describe('ChatService — account switch is a clean slate', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('disposes the old hub and rebuilds it with the new account token', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    const adminHub = FakeHub.last('/hubs/chat')!;
    expect(adminHub.token).toBe('jwt-sub-admin');
    expect(t.chat.conversations().map(c => c.id)).toEqual(['c-admin-ravi', 'c-shared']);

    // "Add account" → Priya signs in IN PLACE (no reload).
    t.signInAs(PRIYA);
    expect(adminHub.stopped).toBe(true);
    expect(t.chat.conversations()).toEqual([]);          // Admin's list is gone at once
    await t.chat.connect();

    const priyaHub = FakeHub.last('/hubs/chat')!;
    expect(priyaHub).not.toBe(adminHub);
    expect(priyaHub.token).toBe('jwt-sub-priya');
    expect(t.chat.conversations().map(c => c.id)).toEqual(['c-shared', 'c-priya-ravi']);
  });

  it('an event arriving late on the previous account\'s socket never reaches the new store', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    const adminHub = FakeHub.last('/hubs/chat')!;
    t.signInAs(PRIYA);
    await t.chat.connect();

    // Ravi → Admin message delivered on Admin's (stale) socket.
    adminHub.emit('MessageReceived', msg('m1', 'c-admin-ravi', RAVI, 'for admin only'));
    adminHub.emit('Typing', { conversationId: 'c-shared', fromUserId: RAVI, isTyping: true });
    expect(t.chat.conversations().find(c => c.id === 'c-admin-ravi')).toBeUndefined();
    expect(t.chat.totalUnread()).toBe(0);
    expect(t.chat.typingByConversation().size).toBe(0);
    expect(t.popups.popups()).toEqual([]);
    expect(t.ringtone.playPing).not.toHaveBeenCalled();

    // …while Priya's own socket works normally.
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m2', 'c-priya-ravi', RAVI, 'for priya'));
    expect(t.chat.conversations().find(c => c.id === 'c-priya-ravi')!.unreadCount).toBe(1);
  });

  it('connect() refuses to reuse a socket opened by another account even without a scope event', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    const adminHub = FakeHub.last('/hubs/chat')!;
    t.user.set({ ...PRIYA, email: '' });               // identity swapped silently
    await t.chat.connect();
    expect(adminHub.stopped).toBe(true);
    expect(FakeHub.last('/hubs/chat')!.token).toBe('jwt-sub-priya');
  });

  it('sends over the socket of the account on screen (server stamps the sender from it)', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    t.signInAs(PRIYA);
    await t.chat.sendMessage('c-shared', 'from priya');
    const hub = FakeHub.last('/hubs/chat')!;
    expect(hub.token).toBe('jwt-sub-priya');
    expect(hub.invoked.map(i => i.method)).toContain('SendMessage');
    expect(FakeHub.all.filter(h => h.invoked.some(i => i.method === 'SendMessage'))).toEqual([hub]);
  });

  it('sign-out clears stores, windows, pop-ups and typing timers', async () => {
    const t = setup();
    t.signInAs(ADMIN);
    await t.chat.connect();
    t.windows.openWindow('c-admin-ravi');
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m1', 'c-shared', PRIYA.authId));
    expect(t.popups.popups().length).toBe(1);
    t.scope.changed(null);
    t.user.set(null);
    expect(t.chat.conversations()).toEqual([]);
    expect(t.chat.threads().size).toBe(0);
    expect(t.windows.open()).toEqual([]);
    expect(t.popups.popups()).toEqual([]);
    expect(t.notify.restore).toHaveBeenCalled();
  });
});

describe('ChatService — pop-up + tone decisions', () => {
  it('pops up (with the ping) for a message in a conversation you are not viewing', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI, 'Sample 26117 is haemolysed'));
    const [p] = t.popups.popups();
    expect(p.senderName).toBe('Ravi Kumar');
    expect(p.preview).toBe('Sample 26117 is haemolysed');
    expect(t.ringtone.playPing).toHaveBeenCalledTimes(1);
  });

  it('no pop-up and no sound for my own message', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m1', 'c-priya-ravi', PRIYA.authId));
    expect(t.popups.popups()).toEqual([]);
    expect(t.ringtone.playPing).not.toHaveBeenCalled();
    expect(t.ringtone.playSoft).not.toHaveBeenCalled();
  });

  it('no pop-up for a muted conversation, unless I am @mentioned', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    t.chat.conversations.update(l => l.map(c => c.id === 'c-priya-ravi' ? { ...c, isMuted: true } : c));
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.popups.popups()).toEqual([]);
    hub.emit('MessageReceived', { ...msg('m2', 'c-priya-ravi', RAVI), mentions: [PRIYA.authId] });
    expect(t.popups.popups().length).toBe(1);
  });

  it('the conversation on screen gets only the soft tick, is marked read and not counted', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    t.chat.activeConversationId.set('c-priya-ravi');
    const off = t.chat.registerViewer('reader', () => [t.chat.activeConversationId()]);
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.popups.popups()).toEqual([]);
    expect(t.ringtone.playSoft).toHaveBeenCalledTimes(1);
    expect(t.ringtone.playPing).not.toHaveBeenCalled();
    expect(hub.invoked.some(i => i.method === 'MarkConversationRead')).toBe(true);
    expect(t.chat.totalUnread()).toBe(0);
    off();
  });

  it('after LEAVING the messages page the last-open thread alerts and counts again', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    t.chat.activeConversationId.set('c-priya-ravi');   // sticky after navigation
    const off = t.chat.registerViewer('reader', () => [t.chat.activeConversationId()]);
    off();                                             // page destroyed
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.popups.popups().length).toBe(1);
    expect(t.chat.conversations().find(c => c.id === 'c-priya-ravi')!.unreadCount).toBe(1);
    expect(hub.invoked.some(i => i.method === 'MarkConversationRead')).toBe(false);
  });

  it('an open docked window suppresses the pop-up (soft tick only)', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    t.windows.openWindow('c-priya-ravi');
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.popups.popups()).toEqual([]);
    expect(t.ringtone.playSoft).toHaveBeenCalled();
  });

  it('hidden tab: the OS notification is the visual — no duplicate in-app pop-up', async () => {
    const t = setup({ hidden: true });
    t.signInAs(PRIYA);
    await t.chat.connect();
    FakeHub.last('/hubs/chat')!.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.notify.notify).toHaveBeenCalledTimes(1);
    expect(t.popups.popups()).toEqual([]);
  });

  it('several messages from one thread collapse into one card with a count', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI, 'one'));
    hub.emit('MessageReceived', msg('m2', 'c-priya-ravi', RAVI, 'two'));
    hub.emit('MessageReceived', msg('m3', 'c-priya-ravi', RAVI, 'three'));
    const cards = t.popups.popups();
    expect(cards.length).toBe(1);
    expect(cards[0].count).toBe(3);
    expect(cards[0].preview).toBe('three');
  });
});

describe('ChatService — read state + typing', () => {
  it('my own read on another tab zeroes the unread badge here', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.chat.totalUnread()).toBe(1);
    hub.emit('MessageRead', { conversationId: 'c-priya-ravi', userId: PRIYA.authId, readAt: '2026-09-27T10:06:00Z' });
    expect(t.chat.totalUnread()).toBe(0);
  });

  it('seeds Seen receipts from the server lastReadAt', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    t.api.get.mockImplementation(() => of([conv('c1', PRIYA.authId, RAVI, {
      participants: [
        { userId: PRIYA.authId, displayName: 'Priya Sharma', email: '' },
        { userId: RAVI, displayName: 'Ravi Kumar', email: '', lastReadAt: '2026-09-27T09:00:00Z' },
      ],
    })]));
    await t.chat.connect();
    expect(t.chat.readReceipts().get('c1')?.get(RAVI)).toBe('2026-09-27T09:00:00Z');
  });

  it('a message from someone clears their typing indicator', async () => {
    const t = setup();
    t.signInAs(PRIYA);
    await t.chat.connect();
    const hub = FakeHub.last('/hubs/chat')!;
    hub.emit('Typing', { conversationId: 'c-priya-ravi', fromUserId: RAVI, isTyping: true });
    expect(t.chat.typingByConversation().get('c-priya-ravi')?.has(RAVI)).toBe(true);
    hub.emit('MessageReceived', msg('m1', 'c-priya-ravi', RAVI));
    expect(t.chat.typingByConversation().has('c-priya-ravi')).toBe(false);
  });
});

describe('messagePreview', () => {
  it('is one line, never emoji', () => {
    expect(messagePreview({ body: 'a\n b ', attachmentUrl: null, attachmentMime: null, sharedRecordTitle: null })).toBe('a b');
    expect(messagePreview({ body: '', attachmentUrl: '/x', attachmentMime: 'audio/webm', sharedRecordTitle: null })).toBe('Voice note');
    expect(messagePreview({ body: '', attachmentUrl: '/x', attachmentMime: 'application/pdf', sharedRecordTitle: null })).toBe('Attachment');
  });
});
