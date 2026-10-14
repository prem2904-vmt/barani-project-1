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

function testSetHash(dto) {
  const codes = (dto.tests || []).map((t) => String(t.code)).sort();
  return crypto.createHash('sha1').update(`${dto.sampleId}\n${dto.priority || ''}\n${codes.join(',')}`).digest('hex').slice(0, 16);
}

class SentJournal {
  constructor({ dir, now = Date.now, keepMs = 14 * 24 * 3600 * 1000 } = {}) {
    this.file = path.join(dir, 'bidi-sent.jsonl');
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
    fs.writeFileSync(tmp, [...this.map].map(([id, v]) => JSON.stringify({ id, ...v })).join('\n') + (this.map.size ? '\n' : ''));
    fs.renameSync(tmp, this.file);
    this.lines = this.map.size;
  }

  /** true when this sample was already downloaded with exactly this test set */
  isSent(dto) { const v = this.map.get(dto.sampleId); return !!v && v.hash === testSetHash(dto); }

  mark(dto) {
    const v = { hash: testSetHash(dto), at: new Date(this.now()).toISOString() };
    this.map.set(dto.sampleId, v);
    fs.appendFileSync(this.file, JSON.stringify({ id: dto.sampleId, ...v }) + '\n');
    this.lines++;
  }
}

class OrderCache {
  constructor({ dir, now = Date.now, ttlMs = 24 * 3600 * 1000, max = 500 } = {}) {
    this.file = path.join(dir, 'bidi-cache.json');
    this.now = now;
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map();
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const [id, v] of Object.entries(j || {})) this.map.set(id, v);
    } catch { /* none yet / torn */ }
  }

  setTtl(ms) { if (ms > 0) this.ttlMs = ms; }

  put(dto) {
    if (!dto || !dto.sampleId || !dto.found || !(dto.tests || []).length) return;
    this.map.set(dto.sampleId, { at: this.now(), dto });
    this._trim();
  }

  putMany(items) { for (const d of items || []) this.put(d); this.save(); }

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

  _trim() {
    if (this.map.size <= this.max) return;
    const sorted = [...this.map].sort((a, b) => a[1].at - b[1].at);
    for (let i = 0; i < sorted.length - this.max; i++) this.map.delete(sorted[i][0]);
  }

  save() {
    try {
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.map)));
      fs.renameSync(tmp, this.file);
    } catch { /* cache is best-effort */ }
  }
}

module.exports = { SentJournal, OrderCache, testSetHash };
