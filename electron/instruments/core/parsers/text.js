'use strict';
/**
 * Text-template parser for analyzers that "print" results (proprietary
 * ticket formats). Entirely admin-configurable:
 *
 *   linePattern      regex with named groups code, value, unit?, flag?
 *   sampleIdPattern  regex with a named group id (a new sample-ID line after
 *                    results starts a NEW message — several tickets per blob)
 *   qcPattern        regex; any matching line marks the message as QC
 *   runAtPattern     optional regex with named group ts (YYYYMMDDHHMM[SS]
 *                    or anything Date can parse)
 *   fixedColumns     optional [{ name:'code'|'value'|'unit'|'flag', start, end }]
 *                    (0-based, end exclusive) used INSTEAD of linePattern
 */
const { lines, emptyMessage, parseTs } = require('./common');

const DEFAULTS = Object.freeze({
  linePattern: '^\\s*(?<code>[A-Za-z][A-Za-z0-9#%\\-_/]*)\\s+(?<value>[<>]?-?\\d+(?:\\.\\d+)?)\\s*(?<unit>(?![HL*]{1,2}\\s*$)\\S+)?\\s*(?<flag>[HL*]{0,2})\\s*$',
  sampleIdPattern: '^\\s*(?:SAMPLE|SPECIMEN|SAMPLE\\s*ID|ID)\\s*(?:NO\\.?)?\\s*[:#]?\\s*(?<id>[A-Za-z0-9\\-]+)\\s*$',
  qcPattern: '^\\s*(?:QC|CONTROL)\\b',
});

function re(p, flags = 'i') {
  if (!p) return null;
  try { return new RegExp(p, flags); } catch { return null; }
}

function flagsOf(f) {
  const t = (f || '').trim();
  if (!t) return [];
  if (/^[HL]{2}$/.test(t) && t[0] === t[1]) return [t];     // HH / LL (panic)
  return t.split('').filter((c, i, a) => c.trim() && a.indexOf(c) === i);
}

function parseText(text, cfg = {}) {
  const lineRe = re(cfg.linePattern || DEFAULTS.linePattern, '');
  const idRe = re(cfg.sampleIdPattern || DEFAULTS.sampleIdPattern);
  const qcRe = re(cfg.qcPattern === undefined ? DEFAULTS.qcPattern : cfg.qcPattern);
  const tsRe = re(cfg.runAtPattern);
  const cols = Array.isArray(cfg.fixedColumns) && cfg.fixedColumns.length ? cfg.fixedColumns : null;

  const out = [];
  let cur = null;
  const ensure = () => {
    if (!cur) { cur = emptyMessage('text', text); out.push(cur); }
    return cur;
  };

  for (const line of lines(text)) {
    const idm = idRe ? idRe.exec(line) : null;
    if (idm) {
      const id = (idm.groups && idm.groups.id) || idm[1];
      // A new sample ID after results (or after another ID) = next ticket.
      if (cur && (cur.results.length || cur.sampleId)) cur = null;
      ensure().sampleId = id ? String(id).trim() : null;
      continue;
    }
    if (qcRe && qcRe.test(line)) { ensure().qc = true; continue; }
    if (tsRe) {
      const tm = tsRe.exec(line);
      if (tm) { const ts = (tm.groups && tm.groups.ts) || tm[1]; ensure().runAt = parseTs(ts) || safeDate(ts); continue; }
    }
    let r = null;
    if (cols) {
      const get = (name) => {
        const c = cols.find((x) => x.name === name);
        return c ? line.slice(c.start, c.end).trim() : '';
      };
      const code = get('code');
      const value = get('value');
      if (code && /^[<>]?-?\d+(\.\d+)?$/.test(value)) r = { code, value, unit: get('unit') || null, flags: flagsOf(get('flag')) };
    } else if (lineRe) {
      const m = lineRe.exec(line);
      if (m && m.groups && m.groups.code && m.groups.value !== undefined) {
        r = { code: m.groups.code.trim(), value: m.groups.value.trim(), unit: (m.groups.unit || '').trim() || null, flags: flagsOf(m.groups.flag) };
      }
    }
    if (r) ensure().results.push({ ...r, rawRecord: line });
  }
  return out.filter((m) => m.results.length || m.sampleId);
}

function safeDate(s) { const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); }

module.exports = { parseText, TEXT_DEFAULTS: DEFAULTS };
