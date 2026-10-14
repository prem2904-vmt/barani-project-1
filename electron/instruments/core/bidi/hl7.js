'use strict';
/**
 * HL7 v2 host query / worklist over MLLP.
 *
 * Analyzer → host
 *   QRY^Q02  (original-mode query, HL7 2.3.x ch. 5 "Query"; Mindray BS-series,
 *            Autolab-style chemistry analyzers):
 *              MSH … QRY^Q02 | QRD|<dt>|R|D|<query id>|||1^RD|<sample id>|OTH|||T | QRF|<where>|…
 *   QBP^Q11  (IHE Laboratory Analytical Workflow "WOS" query, HL7 2.5.1):
 *              MSH … QBP^Q11^QBP_Q11 | QPD|WOS^Work Order Step^IHE_LABTF|<query tag>|<specimen id> | RCP|I||R
 * Host → analyzer
 *   QRY^Q02 →  QCK^Q02 (MSA|AA, QAK|SR|OK|NF) then, when found, DSR^Q03
 *              (MSH, MSA, ERR, QAK, QRD echo, QRF echo, DSP rows).
 *   QBP^Q11 →  RSP^K11 (MSA|AA, QAK|<tag>|OK|NF, QPD echo, then SPM + one
 *              ORC/OBR per test).
 *   worklist → ORM^O01 (ORC/OBR per test) or OML^O21 (SPM + ORC/OBR), PID
 *              only when a patient is sent; the analyzer answers ACK
 *              (MSA|AA | AE | AR; commit-accept CA/CE/CR treated alike).
 *
 * The DSR^Q03 "DSP" row layout is vendor-specific. The positions live in the
 * DSP_DIALECTS table below ('mindray-bs' default, 'generic' = patient-less
 * sequential rows) and can be overridden per instrument with
 * bidirectional.hl7Dialect (name) — they were taken from published Mindray
 * BS-series LIS interface descriptions and MUST be confirmed against the
 * target analyzer's manual.
 */
const { encodingOf } = require('../parsers/hl7');
const { hl7Escape } = require('./escape');

/** DSP-n (sequence) → what it carries. `tests` = first DSP row of the test list. */
const DSP_DIALECTS = Object.freeze({
  'mindray-bs': {
    rows: { patientId: 2, name: 4, dob: 5, sex: 6, sampleId: 21, collectedAt: 22, specimen: 24, priority: 25 },
    tests: 26,
    testFormat: (code) => `${code}^^^`,
    qrdSampleField: 8,
  },
  generic: {
    rows: { sampleId: 1, patientId: 2, name: 3, dob: 4, sex: 5 },
    tests: 6,
    testFormat: (code) => code,
    qrdSampleField: 8,
  },
});

let seq = 0;
function controlId(now = Date.now()) { return `PF${now.toString(36).toUpperCase()}${(++seq).toString(36).toUpperCase()}`; }

function hl7Ts(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function segs(text) {
  return String(text).split(/\r\n|\r|\n/).map((s) => s.replace(/^\x0b/, '')).filter((s) => s.length >= 3);
}

function unesc(v, e) {
  if (!v || v.indexOf(e.escape) < 0) return v;
  const x = e.escape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return v.replace(new RegExp(`${x}([FSTRE])${x}`, 'g'), (_m, k) => ({ F: e.field, S: e.component, T: e.sub, R: e.repeat, E: e.escape }[k]));
}

/**
 * Classify an inbound HL7 message.
 * @returns {null | {kind:'qry_q02'|'qbp_q11'|'ack', e:object, msh:object, sampleId?:string, queryId?:string, code?:string, ref?:string, segs:string[]}}
 */
function classifyHl7(text, cfg = {}) {
  const all = segs(text);
  const mshLine = all.find((s) => s.startsWith('MSH'));
  if (!mshLine) return null;
  const e = encodingOf(mshLine);
  const mp = mshLine.split(e.field);
  const m = (n) => mp[n - 1] ?? '';
  const type = m(9).split(e.component);
  const msh = { sendingApp: m(3), sendingFac: m(4), recvApp: m(5), recvFac: m(6), ctrl: m(10), proc: m(11) || 'P', version: m(12) || '2.3.1', enc: mshLine.slice(4).split(e.field)[0] || '^~\\&' };
  const dialect = DSP_DIALECTS[cfg.hl7Dialect] || DSP_DIALECTS['mindray-bs'];
  const seg = (name) => all.find((s) => s.startsWith(`${name}${e.field}`));
  const fieldOf = (line, n) => (line ? (line.split(e.field)[n] ?? '') : '');
  if (type[0] === 'QRY' || (type[0] === 'QRY' && type[1] === 'Q02')) {
    const qrd = seg('QRD');
    const f = Number(cfg.qrdSampleField) || dialect.qrdSampleField;
    const sampleId = unesc(fieldOf(qrd, f).split(e.component)[0].trim(), e);
    return { kind: 'qry_q02', e, msh, sampleId, queryId: fieldOf(qrd, 4), qrd, qrf: seg('QRF') || null, segs: all };
  }
  if (type[0] === 'QBP') {
    const qpd = seg('QPD');
    const f = Number(cfg.qpdSampleField) || 3;
    const sampleId = unesc(fieldOf(qpd, f).split(e.component)[0].trim(), e);
    return { kind: 'qbp_q11', e, msh, sampleId, queryId: fieldOf(qpd, 2), qpd, queryName: fieldOf(qpd, 1), segs: all };
  }
  if (type[0] === 'ACK' || (seg('MSA') && !seg('OBR') && !seg('OBX') && !seg('QRD'))) {
    const msa = seg('MSA');
    return { kind: 'ack', e, msh, code: fieldOf(msa, 1), ref: fieldOf(msa, 2), segs: all };
  }
  return null;
}

function mshLine(e, msh, { type, ctrl, now, version }) {
  // Reply goes back: our app/facility = their receiving ones, and vice versa.
  return ['MSH', msh.enc, msh.recvApp || 'PREFRONTAL', msh.recvFac || 'LIS', msh.sendingApp, msh.sendingFac, hl7Ts(now), '', type, ctrl, msh.proc || 'P', version || msh.version || '2.3.1'].join(e.field);
}

/** QCK^Q02 acknowledgement (HL7 2.3.1 §5.?.? — MSA, [ERR], QAK with SR|OK|NF). */
function buildQck(q, found, { now = new Date() } = {}) {
  const { e, msh } = q;
  return [
    mshLine(e, msh, { type: `QCK${e.component}Q02`, ctrl: controlId(), now }),
    ['MSA', 'AA', msh.ctrl].join(e.field),
    ['ERR', '0'].join(e.field),
    ['QAK', 'SR', found ? 'OK' : 'NF'].join(e.field),
  ].join('\r') + '\r';
}

/** DSR^Q03 display response: the order as DSP rows (layout per dialect table). */
function buildDsr(q, dto, { now = new Date(), dialect = 'mindray-bs', sendPatient = true } = {}) {
  const { e, msh } = q;
  const dl = DSP_DIALECTS[dialect] || DSP_DIALECTS['mindray-bs'];
  const lines = [
    mshLine(e, msh, { type: `DSR${e.component}Q03`, ctrl: controlId(), now }),
    ['MSA', 'AA', msh.ctrl].join(e.field),
    ['ERR', '0'].join(e.field),
    ['QAK', 'SR', 'OK'].join(e.field),
    q.qrd,
  ];
  if (q.qrf) lines.push(q.qrf);
  const vals = {};
  const pt = sendPatient ? dto.patient : null;
  vals.sampleId = dto.sampleId;
  if (pt) { vals.patientId = pt.id; vals.name = pt.name; vals.dob = String(pt.dob || '').replace(/-/g, ''); vals.sex = pt.sex; }
  if (dto.collectedAt) { const d = new Date(dto.collectedAt); if (!Number.isNaN(d.getTime())) vals.collectedAt = hl7Ts(d); }
  if (dto.specimen) vals.specimen = dto.specimen;
  vals.priority = dto.priority === 'urgent' ? 'Y' : 'N';
  const rows = [];
  for (const [k, n] of Object.entries(dl.rows)) if (vals[k] != null && vals[k] !== '') rows.push([n, vals[k], false]);
  (dto.tests || []).forEach((t, i) => rows.push([dl.tests + i, dl.testFormat(t.code), true]));
  rows.sort((a, b) => a[0] - b[0]);
  for (const [n, v, isTest] of rows) {
    // Test rows keep their component separators (CODE^^^) — escape only the code.
    const val = isTest ? v.split(e.component).map((c) => hl7Escape(c, e)).join(e.component) : v;
    lines.push(['DSP', String(n), '', isTest ? val : hl7Escape(val, e), '', '', ''].join(e.field));
  }
  return lines.join('\r') + '\r';
}

function pidSegment(e, pt) {
  const nm = String(pt.name || '').trim();
  const i = nm.lastIndexOf(' ');
  const fam = i > 0 ? nm.slice(i + 1) : nm;
  const giv = i > 0 ? nm.slice(0, i) : '';
  const f = ['PID', '1', '', hl7Escape(pt.id, e), '', [fam, giv].map((x) => hl7Escape(x, e)).join(e.component), '', String(pt.dob || '').replace(/-/g, ''), hl7Escape(pt.sex || 'U', e)];
  return f.join(e.field);
}

function obrSegments(e, dto, startAt, { now, codeSystem = 'L' }) {
  const out = [];
  const pri = dto.priority === 'urgent' ? 'S' : 'R';
  const coll = dto.collectedAt ? (() => { const d = new Date(dto.collectedAt); return Number.isNaN(d.getTime()) ? '' : hl7Ts(d); })() : '';
  (dto.tests || []).forEach((t, i) => {
    const sid = hl7Escape(dto.sampleId, e);
    out.push(['ORC', 'NW', sid, sid, '', '', '', '', hl7Ts(now)].join(e.field));
    out.push(['OBR', String(startAt + i), sid, sid, [hl7Escape(t.code, e), hl7Escape(t.name || '', e), codeSystem].join(e.component), pri, '', coll].join(e.field));
  });
  return out;
}

/** RSP^K11 (IHE LAW WOS response). */
function buildRsp(q, dto, { now = new Date(), sendPatient = true } = {}) {
  const { e, msh } = q;
  const tag = q.queryId;
  const found = !!dto;
  const lines = [
    mshLine(e, msh, { type: ['RSP', 'K11', 'RSP_K11'].join(e.component), ctrl: controlId(), now, version: msh.version }),
    ['MSA', 'AA', msh.ctrl].join(e.field),
    ['QAK', tag, found ? 'OK' : 'NF', q.queryName || ''].join(e.field),
    q.qpd,
  ];
  if (found) {
    if (sendPatient && dto.patient) lines.push(pidSegment(e, dto.patient));
    lines.push(['SPM', '1', hl7Escape(dto.sampleId, e), '', hl7Escape(dto.specimen || '', e)].join(e.field));
    lines.push(...obrSegments(e, dto, 1, { now }));
  }
  return lines.join('\r') + '\r';
}

/**
 * Worklist message for one sample.
 * @param {{type?:'orm_o01'|'oml_o21', sendPatient?:boolean, app?:string, fac?:string, recvApp?:string, recvFac?:string, now?:Date}} o
 * @returns {{text:string, ctrl:string}}
 */
function buildWorklistMessage(dto, o = {}) {
  const e = { field: '|', component: '^', repeat: '~', escape: '\\', sub: '&' };
  const now = o.now || new Date();
  const oml = o.type === 'oml_o21';
  const ctrl = controlId();
  const lines = [[
    'MSH', '^~\\&', o.app || 'PREFRONTAL', o.fac || 'LIS', o.recvApp || '', o.recvFac || '', hl7Ts(now), '',
    oml ? 'OML^O21^OML_O21' : 'ORM^O01', ctrl, 'P', oml ? '2.5.1' : '2.3.1',
  ].join('|')];
  if (o.sendPatient !== false && dto.patient) lines.push(pidSegment(e, dto.patient));
  if (oml) lines.push(['SPM', '1', hl7Escape(dto.sampleId, e), '', hl7Escape(dto.specimen || '', e)].join('|'));
  lines.push(...obrSegments(e, dto, 1, { now }));
  return { text: lines.join('\r') + '\r', ctrl };
}

module.exports = { classifyHl7, buildQck, buildDsr, buildRsp, buildWorklistMessage, DSP_DIALECTS, controlId, hl7Ts };
