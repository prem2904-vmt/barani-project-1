'use strict';
/**
 * ASTM E1394-97 / CLSI LIS2-A2 record parser.
 *
 * Records (one per line, CR-terminated): H header, P patient, O order,
 * R result, C comment, Q query, M manufacturer, L terminator.
 *
 * Delimiters come from the H record itself: "H|\^&" → field '|',
 * repeat '\', component '^', escape '&' (any other set works the same way).
 * Escape sequences inside values: &F& &S& &R& &E& (with the escape char).
 *
 * Field numbering follows the standard: field 1 is the record type, so
 * "O.3" (Specimen ID) is split index 2. Which O field / component carries
 * the sample barcode is configurable (parser.astm.sampleIdField /
 * sampleIdComponent) because analyzers differ (O.3 vs O.4 instrument
 * specimen ID).
 *
 * One InstrumentMessage per O record (a session may carry several samples).
 */
const { normalizeFlags, parseTs, lines, emptyMessage } = require('./common');
const { parseAstmPath, astmValue, pickRecord } = require('./sample-id-path');

function delimitersFrom(hLine) {
  // "H|\^&..." → field = char 1, then repeat/component/escape = chars 2..4
  const field = hLine[1] || '|';
  const enc = hLine.slice(2, hLine.indexOf(field, 2) >= 0 ? hLine.indexOf(field, 2) : 5);
  return {
    field,
    repeat: enc[0] || '\\',
    component: enc[1] || '^',
    escape: enc[2] || '&',
  };
}

function unescape(v, d) {
  if (!v || !d.escape || v.indexOf(d.escape) < 0) return v;
  const e = d.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return v.replace(new RegExp(`${e}([FSRE])${e}`, 'g'), (_m, k) => (
    { F: d.field, S: d.component, R: d.repeat, E: d.escape }[k]
  ));
}

/** Strip a leading frame-number digit if records still carry it ("1H|…"). */
function stripFn(line) {
  return /^[0-7][HPOCRQLM][^A-Za-z0-9]/.test(line) ? line.slice(1) : line;
}

/**
 * @param {string} text    E1394 message text (records separated by CR/LF)
 * @param {{sampleIdField?:number, sampleIdComponent?:number, qcPattern?:string}} [cfg]
 * @returns {Array<object>} InstrumentMessage[]
 */
function parseAstm(text, cfg = {}) {
  const sampleField = Number(cfg.sampleIdField) > 1 ? Number(cfg.sampleIdField) : 3;
  const sampleComp = Number(cfg.sampleIdComponent) >= 1 ? Number(cfg.sampleIdComponent) : 1;
  const qcRe = cfg.qcPattern ? safeRe(cfg.qcPattern) : null;

  const recs = lines(text).map((l) => stripFn(l.replace(/^\x02/, '')));
  const hLine = recs.find((l) => l[0] === 'H');
  const d = hLine ? delimitersFrom(hLine) : { field: '|', repeat: '\\', component: '^', escape: '&' };

  let header = { serial: null, qc: false, ts: null };
  const out = [];
  let cur = null;
  let lastResult = null;

  // Custom sample-number location (sampleIdPath) — null when unset: the
  // standard behaviour below runs byte-for-byte as before.
  const custom = cfg.sampleIdPath ? parseAstmPath(cfg.sampleIdPath) : null;
  const all = custom ? recs.map((r) => ({ name: (r[0] || '').toUpperCase(), parts: r.split(d.field) })) : null;
  let recIdx = -1;

  const field = (parts, n) => (parts[n - 1] ?? '');
  const comps = (v) => String(v).split(d.component).map((x) => unescape(x, d));

  for (const rec of recs) {
    recIdx++;
    const type = rec[0];
    const parts = rec.split(d.field);
    if (type === 'H') {
      // H.5 sender name/ID: name^version^serial (conventions vary).
      const sender = comps(field(parts, 5));
      header = {
        serial: sender[2] || sender[0] || null,
        // H.12 processing ID: P production, T training, D debug, Q QC.
        qc: field(parts, 12).trim().toUpperCase() === 'Q',
        ts: parseTs(field(parts, 14)),
      };
      continue;
    }
    if (type === 'P') { continue; }
    if (type === 'O') {
      const idVal = comps(field(parts, sampleField));
      let sampleId = (idVal[sampleComp - 1] || '').trim();
      if (!sampleId) {
        // Fallback: the other specimen-ID field (O.3 ↔ O.4).
        const alt = comps(field(parts, sampleField === 3 ? 4 : 3));
        sampleId = (alt[sampleComp - 1] || alt.find((x) => x.trim()) || '').trim();
      }
      if (custom) {
        const r = pickRecord(all, custom.type, custom.occ, recIdx, 'O');
        const id = r ? astmValue(r.parts, custom, d, unescape) : '';
        if (id) sampleId = id;
      }
      const action = field(parts, 12).trim().toUpperCase();   // O.12 action code, Q = QC
      cur = emptyMessage('astm', text);
      cur.sampleId = sampleId || null;
      cur.instrumentSerial = header.serial;
      cur.runAt = parseTs(field(parts, 8)) || header.ts;      // O.8 collection/observation date-time
      cur.qc = header.qc || action === 'Q' || (qcRe ? qcRe.test(sampleId) : false);
      out.push(cur);
      lastResult = null;
      continue;
    }
    if (type === 'R') {
      if (!cur) { cur = emptyMessage('astm', text); cur.instrumentSerial = header.serial; cur.qc = header.qc; out.push(cur); }
      const uti = comps(field(parts, 3));                     // ^^^WBC^...
      const code = (uti[3] || uti.find((x) => x.trim()) || '').trim();
      const value = comps(field(parts, 4))[0].trim();
      const unit = unescape(field(parts, 5), d).trim() || null;
      const flags = normalizeFlags(unescape(field(parts, 7), d), d.repeat);
      const done = parseTs(field(parts, 13));
      if (done && !cur.runAt) cur.runAt = done;
      lastResult = { code, value, unit, flags, rawRecord: rec };
      if (code) cur.results.push(lastResult);
      continue;
    }
    if (type === 'C' && lastResult) {
      // Comment on the preceding result: keep it with the raw record.
      lastResult.rawRecord += '\r' + rec;
      continue;
    }
    // Q / M / L: nothing to extract in this cut (host query is not supported yet).
  }
  return out;
}

function safeRe(p) { try { return new RegExp(p, 'i'); } catch { return null; } }

module.exports = { parseAstm, delimitersFrom, unescape };
