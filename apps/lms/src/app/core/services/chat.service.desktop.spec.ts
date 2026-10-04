import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { RingtoneService } from './ringtone.service';
import { ChatNotifyService } from './chat-notify.service';
import { PlatformService } from './platform.service';
import { ChatPopupService } from './chat-popup.service';
import { ToastService } from './toast.service';
import { PresenceService } from './presence.service';
import { HUB_FACTORY } from './hub-factory';
import { FakeHub, fakeHubFactory } from './fake-hub.testing';
import { DesktopNotifyService, resetDesktopWindowForTests } from './desktop-notify.service';
import type { DesktopWindowState } from './desktop-notify.policy';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';

/**
 * Desktop app (Electron): background throttling is off, so the page ALWAYS
 * says 'visible'. Before this, a message for the open thread while the app sat
 * in the tray was marked read with only a soft tick, and nothing native ever
 * showed. Now the main window's real state decides.
 */
const ME = { id: 'app-priya', authId: 'sub-priya', tenantId: 't1', displayName: 'Priya Sharma', email: '' };
const RAVI = 'sub-ravi';
const conv = (id: string, extra: Partial<Conversation> = {}): Conversation => ({
  id, isGroup: false, name: null, createdById: ME.authId, lastMessageAt: '2026-09-27T10:00:00Z', unreadCount: 0,
  participants: [
    { userId: ME.authId, displayName: 'Priya Sharma', email: '' },
    { userId: RAVI, displayName: 'Ravi Kumar', email: '' },
  ],
  lastMessage: null, ...extra,
});
const msg = (id: string, conversationId: string, body = 'hello'): ChatMessage =>
  ({ id, conversationId, fromUserId: RAVI, body, sentAt: '2026-09-27T10:05:00Z', kind: 'user' });

const FRONT: DesktopWindowState = { focused: true, visible: true, minimized: false };
const TRAY: DesktopWindowState = { focused: false, visible: false, minimized: false };
const BEHIND: DesktopWindowState = { focused: false, visible: true, minimized: false };

async function setup() {
  FakeHub.reset();
  resetDesktopWindowForTests();
  let pushState: (s: DesktopWindowState) => void = () => undefined;
  const bridge = {
    getSettings: vi.fn(async () => null),
    setSettings: vi.fn(async () => null),
    alert: vi.fn(),
    badge: vi.fn(),
    getWindowState: vi.fn(async () => null),
    onWindowState: vi.fn((cb: (s: DesktopWindowState) => void) => { pushState = cb; return () => undefined; }),
    onResume: vi.fn(() => () => undefined),
    onAction: vi.fn(() => () => undefined),
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = { isElectron: true, notify: bridge };

  const user = signal<typeof ME | null>(null);
  const auth = { user, getAccessToken: async () => (user() ? `jwt-${user()!.authId}` : null) };
  const lists = [conv('c-ravi'), conv('c-other', { participants: [
    { userId: ME.authId, displayName: 'Priya Sharma', email: '' },
    { userId: 'sub-x', displayName: 'X', email: '' },
  ] })];
  const api = { get: vi.fn((url: string) => of(url.includes('/conversations') ? lists : [])), post: vi.fn(() => of({})) };
  const ringtone = { playPing: vi.fn(), playSoft: vi.fn(), muted: signal(false) };
  const notify = { notify: vi.fn(() => false), notifyDesktop: vi.fn(() => true), restore: vi.fn(), notifyBusiness: vi.fn() };
  const presence = { myStatusIsDnd: signal(false) };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: auth },
      { provide: ApiService, useValue: api },
      { provide: RingtoneService, useValue: ringtone },
      { provide: ChatNotifyService, useValue: notify },
      { provide: PlatformService, useValue: { isCapacitor: signal(false), isElectron: signal(true) } },
      { provide: PresenceService, useValue: presence },
      { provide: HUB_FACTORY, useValue: fakeHubFactory },
    ],
  });
  const chat = TestBed.inject(ChatService);
  const desktop = TestBed.inject(DesktopNotifyService);
  const popups = TestBed.inject(ChatPopupService);
  const toasts = TestBed.inject(ToastService);
  const toastInfo = vi.spyOn(toasts, 'info');
  TestBed.inject(SessionScopeService).changed({ userId: ME.id, tenantId: ME.tenantId, authId: ME.authId });
  user.set(ME);
  await chat.connect();
  const hub = FakeHub.last('/hubs/chat')!;
  const openThread = () => {
    chat.activeConversationId.set('c-ravi');
    return chat.registerViewer('reader', () => [chat.activeConversationId()]);
  };
  return { chat, desktop, popups, toastInfo, hub, bridge, ringtone, notify, presence, openThread, state: (s: DesktopWindowState) => pushState(s) };
}

describe('ChatService — desktop app notifications', () => {
  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    resetDesktopWindowForTests();
    vi.useRealTimers();
  });

  it('thread open but the window is in the tray → native notification, NOT marked read, counted', async () => {
    const t = await setup();
    const off = t.openThread();
    t.state(TRAY);
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi', 'Sample 26117 is haemolysed'));
    expect(t.notify.notifyDesktop).toHaveBeenCalledWith('Ravi Kumar', 'Sample 26117 is haemolysed', 'c-ravi');
    expect(t.ringtone.playPing).toHaveBeenCalledTimes(1);
    expect(t.popups.popups()).toEqual([]);
    expect(t.hub.invoked.some(i => i.method === 'MarkConversationRead')).toBe(false);
    expect(t.chat.totalUnread()).toBe(1);
    off();
  });

  it('thread open, window behind another app → native (they are not looking), but still on screen for reads', async () => {
    const t = await setup();
    const off = t.openThread();
    t.state(BEHIND);
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    expect(t.notify.notifyDesktop).toHaveBeenCalledTimes(1);
    off();
  });

  it('reading the thread in the app → soft tick only, marked read', async () => {
    const t = await setup();
    const off = t.openThread();
    t.state(FRONT);
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    expect(t.ringtone.playSoft).toHaveBeenCalledTimes(1);
    expect(t.notify.notifyDesktop).not.toHaveBeenCalled();
    expect(t.popups.popups()).toEqual([]);
    expect(t.hub.invoked.some(i => i.method === 'MarkConversationRead')).toBe(true);
    off();
  });

  it('in the app on another screen → in-app pop-up, no native duplicate', async () => {
    const t = await setup();
    t.state(FRONT);
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    expect(t.popups.popups().length).toBe(1);
    expect(t.notify.notifyDesktop).not.toHaveBeenCalled();
  });

  it('Messages off / Do-not-disturb / muted → nothing native and no sound', async () => {
    const t = await setup();
    t.state(TRAY);
    t.desktop.settings.update(s => ({ ...s, messages: false }));
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    t.desktop.settings.update(s => ({ ...s, messages: true }));
    t.presence.myStatusIsDnd.set(true);
    t.hub.emit('MessageReceived', msg('m2', 'c-ravi'));
    t.presence.myStatusIsDnd.set(false);
    t.chat.conversations.update(l => l.map(c => c.id === 'c-ravi' ? { ...c, isMuted: true } : c));
    t.hub.emit('MessageReceived', msg('m3', 'c-ravi'));
    expect(t.notify.notifyDesktop).not.toHaveBeenCalled();
    expect(t.ringtone.playPing).not.toHaveBeenCalled();
    expect(t.popups.popups()).toEqual([]);
  });

  it('Sound off keeps the native notification but plays nothing', async () => {
    const t = await setup();
    t.state(TRAY);
    t.desktop.settings.update(s => ({ ...s, sound: false }));
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    expect(t.notify.notifyDesktop).toHaveBeenCalledTimes(1);
    expect(t.ringtone.playPing).not.toHaveBeenCalled();
  });

  it('bell event: away → native with its reference; in front → toast; Alerts off → none; critical beats DND', async () => {
    const t = await setup();
    const ev = { kind: 'report_ready', title: 'Report ready', body: 'Order 1042', referenceType: 'report', referenceId: 'r1', critical: false };
    t.state(TRAY);
    t.hub.emit('BusinessNotification', ev);
    expect(t.bridge.alert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'report_ready', referenceType: 'report', referenceId: 'r1' }));
    t.state(FRONT);
    t.hub.emit('BusinessNotification', ev);
    expect(t.toastInfo).toHaveBeenCalledWith('Report ready — Order 1042');
    t.state(TRAY);
    t.desktop.settings.update(s => ({ ...s, alerts: false }));
    t.hub.emit('BusinessNotification', ev);
    expect(t.bridge.alert).toHaveBeenCalledTimes(1);
    t.desktop.settings.update(s => ({ ...s, alerts: true }));
    t.presence.myStatusIsDnd.set(true);
    t.hub.emit('BusinessNotification', ev);
    expect(t.bridge.alert).toHaveBeenCalledTimes(1);
    t.hub.emit('BusinessNotification', { ...ev, kind: 'critical_value', critical: true });
    expect(t.bridge.alert).toHaveBeenCalledTimes(2);
    expect(t.notify.notifyBusiness).not.toHaveBeenCalled();   // the web path is not used on desktop
  });

  it('unread chats (muted excluded) reach the dock / taskbar badge', async () => {
    const t = await setup();
    t.state(TRAY);
    t.hub.emit('MessageReceived', msg('m1', 'c-ravi'));
    t.hub.emit('MessageReceived', { ...msg('m2', 'c-other'), fromUserId: 'sub-x' });
    t.chat.conversations.update(l => l.map(c => c.id === 'c-other' ? { ...c, isMuted: true } : c));
    TestBed.tick();
    await new Promise(r => setTimeout(r, 300));
    // The muted conversation's unread is left out (the on-device history
    // store may carry earlier tests' rows for c-ravi, so compare to its count).
    const ravi = t.chat.conversations().find(c => c.id === 'c-ravi')!.unreadCount;
    expect(ravi).toBeGreaterThan(0);
    expect(t.bridge.badge).toHaveBeenLastCalledWith({ chat: ravi, bell: 0 });
  });
});
