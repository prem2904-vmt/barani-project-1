'use strict';
/**
 * Crash-safe local state for two-way interfacing, in the instrument's data
 * dir (same append-only-JSONL discipline as queue.js — a torn last line after
 * a crash is ignored):
 *
 *   bidi-sent.jsonl   {"id": sampleId, "hash": test-set hash, "at": iso}
 *                     one line per successful worklist download; last wins.
 *                     "Send each sample once; resend only if its tests changed."
 *   bidi-cache.json   orders the analyzer may be asked about while the server
 *                     is slow/offline: every worklist item and every successful
 *                     /orders answer, with the time it was fetched. Entries
 *                     older than the worklist window are never served — we
 *                     must not invent or resurrect tests.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Private files: the cache/journal hold barcodes + test lists — owner-only (0600), dir 0700. */
function privateDir(dir) { try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); } catch { /* best effort (e.g. Windows) */ } }

function testSetHash(dto) {
  const codes = (dto.tests || []).map((t) => String(t.code)).sort();
  return crypto.createHash('sha1').update(`${dto.sampleId}\n${dto.priority || ''}\n${codes.join(',')}`).digest('hex').slice(0, 16);
}

class SentJournal {
  constructor({ dir, now = Date.now, keepMs = 14 * 24 * 3600 * 1000 } = {}) {
    privateDir(dir);
    this.file = path.join(dir, 'bidi-sent.jsonl');
    this.marks = 0;
    this.now = now;
    this.keepMs = keepMs;
    this.map = new Map();
    this.lines = 0;
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) return;
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (!e || !e.id) continue;
      this.lines++;
      this.map.set(e.id, { hash: e.hash, at: e.at });
    }
    this._prune();
    if (this.lines > this.map.size * 2 + 200) this._compact();
  }

  _prune() {
    const cut = this.now() - this.keepMs;
    for (const [id, v] of this.map) if (Date.parse(v.at) < cut) this.map.delete(id);
  }

  _compact() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, [...this.map].map(([id, v]) => JSON.stringify({ id, ...v })).join('\n') + (this.map.size ? '\n' : ''), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    this.lines = this.map.size;
  }

  /** true when this sample was already downloaded with exactly this test set */
  isSent(dto) { const v = this.map.get(dto.sampleId); return !!v && v.hash === testSetHash(dto); }

  mark(dto) {
    const v = { hash: testSetHash(dto), at: new Date(this.now()).toISOString() };
    this.map.set(dto.sampleId, v);
    fs.appendFileSync(this.file, JSON.stringify({ id: dto.sampleId, ...v }) + '\n', { mode: 0o600 });
    this.lines++;
    // Runtime housekeeping (a connector can run for months): every 100 marks
    // drop entries past retention and compact the journal if it has grown.
    if (++this.marks % 100 === 0) {
      this._prune();
      if (this.lines > this.map.size * 2 + 200) this._compact();
    }
  }
}

const CACHE_MAX_TTL_MS = 4 * 3600 * 1000;

/**
 * Orders the analyzer may be asked about while the server blips. Rides out a
 * short outage only: TTL = min(worklist window, 4 h). Holds barcode + tests
 * ONLY (the patient is stripped before caching), never a "not found".
 */
class OrderCache {
  constructor({ dir, now = Date.now, ttlMs = CACHE_MAX_TTL_MS, max = 500 } = {}) {
    privateDir(dir);
    this.file = path.join(dir, 'bidi-cache.json');
    this.now = now;
    this.ttlMs = Math.min(ttlMs, CACHE_MAX_TTL_MS);
    this.max = max;
    this.map = new Map();
    this.key = null;            // config fingerprint the entries were cached under (mode + sendPatient)
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
      if (j.entries) { this.key = j.key || null; for (const [id, v] of Object.entries(j.entries)) this.map.set(id, v); }
    } catch { /* none yet / torn / old format */ }
  }

  setTtl(ms) { if (ms > 0) this.ttlMs = Math.min(ms, CACHE_MAX_TTL_MS); }

  put(dto) {
    if (!dto || !dto.sampleId || !dto.found || !(dto.tests || []).length) return;
    this.map.set(dto.sampleId, { at: this.now(), dto: { ...dto, patient: null } });
    this._trim();
  }

  putMany(items) { for (const d of items || []) this.put(d); this.save(); }

  /** Replace the cache with exactly this set (a successful worklist poll). */
  replace(items) { this.map.clear(); this.putMany(items); }

  delete(sampleId) { if (this.map.delete(sampleId)) this.save(); }

  clear() { if (this.map.size) { this.map.clear(); this.save(); } }

  get(sampleId) {
    const v = this.map.get(sampleId);
    if (!v) return null;
    if (this.now() - v.at > this.ttlMs) { this.map.delete(sampleId); return null; }
    return v.dto;
  }

  all() {
    const out = [];
    for (const [id] of this.map) { const d = this.get(id); if (d) out.push(d); }
    return out;
  }

  /** Purge when the config the entries were cached under changed (mode / sendPatient). */
  fingerprint(key) {
    if (this.key !== key) { const had = this.map.size; this.map.clear(); this.key = key; this.save(); return had > 0; }
    return false;
  }

  _trim() {
    if (this.map.size <= this.max) return;
    const sorted = [...this.map].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - this.max; i++) this.map.delete(sorted[i][0]);
  }

  save() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ key: this.key, entries: Object.fromEntries(this.map) }), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch { /* cache is best-effort */ }
  }
}

module.exports = { SentJournal, OrderCache, testSetHash, CACHE_MAX_TTL_MS };
