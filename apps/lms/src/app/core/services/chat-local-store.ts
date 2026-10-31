import { ChatMessage } from '../../shared/models/chat.model';

/**
 * ON-DEVICE chat history (owner 2026-09-27: the server is a relay only — it
 * keeps a message just until every recipient's devices have it; the history
 * lives here). One database PER ACCOUNT (`pf-chat-v1:<tenant>:<user>`), so
 * switching accounts on a shared machine never mixes two people's messages.
 *
 * Stores:
 *   messages  keyPath id, index byConv [conversationId, _ts]  — the history
 *   blobs     keyPath url                                      — attachment bytes
 *   blobMeta  keyPath url, index bySentAt                      — sizes, for eviction
 *   meta      keyPath key                                      — deviceId, flags
 *
 * Browsers without IndexedDB (or where opening it fails — private windows,
 * blocked storage, the unit-test DOM) get the same API in memory: history for
 * this session only.
 *
 * Quota: text is never evicted. When the origin runs out of room the OLDEST
 * attachment blobs go first (by the message's send time); a blob that still
 * doesn't fit is simply not cached (it streams from the server while that
 * still has it).
 */

/** A relayed edit / delete / pin / reaction (server ChatRelayService.SyncEvent). */
export interface ChatRelayEvent {
  id: string;
  conversationId: string;
  messageId: string;
  fromUserId: string;
  type: 'edit' | 'delete' | 'pin' | 'reaction' | string;
  payload?: { body?: string; pinned?: boolean; emoji?: string; op?: 'add' | 'remove'; reactions?: Array<{ emoji: string; userIds: string[] }> } | null;
  createdAt: string;
}

type LocalMessage = ChatMessage & { _ts: number };
interface BlobMeta { url: string; size: number; sentTs: number; storedAt: number }
interface BlobRow { url: string; blob: Blob }
interface MetaRow { key: string; value: unknown }
interface RangeOpts { after?: number; before?: number; limit?: number; newestFirst?: boolean }

/** Thrown when a message could not be stored even after evicting media —
 *  the caller must NOT ack it (the server keeps it for another device). */
export class ChatStorageFullError extends Error {
  constructor() { super('Device storage is full.'); this.name = 'ChatStorageFullError'; }
}

export function isQuotaError(e: unknown): boolean {
  const n = (e as { name?: string } | null)?.name ?? '';
  return n === 'QuotaExceededError' || n === 'NS_ERROR_DOM_QUOTA_REACHED';
}

const ts = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

function strip(m: LocalMessage | undefined): ChatMessage | undefined {
  if (!m) return undefined;
  const { _ts, ...rest } = m;
  void _ts;
  return rest;
}

// ── Backends ───────────────────────────────────────────────────────────

interface Backend {
  readonly persistent: boolean;
  get<T>(store: string, key: string): Promise<T | undefined>;
  put(store: string, rows: unknown[]): Promise<void>;
  del(store: string, keys: string[]): Promise<void>;
  byConversation(convId: string, o: RangeOpts): Promise<LocalMessage[]>;
  allBlobMeta(): Promise<BlobMeta[]>;
  close(): void;
}

const STORES: Record<string, string> = { messages: 'id', blobs: 'url', blobMeta: 'url', meta: 'key' };

class MemoryBackend implements Backend {
  readonly persistent = false;
  private readonly tables = new Map<string, Map<string, unknown>>(
    Object.keys(STORES).map(s => [s, new Map<string, unknown>()]));
  /** Optional byte budget for blobs — lets tests exercise quota eviction. */
  constructor(private readonly blobBudget: number | null = null) {}

  async get<T>(store: string, key: string): Promise<T | undefined> {
    return this.tables.get(store)!.get(key) as T | undefined;
  }
  async put(store: string, rows: unknown[]): Promise<void> {
    const t = this.tables.get(store)!;
    const k = STORES[store];
    if (store === 'blobs' && this.blobBudget != null) {
      const used = [...(this.tables.get('blobMeta')!.values() as Iterable<BlobMeta>)].reduce((s, b) => s + b.size, 0);
      const add = (rows as BlobRow[]).reduce((s, r) => s + (r.blob?.size ?? 0), 0);
      if (used + add > this.blobBudget) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    }
    for (const r of rows) t.set((r as Record<string, string>)[k], r);
  }
  async del(store: string, keys: string[]): Promise<void> {
    const t = this.tables.get(store)!;
    for (const k of keys) t.delete(k);
  }
  async byConversation(convId: string, o: RangeOpts): Promise<LocalMessage[]> {
    let rows = [...(this.tables.get('messages')!.values() as Iterable<LocalMessage>)]
      .filter(m => m.conversationId === convId
        && (o.after == null || m._ts > o.after) && (o.before == null || m._ts < o.before))
      .sort((a, b) => a._ts - b._ts || a.id.localeCompare(b.id));
    if (o.newestFirst) rows.reverse();
    if (o.limit != null) rows = rows.slice(0, o.limit);
    return rows;
  }
  async allBlobMeta(): Promise<BlobMeta[]> {
    return [...(this.tables.get('blobMeta')!.values() as Iterable<BlobMeta>)];
  }
  close(): void { /* nothing */ }
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onabort = () => rej(tx.error ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
    tx.onerror = () => rej(tx.error);
  });
}

class IdbBackend implements Backend {
  readonly persistent = true;
  constructor(private readonly db: IDBDatabase, private readonly K: typeof IDBKeyRange) {}

  static open(name: string, factory: IDBFactory, K: typeof IDBKeyRange): Promise<IdbBackend> {
    return new Promise((res, rej) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        const msgs = db.createObjectStore('messages', { keyPath: 'id' });
        msgs.createIndex('byConv', ['conversationId', '_ts']);
        db.createObjectStore('blobs', { keyPath: 'url' });
        db.createObjectStore('blobMeta', { keyPath: 'url' }).createIndex('bySentAt', 'sentTs');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => res(new IdbBackend(r.result, K));
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('IndexedDB open blocked'));
    });
  }

  async get<T>(store: string, key: string): Promise<T | undefined> {
    return req(this.db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async put(store: string, rows: unknown[]): Promise<void> {
    if (!rows.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const r of rows) os.put(r);
    await done(tx);
  }
  async del(store: string, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    await done(tx);
  }
  byConversation(convId: string, o: RangeOpts): Promise<LocalMessage[]> {
    const lo = o.after != null ? o.after : -Infinity;
    const hi = o.before != null ? o.before : Infinity;
    const range = this.K.bound([convId, lo], [convId, hi], o.after != null, o.before != null);
    const idx = this.db.transaction('messages', 'readonly').objectStore('messages').index('byConv');
    const out: LocalMessage[] = [];
    return new Promise((res, rej) => {
      const c = idx.openCursor(range, o.newestFirst ? 'prev' : 'next');
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur || (o.limit != null && out.length >= o.limit)) { res(out); return; }
        out.push(cur.value as LocalMessage);
        cur.continue();
      };
      c.onerror = () => rej(c.error);
    });
  }
  async allBlobMeta(): Promise<BlobMeta[]> {
    return req(this.db.transaction('blobMeta', 'readonly').objectStore('blobMeta').getAll()) as Promise<BlobMeta[]>;
  }
  close(): void { try { this.db.close(); } catch { /* already closed */ } }
}

// ── The store ──────────────────────────────────────────────────────────

export interface ChatStoreOptions {
  /** IndexedDB factory (default: globalThis.indexedDB). null forces memory. */
  factory?: IDBFactory | null;
  keyRange?: typeof IDBKeyRange;
  /** Memory backend only: a blob byte budget (tests of quota eviction). */
  memoryBlobBudget?: number;
}

export class ChatLocalStore {
  private constructor(private readonly be: Backend, readonly name: string) {}

  /** Database name for an account scope (`<tenant>:<user>`). */
  static dbName(scopeKey: string): string { return `pf-chat-v1:${scopeKey}`; }

  static async open(name: string, opts: ChatStoreOptions = {}): Promise<ChatLocalStore> {
    const g = globalThis as unknown as { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange };
    const factory = opts.factory === undefined ? g.indexedDB : opts.factory;
    const K = opts.keyRange ?? g.IDBKeyRange;
    if (factory && K) {
      try { return new ChatLocalStore(await IdbBackend.open(name, factory, K), name); }
      catch { /* private window / blocked storage → memory */ }
    }
    return new ChatLocalStore(new MemoryBackend(opts.memoryBlobBudget ?? null), name);
  }

  /** True when history survives a reload (IndexedDB), false = memory only. */
  get persistent(): boolean { return this.be.persistent; }

  close(): void { this.be.close(); }

  // ── meta ──
  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.be.get<MetaRow>('meta', key))?.value as T | undefined;
  }
  setMeta(key: string, value: unknown): Promise<void> { return this.be.put('meta', [{ key, value }]); }

  // ── messages ──

  /**
   * Store (or merge into) messages. Relay/server fields win; a field the
   * incoming copy doesn't carry (reactions on a live echo, isPinned…) keeps
   * the local value. Optimistic `pending` rows are never stored. Returns the
   * rows as stored. Throws {@link ChatStorageFullError} when even evicting
   * media can't make room — the caller then must not ack.
   */
  async putMessages(msgs: ChatMessage[]): Promise<ChatMessage[]> {
    const rows: LocalMessage[] = [];
    for (const m of msgs) {
      if (!m?.id || !m.conversationId || m.pending || m.id.startsWith('pending-')) continue;
      const cur = await this.be.get<LocalMessage>('messages', m.id);
      const merged: LocalMessage = { ...(cur ?? {}), ...definedOnly(m), _ts: ts(m.sentAt ?? cur?.sentAt) } as LocalMessage;
      delete (merged as Partial<ChatMessage>).pending;
      rows.push(merged);
    }
    if (!rows.length) return [];
    try {
      await this.be.put('messages', rows);
    } catch (e) {
      if (!isQuotaError(e)) throw e;
      // Make room from media (never text) and try once more.
      await this.evictBlobs(Math.max(5 * 1024 * 1024, (await this.blobUsage()) / 4));
      try { await this.be.put('messages', rows); }
      catch (e2) { if (isQuotaError(e2)) throw new ChatStorageFullError(); throw e2; }
    }
    return rows.map(r => strip(r)!);
  }

  async getMessage(id: string): Promise<ChatMessage | undefined> {
    return strip(await this.be.get<LocalMessage>('messages', id));
  }

  /** The newest `limit` messages (optionally older than `beforeSentAt`), chronological. */
  async recent(convId: string, limit: number, beforeSentAt?: string | null): Promise<ChatMessage[]> {
    const rows = await this.be.byConversation(convId, {
      before: beforeSentAt ? ts(beforeSentAt) : undefined, limit, newestFirst: true,
    });
    return rows.reverse().map(r => strip(r)!);
  }

  /** Case-insensitive substring search over bodies, newest first. */
  async search(convId: string, q: string, limit = 100): Promise<ChatMessage[]> {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const rows = await this.be.byConversation(convId, { newestFirst: true });
    return rows.filter(m => !m.deleted && (m.body ?? '').toLowerCase().includes(term)).slice(0, limit).map(r => strip(r)!);
  }

  async pinned(convId: string, limit = 20): Promise<ChatMessage[]> {
    const rows = await this.be.byConversation(convId, { newestFirst: true });
    return rows.filter(m => m.isPinned && !m.deleted).slice(0, limit).map(r => strip(r)!);
  }

  /** Last message + my unread count (others' user messages after my read mark). */
  async summary(convId: string, me: string, lastReadAt: string | null | undefined):
    Promise<{ last: ChatMessage | null; unread: number }> {
    const last = (await this.be.byConversation(convId, { newestFirst: true, limit: 1 }))[0];
    if (!last) return { last: null, unread: 0 };
    const after = await this.be.byConversation(convId, { after: lastReadAt ? ts(lastReadAt) : undefined });
    const unread = after.filter(m => m.fromUserId !== me && !m.deleted && (!m.kind || m.kind === 'user')).length;
    return { last: strip(last)!, unread };
  }

  /**
   * Apply a relayed event to the local copy. An edit / delete counts only
   * when it comes from the message's own sender (the server can't check
   * once the row is gone — the device holding the message does). Returns
   * the updated message, or null when there is nothing to apply it to.
   */
  async applyEvent(e: ChatRelayEvent): Promise<ChatMessage | null> {
    const cur = await this.be.get<LocalMessage>('messages', e.messageId);
    if (!cur || cur.conversationId !== e.conversationId) return null;
    const next: LocalMessage = { ...cur };
    const p = e.payload ?? {};
    switch (e.type) {
      case 'edit':
        if (e.fromUserId !== cur.fromUserId || typeof p.body !== 'string') return null;
        next.body = p.body; next.editedAt = e.createdAt;
        break;
      case 'delete':
        if (e.fromUserId !== cur.fromUserId) return null;
        Object.assign(next, {
          deleted: true, body: '', replyPreview: null, replyFromName: null,
          attachmentUrl: null, attachmentName: null, attachmentMime: null, attachmentSize: null,
          sharedRecordTitle: null, sharedRecordSubtitle: null, sharedRecordMeta: null, sharedReportPatientName: null, sharedReportTestSummary: null,
        });
        if (cur.attachmentUrl) await this.dropBlob(cur.attachmentUrl);
        break;
      case 'pin':
        next.isPinned = !!p.pinned;
        break;
      case 'reaction':
        next.reactions = Array.isArray(p.reactions) ? p.reactions
          : applyReaction(cur.reactions ?? [], p.emoji, p.op, e.fromUserId);
        break;
      default:
        return null;
    }
    try { await this.be.put('messages', [next]); }
    catch (err) {
      if (!isQuotaError(err)) throw err;
      await this.evictBlobs(5 * 1024 * 1024);
      await this.be.put('messages', [next]);
    }
    return strip(next)!;
  }

  // ── attachment blobs ──

  async getBlob(url: string): Promise<Blob | undefined> {
    return (await this.be.get<BlobRow>('blobs', url))?.blob;
  }

  /** Cache an attachment. Evicts the oldest blobs to make room; false when
   *  it still doesn't fit (the caller shows it from memory this session). */
  async putBlob(url: string, blob: Blob, sentAt?: string | null): Promise<boolean> {
    const meta: BlobMeta = { url, size: blob.size, sentTs: ts(sentAt) || Date.now(), storedAt: Date.now() };
    const write = async () => { await this.be.put('blobs', [{ url, blob }]); await this.be.put('blobMeta', [meta]); };
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await write(); return true; }
      catch (e) {
        if (!isQuotaError(e)) return false;
        // Oldest media first, about this blob's size per round.
        if (await this.evictBlobs(blob.size, url) === 0) return false;
      }
    }
    return false;
  }

  async blobUsage(): Promise<number> {
    return (await this.be.allBlobMeta()).reduce((s, b) => s + (b.size || 0), 0);
  }

  /** Free at least `bytes` by deleting the oldest attachment blobs (by the
   *  message's send time). Never touches messages. Returns bytes freed. */
  async evictBlobs(bytes: number, keep?: string): Promise<number> {
    const all = (await this.be.allBlobMeta()).filter(b => b.url !== keep)
      .sort((a, b) => a.sentTs - b.sentTs || a.storedAt - b.storedAt);
    let freed = 0;
    const drop: string[] = [];
    for (const b of all) {
      if (freed >= bytes) break;
      drop.push(b.url); freed += b.size || 0;
    }
    await this.be.del('blobs', drop);
    await this.be.del('blobMeta', drop);
    return freed;
  }

  private async dropBlob(url: string): Promise<void> {
    await this.be.del('blobs', [url]);
    await this.be.del('blobMeta', [url]);
  }
}

function definedOnly<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

export function applyReaction(
  current: Array<{ emoji: string; userIds: string[] }>, emoji: string | undefined, op: string | undefined, user: string,
): Array<{ emoji: string; userIds: string[] }> {
  if (!emoji) return current;
  const next = current.map(r => ({ emoji: r.emoji, userIds: [...r.userIds] }));
  let g = next.find(r => r.emoji === emoji);
  if (op === 'remove') {
    if (g) g.userIds = g.userIds.filter(u => u !== user);
  } else {
    if (!g) { g = { emoji, userIds: [] }; next.push(g); }
    if (!g.userIds.includes(user)) g.userIds.push(user);
  }
  return next.filter(r => r.userIds.length > 0);
}
