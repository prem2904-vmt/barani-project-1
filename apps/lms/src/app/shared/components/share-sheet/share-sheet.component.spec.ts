import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ShareSheetComponent, buildDestinations } from './share-sheet.component';
import { ShareCardComponent } from '../share-card/share-card.component';
import { ShareService, ShareSheetRequest } from '../../../core/services/share.service';
import { ChatService } from '../../../core/services/chat.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/auth/auth.service';
import type { Conversation } from '../../models/chat.model';
import type { ShareCard } from '../../utils/share-card';

/** Share to Messages — the "Send to colleague" sheet + the ONE card. */
const ME = 'me';
const USERS = [
  { id: 'a1', displayName: 'Priya Nair', email: 'priya@lab.test', isActive: true },
  { id: 'a2', displayName: 'Karthik Iyer', email: 'karthik@lab.test', isActive: true },
  { id: 'a3', displayName: 'Old Staff', email: 'old@lab.test', isActive: false },
  { id: ME, displayName: 'Me Myself', email: 'me@lab.test', isActive: true },
];
const CONVS: Conversation[] = [
  { id: 'c1', isGroup: false, name: null, createdById: ME, lastMessageAt: '2026-10-31T10:00:00Z', unreadCount: 0, lastMessage: null,
    participants: [{ userId: ME, displayName: 'Me', email: '' }, { userId: 'a2', displayName: 'Karthik Iyer', email: 'karthik@lab.test' }] },
  { id: 'g1', isGroup: true, name: 'Haematology bench', createdById: ME, lastMessageAt: '2026-10-31T09:00:00Z', unreadCount: 0, lastMessage: null,
    participants: [{ userId: ME, displayName: 'Me', email: '' }, { userId: 'a1', displayName: 'Priya Nair', email: '' }, { userId: 'a2', displayName: 'Karthik Iyer', email: '' }] },
  { id: 'n1', isGroup: false, name: 'Notes', contextType: 'self', createdById: ME, lastMessageAt: '2026-10-31T11:00:00Z', unreadCount: 0, lastMessage: null,
    participants: [{ userId: ME, displayName: 'Me', email: '' }] },
];

describe('buildDestinations — recent chats, people, groups', () => {
  it('recent first (1:1 = the person), then people A–Z, then groups; never me, inactive or Notes to self; no duplicates', () => {
    const d = buildDestinations(USERS, CONVS, ME, '');
    expect(d.recent.map(x => x.key)).toEqual(['u:a2', 'c:g1']);
    expect(d.people.map(x => x.key)).toEqual(['u:a1']);
    expect(d.groups).toEqual([]);
    expect(d.recent[1].members).toEqual([{ id: 'a1', name: 'Priya Nair' }, { id: 'a2', name: 'Karthik Iyer' }]);
  });
  it('search matches names, emails and group members', () => {
    expect(buildDestinations(USERS, CONVS, ME, 'priya').recent.map(x => x.key)).toEqual(['c:g1']);
    expect(buildDestinations(USERS, CONVS, ME, 'priya').people.map(x => x.key)).toEqual(['u:a1']);
    expect(buildDestinations(USERS, CONVS, ME, 'karthik@').recent.map(x => x.key)).toEqual(['u:a2']);
    const none = buildDestinations(USERS, CONVS, ME, 'zzz');
    expect([...none.recent, ...none.people, ...none.groups]).toEqual([]);
  });
});

function setup(o: { fail?: string[] } = {}) {
  const sheet = signal<ShareSheetRequest | null>(null);
  const share = {
    sheet, available: () => true, opening: () => null,
    directory: vi.fn(async () => USERS),
    closeSheet: vi.fn(() => sheet.set(null)),
    shareTo: vi.fn(async (to: { toUserIds?: string[] }) => { if (o.fail?.includes(to.toUserIds![0])) throw new Error('nope'); return null; }),
    shareToConversation: vi.fn(async () => null),
    openCard: vi.fn(async () => true),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
  TestBed.configureTestingModule({
    imports: [ShareSheetComponent],
    providers: [
      { provide: ShareService, useValue: share },
      { provide: ChatService, useValue: { conversations: signal(CONVS), conversationsLoaded: () => true, loadConversations: vi.fn(async () => {}) } },
      { provide: ToastService, useValue: toasts },
      { provide: AuthService, useValue: { user: () => ({ id: 'u', authId: ME }) } },
    ],
  });
  const f = TestBed.createComponent(ShareSheetComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const open = async (req: ShareSheetRequest) => {
    sheet.set(req);
    for (let i = 0; i < 4; i++) { f.detectChanges(); await f.whenStable(); await new Promise(r => setTimeout(r, 0)); }
    f.detectChanges();
  };
  const row = (key: string) => el.querySelector(`.pf-ss__row[data-key="${key}"]`) as HTMLButtonElement;
  return { f, el, c: f.componentInstance as any, share, toasts, sheet, open, row };
}
afterEach(() => TestBed.resetTestingModule());

const REQ: ShareSheetRequest = { target: { type: 'result', id: 't1', meta: { parameter: 'hb' } }, title: 'Hb 4.2 g/dL', subtitle: 'CBC · sample 26105' };

describe('Send to colleague — the sheet', () => {
  it('closed until asked; then: what you send (the card) · who to · a note · Send = the ONE primary', async () => {
    const { el, open } = setup();
    expect(el.querySelector('.pf-ss')).toBeNull();
    await open(REQ);
    const dlg = el.querySelector('.pf-ss[role=dialog]')!;
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.querySelector('#pf-ss-t')!.textContent).toContain('Send to colleague');
    expect(dlg.querySelector('pf-share-card .pf-scard__t')!.textContent).toContain('Hb 4.2 g/dL');
    expect(dlg.querySelector('pf-share-card button')).toBeNull();          // a static preview
    expect([...dlg.querySelectorAll('.pf-ss__sec')].map(n => n.textContent)).toEqual(['Recent', 'People']);
    expect(dlg.querySelectorAll('.pf-btn--primary').length).toBe(1);
    expect((dlg.querySelector('.pf-ss__send') as HTMLButtonElement).disabled).toBe(true);
    // Rules: no native controls, SVG icons only.
    expect(dlg.querySelectorAll('select, datalist').length).toBe(0);
    expect(dlg.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('pick a person + a group, add a note with an @mention → one share per destination, caption carries @<authId>', async () => {
    const { el, f, open, row, share, toasts } = setup();
    await open(REQ);
    row('u:a1').click(); f.detectChanges();
    row('c:g1').click(); f.detectChanges();
    expect(row('u:a1').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.pf-ss__send')!.textContent).toContain('Send to 2');
    const ta = el.querySelector('#pf-ss-note') as HTMLTextAreaElement;
    ta.value = 'Please recheck @Pri'; ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.dispatchEvent(new Event('input')); f.detectChanges();
    const opts = [...el.querySelectorAll('.pf-ss__mention')].map(b => b.textContent!.trim());
    expect(opts.some(t => t.includes('Priya Nair'))).toBe(true);
    (el.querySelector('.pf-ss__mention') as HTMLButtonElement).click(); f.detectChanges();
    expect((f.componentInstance as any).caption()).toBe('Please recheck @Priya Nair ');
    (el.querySelector('.pf-ss__send') as HTMLButtonElement).click();
    await f.whenStable(); await new Promise(r => setTimeout(r, 0));
    const req = { type: 'result', id: 't1', meta: { parameter: 'hb' }, caption: 'Please recheck @a1', mentions: ['a1'] };
    expect(share.shareTo).toHaveBeenCalledWith({ toUserIds: ['a1'] }, req);
    expect(share.shareToConversation).toHaveBeenCalledWith('g1', req);
    expect(toasts.success).toHaveBeenCalledWith('Sent to 2 people');
    expect(share.closeSheet).toHaveBeenCalled();
  });

  it('only the people receiving the share can be @mentioned; a directory user who is not stays plain text', async () => {
    const { el, f, open, row, share } = setup();
    await open(REQ);
    row('u:a1').click(); f.detectChanges();
    (f.componentInstance as any).caption.set('cc @Karthik Iyer and @Priya Nair');
    (el.querySelector('.pf-ss__send') as HTMLButtonElement).click();
    await f.whenStable(); await new Promise(r => setTimeout(r, 0));
    expect(share.shareTo).toHaveBeenCalledWith({ toUserIds: ['a1'] },
      expect.objectContaining({ caption: 'cc @Karthik Iyer and @a1', mentions: ['a1'] }));
  });

  it('suggested people (the technician who entered it) are preselected and marked', async () => {
    const { el, open, row } = setup();
    await open({ ...REQ, heading: 'Ask the technician', suggest: [{ userId: null, name: 'karthik iyer' }] });
    expect(el.querySelector('#pf-ss-t')!.textContent).toContain('Ask the technician');
    expect(row('u:a2').getAttribute('aria-pressed')).toBe('true');
    expect(row('u:a2').querySelector('.pf-ss__sug')).not.toBeNull();
    expect(el.querySelector('.pf-ss__to')!.textContent).toContain('Karthik Iyer');
  });

  it('a partial failure keeps ONLY the failed destination picked (a retry never double-sends)', async () => {
    const { f, open, row, share, toasts, c } = setup({ fail: ['a2'] });
    await open(REQ);
    row('u:a1').click(); row('u:a2').click(); f.detectChanges();
    await c.send();
    expect(share.shareTo).toHaveBeenCalledTimes(2);
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't send to Karthik Iyer"));
    expect(c.picked().map((d: { key: string }) => d.key)).toEqual(['u:a2']);
    expect(share.closeSheet).not.toHaveBeenCalled();
  });

  it('Esc and the scrim close it', async () => {
    const { el, f, open, share } = setup();
    await open(REQ);
    el.querySelector('.pf-ss')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(share.closeSheet).toHaveBeenCalledTimes(1);
    await open(REQ);
    (el.querySelector('.pf-ss-scrim') as HTMLElement).click(); f.detectChanges();
    expect(share.closeSheet).toHaveBeenCalledTimes(2);
  });

  it('phones: a bottom sheet above the navbar with 44px targets and 16px inputs; reduced motion stops it moving', () => {
    const css = (ShareSheetComponent as any).ɵcmp.styles.join('\n') as string;
    const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
    expect(phone).toMatch(/bottom: var\(--pf-nav-h/);
    expect(phone).toMatch(/font-size: 16px;\s*min-height: 44px/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*animation: none/);
  });
});

describe('<pf-share-card> — the ONE card', () => {
  function card(c: ShareCard, preview = false) {
    const share = { opening: signal<string | null>(null), openCard: vi.fn(async () => true) };
    TestBed.configureTestingModule({ imports: [ShareCardComponent], providers: [{ provide: ShareService, useValue: share }] });
    const f = TestBed.createComponent(ShareCardComponent);
    f.componentRef.setInput('card', c);
    f.componentRef.setInput('preview', preview);
    f.componentRef.setInput('from', 'Priya');
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement, share };
  }

  it('eyebrow · title · subtitle · flag chip in words; a tap opens it through the resolver (with the sender)', () => {
    const c: ShareCard = { type: 'result', id: 't1', title: 'Hb 4.2 g/dL', subtitle: 'CBC · sample 26105', meta: { flag: 'critical_low' } };
    const { el, share } = card(c);
    expect(el.querySelector('.pf-scard__k')!.textContent).toBe('Result');
    expect(el.querySelector('.pf-scard__t')!.textContent).toBe('Hb 4.2 g/dL');
    expect(el.querySelector('.pf-scard__s')!.textContent).toBe('CBC · sample 26105');
    const chip = el.querySelector('.pf-scard__chip')!;
    expect(chip.textContent).toBe('Critical low');
    expect(chip.getAttribute('data-tone')).toBe('critical');
    const btn = el.querySelector('button.pf-scard') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Open result: Hb 4.2 g/dL, CBC · sample 26105');
    btn.click();
    expect(share.openCard).toHaveBeenCalledWith(c, 'Priya');
  });

  it('every type draws an SVG icon (never emoji); a preview is static', () => {
    for (const type of ['patient', 'order', 'sample', 'report', 'validation', 'analyzer', 'insights'] as const) {
      const { el } = card({ type, id: 'x', title: 'T', subtitle: '' }, true);
      expect(el.querySelector('button')).toBeNull();
      expect(el.querySelector('.pf-scard__icon svg path, .pf-scard__icon svg rect')).not.toBeNull();
      expect(el.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
      TestBed.resetTestingModule();
    }
  });
});
