'use strict';
/**
 * ASTM E1394-97 / CLSI LIS2-A2 host query (Request Information record "Q")
 * and the host's answer.
 *
 * Analyzer → host (one E1381 session):   H … , Q|1|<start range ID>|<end range ID>|<universal test ID>|… , L|1
 * Host → analyzer (a NEW E1381 session — the host becomes the sender, see
 * link/astm-e1381.js AstmSender):
 *     found      H , P , O (one per sample; report type O.26 = "O", an order
 *                in response to a query) , L|1|N
 *     no info    H , Q (echo of the request, Q.13 status "X") , L|1|I
 *
 * Standard references (E1394-97 / LIS2-A2 numbering; the record layouts are
 * identical in both — verify section numbers against your copy):
 *   - Request Information record  Q.1 type, Q.2 sequence, Q.3 starting range
 *     ID (patient ^ specimen ^ instrument-specimen components), Q.4 ending
 *     range ID, Q.5 universal test ID, … Q.13 request information status.
 *     The literal range ID "ALL" means every patient/specimen.
 *   - Test Order record O.3 specimen ID, O.4 instrument specimen ID,
 *     O.5 universal test ID (repeat-delimited list: ^^^GLU\^^^UREA),
 *     O.6 priority, O.12 action code, O.26 report type.
 *   - Message Terminator L.3 termination code: N normal, I "no information
 *     available from last query", Q "error in last request for information",
 *     F "last request processed". LIS2-A2 says a host with nothing to say
 *     answers I — NOT an empty O record and NOT silence.
 *   - Q.13 status X = request cannot be processed / not found.
 */
const { astmEscape } = require('./escape');

const DEFAULT_DELIMS = Object.freeze({ field: '|', repeat: '\\', component: '^', escape: '&' });
const MAX_RANGE = 20;

function delimitersFrom(hLine) {
  const field = hLine[1] || '|';
  const end = hLine.indexOf(field, 2);
  const enc = hLine.slice(2, end >= 0 ? end : 5);
  return { field, repeat: enc[0] || '\\', component: enc[1] || '^', escape: enc[2] || '&' };
}

function unescapeAstm(v, d) {
  if (!v || !d.escape || v.indexOf(d.escape) < 0) return v;
  const e = d.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return v.replace(new RegExp(`${e}([FSRE])${e}`, 'g'), (_m, k) => ({ F: d.field, S: d.component, R: d.repeat, E: d.escape }[k]));
}

function stripFn(line) {
  const l = line.replace(/^\x02/, '');
  return /^[0-7][HPOCRQLM][^A-Za-z0-9]/.test(l) ? l.slice(1) : l;
}

function recordsOf(text) {
  return String(text).split(/\r\n|\r|\n/).filter((l) => l.length > 0).map(stripFn);
}

/** True when the reassembled message carries at least one Q record. */
function hasQuery(text) {
  return recordsOf(text).some((r) => r[0] === 'Q' && /^Q[^A-Za-z0-9]/.test(r));
}

/** True when it also carries results/orders (a mixed session). */
function hasResults(text) {
  return recordsOf(text).some((r) => (r[0] === 'R' || r[0] === 'O') && /^[RO][^A-Za-z0-9]/.test(r));
}

/**
 * Which component of Q.3/Q.4 holds the barcode. `component` 1-based; unset
 * ("auto") = first non-empty of component 2 (specimen ID, the E1394 slot —
 * "^123456"), then 3 (instrument specimen ID), then 1 (patient ID slot —
 * several analyzers put the barcode there).
 */
function idsOf(value, d, component) {
  const out = [];
  for (const rep of String(value || '').split(d.repeat)) {
    const comps = rep.split(d.component).map((c) => unescapeAstm(c, d).trim());
    let id;
    if (component >= 1) id = comps[component - 1];
    else id = comps[1] || comps[2] || comps[0];
    if (id) out.push(id);
  }
  return out;
}

/** Expand a numeric range (same width digits) up to `cap`, else just the ends. */
function expandRange(start, end, cap) {
  if (!end || end === start) return { ids: [start], truncated: false };
  if (/^\d+$/.test(start) && /^\d+$/.test(end) && start.length === end.length) {
    const a = BigInt(start); const b = BigInt(end);
    if (b >= a) {
      const n = b - a + 1n;
      const count = Number(n > BigInt(cap) ? BigInt(cap) : n);
      const ids = [];
      for (let i = 0; i < count; i++) ids.push((a + BigInt(i)).toString().padStart(start.length, '0'));
      return { ids, truncated: n > BigInt(cap) };
    }
  }
  return { ids: [start, end], truncated: false };
}

/**
 * @param {string} text   reassembled E1394 message
 * @param {{queryComponent?:number, maxRange?:number, maxQueries?:number}} [cfg]
 * @returns {{delims:object, header:object, queries:Array<{seq:string, ids:string[], all:boolean, tests:string[]|null, truncated:boolean, raw:string}>}}
 */
function parseAstmQueries(text, cfg = {}) {
  const recs = recordsOf(text);
  const hLine = recs.find((l) => l[0] === 'H');
  const d = hLine ? delimitersFrom(hLine) : { ...DEFAULT_DELIMS };
  const hp = hLine ? hLine.split(d.field) : [];
  const header = { sender: (hp[4] || '').split(d.component).map((c) => unescapeAstm(c, d))[0] || '', receiver: (hp[9] || '') };
  const maxRange = cfg.maxRange || MAX_RANGE;
  const maxQueries = cfg.maxQueries || 10;
  const comp = Number(cfg.queryComponent) >= 1 ? Number(cfg.queryComponent) : 0;
  const queries = [];
  for (const rec of recs) {
    if (!/^Q[^A-Za-z0-9]/.test(rec)) continue;
    if (queries.length >= maxQueries) break;
    const p = rec.split(d.field);
    const startRaw = p[2] || '';
    const endRaw = p[3] || '';
    const all = /(^|[\^\\])ALL($|[\^\\])/i.test(startRaw) || /(^|[\^\\])ALL($|[\^\\])/i.test(endRaw);
    let ids = [];
    let truncated = false;
    if (!all) {
      const starts = idsOf(startRaw, d, comp);
      const ends = idsOf(endRaw, d, comp);
      for (let i = 0; i < starts.length; i++) {
        const r = expandRange(starts[i], ends[i] || (starts.length === 1 ? ends[0] : ''), maxRange);
        ids.push(...r.ids);
        if (r.truncated) truncated = true;
      }
      ids = [...new Set(ids)];
      if (ids.length > maxRange) { ids = ids.slice(0, maxRange); truncated = true; }
    }
    // Q.5 universal test ID: ^^^ALL (or empty) = every test; otherwise the
    // 4th component of each repeat is a specific analyzer test code.
    const tests = [];
    for (const rep of String(p[4] || '').split(d.repeat)) {
      const c = unescapeAstm(rep.split(d.component)[3] || '', d).trim();
      if (c && c.toUpperCase() !== 'ALL') tests.push(c);
    }
    queries.push({ seq: p[1] || String(queries.length + 1), ids, all, tests: tests.length ? tests : null, truncated, raw: rec });
  }
  return { delims: d, header, queries };
}

function astmTs(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function isoToTs(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : astmTs(d);
}

/** Build a record from {fieldNumber: value}; field 1 is the type. Values are
 *  pre-escaped by the caller (components need raw delimiters). */
function rec(type, map, d, minLen = 0) {
  const f = [type];
  for (const [k, v] of Object.entries(map)) f[Number(k) - 1] = v;
  for (let i = 0; i < f.length; i++) if (f[i] == null) f[i] = '';
  while (f.length < minLen) f.push('');
  return f.join(d.field);
}

function header(d, { now = new Date(), sender = 'PrefrontalLIS', receiver = '' } = {}) {
  const esc = (v) => astmEscape(v, d);
  return rec('H', { 2: `${d.repeat}${d.component}${d.escape}`, 5: `${esc(sender)}${d.component}1.0`, 10: esc(receiver), 12: 'P', 13: '1', 14: astmTs(now) }, d, 14);
}

function patientName(name, d) {
  const n = String(name || '').trim();
  if (!n) return '';
  const i = n.lastIndexOf(' ');
  const last = i > 0 ? n.slice(i + 1) : n;
  const first = i > 0 ? n.slice(0, i) : '';
  return `${astmEscape(last, d)}${d.component}${astmEscape(first, d)}`;
}

/**
 * H, then P + O per sample, then L|1|N.
 * @param {Array<object>} orders  DeviceOrdersDto[] (found, tests non-empty)
 * @param {object} d              delimiters
 * @param {{sampleIdField?:number, sampleIdComponent?:number, actionCode?:string, sendPatient?:boolean, filterTests?:string[]|null, now?:Date}} o
 */
function buildAstmOrders(orders, d = DEFAULT_DELIMS, o = {}) {
  const esc = (v) => astmEscape(v, d);
  const field = Number(o.sampleIdField) > 1 ? Number(o.sampleIdField) : 3;
  const compN = Number(o.sampleIdComponent) >= 1 ? Number(o.sampleIdComponent) : 1;
  const now = o.now || new Date();
  const lines = [header(d, { now, sender: o.sender, receiver: o.receiver })];
  orders.forEach((dto, i) => {
    const pt = o.sendPatient !== false ? dto.patient : null;
    const pmap = { 2: String(i + 1) };
    if (pt) {
      pmap[3] = esc(pt.id);
      pmap[6] = patientName(pt.name, d);
      pmap[8] = String(pt.dob || '').replace(/-/g, '');
      pmap[9] = esc(pt.sex || '');
      if (!pt.dob && pt.ageYears != null) pmap[15] = esc(`${pt.ageYears}Y`);   // no standard age field — user "special field 1"
    }
    lines.push(rec('P', pmap, d, 2));
    const tests = (dto.tests || []).filter((t) => !o.filterTests || o.filterTests.includes(t.code));
    const idVal = `${d.component.repeat(compN - 1)}${esc(dto.sampleId)}`;
    const omap = {
      2: '1',
      5: tests.map((t) => `${d.component}${d.component}${d.component}${esc(t.code)}`).join(d.repeat),
      6: dto.priority === 'urgent' ? 'S' : 'R',
      7: astmTs(now),
      8: isoToTs(dto.collectedAt),
      12: o.actionCode || 'A',
      16: esc(dto.specimen || ''),
      26: 'O',
    };
    omap[field] = idVal;
    if (field !== 3) omap[3] = '';
    lines.push(rec('O', omap, d, 26));
  });
  lines.push('L|1|N');
  return lines.join('\r') + '\r';
}

/**
 * LIS2-A2 "no information" answer: H, echo of the Q record with Q.13 = X,
 * L|1|I. `status` 'I' (default) — no information; callers may pass 'Q'.
 */
function buildAstmNoInfo(query, d = DEFAULT_DELIMS, o = {}) {
  const p = String(query.raw || '').split(d.field);
  const q = ['Q', p[1] || '1', p[2] || '', p[3] || '', p[4] || ''];
  while (q.length < 13) q.push('');
  q[12] = 'X';
  return [header(d, { now: o.now, sender: o.sender, receiver: o.receiver }), q.join(d.field), `L|1|${o.status || 'I'}`].join('\r') + '\r';
}

module.exports = { parseAstmQueries, hasQuery, hasResults, buildAstmOrders, buildAstmNoInfo, expandRange, astmTs, MAX_RANGE, DEFAULT_DELIMS };
