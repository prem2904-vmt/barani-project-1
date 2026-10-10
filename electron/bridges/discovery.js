'use strict';
/**
 * mDNS browse for `_prefrontal-bridge._tcp` (bridge-api v1, B.5) in the main
 * process, with `multicast-dns` (pure JS, no native add-on). Queries on
 * start and every 10 s; a Bridge not heard for 75 s, or a goodbye (ttl 0),
 * is reported lost. Emits the same event shape as the native plugins.
 */
const { EventEmitter } = require('events');
const { SERVICE, parseResponse } = require('./mdns-parse');

const REQUERY_MS = 10_000;
const STALE_MS = 75_000;

class BridgeDiscovery extends EventEmitter {
  constructor(deps = {}) {
    super();
    this.factory = deps.factory || (() => require('multicast-dns')());
    this.now = deps.now || (() => Date.now());
    this.mdns = null;
    this.timer = null;
    this.seen = new Map(); // name → { at, event }
  }

  get running() { return !!this.mdns; }

  start() {
    if (this.mdns) return;
    this.mdns = this.factory();
    this.mdns.on('response', (p) => this.onResponse(p));
    this.mdns.on('error', (e) => this.emit('error', e));
    this.query();
    this.timer = setInterval(() => { this.query(); this.prune(); }, REQUERY_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.mdns) { try { this.mdns.destroy(); } catch { /* closed */ } }
    this.mdns = null;
    this.seen.clear();
  }

  query() {
    try { this.mdns && this.mdns.query({ questions: [{ name: SERVICE, type: 'PTR' }] }); } catch (e) { this.emit('error', e); }
  }

  onResponse(packet) {
    const { found, lost } = parseResponse(packet);
    for (const e of found) {
      const prev = this.seen.get(e.name);
      // Some responders answer PTR + SRV/TXT in separate packets: merge.
      const merged = prev ? {
        ...prev.event, ...Object.fromEntries(Object.entries(e).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length))),
      } : e;
      this.seen.set(e.name, { at: this.now(), event: merged });
      if (merged.txt && merged.txt.sn) this.emit('found', merged);
      else if (!prev) this.query();
    }
    for (const e of lost) {
      const prev = this.seen.get(e.name);
      this.seen.delete(e.name);
      this.emit('lost', prev ? prev.event : e);
    }
  }

  prune() {
    const cutoff = this.now() - STALE_MS;
    for (const [name, v] of this.seen) {
      if (v.at < cutoff) { this.seen.delete(name); this.emit('lost', v.event); }
    }
  }
}

module.exports = { BridgeDiscovery, REQUERY_MS, STALE_MS };
