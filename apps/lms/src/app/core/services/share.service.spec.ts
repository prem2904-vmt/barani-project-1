import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ShareService, endpointMissing, openParams, readResolve, wireId } from './share.service';
import { ApiService } from './api.service';
import { DialogService } from './dialog.service';
import { ToastService } from './toast.service';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { BranchSwitchService } from './branch-switch.service';
import { ChatService } from './chat.service';
import { AuthService } from '../auth/auth.service';
import { ApiError } from '../../shared/models/api-response.model';

/** Share to Messages — every share / card call lives in ShareService (the
 *  contract with prefrontal-mw is pinned here). */
const G = '0b8a1c2d-1111-4222-8333-944455556666';
const missing = () => ApiError.from(new HttpErrorResponse({ status: 404, statusText: 'Not Found', url: '/x' }));

function setup(o: { messages?: boolean; branches?: Array<{ id: string; name: string }>; switchOk?: boolean } = {}) {
  const api = { get: vi.fn(), post: vi.fn() };
  const router = {
    navigateByUrl: vi.fn(async () => true),
    createUrlTree: vi.fn((cmds: unknown[], extras: { queryParams?: Record<string, string> }) => ({ cmds, qp: extras?.queryParams })),
  };
  const dialog = { alert: vi.fn(async () => undefined), confirm: vi.fn(async () => true) };
  const toasts = { info: vi.fn(), error: vi.fn(), success: vi.fn() };
  const branchSwitch = { switchTo: vi.fn(async () => o.switchOk ?? true) };
  const chat = { sendMessage: vi.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: Router, useValue: router },
      { provide: DialogService, useValue: dialog },
      { provide: ToastService, useValue: toasts },
      { provide: BranchSwitchService, useValue: branchSwitch },
      { provide: ChatService, useValue: chat },
      { provide: TenantEntitlementsService, useValue: { moduleEnabled: () => o.messages !== false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', branches: o.branches ?? [] }) } },
    ],
  });
  return { svc: TestBed.inject(ShareService), api, router, dialog, toasts, branchSwitch, chat };
}
afterEach(() => TestBed.resetTestingModule());

describe('ShareService — wire helpers', () => {
  it('readResolve: ok route / none / other_branch; anything not an in-app path is "none"', () => {
    expect(readResolve({ access: 'ok', route: '/o/1', queryParams: { a: 1, b: null } as never, label: 'Open order' }))
      .toEqual({ kind: 'open', route: '/o/1', queryParams: { a: '1' }, label: 'Open order' });
    expect(readResolve({ access: 'none' })).toEqual({ kind: 'none' });
    expect(readResolve({ access: 'other_branch', branchId: 'b2', branchName: 'Salem', canSwitch: true }))
      .toEqual({ kind: 'other_branch', branchId: 'b2', branchName: 'Salem', canSwitch: true });
    expect(readResolve({ access: 'ok', route: 'https://evil.test' })).toEqual({ kind: 'none' });
    expect(readResolve(null)).toEqual({ kind: 'none' });
  });
  it('an ORDER card always opens the order itself (?view=detail), never the scan-to-collect landing', () => {
    expect(openParams({ type: 'order' }, '/o/1')).toEqual({ view: 'detail' });
    expect(openParams({ type: 'order' }, '/o/1', { view: 'x' })).toEqual({ view: 'x' });
    expect(openParams({ type: 'patient' }, '/p/1')).toEqual({});
  });
  it('an Insights card sends its dashboard id only (a built-in section rides in meta)', () => {
    expect(wireId({ type: 'insights', id: 'overview' })).toBeNull();
    expect(wireId({ type: 'insights', id: G })).toBe(G);
    expect(wireId({ type: 'order', id: 'o1' })).toBe('o1');
  });
  it('"endpoint missing" = an EMPTY 404 only; a coded not_found is a real answer', () => {
    expect(endpointMissing(missing())).toBe(true);
    expect(endpointMissing(new ApiError('Record not found.', 'not_found'))).toBe(false);
    expect(endpointMissing(new ApiError('nope', 'forbidden'))).toBe(false);
  });
});

describe('ShareService — sending', () => {
  it('POST /conversations/{id}/share {type, id, caption, meta, mentions} → the message DTO', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({ conversationId: 'c1', messageId: 'm1', card: { type: 'result', id: 't1', title: 'Hb 4.2', subtitle: '' } }));
    const msg = await svc.shareToConversation('c1', { type: 'result', id: 't1', caption: '  Recheck?  ', meta: { parameter: 'hb', empty: '' } as never, mentions: ['a2'] });
    expect(msg?.messageId).toBe('m1');
    expect(api.post).toHaveBeenCalledWith('/api/chat/conversations/c1/share',
      { type: 'result', id: 't1', caption: 'Recheck?', meta: { parameter: 'hb' }, mentions: ['a2'] });
  });
  it('client meta = a result\'s parameter ONLY / an Insights view; anything else never leaves (the server reads the value itself)', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({ conversationId: 'c1', messageId: 'm1', card: null }));
    await svc.shareToConversation('c1', { type: 'result', id: 't1', meta: { parameter: 'hb', value: '4.2', flag: 'CL', sampleId: 's1' } });
    expect(api.post).toHaveBeenLastCalledWith('/api/chat/conversations/c1/share', { type: 'result', id: 't1', meta: { parameter: 'hb' } });
    await svc.shareToConversation('c1', { type: 'analyzer', id: 'm1', meta: { tab: 'qc' } });
    expect(api.post).toHaveBeenLastCalledWith('/api/chat/conversations/c1/share', { type: 'analyzer', id: 'm1' });
    await svc.shareToConversation('c1', { type: 'insights', id: G, meta: { section: `dash:${G}`, period: 'month', junk: 'x' } });
    expect(api.post).toHaveBeenLastCalledWith('/api/chat/conversations/c1/share', { type: 'insights', id: G, meta: { section: `dash:${G}`, period: 'month' } });
  });
  it('no caption / meta / mentions → not sent at all', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({}));
    await svc.shareToConversation('c1', { type: 'patient', id: 'p1', caption: '   ' });
    expect(api.post).toHaveBeenCalledWith('/api/chat/conversations/c1/share', { type: 'patient', id: 'p1' });
  });
  it('POST /api/chat/share to people (toUserIds) or a conversation', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({}));
    await svc.shareTo({ toUserIds: ['a1'] }, { type: 'order', id: 'o1' });
    expect(api.post).toHaveBeenCalledWith('/api/chat/share', { type: 'order', id: 'o1', toUserIds: ['a1'] });
    await svc.shareTo({ toUserIds: ['a1', 'a2'], groupName: ' Night shift ' }, { type: 'insights', id: 'overview', meta: { section: 'overview' } });
    expect(api.post).toHaveBeenLastCalledWith('/api/chat/share', { type: 'insights', meta: { section: 'overview' }, toUserIds: ['a1', 'a2'], groupName: 'Night shift' });
  });
  it('OLDER server (no /share): patients + reports still go through the legacy endpoints; the note follows as a message', async () => {
    const { svc, api, chat } = setup();
    api.post.mockImplementation((url: string) => url.endsWith('/share') ? throwError(() => missing()) : of({}));
    await svc.shareToConversation('c1', { type: 'patient', id: 'p1', caption: 'FYI' });
    expect(api.post).toHaveBeenCalledWith('/api/chat/conversations/c1/share-patient', { patientId: 'p1' });
    expect(chat.sendMessage).toHaveBeenCalledWith('c1', 'FYI');
    await svc.shareToConversation('c1', { type: 'report', id: 'r1' });
    expect(api.post).toHaveBeenCalledWith('/api/chat/conversations/c1/share-report', { reportId: 'r1' });
    // A new card type has no legacy path → the error surfaces.
    await expect(svc.shareToConversation('c1', { type: 'order', id: 'o1' })).rejects.toBeTruthy();
  });
  it('a CODED error (forbidden / not found) never falls back — it surfaces', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(throwError(() => new ApiError('You don\'t have access to that kind of record.', 'forbidden')));
    await expect(svc.shareToConversation('c1', { type: 'patient', id: 'p1' })).rejects.toThrow(/access/);
    expect(api.post).toHaveBeenCalledTimes(1);
  });
  it('forward keeps the card (the server re-checks the forwarder may see it); a plain message is not a card', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({}));
    const ok = await svc.forwardCard('c9', { id: 'm', conversationId: 'c1', fromUserId: 'x', sentAt: '', body: 'look',
      sharedRecordType: 'result', sharedRecordId: 't1', sharedRecordMeta: { parameter: 'hb' } } as never);
    expect(ok).toBe(true);
    expect(api.post).toHaveBeenCalledWith('/api/chat/conversations/c9/share', { type: 'result', id: 't1', caption: 'look', meta: { parameter: 'hb' } });
    expect(await svc.forwardCard('c9', { id: 'm', body: 'hi' } as never)).toBe(false);
  });
});

describe('ShareService — pasted links', () => {
  it('from-url → {type, id, meta}; anything it can\'t read stays text (null)', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({ type: 'order', id: G, meta: {} }));
    expect(await svc.cardFromUrl(`https://med.prefrontal.health/o/${G}`)).toEqual({ type: 'order', id: G, meta: null });
    expect(api.post).toHaveBeenCalledWith('/api/chat/cards/from-url', { url: `https://med.prefrontal.health/o/${G}` });
    api.post.mockReturnValue(throwError(() => new ApiError('That link isn\'t a Prefrontal record.', 'not_a_card')));
    expect(await svc.cardFromUrl('https://med.prefrontal.health/x')).toBeNull();
    // allowed:false (the sender may not see it) → stays text.
    api.post.mockReturnValue(of({ type: 'order', id: G, meta: {}, allowed: false, error: 'forbidden' }));
    expect(await svc.cardFromUrl(`https://med.prefrontal.health/o/${G}`)).toBeNull();
    // The server's own title / subtitle name the preview.
    api.post.mockReturnValue(of({ type: 'order', id: G, meta: {}, allowed: true, title: 'LAB-2610-000200', subtitle: 'Priya Nair · MRN1' }));
    expect(await svc.cardFromUrl(`https://med.prefrontal.health/o/${G}`)).toEqual({ type: 'order', id: G, meta: null, title: 'LAB-2610-000200', subtitle: 'Priya Nair · MRN1' });
    api.post.mockReturnValue(of({ type: 'invoice', id: 'x' }));
    expect(await svc.cardFromUrl(`https://med.prefrontal.health/o/${G}`)).toBeNull();
  });
  it('a desktop (hash-routed) link travels as its in-app path; an Insights view keeps its section', async () => {
    const { svc, api } = setup();
    api.post.mockReturnValue(of({ type: 'insights', id: null, meta: { section: 'revenue', period: 'month' } }));
    const t = await svc.cardFromUrl('https://med.prefrontal.health/#/insights?section=revenue&period=month');
    expect(api.post).toHaveBeenCalledWith('/api/chat/cards/from-url', { url: '/insights?section=revenue&period=month' });
    expect(t).toEqual({ type: 'insights', id: 'revenue', meta: { section: 'revenue', period: 'month' } });
  });
});

describe('ShareService — opening a card (the RECEIVER)', () => {
  const card = { type: 'result' as const, id: 't1', title: 'Hb 4.2', subtitle: '', meta: { parameter: 'hb' } };

  it('GET /cards/resolve?type&id&meta → navigate to the route + query the server chose', async () => {
    const { svc, api, router } = setup();
    api.get.mockReturnValue(of({ access: 'ok', route: '/lab/result/t1', queryParams: { param: 'hb' } }));
    expect(await svc.openCard(card)).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/api/chat/cards/resolve?type=result&id=t1&meta=%7B%22parameter%22%3A%22hb%22%7D');
    expect(router.createUrlTree).toHaveBeenCalledWith(['/lab/result/t1'], { queryParams: { param: 'hb' } });
    expect(router.navigateByUrl).toHaveBeenCalled();
  });
  it('no access → a friendly notice naming the sender, never a raw 403 / navigation', async () => {
    const { svc, api, router, dialog } = setup();
    api.get.mockReturnValue(of({ access: 'none' }));
    expect(await svc.openCard(card, 'Priya')).toBe(false);
    expect(dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ title: "You can't open this", message: expect.stringContaining('Ask Priya') }));
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
  it('another branch I work in → "In Branch X — switch?" → the existing switcher → re-resolve → open', async () => {
    const { svc, api, router, dialog, branchSwitch } = setup();
    api.get
      .mockReturnValueOnce(of({ access: 'other_branch', branchId: 'b2', branchName: 'Salem', canSwitch: true }))
      .mockReturnValueOnce(of({ access: 'ok', route: '/o/o1' }));
    expect(await svc.openCard({ type: 'order', id: 'o1', title: 'LAB-1', subtitle: '' })).toBe(true);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'This is in Salem', confirmLabel: 'Switch to Salem' }));
    expect(branchSwitch.switchTo).toHaveBeenCalledWith('b2');
    expect(router.createUrlTree).toHaveBeenCalledWith(['/o/o1'], { queryParams: { view: 'detail' } });
  });
  it('another branch, declined → stays put; a branch I don\'t work in → a notice, no switch', async () => {
    const a = setup();
    a.dialog.confirm.mockResolvedValue(false);
    a.api.get.mockReturnValue(of({ access: 'other_branch', branchId: 'b2', branchName: 'Salem', canSwitch: true }));
    expect(await a.svc.openCard(card)).toBe(false);
    expect(a.branchSwitch.switchTo).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const b = setup();
    b.api.get.mockReturnValue(of({ access: 'other_branch', branchId: 'b3', branchName: 'Erode', canSwitch: false }));
    expect(await b.svc.openCard(card)).toBe(false);
    expect(b.dialog.confirm).not.toHaveBeenCalled();
    expect(b.dialog.alert).toHaveBeenCalledWith(expect.objectContaining({ title: 'This is in Erode' }));
  });
  it('OLDER server (no /cards/resolve) → the app\'s own route for the card', async () => {
    const { svc, api, router } = setup();
    api.get.mockReturnValue(throwError(() => missing()));
    await svc.openCard({ type: 'patient', id: 'p1', title: 'Priya', subtitle: '' });
    expect(router.createUrlTree).toHaveBeenCalledWith(['/p/p1'], { queryParams: {} });
  });
  it('a resolve failure is a toast; one open at a time (busy key)', async () => {
    const { svc, api, toasts } = setup();
    api.get.mockReturnValue(throwError(() => new ApiError('Server error', 'boom')));
    expect(await svc.openCard(card)).toBe(false);
    expect(toasts.error).toHaveBeenCalledWith('Server error');
    expect(svc.opening()).toBeNull();
  });
});

describe('ShareService — the sheet', () => {
  it('opens only with the Messages module (structural gate)', () => {
    const off = setup({ messages: false });
    off.svc.openSheet({ target: { type: 'patient', id: 'p1' }, title: 'Priya' });
    expect(off.svc.sheet()).toBeNull();
    TestBed.resetTestingModule();
    const on = setup();
    on.svc.openSheet({ target: { type: 'patient', id: 'p1' }, title: 'Priya' });
    expect(on.svc.sheet()?.title).toBe('Priya');
    on.svc.closeSheet();
    expect(on.svc.sheet()).toBeNull();
  });
  it('the directory is fetched once per session (and again after a failure)', async () => {
    const { svc, api } = setup();
    api.get.mockReturnValueOnce(throwError(() => new Error('x'))).mockReturnValue(of([{ id: 'a1', displayName: 'A', email: '', isActive: true }]));
    await expect(svc.directory()).rejects.toBeTruthy();
    expect(await svc.directory()).toHaveLength(1);
    await svc.directory();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});
