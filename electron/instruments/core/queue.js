'use strict';
/**
 * Store-and-forward queue on local disk: an append-only JSONL journal.
 *
 *   {"op":"add","id","key","payload","at"}      new message to upload
 *   {"op":"try","id","attempts","nextAt","err"}  failed attempt → backoff
 *   {"op":"done","id"}                          uploaded (server accepted)
 *   {"op":"dead","id","err"}                    permanently rejected (4xx) —
 *                                                also copied to dead.jsonl
 *   {"op":"seen","key"}                         (compaction) remembered key
 *
 * Replaying the journal rebuilds the state, so a crash / power cut / restart
 * loses nothing that was acknowledged to the analyzer. The idempotency key
 * (sha256 of instrument id + raw message) de-duplicates re-sends at BOTH
 * ends: add() ignores a key it has already seen, and the server's unique
 * index ignores a key it has already stored.
 */
const fs = require('fs');
const path = require('path');

class DiskQueue {
  /**
   * @param {{dir:string, name?:string, baseDelayMs?:number, maxDelayMs?:number,
   *          rememberKeys?:number, now?:()=>number, random?:()=>number}} opts
   */
  constructor({ dir, name = 'queue', baseDelayMs = 2000, maxDelayMs = 5 * 60 * 1000, rememberKeys = 5000, now, random } = {}) {
    if (!dir) throw new Error('DiskQueue: dir is required');
    this.dir = dir;
    this.file = path.join(dir, `${name}.jsonl`);
    this.deadFile = path.join(dir, `${name}.dead.jsonl`);
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
    this.rememberKeys = rememberKeys;
    this.now = now || Date.now;
    this.random = random || Math.random;
    this.items = new Map();     // id → { id, key, payload, attempts, nextAt, lastError }
    this.seen = new Set();      // idempotency keys already done (bounded)
    this.seenOrder = [];
    this.journalLines = 0;
    this.inflight = new Set();
    this.loaded = false;
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.items.clear();
    this.seen.clear();
    this.seenOrder = [];
    this.journalLines = 0;
    if (fs.existsSync(this.file)) {
      const text = fs.readFileSync(this.file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let e;
        try { e = JSON.parse(line); } catch { continue; } // torn last line after a crash
        this.journalLines++;
        this._apply(e);
      }
    }
    this.loaded = true;
    return this;
  }

  _remember(key) {
    if (!key || this.seen.has(key)) return;
    this.seen.add(key);
    this.seenOrder.push(key);
    while (this.seenOrder.length > this.rememberKeys) this.seen.delete(this.seenOrder.shift());
  }

  _apply(e) {
    switch (e.op) {
      case 'add':
        if (!this.items.has(e.id)) this.items.set(e.id, { id: e.id, key: e.key, payload: e.payload, attempts: 0, nextAt: 0, lastError: null, at: e.at });
        break;
      case 'try': {
        const it = this.items.get(e.id);
        if (it) { it.attempts = e.attempts; it.nextAt = e.nextAt; it.lastError = e.err || null; }
        break;
      }
      case 'done':
      case 'dead': {
        const it = this.items.get(e.id);
        if (it) { this._remember(it.key); this.items.delete(e.id); }
        break;
      }
      case 'seen':
        this._remember(e.key);
        break;
      default:
    }
  }

  _append(e) {
    fs.appendFileSync(this.file, JSON.stringify(e) + '\n');
    this.journalLines++;
    this._apply(e);
    if (this.journalLines > 2000 && this.journalLines > this.items.size * 4) this.compact();
  }

  hasKey(key) {
    if (this.seen.has(key)) return true;
    for (const it of this.items.values()) if (it.key === key) return true;
    return false;
  }

  /** @returns {{added:boolean, id:string|null}} */
  add({ key, payload }) {
    if (!this.loaded) this.load();
    if (key && this.hasKey(key)) return { added: false, id: null };
    this.seq = (this.seq || 0) + 1;
    const id = `${this.now().toString(36)}-${this.seq.toString(36)}-${Math.floor(this.random() * 1e9).toString(36)}`;
    this._append({ op: 'add', id, key, payload, at: new Date(this.now()).toISOString() });
    return { added: true, id };
  }

  /** Items whose backoff has elapsed and are not being uploaded right now. */
  due() {
    const t = this.now();
    return [...this.items.values()].filter((it) => it.nextAt <= t && !this.inflight.has(it.id));
  }

  begin(id) { this.inflight.add(id); }
  end(id) { this.inflight.delete(id); }

  done(id) { this.inflight.delete(id); if (this.items.has(id)) this._append({ op: 'done', id }); }

  /** Transient failure → exponential backoff with ±20 % jitter. */
  retry(id, err) {
    this.inflight.delete(id);
    const it = this.items.get(id);
    if (!it) return;
    const attempts = it.attempts + 1;
    const base = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** Math.min(attempts - 1, 20));
    const jitter = base * (0.8 + 0.4 * this.random());
    this._append({ op: 'try', id, attempts, nextAt: this.now() + Math.round(jitter), err: String(err || '').slice(0, 300) });
  }

  /** Permanent failure (server said the payload is invalid) → dead letter. */
  dead(id, err) {
    this.inflight.delete(id);
    const it = this.items.get(id);
    if (!it) return;
    fs.appendFileSync(this.deadFile, JSON.stringify({ ...it, err: String(err || ''), deadAt: new Date(this.now()).toISOString() }) + '\n');
    this._append({ op: 'dead', id, err: String(err || '').slice(0, 300) });
  }

  get length() { return this.items.size; }

  /** Nearest nextAt among pending items (ms epoch) or null. */
  nextDueAt() {
    let n = null;
    for (const it of this.items.values()) if (!this.inflight.has(it.id) && (n === null || it.nextAt < n)) n = it.nextAt;
    return n;
  }

  /** Rewrite the journal with only live state (atomic rename). */
  compact() {
    const tmp = `${this.file}.tmp`;
    const lines = [];
    for (const k of this.seenOrder) lines.push(JSON.stringify({ op: 'seen', key: k }));
    for (const it of this.items.values()) {
      lines.push(JSON.stringify({ op: 'add', id: it.id, key: it.key, payload: it.payload, at: it.at }));
      if (it.attempts) lines.push(JSON.stringify({ op: 'try', id: it.id, attempts: it.attempts, nextAt: it.nextAt, err: it.lastError }));
    }
    fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
    fs.renameSync(tmp, this.file);
    this.journalLines = lines.length;
  }
}

module.exports = { DiskQueue };
