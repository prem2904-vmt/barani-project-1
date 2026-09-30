'use strict';
/**
 * HL7 v2.x ORU^R01 (unsolicited observation) parser + ACK builder.
 *
 *   MSH  encoding chars from MSH-2 (default ^~\&)
 *   OBR  one per ordered panel — sample ID from OBR-3 (filler) / OBR-2
 *        (placer) / SPM-2 / PID-3 (configurable: parser.hl7.sampleIdField)
 *   OBX  OBX-3 code (component 1, else 2), OBX-5 value, OBX-6 unit,
 *        OBX-8 abnormal flags (repeating), OBX-14 observation time
 *   SPM  SPM-11 specimen role Q/C = quality-control material
 *
 * One InstrumentMessage per OBR (results follow their OBR).
 */
const { normalizeFlags, parseTs, emptyMessage } = require('./common');

function segmentsOf(text) {
  return String(text).split(/\r\n|\r|\n/).map((s) => s.replace(/^\x0b/, '')).filter((s) => s.length >= 3);
}

function encodingOf(msh) {
  const field = msh[3] || '|';
  const enc = msh.slice(4).split(field)[0] || '^~\\&';
  return { field, component: enc[0] || '^', repeat: enc[1] || '~', escape: enc[2] || '\\', sub: enc[3] || '&' };
}

function unescapeHl7(v, e) {
  if (!v || v.indexOf(e.escape) < 0) return v;
  const x = e.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return v.replace(new RegExp(`${x}([FSTRE])${x}`, 'g'), (_m, k) => (
    { F: e.field, S: e.component, T: e.sub, R: e.repeat, E: e.escape }[k]
  ));
}

/** Field n (HL7 numbering) of a segment split by the field separator. */
function fld(seg, parts, n) {
  // MSH-1 IS the separator, so MSH-n lives at split index n-1.
  return (seg === 'MSH' ? parts[n - 1] : parts[n]) ?? '';
}

function parseHl7(text, cfg = {}) {
  const segs = segmentsOf(text);
  const mshLine = segs.find((s) => s.startsWith('MSH'));
  const e = mshLine ? encodingOf(mshLine) : { field: '|', component: '^', repeat: '~', escape: '\\', sub: '&' };
  const which = String(cfg.sampleIdField || 'OBR-3').toUpperCase();
  const qcRe = cfg.qcPattern ? safeRe(cfg.qcPattern) : null;
  const comp = (v, i = 1) => unescapeHl7(String(v).split(e.repeat)[0].split(e.component)[i - 1] ?? '', e).trim();

  let serial = null;
  let msgTs = null;
  let pid3 = null;
  const out = [];
  let cur = null;

  for (const s of segs) {
    const name = s.slice(0, 3);
    const parts = s.split(e.field);
    if (name === 'MSH') {
      serial = comp(fld('MSH', parts, 3)) || null;       // sending application
      const fac = comp(fld('MSH', parts, 4));
      if (fac) serial = serial ? `${serial}@${fac}` : fac;
      msgTs = parseTs(fld('MSH', parts, 7));
      continue;
    }
    if (name === 'PID') { pid3 = comp(fld('PID', parts, 3)) || null; continue; }
    if (name === 'OBR') {
      cur = emptyMessage('hl7', text);
      cur.instrumentSerial = serial;
      const obr3 = comp(fld('OBR', parts, 3));
      const obr2 = comp(fld('OBR', parts, 2));
      cur.sampleId = (which === 'OBR-2' ? obr2 || obr3
        : which === 'PID-3' ? pid3 || obr3 || obr2
          : obr3 || obr2) || null;
      cur.runAt = parseTs(fld('OBR', parts, 7)) || msgTs;
      cur.qc = qcRe && cur.sampleId ? qcRe.test(cur.sampleId) : false;
      out.push(cur);
      continue;
    }
    if (name === 'SPM') {
      if (!cur) continue;
      const spm2 = String(fld('SPM', parts, 2));
      const spmId = spm2.split(e.component).map((c) => c.split(e.sub)[0].trim()).find((x) => x);
      if (which === 'SPM-2' && spmId) cur.sampleId = unescapeHl7(spmId, e);
      const role = comp(fld('SPM', parts, 11)).toUpperCase();
      if (role === 'Q' || role === 'C') cur.qc = true;
      if (qcRe && cur.sampleId && qcRe.test(cur.sampleId)) cur.qc = true;
      continue;
    }
    if (name === 'OBX') {
      if (!cur) { cur = emptyMessage('hl7', text); cur.instrumentSerial = serial; cur.runAt = msgTs; cur.sampleId = pid3; out.push(cur); }
      const code = comp(fld('OBX', parts, 3), 1) || comp(fld('OBX', parts, 3), 2);
      const value = comp(fld('OBX', parts, 5), 1);
      const unit = comp(fld('OBX', parts, 6), 1) || null;
      const flags = normalizeFlags(unescapeHl7(fld('OBX', parts, 8), e), e.repeat);
      const ts = parseTs(fld('OBX', parts, 14));
      if (ts && !cur.runAt) cur.runAt = ts;
      if (code) cur.results.push({ code, value, unit, flags, rawRecord: s });
      continue;
    }
  }
  return out;
}

/**
 * Build the HL7 ACK for a received message: MSA|AA|<MSH-10>. Returns null
 * when the text has no MSH (nothing to acknowledge).
 */
function buildAck(text, { code = 'AA', now = new Date() } = {}) {
  const segs = segmentsOf(text);
  const msh = segs.find((s) => s.startsWith('MSH'));
  if (!msh) return null;
  const e = encodingOf(msh);
  const p = msh.split(e.field);
  const f = (n) => p[n - 1] ?? '';
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const ctrl = f(10);
  const trigger = (f(9).split(e.component)[1]) || 'R01';
  const encChars = msh.slice(4).split(e.field)[0] || '^~\\&';
  const header = ['MSH', encChars, f(5), f(6), f(3), f(4), ts, '', `ACK${e.component}${trigger}`, `ACK${ctrl}`, f(11) || 'P', f(12) || '2.3.1'].join(e.field);
  return `${header}\r${['MSA', code, ctrl].join(e.field)}\r`;
}

function safeRe(p) { try { return new RegExp(p, 'i'); } catch { return null; } }

module.exports = { parseHl7, buildAck, encodingOf };
