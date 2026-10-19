'use strict';
/**
 * Two-way side of the analyzer simulator: ask the host which tests to run on
 * a barcode (ASTM Q record, HL7 QRY^Q02, HL7 QBP^Q11) and accept a worklist
 * download (ASTM H/P/O/L session or HL7 ORM^O01 / OML^O21, answering ACK).
 *
 * Generic, standards-shaped — not any vendor's exact bytes. `io` is the
 * { write(bytes), onData(cb) } pipe the other sims use.
 */
const { AstmSender, AstmReceiver } = require('../core/link/astm-e1381');
const { MllpReceiver, frame: mllpFrame } = require('../core/link/mllp');
const { buildAck } = require('../core/parsers/hl7');
const { ts } = require('./dialects');

function split(text) { return String(text).split(/\r\n|\r|\n/).filter(Boolean); }

/** E1394 H/P/O/L → [{ sampleId, tests:[code], priority, action, report, patient:{id,name}|null }] */
function parseAstmOrders(text) {
  const out = [];
  let patient = null;
  const d = { f: '|', r: '\\', c: '^', e: '&' };
  const un = (v) => String(v).replace(/&([FSRE])&/g, (_m, k) => ({ F: d.f, S: d.c, R: d.r, E: d.e }[k]));
  for (const rec of split(text)) {
    const p = rec.split('|');
    if (rec[0] === 'P') patient = { id: un(p[2] || ''), name: un(p[5] || '').trim() || null };
    if (rec[0] === 'O') {
      out.push({
        sampleId: un((p[2] || '').split('^').pop() || p[3] || ''),
        tests: (p[4] || '').split('\\').map((t) => t.split('^')[3]).filter(Boolean).map(un),
        priority: p[5], action: p[11], report: p[25], specimen: un(p[15] || ''), patient: patient && (patient.id || patient.name) ? patient : null,
      });
    }
  }
  return out;
}

/** HL7 ORM/OML/RSP → same shape; reads OBR-4 codes, OBR-3/2 sample id. */
function parseHl7Orders(text) {
  const out = []; let pid = null; let cur = null;
  const un = (v) => String(v).replace(/\\([FSTRE])\\/g, (_m, k) => ({ F: '|', S: '^', T: '&', R: '~', E: '\\' }[k])).replace(/\\\.br\\/g, '\n');
  for (const seg of split(text)) {
    const p = seg.split('|');
    if (p[0] === 'PID') pid = { id: un(p[3] || ''), name: (p[5] || '').split('^').reverse().map(un).join(' ').trim() };
    if (p[0] === 'OBR') {
      const sid = un(p[3] || p[2] || '');
      if (!cur || cur.sampleId !== sid) { cur = { sampleId: sid, tests: [], priority: p[5], patient: pid }; out.push(cur); }
      cur.tests.push(un((p[4] || '').split('^')[0]));
    }
  }
  return out;
}

/** DSR^Q03 (mindray-bs layout; `autolab` for the Autolab one) → { sampleId, patientId, name, tests }. */
function parseDsr(text, layout = 'mindray-bs') {
  const row = {};
  for (const seg of split(text)) { const p = seg.split('|'); if (p[0] === 'DSP') row[Number(p[1])] = p[3]; }
  const unq = (v) => (v == null ? v : String(v).replace(/\\([FSTRE])\\/g, (_m, k) => ({ F: '|', S: '^', T: '&', R: '~', E: '\\' }[k])));
  const first = layout === 'autolab' ? 5 : 29;
  const tests = Object.keys(row).map(Number).filter((n) => n >= first).sort((a, b) => a - b).map((n) => row[n].split('^')[0]);
  return layout === 'autolab'
    ? { sampleId: null, patientId: unq(row[1]), name: unq(row[2]), tests }
    : { sampleId: row[21], patientId: unq(row[1]), name: unq(row[3]), tests };
}

class QuerySim {
  /**
   * @param {{write:Function,onData:Function}} io
   * @param {{kind:'astm'|'hl7', timeoutMs?:number, ackCode?:(msg:string,n:number)=>string}} o
   */
  constructor(io, o = {}) {
    this.io = io;
    this.kind = o.kind || 'astm';
    this.timeoutMs = o.timeoutMs || 8000;
    this.ackCode = o.ackCode || (() => 'AA');
    this.received = [];        // every host→analyzer message we got (text)
    this.waiters = [];
    this.worklist = [];        // parsed orders accepted via worklist
    this.ackCount = 0;
    if (this.kind === 'astm') {
      this.sender = new AstmSender({ write: io.write, ackTimeoutMs: 5000, busyRetryMs: 200 });
      this.rx = new AstmReceiver({ write: io.write });
      this.rx.on('message', (t) => this._got(t));
      io.onData((b) => { this.sender.feed(b); this.rx.feed(b); });
    } else {
      this.rx = new MllpReceiver({
        write: io.write,
        reply: (t) => {
          // The analyzer ACKs an ORM/OML (worklist); it does not ACK QCK/DSR/RSP.
          if (!/^(?:\x0b)?MSH\|[^\r]*\|(ORM|OML)\^/m.test(t)) return null;
          const code = this.ackCode(t, ++this.ackCount);
          if (!code) return null;
          const ack = buildAck(t, { code });
          // o.ackRef(text) lets a test emulate an analyzer that echoes a wrong/empty MSA-2
          return o.ackRef ? ack.replace(/(\rMSA\|[A-Z]+\|)[^\r]*/, (_m, pre) => `${pre}${o.ackRef(t)}`) : ack;   // a falsy code = the analyzer stays silent (ACK timeout test)
        },
      });
      this.rx.on('message', (t) => this._got(t));
      io.onData((b) => this.rx.feed(b));
    }
  }

  _got(text) {
    this.received.push(text);
    if (/MSH\|[^\r]*\|(ORM|OML)\^/.test(text) || (this.kind === 'astm' && !this.waiters.length)) this.worklist.push(...(this.kind === 'astm' ? parseAstmOrders(text) : parseHl7Orders(text)));
    const w = this.waiters.splice(0);
    w.forEach((f) => f(text));
  }

  _next(match) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== h); resolve(null); }, this.timeoutMs);
      const h = (text) => { if (match && !match(text)) { this.waiters.push(h); return; } clearTimeout(t); resolve(text); };
      this.waiters.push(h);
    });
  }

  /** ASTM: Q|1|<patient>^<specimen>… ; resolves { orders, noInfo, text } (text null = no reply). */
  async queryAstm(sampleId, { end, comp = 2, tests = 'ALL', fn } = {}) {
    const idf = (id) => `${'^'.repeat(comp - 1)}${id}`;
    const msg = [
      `H|\\^&|||SIM-CHEM^1.0|||||||P|LIS2-A2|${ts()}`,
      `Q|1|${idf(sampleId)}|${end ? idf(end) : ''}|^^^${tests}|||||||||O`,
      'L|1|N',
    ].join('\r') + '\r';
    const reply = this._next();
    await this.sender.send(msg);
    const text = await reply;
    if (!text) return { orders: [], noInfo: null, text: null };
    const noInfo = /(^|\r)L\|1\|I/.test(text);
    return { orders: parseAstmOrders(text), noInfo, text };
  }

  /** HL7 original-mode query QRY^Q02 → { qck, dsr, ... } */
  async queryQ02(sampleId) {
    const ctrl = `Q${Date.now().toString(36)}`;
    const msg = [`MSH|^~\\&|BS-240|LAB|PREFRONTAL|LIS|${ts()}||QRY^Q02|${ctrl}|P|2.3.1`, `QRD|${ts()}|R|D|1|||1^RD|${sampleId}|OTH|||T`, 'QRF|SIM-CHEM'].join('\r') + '\r';
    const first = this._next((t) => /\|QCK\^Q02\|/.test(t));
    this.io.write(mllpFrame(msg));
    const qck = await first;
    if (!qck) return { qck: null, found: false, text: null };
    const found = /QAK\|SR\|OK/.test(qck);
    let dsr = null;
    if (found) dsr = this.received.find((t) => /\|DSR\^Q03\|/.test(t)) || await this._next((t) => /\|DSR\^Q03\|/.test(t));
    return { qck, dsr, found, order: dsr ? parseDsr(dsr) : null, text: dsr || qck };
  }

  /** IHE LAW WOS query QBP^Q11 → RSP^K11 */
  async queryQ11(sampleId) {
    const ctrl = `B${Date.now().toString(36)}`;
    const msg = [`MSH|^~\\&|SIM-CHEM|LAB|PREFRONTAL|LIS|${ts()}||QBP^Q11^QBP_Q11|${ctrl}|P|2.5.1`, `QPD|WOS^Work Order Step^IHE_LABTF|TAG${ctrl}|${sampleId}`, 'RCP|I||R'].join('\r') + '\r';
    const reply = this._next((t) => /\|RSP\^K11/.test(t));
    this.io.write(mllpFrame(msg));
    const rsp = await reply;
    if (!rsp) return { rsp: null, found: false, orders: [] };
    return { rsp, found: /QAK\|[^|]*\|OK/.test(rsp), orders: parseHl7Orders(rsp), text: rsp };
  }

  /** Wait for the host to download N worklist messages. */
  async waitWorklist(n, ms = 8000) {
    const until = Date.now() + ms;
    while (this.worklist.length < n && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
    return this.worklist;
  }
}

module.exports = { QuerySim, parseAstmOrders, parseHl7Orders, parseDsr };
