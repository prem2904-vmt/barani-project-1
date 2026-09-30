'use strict';
/** Shared helpers for the message parsers. */

/** Analyzer flag tokens → normalized list. 'N' / '' (normal) → []. */
function normalizeFlags(raw, repeatSep) {
  if (raw == null) return [];
  const parts = repeatSep ? String(raw).split(repeatSep) : [String(raw)];
  const out = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t || t === 'N' || t === 'n') continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * ASTM / HL7 timestamp YYYYMMDD[HHMM[SS]] → ISO-8601 (UTC). The analyzer
 * sends wall-clock time without a zone; it is read in the HOST's local zone
 * (the connector PC sits next to the analyzer). Unparseable → null.
 */
function parseTs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(String(s || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Split text into lines on CR, LF or CRLF, dropping empties. */
function lines(text) {
  return String(text).split(/\r\n|\r|\n/).filter((l) => l.length > 0);
}

function emptyMessage(protocol, raw) {
  return { sampleId: null, instrumentSerial: null, runAt: null, qc: false, results: [], raw, protocol };
}

module.exports = { normalizeFlags, parseTs, lines, emptyMessage };
