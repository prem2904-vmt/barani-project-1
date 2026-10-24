'use strict';
/**
 * Sinocare iCARE FHIR-ish resources, as delivered by the 'sinocare-sn' link
 * (one JSON envelope per frame — see link/sinocare-sn.js):
 *
 *   Device / Patient frames  → no message (the link keeps them as context)
 *   Observation (or anything carrying a value) → one message with results,
 *     sample ID from the Observation itself if it names one, else the
 *     matching Patient (same extension.position, else the last Patient).
 *
 * Observation frames have NOT been captured yet, so this is deliberately
 * tolerant: code from code.coding[0].code | code.text | code | itemCode |
 * item | name; value from valueQuantity.value | valueString | value | result;
 * unit from valueQuantity.unit | unit; component[] and Bundle entry[] are
 * walked too.
 *
 * cfg (parser.sinocare): { sampleIdField: 'medicalRecordNo' (default) | 'position' }
 */
const { emptyMessage } = require('./common');

function str(v) { return v == null ? '' : String(v).trim(); }

function codeOf(o) {
  if (!o || typeof o !== 'object') return '';
  const c = o.code;
  if (c && typeof c === 'object') {
    const coding = Array.isArray(c.coding) ? c.coding[0] : c.coding;
    return str((coding && (coding.code || coding.display)) || c.text || c.code);
  }
  return str(c || o.itemCode || o.item || o.itemName || o.testCode || o.testName || o.project || o.name);
}

function valueOf(o) {
  if (!o || typeof o !== 'object') return null;
  const q = o.valueQuantity;
  if (q && typeof q === 'object' && q.value != null) return { value: str(q.value), unit: str(q.unit || q.code) || null };
  for (const k of ['valueString', 'valueInteger', 'valueDecimal', 'value', 'result', 'resultValue']) {
    const v = o[k];
    if (v != null && typeof v !== 'object' && str(v) !== '') return { value: str(v), unit: str(o.unit || o.units) || null };
    if (v && typeof v === 'object' && v.value != null) return { value: str(v.value), unit: str(v.unit) || null };
  }
  return null;
}

function flagsOf(o) {
  const out = [];
  const interp = o && o.interpretation;
  const list = Array.isArray(interp) ? interp : interp ? [interp] : [];
  for (const i of list) {
    const c = typeof i === 'string' ? i : (i && (i.coding && i.coding[0] && i.coding[0].code)) || (i && i.text);
    const t = str(c);
    if (t && t !== 'N' && !out.includes(t)) out.push(t);
  }
  const f = str(o && (o.flag || o.abnormalFlag));
  if (f && f !== 'N' && !out.includes(f)) out.push(f);
  return out;
}

/** Every result-bearing object in the tree (Observation, its components, a Bundle's entries). */
function collect(o, out, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return;
  if (Array.isArray(o)) { for (const x of o) collect(x, out, depth + 1); return; }
  const code = codeOf(o);
  const val = valueOf(o);
  if (code && val) out.push({ code, ...val, flags: flagsOf(o), rawRecord: JSON.stringify(o).slice(0, 500) });
  for (const k of ['component', 'components', 'entry', 'resource', 'results', 'items', 'observations', 'contained']) {
    if (o[k] && typeof o[k] === 'object') collect(o[k], out, depth + 1);
  }
}

function idFromPatient(p, field) {
  if (!p || typeof p !== 'object') return null;
  const pos = p.extension && p.extension.position;
  const mrn = p.medicalRecordNo;
  const v = field === 'position' ? (pos ?? mrn) : (mrn ?? pos);
  return str(v) || null;
}

function parseSinocare(text, cfg = {}) {
  let env;
  try { env = JSON.parse(String(text)); } catch { return []; }
  if (!env || typeof env !== 'object') return [];
  const isEnvelope = env.sinocare === 1;
  const body = isEnvelope ? env.body : env;
  const resource = str(isEnvelope ? env.resource : '').toLowerCase();
  if (!body || typeof body !== 'object') return [];
  if (resource === 'patient' || resource === 'device') return [];
  const res = body.fhir || body.resource || body;

  const results = [];
  collect(res, results);
  if (!results.length) return [];

  const ctx = (isEnvelope && env.context) || {};
  const field = cfg.sampleIdField === 'position' ? 'position' : 'medicalRecordNo';
  // The Observation may name its own sample / position.
  const ownPos = str(res.extension && res.extension.position) || str(res.position);
  const ownId = str(res.medicalRecordNo) || str(res.sampleId) || str(res.sampleNo) || str(res.barcode);
  let patient = null;
  if (ownPos && ctx.patients && ctx.patients[ownPos]) patient = ctx.patients[ownPos];
  else if (!ownPos) patient = ctx.patient || null;
  let sampleId = null;
  if (field === 'position') sampleId = ownPos || idFromPatient(patient, 'position') || ownId || null;
  else sampleId = ownId || idFromPatient(patient, 'medicalRecordNo') || ownPos || null;

  const msg = emptyMessage('text', text);
  msg.sampleId = sampleId;
  msg.instrumentSerial = str(ctx.device && ctx.device.serialNumber) || null;
  const ts = str(res.effectiveDateTime || res.issued || res.testTime || res.time);
  if (ts) { const d = new Date(ts); if (!Number.isNaN(d.getTime())) msg.runAt = d.toISOString(); }
  msg.results = results;
  return [msg];
}

module.exports = { parseSinocare };
