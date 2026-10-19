import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { Observable, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { ChatHistoryService, ChatSyncItem } from './chat-history.service';
import { ChatLocalStore, ChatStorageFullError } from './chat-local-store';
import { PlatformService } from './platform.service';
import { ChatMessage } from '../../shared/models/chat.model';

/**
 * Chat relay (2026-09-27) — the device side: sync → store → ack (never ack
 * what wasn't stored), dedupe, per-account stores (account switch never
 * mixes), device id per account kept IN the store, one-time legacy import,
 * attachments cached once / "no longer available" when the server lost it.
 */
const A = { userId: 'app-admin', tenantId: 't1', authId: 'sub-admin' };
const B = { userId: 'app-priya', tenantId: 't1', authId: 'sub-priya' };

const msg = (id: string, conv = 'c1', from = 'sub-ravi', min = 1): ChatMessage =>
  ({ id, conversationId: conv, fromUserId: from, body: `hi ${id}`, sentAt: new Date(Date.UTC(2026, 8, 27, 10, min)).toISOString(), kind: 'user' });

const item = (seq: number, m: ChatMessage, v = 1): ChatSyncItem => ({ seq, v, kind: 'message', message: m });

function setup(factory = new IDBFactory()) {
  let pages: Array<{ items: ChatSyncItem[]; next: number; hasMore: boolean }> = [];
  const legacy: Record<string, ChatMessage[]> = {};
  const api = {
    get: vi.fn((url: string): Observable<unknown> => {
      if (url.startsWith('/api/chat/sync')) return of(pages.shift() ?? { items: [], next: 0, hasMore: false });
      const m = /conversations\/([^/]+)\/messages\?skip=(\d+)/.exec(url);
      if (m) return of(Number(m[2]) === 0 ? (legacy[m[1]] ?? []) : []);
      return of([]);
    }),
    post: vi.fn((_url: string, _body: unknown) => of({ acked: 1 })),
  };
  const http = { get: vi.fn((): Observable<Blob> => of(new Blob(['bytes']))) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: http },
      { provide: PlatformService, useValue: { getApiUrl: () => 'https://api.test', isCapacitor: () => false, isElectron: () => false } },
    ],
  });
  const scope = TestBed.inject(SessionScopeService);
  const history = TestBed.inject(ChatHistoryService);
  history.storeOptions = { factory, keyRange: IDBKeyRange };
  const acks = () => api.post.mock.calls.filter(c => c[0] === '/api/chat/sync/ack').map(c => c[1] as { deviceId: string; ids: string[] });
  return {
    api, http, scope, history, acks, legacy,
    setPages: (p: typeof pages) => { pages = p; },
  };
}

describe('ChatHistoryService — relay sync on the device', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:local'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

  it('sync stores every pending item, THEN acks them for this device', async () => {
    const t = setup();
    t.scope.changed(A);
    t.setPages([
      { items: [item(1, msg('m1')), item(2, msg('m2', 'c1', 'sub-ravi', 2))], next: 2, hasMore: true },
      { items: [item(3, msg('m3', 'c2', 'sub-ravi', 3))], next: 3, hasMore: false },
    ]);
    const res = await t.history.sync();
    expect(res.messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3']);
    expect((await t.history.recent('c1', 10)).map(m => m.id)).toEqual(['m1', 'm2']);

    const device = await t.history.deviceId();
    expect(t.acks()).toEqual([{ deviceId: device, ids: ['m1', 'm2'] }, { deviceId: device, ids: ['m3'] }]);
    // The second page was asked for after the first page's cursor.
    expect(t.api.get.mock.calls.map(c => c[0]).filter((u: string) => u.startsWith('/api/chat/sync'))[1]).toContain('after=2');
  });

  it('nothing is acked when the device could not store it (storage full)', async () => {
    const t = setup();
    t.scope.changed(A);
    vi.spyOn(ChatLocalStore.prototype, 'putMessages').mockRejectedValue(new ChatStorageFullError());
    t.setPages([{ items: [item(1, msg('m1'))], next: 1, hasMore: false }]);
    await t.history.sync();
    expect(t.acks()).toEqual([]);
    expect(t.history.storageFull()).toBe(true);
  });

  it('a re-delivered message is stored once (dedupe by id) and acked again', async () => {
    const t = setup();
    t.scope.changed(A);
    t.setPages([{ items: [item(1, msg('m1'))], next: 1, hasMore: false }]);
    await t.history.sync();
    t.setPages([{ items: [item(5, { ...msg('m1'), body: 'same id' })], next: 5, hasMore: false }]);
    await t.history.sync();
    const rows = await t.history.recent('c1', 10);
    expect(rows.map(r => r.id)).toEqual(['m1']);
    expect(rows[0].body).toBe('same id');
    expect(t.acks().flatMap(a => a.ids)).toEqual(['m1', 'm1']);
  });

  it('an envelope newer than this app understands is left on the server (not acked)', async () => {
    const t = setup();
    t.scope.changed(A);
    t.setPages([{ items: [item(1, msg('m-e2e'), 2), item(2, msg('m-plain'))], next: 2, hasMore: false }]);
    await t.history.sync();
    expect(t.acks().flatMap(a => a.ids)).toEqual(['m-plain']);
    expect((await t.history.recent('c1', 10)).map(m => m.id)).toEqual(['m-plain']);
  });

  it('relayed events are applied and acked by event id', async () => {
    const t = setup();
    t.scope.changed(A);
    t.setPages([{ items: [
      item(1, msg('m1', 'c1', 'sub-ravi')),
      { seq: 2, v: 1, kind: 'event', event: { id: 'e1', conversationId: 'c1', messageId: 'm1', fromUserId: 'sub-ravi', type: 'edit', payload: { body: 'edited' }, createdAt: new Date().toISOString() } },
    ], next: 2, hasMore: false }]);
    const res = await t.history.sync();
    expect(res.updated.map(m => m.body)).toEqual(['edited']);
    expect(t.acks().flatMap(a => a.ids)).toEqual(['m1', 'e1']);
  });

  it('account switch: each account has its own store and device id — nothing mixes', async () => {
    const factory = new IDBFactory();
    const t = setup(factory);
    t.scope.changed(A);
    t.setPages([{ items: [item(1, msg('m-admin'))], next: 1, hasMore: false }]);
    await t.history.sync();
    const adminDevice = await t.history.deviceId();

    t.scope.changed(B);
    expect(await t.history.recent('c1', 10)).toEqual([]);
    const priyaDevice = await t.history.deviceId();
    expect(priyaDevice).not.toBe(adminDevice);

    t.scope.changed(A);
    expect((await t.history.recent('c1', 10)).map(m => m.id)).toEqual(['m-admin']);
    expect(await t.history.deviceId()).toBe(adminDevice);   // same device for the same account
  });

  it('cleared storage = a new device that starts empty (fresh store)', async () => {
    const t = setup(new IDBFactory());
    t.scope.changed(A);
    const first = await t.history.deviceId();
    expect(t.history.freshStore()).toBe(true);

    // Same browser, storage wiped: a brand-new IndexedDB.
    t.history.storeOptions = { factory: new IDBFactory(), keyRange: IDBKeyRange };
    t.scope.changed(B); t.scope.changed(A);
    const second = await t.history.deviceId();
    expect(second).not.toBe(first);
    expect(await t.history.recent('c1', 10)).toEqual([]);
  });

  it('live messages are stored and acked (batched) after storing', async () => {
    const t = setup();
    t.scope.changed(A);
    await t.history.storeLive(msg('live-1'));
    await t.history.storeLive(msg('live-2', 'c1', 'sub-ravi', 2));
    expect(t.acks()).toEqual([]);                        // batched, not per message
    expect((await t.history.recent('c1', 10)).map(m => m.id)).toEqual(['live-1', 'live-2']);
    await vi.waitFor(() => expect(t.acks().flatMap(a => a.ids)).toEqual(['live-1', 'live-2']));
    expect(t.acks().length).toBe(1);
  });

  it('pre-relay history still on the server is imported once per conversation, never acked', async () => {
    const t = setup();
    t.scope.changed(A);
    t.legacy['c9'] = [msg('old-1', 'c9'), msg('old-2', 'c9', 'sub-ravi', 2)];
    expect(await t.history.importLegacy('c9')).toBe(2);
    expect(await t.history.importLegacy('c9')).toBe(0);
    const legacyCalls = t.api.get.mock.calls.filter(c => (c[0] as string).includes('/conversations/c9/messages'));
    expect(legacyCalls.length).toBe(1);
    expect((await t.history.recent('c9', 10)).map(m => m.id)).toEqual(['old-1', 'old-2']);
    expect(t.acks()).toEqual([]);
  });

  it('attachments download once and are served from the device afterwards', async () => {
    const t = setup();
    t.scope.changed(A);
    const url = '/uploads/chat/11111111-1111-1111-1111-111111111111/a1b2c3.png';
    expect(t.history.mediaSrc(url)).toBe('');                 // loading
    await vi.waitFor(() => expect(t.history.mediaState(url)).toBe('ready'));
    expect(t.history.mediaSrc(url)).toBe('blob:local');
    expect(t.http.get).toHaveBeenCalledTimes(1);
    const blob = await t.history.mediaBlob(url);
    expect(blob).toBeTruthy();
    expect(t.http.get).toHaveBeenCalledTimes(1);               // no second download
  });

  it('an attachment the server already removed (404) and this device never kept is "unavailable"', async () => {
    const t = setup();
    t.scope.changed(A);
    t.http.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const url = '/uploads/chat/11111111-1111-1111-1111-111111111111/gone00.png';
    t.history.mediaSrc(url);
    await vi.waitFor(() => expect(t.history.mediaState(url)).toBe('unavailable'));
    expect(t.history.mediaSrc(url)).toBe('');
  });

  it('a network error is NOT "unavailable" — the next render retries', async () => {
    const t = setup();
    t.scope.changed(A);
    t.http.get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    const url = '/uploads/chat/11111111-1111-1111-1111-111111111111/flaky0.png';
    t.history.mediaSrc(url);
    await vi.waitFor(() => expect(t.http.get).toHaveBeenCalledTimes(1));
    await new Promise(r => setTimeout(r, 0));
    expect(t.history.mediaState(url)).not.toBe('unavailable');
  });
});
