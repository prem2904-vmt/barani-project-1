'use strict';
/**
 * Two-way (bidirectional) interfacing for ONE connector. Host-agnostic Node.
 *
 *   mode "query"     the analyzer reads a tube barcode and asks us (ASTM Q,
 *                    HL7 QRY^Q02, QBP^Q11); we answer from the LMS in <= 4 s,
 *                    else from the local cache, else "no order".
 *   mode "worklist"  every worklistPollSeconds we fetch the pending samples and
 *                    push each (once; again only if its tests changed).
 *   mode "both"      both.
 *   mode "off" / no block   this object is inert: intercept() returns false and
 *                    suppressAck() false, so the connector behaves exactly as
 *                    it did before this feature existed.
 *
 * We never invent tests (answers are only what the server — or an earlier
 * server answer in the cache — said) and never leave the analyzer hanging
 * (hard 4 s server ceiling; every failure ends in a protocol-correct "no
 * information"). We never start a run: the tube must be loaded on the analyzer.
 */
const { parseAstmQueries, hasQuery, hasResults, buildAstmOrders, buildAstmNoInfo, buildAstmRefused, astmTs, DEFAULT_DELIMS } = require('./astm');
const { classifyHl7, buildQck, buildDsr, buildRsp, buildWorklistMessage } = require('./hl7');
const { SentJournal, OrderCache } = require('./store');
const { AstmSender } = require('../link/astm-e1381');
const { frame: mllpFrame } = require('../link/mllp');

const MODES = ['off', 'query', 'worklist', 'both'];
const clamp = (n, lo, hi, d) => { const v = Number(n); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

/** Normalise the `bidirectional` block (contract §1). Unknown mode → off. */
function normalizeBidi(raw) {
  const b = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.includes(b.mode) ? b.mode : 'off';
  return {
    mode,
    sendPatient: !!b.sendPatient,
    hl7Query: ['auto', 'qry_q02', 'qbp_q11'].includes(b.hl7Query) ? b.hl7Query : 'auto',
    hl7Order: b.hl7Order === 'oml_o21' ? 'oml_o21' : 'orm_o01',
    hl7Dialect: typeof b.hl7Dialect === 'string' && b.hl7Dialect !== 'auto' ? b.hl7Dialect : '',   // '' = auto from MSH-3/4
    worklistWindowHours: clamp(b.worklistWindowHours, 1, 168, 24),
    worklistPollSeconds: clamp(b.worklistPollSeconds, 15, 3600, 60),
    astmQueryComponent: Number(b.astmQueryComponent) >= 1 ? Number(b.astmQueryComponent) : 0,
    astmActionCode: typeof b.astmActionCode === 'string' && b.astmActionCode ? b.astmActionCode[0].toUpperCase() : '',   // '' = A for query replies, N for worklist downloads
    qrdSampleField: Number(b.qrdSampleField) || 0,
    qpdSampleField: Number(b.qpdSampleField) || 0,
  };
}

class BidiHost {
  /**
   * @param {object} c   the Connector (uses c.uploader, c.rawlog, c.links, c.transport, c.now, c.dataDir)
   * @param {object} [opts] test knobs: queryTimeoutMs, ackTimeoutMs, holdMs, retryBaseMs, retries, pollMs, idleWaitMs
   */
  constructor(c, opts = {}) {
    this.c = c;
    this.opts = { queryTimeoutMs: 4000, ackTimeoutMs: 5000, holdMs: 200, retryBaseMs: 2000, retries: 2, idleWaitMs: 20000, ...opts };
    this.sent = new SentJournal({ dir: c.dataDir, now: c.now });
    this.cache = new OrderCache({ dir: c.dataDir, now: c.now });
    this.senders = new Map();      // sessionId → AstmSender currently transmitting
    this.chains = new Map();       // sessionId → Promise (serialises our transmissions per session)
    this.ackWaiters = new Map();   // HL7 control id → resolve(code)
    this.failures = new Map();     // sampleId → { n, nextAt }
    this.timer = null;
    this.ticking = false;
    this.stopped = true;
    this.day = null;
    this.counters = this._zero();
    this.lastQueryAt = null;
    this.lastWorklistAt = null;
    this.lastError = null;
  }

  _zero() { return { queriesAnswered: 0, queriesNotFound: 0, queriesFromCache: 0, queryErrors: 0, worklistSent: 0, worklistFailed: 0 }; }

  cfg() {
    const c = this.c;
    const raw = (c.active && c.active.bidirectional) || (c.remote && c.remote.bidirectional) || (c.remote && c.remote.config && c.remote.config.bidirectional);
    return normalizeBidi(raw);
  }

  mode() { return this.cfg().mode; }
  answersQueries() { const m = this.mode(); return m === 'query' || m === 'both'; }
  sendsWorklist() { const m = this.mode(); return m === 'worklist' || m === 'both'; }
  active() { return this.mode() !== 'off'; }

  summary() {
    const cfg = this.cfg();
    return { mode: cfg.mode, ...this.counters, lastQueryAt: this.lastQueryAt, lastWorklistAt: this.lastWorklistAt, cachedOrders: this.cache.map.size, lastError: this.lastError };
  }

  _note(msg) { this.c.rawlog.write('note', `two-way: ${msg}`); }
  _rollDay() {
    const d = new Date(this.c.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    if (this.day !== d) { this.day = d; this.counters = this._zero(); }
  }
  _bump(k) { this._rollDay(); this.counters[k]++; this.c._emitStatus(); }

  // ── lifecycle ────────────────────────────────────────────────────────
  start() {
    this.stopped = false;
    this._schedule(this.opts.firstPollMs ?? 1500);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    for (const [, res] of this.ackWaiters) res(null);
    this.ackWaiters.clear();
    this.senders.clear();
  }

  _schedule(ms) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try { await this.worklistTick(); } catch (e) { this.lastError = `worklist: ${e.message}`; }
      this._schedule(this.opts.pollMs ?? this.cfg().worklistPollSeconds * 1000);
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  // ── inbound hooks (called by the connector) ──────────────────────────
  /** Called for every link-delivered message. true = consumed (do not parse as results). */
  intercept(text, meta, sessionId) {
    if (!this.active()) return false;
    try {
      if (meta && meta.link === 'astm-e1381') {
        if (!this.answersQueries() || !hasQuery(text)) return false;
        const mixed = hasResults(text);
        this._run(sessionId, () => this._answerAstm(text, sessionId)).catch(() => {});
        return !mixed;
      }
      if (meta && meta.link === 'mllp') {
        const cl = classifyHl7(text, this.cfg());
        if (!cl) return false;
        if (cl.kind === 'ack') {
          if (!this.sendsWorklist()) return false;
          const res = this.ackWaiters.get(cl.ref);
          if (res) { this.ackWaiters.delete(cl.ref); res(cl.code); } else this._note(`unmatched ACK ${cl.code} for ${cl.ref} ignored`);
          return true;
        }
        if (!this.answersQueries()) return false;
        this._answerHl7(cl, sessionId).catch((e) => this._note(`query answer failed: ${e.message}`));
        return true;
      }
    } catch (e) { this._note(`inbound error: ${e.message}`); }
    return false;
  }

  /** The default HL7 ACK must NOT be sent for a query we answer ourselves, nor for an ACK. */
  suppressAck(text) {
    if (!this.active()) return false;
    const cl = classifyHl7(text, this.cfg());
    if (!cl) return false;
    if (cl.kind === 'ack') return this.sendsWorklist();
    return this.answersQueries();
  }

  /** Raw inbound bytes for a session — feeds a transmitting AstmSender (ACK/NAK/EOT/ENQ). */
  feed(bytes, sessionId) { const s = this.senders.get(sessionId); if (s) s.feed(bytes); }

  _run(sessionId, fn) {
    const prev = this.chains.get(sessionId) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.chains.set(sessionId, next.catch(() => {}));
    return next;
  }

  // ── server lookups ───────────────────────────────────────────────────
  /** @returns {{status:'ok'|'notfound'|'error', dto?:object, fromCache?:boolean}} */
  async lookup(sampleId) {
    const t = this.opts.queryTimeoutMs;
    try {
      const dto = await this.c.uploader.getOrders(sampleId, { timeoutMs: t });
      if (dto && dto.found && (dto.tests || []).length) {
        this.cache.setTtl(this.cfg().worklistWindowHours * 3600 * 1000);
        this.cache.put(dto); this.cache.save();
        return { status: 'ok', dto };
      }
      return { status: 'notfound' };
    } catch (e) {
      this.lastError = `orders: ${e.message}`;
      // 409 (two-way off on the server) or any other non-retryable refusal: the
      // cache must not paper over it.
      if (e && e.kind === 'permanent') return { status: 'refused' };
      this.cache.setTtl(this.cfg().worklistWindowHours * 3600 * 1000);
      const cached = this.cache.get(sampleId);
      if (cached) return { status: 'ok', dto: cached, fromCache: true };
      return { status: 'error' };
    }
  }

  _filterTests(dto, tests) {
    if (!tests) return dto;
    const keep = (dto.tests || []).filter((t) => tests.includes(t.code));
    return keep.length ? { ...dto, tests: keep } : null;
  }

  // ── ASTM ─────────────────────────────────────────────────────────────
  async _answerAstm(text, sessionId) {
    const cfg = this.cfg();
    const link = this.c.links.get(sessionId);
    const { delims, header, queries } = parseAstmQueries(text, { queryComponent: cfg.astmQueryComponent });
    this._note(`ASTM query from analyzer: ${queries.length} request(s)`);
    for (const q of queries) {
      let orders = [];
      let errored = false;
      let refused = false;
      if (q.all) {
        let items = [];
        try {
          const w = await this.c.uploader.getWorklist({ timeoutMs: this.opts.queryTimeoutMs });
          items = (w && w.items) || [];
          this.cache.putMany(items);
        } catch { items = this.cache.all(); errored = !items.length; }
        orders = items.filter((d) => d.found && (d.tests || []).length).slice(0, 20);
      } else {
        const res = await Promise.all(q.ids.map((id) => this.lookup(id)));
        res.forEach((r) => {
          if (r.status === 'ok') { const d = this._filterTests(r.dto, q.tests); if (d) { orders.push(d); if (r.fromCache) this._bump('queriesFromCache'); } }
          else if (r.status === 'error') errored = true;
          else if (r.status === 'refused') refused = true;
        });
      }
      orders = orders.map((d) => this._filterTests(d, q.tests)).filter(Boolean);
      const ids = q.all ? '(ALL)' : q.ids.join(',');
      const sendOpts = { sender: 'PrefrontalLIS', receiver: header.sender, sampleIdField: this.c.active && this.c.active.parser && this.c.active.parser.astm && this.c.active.parser.astm.sampleIdField, sampleIdComponent: this.c.active && this.c.active.parser && this.c.active.parser.astm && this.c.active.parser.astm.sampleIdComponent, actionCode: cfg.astmActionCode || 'A', sendPatient: cfg.sendPatient };
      let out;
      if (orders.length) {
        out = buildAstmOrders(orders, delims, sendOpts);
        this._bump('queriesAnswered');
        this._note(`answered query ${ids}: ${orders.map((o) => `${o.sampleId}[${o.tests.map((t) => t.code).join(' ')}]`).join(' ')}`);
      } else {
        out = refused ? buildAstmRefused(q, delims, sendOpts) : buildAstmNoInfo(q, delims, sendOpts);
        this._bump(errored || refused ? 'queryErrors' : 'queriesNotFound');
        this._note(`query ${ids}: ${refused ? 'server refused' : errored ? 'server unavailable and nothing cached' : 'no order on record'} — sent ${refused ? 'L|1|Q' : '"no information" (L|1|I)'}`);
      }
      this.lastQueryAt = new Date(this.c.now()).toISOString();
      try { await this._sendAstm(sessionId, out); } catch (e) { this.lastError = `astm reply: ${e.message}`; this._note(`could not send the answer: ${e.message}`); this._bump('queryErrors'); }
    }
  }

  /** Send one E1394 message as a NEW E1381 session. We wait for the analyzer's
   *  EOT (E1381 contention rule: the analyzer's session wins; a crossed ENQ is
   *  answered by the analyzer's ACK from the receiver and our ENQ is retried
   *  after its EOT — AstmSender's beforeEnq gate), then bid for the line. */
  async _sendAstm(sessionId, message) {
    const link = this.c.links.get(sessionId);
    const waitIdle = async () => {
      const until = this.c.now() + this.opts.idleWaitMs;
      while (link && link.isBusy() && this.c.now() < until && !this.stopped) await sleep(25);
      if (link && link.isBusy()) throw new Error('line busy (analyzer session did not finish)');
      await sleep(this.opts.holdMs);
      while (link && link.isBusy() && this.c.now() < until && !this.stopped) await sleep(25);
    };
    const sender = new AstmSender({
      write: (b) => this.c._writeOut(b, sessionId),
      ackTimeoutMs: this.opts.ackTimeoutMs,
      busyRetryMs: this.opts.busyRetryMs ?? 1000,
      beforeEnq: waitIdle,
    });
    this.senders.set(sessionId, sender);
    try { await sender.send(message); } finally { if (this.senders.get(sessionId) === sender) this.senders.delete(sessionId); }
  }

  // ── HL7 ──────────────────────────────────────────────────────────────
  async _answerHl7(cl, sessionId) {
    const cfg = this.cfg();
    this._note(`HL7 ${cl.kind === 'qry_q02' ? 'QRY^Q02' : 'QBP^Q11'} query for ${cl.sampleId || '(no id)'}`);
    const r = cl.sampleId ? await this.lookup(cl.sampleId) : { status: 'notfound' };
    const dto = r.status === 'ok' ? r.dto : null;
    const asked = cl.kind;
    const shape = cfg.hl7Query === 'auto' ? asked : cfg.hl7Query;
    const now = new Date();
    const frames = [];
    if (shape === 'qry_q02') {
      frames.push(buildQck(cl, !!dto, { now }));
      if (dto) frames.push(buildDsr(cl, dto, { now, dialect: cfg.hl7Dialect, sendPatient: cfg.sendPatient }));
    } else {
      frames.push(buildRsp({ ...cl, qpd: cl.qpd || `QPD|WOS^Work Order Step^IHE_LABTF|${cl.queryId || ''}|${cl.sampleId}`, queryName: cl.queryName }, dto, { now, sendPatient: cfg.sendPatient }));
    }
    if (dto) { this._bump('queriesAnswered'); if (r.fromCache) this._bump('queriesFromCache'); this._note(`answered ${cl.sampleId}: ${dto.tests.map((t) => t.code).join(' ')}${r.fromCache ? ' (from cache)' : ''}`); }
    else { this._bump(r.status === 'error' || r.status === 'refused' ? 'queryErrors' : 'queriesNotFound'); this._note(`query ${cl.sampleId}: ${r.status === 'error' ? 'server unavailable and nothing cached' : 'no order on record'} — replied NF`); }
    this.lastQueryAt = new Date(this.c.now()).toISOString();
    for (const f of frames) this.c._writeOut(mllpFrame(f), sessionId);
  }

  // ── worklist ─────────────────────────────────────────────────────────
  _protocol() {
    const link = this.c.active && this.c.active.link;
    const t = link && link.type;
    if (t === 'astm-e1381' || t === 'astm') return 'astm';
    if (t === 'mllp' || t === 'hl7') return 'hl7';
    for (const l of this.c.links.values()) { if (l.type === 'astm-e1381') return 'astm'; if (l.type === 'mllp') return 'hl7'; }
    return null;
  }

  _pickSession() {
    for (const [id] of this.c.links) return id;
    return null;
  }

  /** One poll+download cycle (the scheduler calls this; tests call it directly). */
  async worklistTick() {
    if (this.ticking || this.stopped || !this.sendsWorklist()) return { skipped: true };
    this.ticking = true;
    try {
      const sessionId = this._pickSession();
      const protocol = this._protocol();
      if (!sessionId || !protocol) return { skipped: 'no analyzer connection' };
      let items;
      try {
        const w = await this.c.uploader.getWorklist({ timeoutMs: this.opts.worklistTimeoutMs ?? 10000 });
        items = ((w && w.items) || []).filter((d) => d && d.found !== false && (d.tests || []).length);
        this.cache.setTtl(this.cfg().worklistWindowHours * 3600 * 1000);
        this.cache.putMany(items);
      } catch (e) {
        this.lastError = `worklist: ${e.message}`;
        this._note(`worklist fetch failed: ${e.message}`);
        return { error: e.message };
      }
      const cfg = this.cfg();
      let sent = 0; let failed = 0;
      for (const dto of items.slice(0, 200)) {
        if (this.stopped) break;
        if (this.sent.isSent(dto)) continue;
        const f = this.failures.get(dto.sampleId);
        if (f && f.nextAt > this.c.now()) continue;
        const ok = await this._sendWorklistItem(sessionId, protocol, dto, cfg);
        if (ok) { this.sent.mark(dto); this.failures.delete(dto.sampleId); sent++; this._bump('worklistSent'); this.lastWorklistAt = new Date(this.c.now()).toISOString(); this._note(`worklist: sent ${dto.sampleId} [${dto.tests.map((t) => t.code).join(' ')}]`); }
        else {
          failed++; this._bump('worklistFailed');
          const n = (f ? f.n : 0) + 1;
          this.failures.set(dto.sampleId, { n, nextAt: this.c.now() + Math.min(10 * 60000, (this.opts.failBackoffMs ?? 15000) * 2 ** (n - 1)) });
        }
      }
      return { sent, failed, total: items.length };
    } finally { this.ticking = false; }
  }

  async _sendWorklistItem(sessionId, protocol, dto, cfg) {
    const attempts = 1 + this.opts.retries;
    for (let i = 0; i < attempts; i++) {
      try {
        if (protocol === 'astm') {
          const p = this.c.active && this.c.active.parser && this.c.active.parser.astm || {};
          const msg = buildAstmOrders([dto], DEFAULT_DELIMS, { sender: 'PrefrontalLIS', sampleIdField: p.sampleIdField, sampleIdComponent: p.sampleIdComponent, actionCode: cfg.astmActionCode || 'N', sendPatient: cfg.sendPatient });
          await this._run(sessionId, () => this._sendAstm(sessionId, msg));
          return true;
        }
        const { text, ctrl } = buildWorklistMessage(dto, { type: cfg.hl7Order, sendPatient: cfg.sendPatient });
        const waiter = new Promise((res) => {
          this.ackWaiters.set(ctrl, res);
          const t = setTimeout(() => { if (this.ackWaiters.delete(ctrl)) res('TIMEOUT'); }, this.opts.ackTimeoutMs);
          if (t.unref) t.unref();
        });
        this.c._writeOut(mllpFrame(text), sessionId);
        const code = await waiter;
        if (code === 'AA' || code === 'CA') return true;
        throw new Error(code === 'TIMEOUT' || code == null ? 'no ACK from the analyzer' : `analyzer answered ${code}`);
      } catch (e) {
        this.lastError = `worklist ${dto.sampleId}: ${e.message}`;
        this._note(`worklist ${dto.sampleId} attempt ${i + 1}/${attempts} failed: ${e.message}`);
        if (i + 1 < attempts) await sleep(this.opts.retryBaseMs * 2 ** i);
      }
    }
    return false;
  }
}

module.exports = { BidiHost, normalizeBidi, MODES, astmTs };
