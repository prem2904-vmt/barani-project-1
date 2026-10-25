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
 * Results come from the built-in HBPRO_LAYOUT below (verified against the
 * analyzer screen). A lab can still override with its own absolute positions
 * (parser.hbpro.fields, 0-based, end exclusive):
 *   { fields: [{ code: 'HbA1c', start: 60, end: 64, unit: '%', decimals?: 1 }],
 *     sampleIdStart?: 3, sampleIdEnd?: 9 }
 * — editable in the instrument editor without a new desktop build.
 */
const { emptyMessage } = require('./common');
const { textValue } = require('./sample-id-path');

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

/**
 * The HBPro's own layout, read from a real record against the analyzer's result
 * screen (24 Oct 2026, Arun Lab): after the ID text (variable length — the name
 * the tech typed) comes a block of digits that starts with column temp (4),
 * position (2), number (4), 1 digit, date YYMMDD, time hhmmss. The results sit at
 * fixed offsets from the START of that block, so positions are counted from it.
 */
const HBPRO_LAYOUT = [
  { code: 'HbA1a', start: 107, end: 111, unit: '%' },
  { code: 'HbA1b', start: 111, end: 115, unit: '%' },
  { code: 'HbF', start: 115, end: 119, unit: '%' },
  { code: 'LA1c+', start: 119, end: 123, unit: '%' },
  { code: 'HbA1c', start: 123, end: 127, unit: '%' },
  { code: 'HbA0', start: 127, end: 131, unit: '%' },
  { code: 'HbA1c-IFCC', start: 131, end: 136, unit: 'mmol/mol' },
  { code: 'eAG-mmol', start: 136, end: 140, unit: 'mmol/L' },
  { code: 'eAG', start: 140, end: 145, unit: 'mg/dL' },
];

/** Start of the digit block after the ID text, or -1. The block is 35 digits
 *  (temp, position, number, flag, date, time, 2 + 10 more) followed by the first
 *  decimal value "0.dddd" — anchoring on that decimal keeps an all-digit ID (a
 *  typed tube number, which runs straight into the block) out of the block. */
function blockStart(rec, from) {
  const m = /(?<=\d{35})0\.\d/.exec(rec.slice(from));
  return m ? from + m.index - 35 : -1;
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
  // Custom location (sampleIdPath "start-end" / regex) wins when it reads something.
  if (cfg.sampleIdPath) { const id = textValue(rec, cfg.sampleIdPath); if (id) msg.sampleId = id; }
  msg.patient = patientBits(rec.slice(idEnd));
  const block = blockStart(rec, idEnd);
  // A tech who types the Prefrontal tube number into the HBPro's ID box: an ID
  // that is only digits (6+) is the sample number. Names never are.
  if (block >= idEnd && !cfg.sampleIdPath) {
    const idText = rec.slice(idEnd, block).trim();
    if (/^\d{6,}$/.test(idText)) msg.sampleId = idText;
  }
  const own = normalizeFields(cfg.fields);
  // Lab-entered positions are absolute; the built-in layout counts from the block.
  const fields = own.length ? own : (block >= 0 && cfg.layout !== 'none' ? HBPRO_LAYOUT.map((f) => ({ ...f, start: block + f.start, end: block + f.end, decimals: 1 })) : []);
  for (const f of fields) {
    const v = rec.slice(f.start, f.end).trim();
    if (!NUM_RE.test(v)) continue;
    let value = v;
    if (f.decimals != null && /^-?\d+(\.\d+)?$/.test(v)) value = Number(v).toFixed(f.decimals);
    msg.results.push({ code: f.code, value, unit: f.unit, flags: [], rawRecord: `${f.code}@${f.start}-${f.end}=${v}` });
  }
  return [msg];
}

module.exports = { parseHbpro, parseFieldLines, normalizeFields, patientBits, HBPRO_LAYOUT, blockStart };
