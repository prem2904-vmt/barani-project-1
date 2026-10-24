'use strict';
/**
 * LifeDx HBPro (HbA1c HPLC) — one fixed-width ASCII record per run, delivered
 * by the 'stx-etx' link:
 *
 *   S04----19DR JANE DOE      29 F0329041215026102412304410…0.00120.0021…
 *   └┬┘└─┬──┘└──── name ────┘age sex  …result numbers… …chromatogram…
 *   type  sample id (left-padded with '-')
 *
 * Known for sure: record type (first 3 chars), sample id (next 6, '-' padding
 * stripped). Patient name / age / sex are read only when they parse cleanly.
 * The result positions are NOT known yet, so `results` stays empty until the
 * lab configures them (parser.hbpro.fields, 0-based, end exclusive):
 *   { fields: [{ code: 'HbA1c', start: 60, end: 64, unit: '%', decimals?: 1 }],
 *     sampleIdStart?: 3, sampleIdEnd?: 9 }
 * — editable in the instrument editor without a new desktop build.
 */
const { emptyMessage } = require('./common');

const NUM_RE = /^[<>]?-?\d+(?:\.\d+)?$/;

function int(v, d) { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : d; }

/** Tolerant: "HbA1c 60 64 %" lines or [{code,start,end,unit}] → fields[]. */
function normalizeFields(fields) {
  if (!fields) return [];
  if (typeof fields === 'string') return parseFieldLines(fields);
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f) => ({ code: String((f && f.code) || '').trim(), start: int(f && f.start, -1), end: int(f && f.end, -1), unit: f && f.unit ? String(f.unit).trim() : null, decimals: f && f.decimals != null && f.decimals !== '' ? int(f.decimals, null) : null }))
    .filter((f) => f.code && f.start >= 0 && f.end > f.start);
}

/** "CODE START END [UNIT]" per line ('#' comments) → fields[]. */
function parseFieldLines(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^(\S+)\s+(\d+)\s+(\d+)(?:\s+(\S+))?\s*$/.exec(line);
    if (!m) continue;
    const start = +m[2]; const end = +m[3];
    if (end > start) out.push({ code: m[1], start, end, unit: m[4] || null, decimals: null });
  }
  return out;
}

/** "DR JANE DOE      29 F…" → { name, age, sex } or nulls. */
function patientBits(rest) {
  const m = /^(?<name>[A-Za-z][A-Za-z .'-]*?)\s{1,}(?<age>\d{1,3})\s?(?<sex>[MFO])(?=\d|\s|$)/.exec(rest);
  if (!m) return { name: null, age: null, sex: null };
  return { name: m.groups.name.trim() || null, age: m.groups.age ? Number(m.groups.age) : null, sex: m.groups.sex || null };
}

function parseHbpro(text, cfg = {}) {
  // The link hands us the frame body; tolerate a pasted frame with STX/ETX/CR/LF.
  const rec = String(text || '').replace(/[\x02\x03]/g, '').replace(/^[\r\n]+|[\r\n]+$/g, '');
  if (!rec.trim()) return [];
  const msg = emptyMessage('text', text);
  const idStart = int(cfg.sampleIdStart, 3);
  const idEnd = int(cfg.sampleIdEnd, 9);
  msg.recordType = rec.slice(0, 3);
  msg.sampleId = rec.slice(idStart, idEnd).replace(/^[-\s]+/, '').trim() || null;
  msg.patient = patientBits(rec.slice(idEnd));
  for (const f of normalizeFields(cfg.fields)) {
    const v = rec.slice(f.start, f.end).trim();
    if (!NUM_RE.test(v)) continue;
    let value = v;
    if (f.decimals != null && /^-?\d+(\.\d+)?$/.test(v)) value = Number(v).toFixed(f.decimals);
    msg.results.push({ code: f.code, value, unit: f.unit, flags: [], rawRecord: `${f.code}@${f.start}-${f.end}=${v}` });
  }
  return [msg];
}

module.exports = { parseHbpro, parseFieldLines, normalizeFields, patientBits };
