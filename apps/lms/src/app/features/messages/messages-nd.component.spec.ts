import { NO_ERRORS_SCHEMA, computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MessagesNdComponent } from './messages-nd.component';
import { MessagesRouteComponent } from './messages-route.component';
import { ChatService } from '../../core/services/chat.service';
import { SignalingService } from '../../core/services/signaling.service';
import { WebrtcService } from '../../core/services/webrtc.service';
import { AuthService } from '../../core/auth/auth.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { PresenceService } from '../../core/services/presence.service';
import { ApiService } from '../../core/services/api.service';
import { ToastService } from '../../core/services/toast.service';
import { ChatNotifyService } from '../../core/services/chat-notify.service';
import { RingtoneService } from '../../core/services/ringtone.service';
import { KeyboardService } from '../../core/services/keyboard.service';
import { NavBackService } from '../../core/services/nav-back.service';
import { ThemeService } from '../../core/services/theme.service';
import { ChatMessage, Conversation } from '../../shared/models/chat.model';

/**
 * MESSAGES — new design (ND-PATTERN §17). The page's own template renders
 * (the hero band is an unknown element, so its projected pill + actions
 * stay in the DOM where the spec can reach them). Services are fakes with
 * the same signal surface the page reads.
 */
const ME = 'me-1';
const today = new Date();
const iso = (minsAgo: number, daysAgo = 0) => {
  const d = new Date(today); d.setDate(d.getDate() - daysAgo); d.setMinutes(d.getMinutes() - minsAgo);
  return d.toISOString();
};

const CONVS: Conversation[] = [
  {
    id: 'c1', isGroup: false, name: null, createdById: ME, lastMessageAt: iso(5), unreadCount: 3,
    participants: [
      { userId: ME, displayName: 'Anita Rao', email: 'anita@lab.test' },
      { userId: 'u2', displayName: 'Dr. Meenakshi Sundaravadivelu Ramanathan', email: 'meena@lab.test' },
    ],
    lastMessage: { id: 'm3', fromUserId: 'u2', body: '', sentAt: iso(5) },
  },
  {
    id: 'c2', isGroup: true, name: 'Haematology bench', createdById: ME, lastMessageAt: iso(30, 1), unreadCount: 0,
    participants: [
      { userId: ME, displayName: 'Anita Rao', email: 'anita@lab.test' },
      { userId: 'u3', displayName: 'Karthik Iyer', email: 'karthik@lab.test' },
      { userId: 'u4', displayName: 'Priya Das', email: 'priya@lab.test' },
    ],
    lastMessage: { id: 'g1', fromUserId: ME, body: 'CBC reruns are on the rack', sentAt: iso(30, 1) },
  },
];

const MSGS: ChatMessage[] = [
  { id: 'm1', conversationId: 'c1', fromUserId: 'u2', body: 'Is sample 26117 ready?', sentAt: iso(60, 1), kind: 'user' },
  { id: 'm2', conversationId: 'c1', fromUserId: ME, body: 'Yes, validated.', sentAt: iso(10), kind: 'user' },
  { id: 'm3', conversationId: 'c1', fromUserId: 'u2', body: '', sentAt: iso(5), kind: 'user',
    attachmentUrl: '/uploads/a.webm', attachmentName: 'voice-7s.webm', attachmentMime: 'audio/webm', attachmentSize: 2048 },
];

class FakeRecorder {
  static isTypeSupported() { return true; }
  mimeType = 'audio/webm';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() { /* recording */ }
  stop() { this.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) }); this.onstop?.(); }
}

function setup(opts: { narrow?: boolean; deepLink?: string } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: (q.includes('900px') || q.includes('640px')) ? !!opts.narrow : false,
    addEventListener() {}, removeEventListener() {},
  });
  const conversations = signal<Conversation[]>(structuredClone(CONVS));
  const activeConversationId = signal<string | null>(null);
  const activeMessages = signal<ChatMessage[]>([]);
  const loadingHistory = signal(false);
  const readReceipts = signal(new Map<string, Map<string, string>>());
  const chat = {
    isConnected: signal(true),
    conversations, activeConversationId, activeMessages, loadingHistory, readReceipts,
    loadingOlder: signal(false),
    hasMoreHistory: signal(false),
    typingByConversation: signal(new Map<string, Set<string>>()),
    activeConversation: computed(() => conversations().find(c => c.id === activeConversationId()) ?? null),
    totalUnread: computed(() => conversations().reduce((n, c) => n + c.unreadCount, 0)),
    connect: vi.fn(async () => {}),
    loadConversations: vi.fn(async () => {}),
    openConversation: vi.fn(async (id: string) => {
      activeConversationId.set(id);
      loadingHistory.set(true);
      activeMessages.set([]);
      await Promise.resolve();
      activeMessages.set(MSGS.filter(m => m.conversationId === id));
      loadingHistory.set(false);
    }),
    closeConversation: vi.fn(() => { activeConversationId.set(null); activeMessages.set([]); }),
    getPinned: vi.fn(async () => []),
    sendMessage: vi.fn(async () => {}),
    uploadAttachment: vi.fn(async (f: File) => ({ url: '/uploads/v.webm', name: f.name, contentType: f.type, size: f.size })),
    openDirectConversation: vi.fn(async () => 'c9'),
    setTyping: vi.fn(async () => {}),
    openNotesToSelf: vi.fn(async () => 'n1'),
    // The page registers itself as the surface showing the active thread.
    registerViewer: vi.fn(() => () => undefined),
  };
  const api = { get: vi.fn((url: string) => of(url.startsWith('/api/directory/users') ? [
    { id: 'u5', displayName: 'Meera Nair', email: 'meera@lab.test', isActive: true },
    { id: 'u2', displayName: 'Dr. Meenakshi Sundaravadivelu Ramanathan', email: 'meena@lab.test', isActive: true },
  ] : [])) };
  const navBack = { registerBackInterceptor: vi.fn(), clearBackInterceptor: vi.fn(), showBack: signal(true), back: vi.fn() };
  TestBed.configureTestingModule({
    imports: [MessagesNdComponent],
    providers: [
      { provide: ChatService, useValue: chat },
      { provide: SignalingService, useValue: {
        isConnected: signal(true), connect: vi.fn(async () => {}), getOnlineUsersWithStatus: vi.fn(async () => {}),
        userPresences: signal(new Map([['u2', 'active']])), onlineUserIds: signal(new Set(['u2'])),
      } },
      { provide: WebrtcService, useValue: { inCall: signal(false), startCall: vi.fn(async () => 'r1'), startGroupCall: vi.fn(async () => 'r2') } },
      { provide: AuthService, useValue: { user: () => ({ id: 'user-1', authId: ME }) } },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => true } },
      { provide: PresenceService, useValue: { statusFor: () => null, displayStatus: (id: string | null) => (id ? 'active' : null) } },
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { info: vi.fn(), error: vi.fn(), success: vi.fn() } },
      { provide: ChatNotifyService, useValue: { ensurePermission: vi.fn(async () => {}) } },
      { provide: RingtoneService, useValue: { muted: signal(false), toggleMute: vi.fn() } },
      { provide: KeyboardService, useValue: { visible: signal(false), reset: vi.fn() } },
      { provide: NavBackService, useValue: navBack },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(opts.deepLink ? { c: opts.deepLink } : {}) } } },
    ],
  });
  TestBed.overrideComponent(MessagesNdComponent, {
    set: { imports: [CommonModule, FormsModule], schemas: [NO_ERRORS_SCHEMA] },
  });
  const f = TestBed.createComponent(MessagesNdComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  return { f, el, c, chat, api, navBack };
}

const flush = () => new Promise(r => setTimeout(r, 0));
async function settle(f: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 4; i++) { f.detectChanges(); await f.whenStable(); await flush(); }
  f.detectChanges();
}
const q = <T extends Element = HTMLElement>(el: Element, s: string) => el.querySelector(s) as T | null;
const qa = <T extends Element = HTMLElement>(el: Element, s: string) => Array.from(el.querySelectorAll(s)) as T[];
const rows = (el: HTMLElement) => qa(el, '.pf-mnd-side .pf-mnd-rows > li > .pf-mnd-row');

// An in-memory Storage (the runner's own localStorage may be missing).
beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)); },
    removeItem: (k: string) => { mem.delete(k); },
    clear: () => mem.clear(),
  });
});
afterEach(() => {
  document.documentElement.classList.remove('pf-chat-immersive');
  vi.unstubAllGlobals();
});

describe('Messages — new design (ND-PATTERN §17)', () => {
  it('band: back + actions (New chat is secondary) and the pill is the search', async () => {
    const { f, el } = setup();
    await settle(f);
    const band = q(el, 'pf-hero-band')!;
    expect(band).toBeTruthy();
    const input = q<HTMLInputElement>(band, '[band-search] input')!;
    expect(input.placeholder).toBe('Search conversations and people');
    const newChat = q(band, 'button[aria-label="New chat"]')!;
    expect(newChat.className).toContain('pf-hb-btn--ghost');
    expect(newChat.className).not.toContain('--primary');
  });

  it('pill filter: All / Unread / Groups / Calls as ONE radio group; Unread + Groups filter the list', async () => {
    const { f, el } = setup();
    await settle(f);
    const radios = qa<HTMLButtonElement>(el, '[role="radiogroup"].pf-mnd-filter [role="radio"]');
    expect(radios.map(r => r.textContent!.replace(/\d+/g, '').trim())).toEqual(['All', 'Unread', 'Groups', 'Calls']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(rows(el).length).toBe(2);
    radios[1].click(); await settle(f);
    expect(rows(el).map(r => r.querySelector('.pf-mnd-row__name')!.textContent!.trim()))
      .toEqual(['Dr. Meenakshi Sundaravadivelu Ramanathan']);
    radios[2].click(); await settle(f);
    expect(rows(el).map(r => r.querySelector('.pf-mnd-row__name')!.textContent!.trim())).toEqual(['Haematology bench']);
    radios[3].click(); await settle(f);
    expect(q(el, '.pf-mnd-side .nd-card__label')!.textContent!.trim()).toBe('Calls');
  });

  it('pill search matches conversations by participant AND lists people to message', async () => {
    const { f, el, c, api, chat } = setup();
    await settle(f);
    c.onBandSearch('karthik'); await settle(f);
    expect(rows(el).map(r => r.querySelector('.pf-mnd-row__name')!.textContent!.trim())).toEqual(['Haematology bench']);
    c.onBandSearch('mee'); await settle(f);
    expect(api.get).toHaveBeenCalledWith('/api/directory/users');
    // Meenakshi already has a 1:1 → only the conversation; Meera is a person.
    const people = qa(el, '.pf-mnd-section + .pf-mnd-rows .pf-mnd-row');
    expect(people.map(p => p.querySelector('.pf-mnd-row__name')!.textContent!.trim())).toEqual(['Meera Nair']);
    people[0].click(); await settle(f);
    expect(chat.openDirectConversation).toHaveBeenCalledWith('u5');
  });

  it('CONVERSATIONS is the LEFT card with the BILLING header; it collapses to a strip (remembered)', async () => {
    const { f, el } = setup();
    await settle(f);
    const panels = q(el, '.pf-mnd-panels')!;
    const kids = Array.from(panels.children);
    expect(kids[0].matches('aside.nd-card.pf-mnd-side')).toBe(true);
    expect(kids[1].matches('section.nd-card.pf-mnd-thread')).toBe(true);
    const head = q(kids[0], '.nd-card__head')!;
    expect(q(head, '.nd-card__icon svg')).toBeTruthy();
    expect(q(head, '.nd-card__label')!.textContent!.trim()).toBe('Conversations');
    (q<HTMLButtonElement>(head, 'button[aria-label="Hide conversations"]')!).click();
    await settle(f);
    expect(q(el, '.pf-mnd-side')).toBeNull();
    expect(q(el, '.pf-mnd-strip')).toBeTruthy();
    expect(localStorage.getItem('pf:msgs:list-collapsed:user-1')).toBe('1');
    (q<HTMLButtonElement>(el, '.pf-mnd-strip__btn')!).click();
    await settle(f);
    expect(q(el, '.pf-mnd-side')).toBeTruthy();
  });

  it('rows: full name (no cut), tabular time, SVG kind icon, unread = neutral chip + violet dot', async () => {
    const { f, el } = setup();
    await settle(f);
    const [r1, r2] = rows(el);
    expect(r1.querySelector('.pf-mnd-row__name')!.textContent!.trim()).toBe('Dr. Meenakshi Sundaravadivelu Ramanathan');
    expect(r1.querySelector('time.pf-mnd-row__time.nd-num')).toBeTruthy();
    expect(r1.querySelector('.pf-mnd-row__kind')!.tagName.toLowerCase()).toBe('svg');
    expect(r1.querySelector('.pf-mnd-row__pv')!.textContent!.trim()).toBe('Attachment');
    const unread = r1.querySelector('.pf-mnd-unread')!;
    expect(unread.textContent!.trim()).toBe('3');
    expect(unread.querySelector('.pf-mnd-unread__dot')).toBeTruthy();
    expect(r2.querySelector('.pf-mnd-unread')).toBeNull();
    expect(r2.querySelector('.pf-mnd-row__pv')!.textContent!.trim()).toBe('You: CBC reruns are on the rack');
  });

  it('thread: header name + status + quiet call; bubbles mine/theirs; date separator; violet seen check', async () => {
    const { f, el, chat } = setup();
    await settle(f);
    chat.readReceipts.set(new Map([['c1', new Map([['u2', iso(1)]])]]));
    rows(el)[0].click();
    await settle(f);
    expect(rows(el)[0].getAttribute('aria-pressed')).toBe('true');
    const thread = q(el, 'section.pf-mnd-thread')!;
    expect(q(thread, '.pf-mnd-thread__name')!.textContent!.trim()).toBe('Dr. Meenakshi Sundaravadivelu Ramanathan');
    expect(q(thread, '.pf-mnd-thread__status')!.textContent!).toContain('Online');
    const call = q<HTMLButtonElement>(thread, '.pf-mnd-thread__acts button[aria-label="Voice call"]')!;
    expect(call.className).toContain('pf-mnd-qbtn');
    expect(qa(thread, '.pf-mnd-day').length).toBeGreaterThanOrEqual(2);   // yesterday + today
    expect(qa(thread, '.pf-mnd-bubble--mine').length).toBe(1);
    expect(qa(thread, '.pf-mnd-bubble:not(.pf-mnd-bubble--mine)').length).toBe(2);
    expect(q(thread, '.pf-mnd-bubble--mine .pf-mnd-tick--seen')).toBeTruthy();
    // The voice note is a kit player (not native controls).
    expect(q(thread, '.pf-mnd-voice .pf-mnd-voice__play')).toBeTruthy();
    expect(q(thread, 'audio[controls]')).toBeNull();
    expect(q(thread, '.pf-mnd-voice__t')!.textContent!.trim()).toBe('0:07');
    // History never animates in.
    expect(qa(thread, '.pf-mnd-msg--fresh').length).toBe(0);
  });

  it('a NEW message fades + slides in; history stays still', async () => {
    const { f, el, chat } = setup();
    await settle(f);
    rows(el)[0].click(); await settle(f);
    chat.activeMessages.update(l => [...l, { id: 'm4', conversationId: 'c1', fromUserId: 'u2', body: 'Thanks', sentAt: new Date().toISOString(), kind: 'user' }]);
    await settle(f);
    const fresh = qa(el, '.pf-mnd-msg--fresh');
    expect(fresh.length).toBe(1);
    expect(fresh[0].textContent).toContain('Thanks');
  });

  it('composer: attach is a quiet icon, the mic sits INSIDE the field, Send is the ONE primary; Enter sends', async () => {
    const { f, el, c, chat } = setup();
    await settle(f);
    rows(el)[0].click(); await settle(f);
    const composer = q(el, '.pf-mnd-composer')!;
    const field = q(composer, '.pf-mnd-field')!;
    expect(q(field, 'textarea')).toBeTruthy();
    expect(q(field, 'button[aria-label="Record a voice message"]')).toBeTruthy();
    expect(q(composer, '.pf-mnd-attach button[aria-label="Attach"]')!.className).toContain('pf-mnd-qbtn');
    expect(qa(el, '.nd-btn--primary, .pf-hb-btn--primary').length).toBe(1);
    const send = q<HTMLButtonElement>(composer, 'button.nd-btn--primary[aria-label="Send"]')!;
    expect(send).toBeTruthy();
    expect(send.disabled).toBe(true);
    const ta = q<HTMLTextAreaElement>(field, 'textarea')!;
    ta.value = 'On my way'; ta.dispatchEvent(new Event('input'));
    await settle(f);
    expect(send.disabled).toBe(false);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle(f);
    expect(chat.sendMessage).toHaveBeenCalledWith('c1', 'On my way', null, null);
    expect(c.draft()).toBe('');
  });

  it('voice note: record → stop gives a PREVIEW (nothing sent) → Enter sends it', async () => {
    const { f, el, chat } = setup();
    (window as any).MediaRecorder = FakeRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop() {} }] })) },
    });
    (URL as any).createObjectURL = vi.fn(() => 'blob:voice');
    (URL as any).revokeObjectURL = vi.fn();
    await settle(f);
    rows(el)[0].click(); await settle(f);
    (q<HTMLButtonElement>(el, '.pf-mnd-field button[aria-label="Record a voice message"]')!).click();
    await settle(f);
    expect(q(el, '.pf-mnd-field.is-rec')).toBeTruthy();
    expect(q<HTMLTextAreaElement>(el, '.pf-mnd-field textarea')!.hidden).toBe(true);
    (q<HTMLButtonElement>(el, '.pf-mnd-field button[aria-label="Stop recording"]')!).click();
    await settle(f);
    expect(q(el, '.pf-mnd-field.is-draft')).toBeTruthy();
    expect(q(el, '.pf-mnd-field button[aria-label="Play"]')).toBeTruthy();
    expect(chat.uploadAttachment).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    q(el, '.pf-mnd-field')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle(f);
    expect(chat.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(chat.sendMessage).toHaveBeenCalledWith('c1', '', null, expect.objectContaining({ contentType: 'audio/webm' }));
    expect(q(el, '.pf-mnd-field.is-draft')).toBeNull();
  });

  it('no emoji anywhere in the chrome (SVG icons only)', async () => {
    const { f, el } = setup();
    await settle(f);
    rows(el)[0].click(); await settle(f);
    expect(/\p{Extended_Pictographic}/u.test(el.textContent ?? '')).toBe(false);
  });

  it('the navbar is never hidden: no html.pf-chat-immersive, even in a phone thread', async () => {
    const { f, el } = setup({ narrow: true });
    await settle(f);
    rows(el)[0].click(); await settle(f);
    expect(q(el, 'section.pf-mnd-thread')).toBeTruthy();
    expect(document.documentElement.classList.contains('pf-chat-immersive')).toBe(false);
  });

  it('phone: the list fills the screen; a tap PUSHES the thread (slide); the band back pops it', async () => {
    const { f, el, c, chat, navBack } = setup({ narrow: true });
    await settle(f);
    expect(q(el, '.pf-mnd-panels--narrow')).toBeTruthy();
    expect(q(el, 'aside.pf-mnd-side')).toBeTruthy();
    expect(q(el, 'section.pf-mnd-thread')).toBeNull();
    expect(q(el, 'button[aria-label="Hide conversations"]')).toBeNull();   // no collapse on phones
    rows(el)[0].click(); await settle(f);
    expect(q(el, 'aside.pf-mnd-side')).toBeNull();
    const thread = q(el, 'section.pf-mnd-thread')!;
    expect(thread.classList.contains('pf-mnd-push--forward')).toBe(true);
    // The swipe-back interceptor is live while the thread is open.
    expect(navBack.registerBackInterceptor).toHaveBeenCalled();
    // The pill becomes the search IN this conversation; no list filters.
    expect(q<HTMLInputElement>(el, '[band-search] input')!.placeholder).toContain('Search in Dr. Meenakshi');
    expect(q(el, '.pf-mnd-filter')).toBeNull();
    // Band back chevron → pops the thread, the list slides back.
    const back = c.bandBack();
    expect(typeof back).toBe('function');
    back(); await settle(f);
    expect(chat.closeConversation).toHaveBeenCalled();
    expect(q(el, 'section.pf-mnd-thread')).toBeNull();
    expect(q(el, 'aside.pf-mnd-side')!.classList.contains('pf-mnd-push--back')).toBe(true);
    expect(c.bandBack()).toBeNull();
  });

  it('deep link ?c= opens the thread directly (no slide)', async () => {
    const { f, el, chat } = setup({ narrow: true, deepLink: 'c2' });
    await settle(f);
    expect(chat.openConversation).toHaveBeenCalledWith('c2');
    const thread = q(el, 'section.pf-mnd-thread')!;
    expect(thread).toBeTruthy();
    expect(thread.classList.contains('pf-mnd-push--forward')).toBe(false);
    expect(q(thread, '.pf-mnd-thread__name')!.textContent!.trim()).toBe('Haematology bench');
  });
});

describe('Messages route', () => {
  it('renders the nd screen in the new design and the classic page otherwise', () => {
    const design = signal(true);
    TestBed.configureTestingModule({
      imports: [MessagesRouteComponent],
      providers: [{ provide: ThemeService, useValue: { isNewDesign: () => design() } }],
    });
    TestBed.overrideComponent(MessagesRouteComponent, { set: { imports: [], schemas: [NO_ERRORS_SCHEMA] } });
    const f = TestBed.createComponent(MessagesRouteComponent);
    f.detectChanges();
    expect(f.nativeElement.querySelector('pf-messages-nd')).toBeTruthy();
    expect(f.nativeElement.querySelector('app-messages-page')).toBeNull();
    design.set(false); f.detectChanges();
    expect(f.nativeElement.querySelector('pf-messages-nd')).toBeNull();
    expect(f.nativeElement.querySelector('app-messages-page')).toBeTruthy();
  });
});
