import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, Injector, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ChatMessage } from '../../shared/models/chat.model';
import { absoluteApiUrl, isPrivateUploadPath, uploadPathOf } from '../../shared/utils/upload-fetch';
import { SessionScopeService } from '../auth/session-scope.service';
import { ApiService } from './api.service';
import { ChatLocalStore, ChatRelayEvent, ChatStorageFullError, ChatStoreOptions } from './chat-local-store';
import { PlatformService } from './platform.service';
import { UploadsService } from './uploads.service';
import { ToastService } from './toast.service';

/** One pending item from GET /api/chat/sync (server ChatRelayService.SyncItem). */
export interface ChatSyncItem {
  seq: number;
  /** Envelope version — 1 = plaintext. E2E adds a version; unknown ones are skipped (not acked). */
  v: number;
  kind: 'message' | 'event';
  message?: ChatMessage | null;
  event?: ChatRelayEvent | null;
}
interface SyncPage { items: ChatSyncItem[]; next: number; hasMore: boolean }

/** Result of applying synced / live items to the local store. */
export interface ChatApplied {
  /** Messages stored (new or re-delivered). */
  messages: ChatMessage[];
  /** Messages changed by an event (edit / delete / pin / reaction). */
  updated: ChatMessage[];
}

/** An attachment's state on THIS device. */
export type ChatMediaState = 'none' | 'loading' | 'ready' | 'unavailable';

export const SUPPORTED_ENVELOPE = 1;

/**
 * The device side of the chat RELAY (owner 2026-09-27). The server keeps a
 * message only until it is delivered; this service keeps the history:
 *
 *  - one {@link ChatLocalStore} per ACCOUNT (tenant + user) — opened lazily,
 *    closed on account switch, so two people on one machine never mix;
 *  - a device id minted once and kept INSIDE that store (clear the store and
 *    this is a new device — it starts empty, as the owner accepted);
 *  - `sync()`: pull everything pending for this device, store it, THEN ack —
 *    never the other way round (an un-stored message must stay on the server);
 *  - `storeLive()` / `applyLiveEvent()`: the same for realtime events;
 *  - a one-time import of pre-relay history the server still holds;
 *  - attachments: downloaded once, kept as blobs; when the server copy is gone
 *    and this device never cached it, the state is `unavailable`.
 */
@Injectable({ providedIn: 'root' })
export class ChatHistoryService {
  private readonly api = inject(ApiService);
  private readonly scope = inject(SessionScopeService);
  private readonly injector = inject(Injector);

  /** Test seam: where the store lives (default: the browser's IndexedDB). */
  storeOptions: ChatStoreOptions = {};

  private storeKey: string | null = null;
  private storePromise: Promise<ChatLocalStore> | null = null;
  private deviceIdPromise: Promise<string> | null = null;
  /** Bumped on every account change — in-flight work for the old account stops. */
  private gen = 0;
  private syncing: Promise<ChatApplied> | null = null;
  private ackQueue = new Set<string>();
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private persistAsked = false;

  /** url → blob: URL (ready) | 'loading' | 'unavailable'. */
  private readonly media = signal<Record<string, string>>({});
  private readonly mediaInflight = new Map<string, Promise<void>>();
  private readonly objectUrls: string[] = [];

  /** True when this account's store was created in this session (first run on
   *  this device, or its storage was cleared) — earlier history isn't here. */
  readonly freshStore = signal(false);
  /** False when history can't survive a reload (no IndexedDB). */
  readonly persistent = signal(true);
  /** Set when the device ran out of room even after evicting media. */
  readonly storageFull = signal(false);

  constructor() {
    this.scope.onChange(() => this.reset());
  }

  // ── Store + device ─────────────────────────────────────────────────

  /** The store for the account on screen. */
  store(): Promise<ChatLocalStore> {
    const key = this.scope.scopeKey();
    if (this.storePromise && this.storeKey === key) return this.storePromise;
    this.storeKey = key;
    const gen = this.gen;
    this.storePromise = ChatLocalStore.open(ChatLocalStore.dbName(key), this.storeOptions).then(async s => {
      this.persistent.set(s.persistent);
      const created = await s.getMeta<string>('createdAt');
      if (!created) {
        await s.setMeta('createdAt', new Date().toISOString());
        if (gen === this.gen) this.freshStore.set(true);
      }
      this.askPersist();
      return s;
    });
    return this.storePromise;
  }

  /** This device's id for the account on screen (minted once, kept in the store). */
  deviceId(): Promise<string> {
    if (this.deviceIdPromise && this.storeKey === this.scope.scopeKey()) return this.deviceIdPromise;
    this.deviceIdPromise = this.store().then(async s => {
      const have = await s.getMeta<string>('deviceId');
      if (have) return have;
      const id = 'd' + randomHex(32);
      await s.setMeta('deviceId', id);
      return id;
    });
    return this.deviceIdPromise;
  }

  /** web | ios | android | electron — display only, for the device list. */
  platformName(): string {
    const p = this.injector.get(PlatformService, null);
    if (p?.isElectron?.()) return 'electron';
    if (p?.isCapacitor?.()) {
      const cap = (globalThis as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
      const n = cap?.getPlatform?.();
      return n === 'ios' || n === 'android' ? n : 'web';
    }
    return 'web';
  }

  /** Ask the browser not to evict this origin's storage under pressure. */
  private askPersist(): void {
    if (this.persistAsked) return;
    this.persistAsked = true;
    try {
      const st = (globalThis.navigator as Navigator | undefined)?.storage;
      if (st?.persist) void st.persisted?.().then(p => (p ? true : st.persist())).catch(() => undefined);
    } catch { /* not supported */ }
  }

  /** Out of room even after evicting media: say so once — messages then
   *  stay on the server (un-acked) until there's space. */
  private markFull(): void {
    if (this.storageFull()) return;
    this.storageFull.set(true);
    try {
      this.injector.get(ToastService, null)?.error(
        'This device is out of storage for messages. New messages stay on the server until space is freed.');
    } catch { /* no toast host */ }
  }

  /** Account switch / sign-out: forget everything of the previous account. */
  reset(): void {
    this.gen++;
    const old = this.storePromise;
    this.storePromise = null;
    this.storeKey = null;
    this.deviceIdPromise = null;
    this.syncing = null;
    this.ackQueue.clear();
    if (this.ackTimer) { clearTimeout(this.ackTimer); this.ackTimer = null; }
    for (const u of this.objectUrls.splice(0)) { try { URL.revokeObjectURL(u); } catch { /* */ } }
    this.media.set({});
    this.mediaInflight.clear();
    this.freshStore.set(false);
    this.storageFull.set(false);
    if (old) void old.then(s => s.close()).catch(() => undefined);
  }

  // ── Sync + ack ─────────────────────────────────────────────────────

  /** Pull everything pending for this device → store → ack. Single-flight. */
  sync(): Promise<ChatApplied> {
    if (this.syncing) return this.syncing;
    const run = this.runSync().finally(() => { if (this.syncing === run) this.syncing = null; });
    this.syncing = run;
    return run;
  }

  private async runSync(): Promise<ChatApplied> {
    const gen = this.gen;
    const out: ChatApplied = { messages: [], updated: [] };
    const device = await this.deviceId();
    let after = 0;
    for (let round = 0; round < 50; round++) {
      if (gen !== this.gen) break;
      const page = await firstValueFrom(this.api.get<SyncPage>(
        `/api/chat/sync?deviceId=${encodeURIComponent(device)}&after=${after}&limit=200`));
      if (gen !== this.gen) break;
      const items = page && Array.isArray(page.items) ? page.items : [];
      if (!items.length) break;
      const applied = await this.applyItems(items, gen);
      out.messages.push(...applied.result.messages);
      out.updated.push(...applied.result.updated);
      if (applied.stored.length) await this.ackNow(applied.stored, device, gen);
      if (!page.hasMore) break;
      after = page.next;
    }
    return out;
  }

  /** Store items in order; returns what was stored (ackable) and the result. */
  private async applyItems(items: ChatSyncItem[], gen: number): Promise<{ stored: string[]; result: ChatApplied }> {
    const s = await this.store();
    const stored: string[] = [];
    const result: ChatApplied = { messages: [], updated: [] };
    const sorted = [...items].sort((a, b) => a.seq - b.seq);
    for (const it of sorted) {
      if (gen !== this.gen) break;
      if (it.v != null && it.v > SUPPORTED_ENVELOPE) continue;   // newer envelope: leave it for an updated app
      try {
        if (it.kind === 'message' && it.message) {
          result.messages.push(...await s.putMessages([it.message]));
          stored.push(it.message.id);
        } else if (it.kind === 'event' && it.event) {
          const upd = await s.applyEvent(it.event);
          if (upd) result.updated.push(upd);
          stored.push(it.event.id);        // applied, or nothing local to apply it to
        }
      } catch (e) {
        if (e instanceof ChatStorageFullError) { this.markFull(); break; }
        throw e;
      }
    }
    return { stored, result };
  }

  private async ackNow(ids: string[], device: string, gen: number): Promise<void> {
    if (!ids.length || gen !== this.gen) return;
    try {
      await firstValueFrom(this.api.post('/api/chat/sync/ack', { deviceId: device, ids }));
    } catch { /* not acked → the next sync re-delivers; storage dedupes by id */ }
  }

  /** Ack soon (batched) — only ever called AFTER the item was stored. */
  private ackSoon(id: string): void {
    this.ackQueue.add(id);
    if (this.ackTimer) return;
    const gen = this.gen;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      const ids = [...this.ackQueue];
      this.ackQueue.clear();
      void this.deviceId().then(d => this.ackNow(ids, d, gen));
    }, 250);
  }

  /** A realtime MessageReceived: store it, then ack. Returns the stored row. */
  async storeLive(m: ChatMessage): Promise<ChatMessage | null> {
    const gen = this.gen;
    try {
      const s = await this.store();
      if (gen !== this.gen) return null;
      const [row] = await s.putMessages([m]);
      if (row) this.ackSoon(row.id);
      return row ?? null;
    } catch (e) {
      if (e instanceof ChatStorageFullError) this.markFull();
      return null;
    }
  }

  /** My own send, as the server returned it (the sending device is already
   *  acked server-side — just keep it). */
  async storeOwn(m: ChatMessage): Promise<void> {
    try { await (await this.store()).putMessages([m]); } catch { /* the sync after reconnect repairs it */ }
  }

  /** A realtime edit / delete / pin / reaction. Acks its eventId once applied. */
  async applyLiveEvent(e: ChatRelayEvent & { eventId?: string }): Promise<ChatMessage | null> {
    const gen = this.gen;
    try {
      const s = await this.store();
      if (gen !== this.gen) return null;
      const upd = await s.applyEvent(e);
      if (e.eventId) this.ackSoon(e.eventId);
      return upd;
    } catch { return null; }
  }

  // ── Reads (the UI's history comes from here) ───────────────────────

  async recent(convId: string, limit: number, beforeSentAt?: string | null): Promise<ChatMessage[]> {
    return (await this.store()).recent(convId, limit, beforeSentAt);
  }
  async search(convId: string, q: string): Promise<ChatMessage[]> {
    return (await this.store()).search(convId, q);
  }
  async pinned(convId: string): Promise<ChatMessage[]> {
    return (await this.store()).pinned(convId);
  }
  async summary(convId: string, me: string, lastReadAt?: string | null) {
    return (await this.store()).summary(convId, me, lastReadAt);
  }

  /**
   * One-time (per account + device + conversation) import of history the
   * server still holds from before the relay (and anything not yet cleaned
   * up). Never acked — these are not deliveries to this device.
   */
  async importLegacy(convId: string): Promise<number> {
    const gen = this.gen;
    const s = await this.store();
    const key = `legacy:${convId}`;
    if (await s.getMeta<boolean>(key)) return 0;
    let n = 0;
    try {
      for (let page = 0; page < 5; page++) {
        const rows = await firstValueFrom(this.api.get<ChatMessage[]>(
          `/api/chat/conversations/${convId}/messages?skip=${page * 200}&take=200`)) ?? [];
        if (gen !== this.gen) return n;
        if (!Array.isArray(rows) || !rows.length) break;
        n += (await s.putMessages(rows.map(r => ({ ...r, conversationId: r.conversationId ?? convId })))).length;
        if (rows.length < 200) break;
      }
      if (gen === this.gen) await s.setMeta(key, true);
    } catch (e) {
      if (e instanceof ChatStorageFullError) this.markFull();
      /* else: offline / forbidden — try again next time */
    }
    return n;
  }

  // ── Attachments ────────────────────────────────────────────────────

  private apiBase(): string {
    return this.injector.get(PlatformService, null)?.getApiUrl?.() ?? '';
  }

  /** Synchronous src for templates: the cached blob: URL, '' while loading /
   *  unavailable. Kicks off the one-time download. */
  mediaSrc(url: string | null | undefined, sentAt?: string | null): string {
    if (!url) return '';
    const base = this.apiBase();
    const path = uploadPathOf(url, base);
    if (!isPrivateUploadPath(path)) return absoluteApiUrl(path, base);
    const v = this.media()[path];
    if (v && v !== 'loading' && v !== 'unavailable') return v;
    if (!v) void this.loadMedia(path, sentAt);
    return '';
  }

  mediaState(url: string | null | undefined): ChatMediaState {
    if (!url) return 'none';
    const path = uploadPathOf(url, this.apiBase());
    if (!isPrivateUploadPath(path)) return 'ready';
    const v = this.media()[path];
    return !v || v === 'loading' ? 'loading' : v === 'unavailable' ? 'unavailable' : 'ready';
  }

  /** The bytes of an attachment: local copy first, else download once + keep. */
  async mediaBlob(url: string, sentAt?: string | null): Promise<Blob | null> {
    const path = uploadPathOf(url, this.apiBase());
    const s = await this.store();
    const local = await s.getBlob(path);
    if (local) return local;
    const r = await this.download(path);
    if (r.blob) await s.putBlob(path, r.blob, sentAt);
    return r.blob;
  }

  private loadMedia(path: string, sentAt?: string | null): Promise<void> {
    const have = this.mediaInflight.get(path);
    if (have) return have;
    const gen = this.gen;
    this.media.update(m => ({ ...m, [path]: 'loading' }));
    const p = (async () => {
      const s = await this.store();
      let blob = (await s.getBlob(path)) ?? null;
      let gone = false;
      if (!blob) {
        const r = await this.download(path);
        blob = r.blob; gone = r.gone;
        if (blob) await s.putBlob(path, blob, sentAt);
      }
      if (gen !== this.gen) return;
      if (blob) {
        const u = URL.createObjectURL(blob);
        this.objectUrls.push(u);
        this.media.update(m => ({ ...m, [path]: u }));
      } else if (gone) {
        this.media.update(m => ({ ...m, [path]: 'unavailable' }));
      } else {
        // Offline / transient: forget the attempt so the next render retries.
        this.media.update(m => { const n = { ...m }; delete n[path]; return n; });
      }
    })().catch(() => undefined).finally(() => this.mediaInflight.delete(path));
    this.mediaInflight.set(path, p);
    return p;
  }

  /** GET /api/uploads/file — `gone` when the server no longer has it (404). */
  private async download(path: string): Promise<{ blob: Blob | null; gone: boolean }> {
    try {
      const http = this.injector.get(HttpClient);
      const blob = await firstValueFrom(http.get(`${this.apiBase()}/api/uploads/file`,
        { params: { path }, responseType: 'blob' }));
      return { blob, gone: false };
    } catch (e) {
      return { blob: null, gone: e instanceof HttpErrorResponse && (e.status === 404 || e.status === 410) };
    }
  }

  /** Open an attachment: from the device copy when there is one, else a
   *  short-lived signed link. false = it's gone everywhere. */
  async openMedia(url: string, sentAt?: string | null): Promise<boolean> {
    // Native shells can't reliably open a blob: URL in a new window — they
    // open the server's signed link (the existing path) while it exists.
    if (this.injector.get(PlatformService, null)?.isCapacitor?.() && this.mediaState(url) !== 'unavailable') {
      await this.injector.get(UploadsService).open(url);
      return true;
    }
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    const blob = await this.mediaBlob(url, sentAt);
    if (!blob) {
      tab?.close();
      const path = uploadPathOf(url, this.apiBase());
      this.media.update(m => ({ ...m, [path]: 'unavailable' }));
      return false;
    }
    const u = URL.createObjectURL(blob);
    this.objectUrls.push(u);
    if (tab) { tab.opener = null; tab.location.href = u; }
    else window.open(u, '_blank', 'noopener');
    return true;
  }
}

function randomHex(n: number): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(Math.ceil(n / 2));
    c.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, '0')).join('').slice(0, n);
  }
  let s = '';
  while (s.length < n) s += Math.random().toString(16).slice(2);
  return s.slice(0, n);
}
