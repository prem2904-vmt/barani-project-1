import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { ChatLocalStore } from './chat-local-store';
import { ChatMessage } from '../../shared/models/chat.model';

/**
 * Chat relay (2026-09-27): history lives on the device. The store is
 * exercised against a real IndexedDB implementation (fake-indexeddb) — the
 * same code path the browser / WebView / Electron take.
 */
const msg = (id: string, conv: string, from: string, sentAt: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, conversationId: conv, fromUserId: from, body: `body ${id}`, sentAt, kind: 'user', ...extra });

const at = (min: number) => new Date(Date.UTC(2026, 8, 27, 10, min)).toISOString();

describe('ChatLocalStore (IndexedDB)', () => {
  let factory: IDBFactory;
  const open = (name = 'pf-chat-v1:t1:u1') => ChatLocalStore.open(name, { factory, keyRange: IDBKeyRange });

  beforeEach(() => { factory = new IDBFactory(); });

  it('is persistent and survives a reopen', async () => {
    const s = await open();
    expect(s.persistent).toBe(true);
    await s.putMessages([msg('m1', 'c1', 'a', at(1))]);
    s.close();
    const again = await open();
    expect((await again.getMessage('m1'))?.body).toBe('body m1');
  });

  it('keeps each account in its own database — never mixes', async () => {
    const admin = await open(ChatLocalStore.dbName('t1:admin'));
    const priya = await open(ChatLocalStore.dbName('t1:priya'));
    await admin.putMessages([msg('m-admin', 'c1', 'x', at(1))]);
    expect(await priya.getMessage('m-admin')).toBeUndefined();
    expect(await priya.recent('c1', 50)).toEqual([]);
    const other = await open(ChatLocalStore.dbName('t2:admin'));   // same user id, other tenant
    expect(await other.getMessage('m-admin')).toBeUndefined();
  });

  it('orders by server send time, dedupes by id, never stores optimistic rows', async () => {
    const s = await open();
    await s.putMessages([msg('m3', 'c1', 'a', at(3)), msg('m1', 'c1', 'a', at(1)), msg('m2', 'c1', 'b', at(2))]);
    await s.putMessages([msg('m2', 'c1', 'b', at(2), { body: 'redelivered' })]);
    await s.putMessages([{ ...msg('pending-1', 'c1', 'a', at(4)), pending: true }]);
    const rows = await s.recent('c1', 50);
    expect(rows.map(r => r.id)).toEqual(['m1', 'm2', 'm3']);
    expect(rows[1].body).toBe('redelivered');
    expect(rows.some(r => '_ts' in r)).toBe(false);
  });

  it('a re-delivered copy without reactions keeps the local reactions', async () => {
    const s = await open();
    await s.putMessages([msg('m1', 'c1', 'a', at(1), { reactions: [{ emoji: '+1', userIds: ['b'] }] })]);
    await s.putMessages([msg('m1', 'c1', 'a', at(1))]);
    expect((await s.getMessage('m1'))?.reactions).toEqual([{ emoji: '+1', userIds: ['b'] }]);
  });

  it('scrollback pages backwards from the oldest message on screen', async () => {
    const s = await open();
    await s.putMessages(Array.from({ length: 7 }, (_, i) => msg(`m${i}`, 'c1', 'a', at(i))));
    await s.putMessages([msg('other', 'c2', 'a', at(3))]);
    const page1 = await s.recent('c1', 3);
    expect(page1.map(r => r.id)).toEqual(['m4', 'm5', 'm6']);
    const page2 = await s.recent('c1', 3, page1[0].sentAt);
    expect(page2.map(r => r.id)).toEqual(['m1', 'm2', 'm3']);
    const page3 = await s.recent('c1', 3, page2[0].sentAt);
    expect(page3.map(r => r.id)).toEqual(['m0']);
  });

  it('searches and lists pinned from the local history', async () => {
    const s = await open();
    await s.putMessages([
      msg('m1', 'c1', 'a', at(1), { body: 'Potassium is 6.2' }),
      msg('m2', 'c1', 'a', at(2), { body: 'ok', isPinned: true }),
      msg('m3', 'c1', 'a', at(3), { body: 'potassium repeat?', deleted: true }),
    ]);
    expect((await s.search('c1', 'POTASSIUM')).map(m => m.id)).toEqual(['m1']);
    expect((await s.pinned('c1')).map(m => m.id)).toEqual(['m2']);
  });

  it('summary: last message + my unread (others\' user messages after my read mark)', async () => {
    const s = await open();
    await s.putMessages([
      msg('m1', 'c1', 'them', at(1)),
      msg('m2', 'c1', 'them', at(5)),
      msg('m3', 'c1', 'me', at(6)),
      msg('m4', 'c1', 'them', at(7), { kind: 'system' }),
    ]);
    const sum = await s.summary('c1', 'me', at(2));
    expect(sum.last?.id).toBe('m4');
    expect(sum.unread).toBe(1);
    expect((await s.summary('empty', 'me', null)).last).toBeNull();
  });

  it('applies relayed events; an edit/delete only counts from the message\'s own sender', async () => {
    const s = await open();
    await s.putMessages([msg('m1', 'c1', 'alice', at(1), { body: 'typo', attachmentUrl: '/uploads/chat/t/a.png' })]);
    await s.putBlob('/uploads/chat/t/a.png', new Blob(['png']), at(1));

    expect(await s.applyEvent({ id: 'e0', conversationId: 'c1', messageId: 'm1', fromUserId: 'mallory', type: 'edit', payload: { body: 'hijack' }, createdAt: at(2) })).toBeNull();
    expect((await s.getMessage('m1'))?.body).toBe('typo');

    const edited = await s.applyEvent({ id: 'e1', conversationId: 'c1', messageId: 'm1', fromUserId: 'alice', type: 'edit', payload: { body: 'fixed' }, createdAt: at(2) });
    expect(edited?.body).toBe('fixed');
    expect(edited?.editedAt).toBe(at(2));

    await s.applyEvent({ id: 'e2', conversationId: 'c1', messageId: 'm1', fromUserId: 'bob', type: 'reaction', payload: { emoji: '+1', op: 'add' }, createdAt: at(3) });
    await s.applyEvent({ id: 'e3', conversationId: 'c1', messageId: 'm1', fromUserId: 'carol', type: 'reaction', payload: { emoji: '+1', op: 'add' }, createdAt: at(3) });
    await s.applyEvent({ id: 'e4', conversationId: 'c1', messageId: 'm1', fromUserId: 'bob', type: 'reaction', payload: { emoji: '+1', op: 'remove' }, createdAt: at(3) });
    expect((await s.getMessage('m1'))?.reactions).toEqual([{ emoji: '+1', userIds: ['carol'] }]);

    await s.applyEvent({ id: 'e5', conversationId: 'c1', messageId: 'm1', fromUserId: 'bob', type: 'pin', payload: { pinned: true }, createdAt: at(4) });
    expect((await s.getMessage('m1'))?.isPinned).toBe(true);

    const del = await s.applyEvent({ id: 'e6', conversationId: 'c1', messageId: 'm1', fromUserId: 'alice', type: 'delete', payload: {}, createdAt: at(5) });
    expect(del).toMatchObject({ deleted: true, body: '', attachmentUrl: null });
    expect(await s.getBlob('/uploads/chat/t/a.png')).toBeUndefined();   // its bytes go too

    // Event for a message this device doesn't have / wrong conversation → nothing.
    expect(await s.applyEvent({ id: 'e7', conversationId: 'c1', messageId: 'nope', fromUserId: 'a', type: 'pin', payload: { pinned: true }, createdAt: at(6) })).toBeNull();
    expect(await s.applyEvent({ id: 'e8', conversationId: 'c2', messageId: 'm1', fromUserId: 'a', type: 'pin', payload: { pinned: false }, createdAt: at(6) })).toBeNull();
  });

  it('keeps attachment blobs and evicts the OLDEST first on request — never messages', async () => {
    const s = await open();
    await s.putMessages([msg('m1', 'c1', 'a', at(1)), msg('m2', 'c1', 'a', at(2))]);
    await s.putBlob('/old', new Blob([new Uint8Array(100)]), at(1));
    await s.putBlob('/new', new Blob([new Uint8Array(100)]), at(9));
    expect(await s.blobUsage()).toBe(200);
    const freed = await s.evictBlobs(50);
    expect(freed).toBe(100);
    expect(await s.getBlob('/old')).toBeUndefined();
    expect(await s.getBlob('/new')).toBeDefined();
    expect((await s.recent('c1', 10)).length).toBe(2);
  });

  it('meta values (device id, flags) round-trip', async () => {
    const s = await open();
    expect(await s.getMeta('deviceId')).toBeUndefined();
    await s.setMeta('deviceId', 'dabc123456');
    expect(await s.getMeta('deviceId')).toBe('dabc123456');
  });
});

describe('ChatLocalStore (quota)', () => {
  it('when the device is full a new attachment evicts the oldest blobs to fit', async () => {
    const s = await ChatLocalStore.open('q', { factory: null, memoryBlobBudget: 250 });
    expect(s.persistent).toBe(false);
    await s.putMessages([msg('m1', 'c1', 'a', at(1))]);
    expect(await s.putBlob('/a', new Blob([new Uint8Array(100)]), at(1))).toBe(true);
    expect(await s.putBlob('/b', new Blob([new Uint8Array(100)]), at(2))).toBe(true);
    // 100 + 100 + 100 > 250 → quota → evict oldest (/a) → fits.
    expect(await s.putBlob('/c', new Blob([new Uint8Array(100)]), at(3))).toBe(true);
    expect(await s.getBlob('/a')).toBeUndefined();
    expect(await s.getBlob('/b')).toBeDefined();
    expect(await s.getBlob('/c')).toBeDefined();
    expect(await s.getMessage('m1')).toBeDefined();          // text never evicted
  });

  it('a blob bigger than the whole budget is simply not cached', async () => {
    const s = await ChatLocalStore.open('q2', { factory: null, memoryBlobBudget: 50 });
    expect(await s.putBlob('/huge', new Blob([new Uint8Array(100)]), at(1))).toBe(false);
    expect(await s.getBlob('/huge')).toBeUndefined();
  });

  it('falls back to memory when IndexedDB is unavailable', async () => {
    const s = await ChatLocalStore.open('x', { factory: null });
    expect(s.persistent).toBe(false);
    await s.putMessages([msg('m1', 'c1', 'a', at(1))]);
    expect((await s.recent('c1', 5)).map(m => m.id)).toEqual(['m1']);
  });
});
