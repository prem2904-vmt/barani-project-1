'use strict';
/**
 * Custom sample-number location ("sampleIdPath") — picked by the lab from a
 * real received message in the instrument editor, so a new analyzer does not
 * need a new standard field / desktop build. When set on a parser block it
 * OVERRIDES the standard sample-ID field; when it yields nothing (empty /
 * missing) the parser falls back to its standard field, so nothing gets worse.
 * Values are trimmed only.
 *
 * Grammar (one per format):
 *   HL7      SEG[n].field[.component[.subcomponent]]   PID.5.2 · OBR.3 · PV1.19 · OBX[2].5
 *            1-based like HL7 numbering (MSH.3 = sending application — the
 *            MSH-1 separator quirk is handled). First repetition only.
 *   ASTM     Type[n].field[.component]                  O.3 · O.3.1 · P.6.2
 *            field 1 = the record type, as the standard numbers it.
 *   Text /   [line:]start-end   0-based characters, end NOT included; line is
 *   HBPro                       1-based over the message's non-empty lines (default 1)
 *            or any other text = a regex with ONE capture group (or (?<id>…)),
 *            first matching line wins.
 *   Sinocare Root.key[.key…]   Root = Patient (the patient the parser matched),
 *            Device, or anything else (Observation …) = the resource itself.
 *            Numeric keys index arrays: component.0.code.
 *
 * Occurrence: [n] picks the n-th segment/record of that type in the whole
 * message. Without it, the order's own segment is used (OBR for HL7, O for
 * ASTM); any other type uses the nearest one BEFORE the order (its patient),
 * else the first one in the message.
 *
 * MUST stay in step with the TS mirror apps/lms/src/app/shared/instruments/sample-id-path.ts.
 */

const SEG_RE = /^([A-Za-z][A-Za-z0-9]{2})(?:\[(\d+)\])?\.(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;
const REC_RE = /^([A-Za-z])(?:\[(\d+)\])?\.(\d+)(?:\.(\d+))?$/;
const RANGE_RE = /^(?:(\d+):)?(\d+)-(\d+)$/;

function clean(s) { return s == null ? '' : String(s).trim(); }

/** "PID.5.2" → { seg:'PID', occ:null, field:5, comp:2, sub:null } | null. */
function parseHl7Path(path) {
  const m = SEG_RE.exec(clean(path));
  if (!m) return null;
  const field = +m[3];
  if (field < 1) return null;
  return { seg: m[1].toUpperCase(), occ: m[2] ? Math.max(1, +m[2]) : null, field, comp: m[4] ? +m[4] : null, sub: m[5] ? +m[5] : null };
}

/** "O.3.1" → { type:'O', occ:null, field:3, comp:1 } | null. */
function parseAstmPath(path) {
  const m = REC_RE.exec(clean(path));
  if (!m) return null;
  const field = +m[3];
  if (field < 1) return null;
  return { type: m[1].toUpperCase(), occ: m[2] ? Math.max(1, +m[2]) : null, field, comp: m[4] ? +m[4] : null };
}

/** HL7 value at a parsed path within ONE segment's split parts. */
function hl7Value(parts, p, e, unescape) {
  const raw = (p.seg === 'MSH' ? parts[p.field - 1] : parts[p.field]) ?? '';
  if (p.seg === 'MSH' && p.field <= 2) return clean(raw);
  let v = String(raw).split(e.repeat)[0];
  if (p.comp) v = v.split(e.component)[p.comp - 1] ?? '';
  if (p.sub) v = v.split(e.sub)[p.sub - 1] ?? '';
  return clean(unescape ? unescape(v, e) : v);
}

/** ASTM value at a parsed path within ONE record's split parts. */
function astmValue(parts, p, d, unescape) {
  let v = String(parts[p.field - 1] ?? '');
  if (p.field === 2 && p.type === 'H') return clean(v);
  v = v.split(d.repeat)[0];
  if (p.comp) v = v.split(d.component)[p.comp - 1] ?? '';
  return clean(unescape ? unescape(v, d) : v);
}

/**
 * Pick the record/segment a path points at.
 * @param {Array<{name:string, parts:string[]}>} all  every segment/record, in order
 * @param {number} orderIdx  index (in `all`) of the order segment/record being built, or -1
 * @param {string} orderType 'OBR' | 'O'
 */
function pickRecord(all, name, occ, orderIdx, orderType) {
  if (occ) {
    let n = 0;
    for (const r of all) if (r.name === name && ++n === occ) return r;
    return null;
  }
  if (name === orderType && orderIdx >= 0) return all[orderIdx];
  for (let i = (orderIdx >= 0 ? orderIdx : all.length) - 1; i >= 0; i--) if (all[i].name === name) return all[i];
  return all.find((r) => r.name === name) || null;
}

/** Text/HBPro: range or regex over the message lines. */
function textValue(text, path) {
  const p = clean(path);
  if (!p) return '';
  const ls = String(text || '').replace(/[\x02\x03]/g, '').split(/\r\n|\r|\n/).filter((l) => l.length > 0);
  const r = RANGE_RE.exec(p);
  if (r) {
    const line = ls[(r[1] ? Math.max(1, +r[1]) : 1) - 1];
    const s = +r[2]; const en = +r[3];
    if (line == null || en <= s) return '';
    return clean(line.slice(s, en));
  }
  let re;
  try { re = new RegExp(p, 'i'); } catch { return ''; }
  for (const l of ls) {
    const m = re.exec(l);
    if (m) return clean((m.groups && m.groups.id) ?? m[1] ?? '');
  }
  return '';
}

/** Sinocare: walk "Root.key.key" into the envelope's resource / patient / device. */
function jsonWalk(obj, keys) {
  let o = obj;
  for (const k of keys) {
    if (o == null || typeof o !== 'object') return '';
    o = o[k];
  }
  return o == null || typeof o === 'object' ? '' : clean(o);
}

function sinocareValue({ res, patient, device }, path) {
  const keys = clean(path).split('.').filter((k) => k !== '');
  if (keys.length < 2) return '';
  const root = keys[0].toLowerCase();
  const base = root === 'patient' ? patient : root === 'device' ? device : res;
  return jsonWalk(base, keys.slice(1));
}

module.exports = { parseHl7Path, parseAstmPath, hl7Value, astmValue, pickRecord, textValue, sinocareValue, jsonWalk };
