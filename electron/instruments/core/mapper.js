'use strict';
/**
 * Layer 4 — analyzer code → Test Master analyte, with unit conversion.
 *
 * The server is the SOURCE OF TRUTH for mapping (the instrument's code maps
 * live in Postgres and are applied at ingest, so a re-mapped or re-attached
 * message is always converted the server's way). This module is the tested
 * mirror used by the connector for the listen-mode / status preview, so the
 * admin sees exactly what the server will store.
 *
 *   value' = round(value × factor + offset, decimals)   (numeric values only)
 *
 * Rounding is half AWAY from zero (MidpointRounding.AwayFromZero on the
 * server). Non-numeric values ("Positive", ">1000") pass through unchanged.
 * Codes match case-insensitively after trimming.
 */

function normCode(c) { return String(c ?? '').trim().toUpperCase(); }

function roundAway(x, decimals) {
  if (decimals == null || decimals === '' || !(Number(decimals) >= 0)) return x;
  const f = 10 ** Number(decimals);
  const y = Math.abs(x) * f;
  // Correct binary representation noise (1.005 × 100 = 100.49999…).
  const r = Math.round(y + 1e-9 * Math.max(1, y));
  return (Math.sign(x) || 1) * r / f;
}

function formatNumber(x, decimals) {
  if (decimals == null || decimals === '' || !(Number(decimals) >= 0)) {
    // Trim float noise without forcing a fixed width.
    return String(+x.toPrecision(12));
  }
  return roundAway(x, decimals).toFixed(Number(decimals));
}

/**
 * Convert one value by a map. Returns the string the server will store.
 * @param {string} raw
 * @param {{factor?:number, offset?:number, decimals?:number|null}} map
 */
function convertValue(raw, map = {}) {
  const s = String(raw ?? '').trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return s;
  const factor = map.factor == null || map.factor === '' ? 1 : Number(map.factor);
  const offset = map.offset == null || map.offset === '' ? 0 : Number(map.offset);
  const v = Number(s) * factor + offset;
  return formatNumber(v, map.decimals);
}

/**
 * @param {{results: Array<{code,value,unit,flags}>}} message  InstrumentMessage
 * @param {Array<{analyzerCode,testCatalogKey,parameterName?,factor?,offset?,decimals?,unit?}>} maps
 * @returns {{ mapped: object[], unmapped: string[] }}
 */
function applyMaps(message, maps = []) {
  const byCode = new Map();
  for (const m of maps || []) {
    if (m && m.isActive === false) continue;
    const k = normCode(m.analyzerCode);
    if (k && !byCode.has(k)) byCode.set(k, m);
  }
  const mapped = [];
  const unmapped = [];
  for (const r of (message && message.results) || []) {
    const map = byCode.get(normCode(r.code));
    if (!map) { if (!unmapped.includes(r.code)) unmapped.push(r.code); continue; }
    mapped.push({
      analyzerCode: r.code,
      catalogKey: map.testCatalogKey,
      parameterName: map.parameterName || null,
      value: convertValue(r.value, map),
      rawValue: r.value,
      unit: map.unit || r.unit || null,
      rawUnit: r.unit || null,
      flags: Array.isArray(r.flags) ? r.flags.slice() : [],
    });
  }
  return { mapped, unmapped };
}

module.exports = { applyMaps, convertValue, roundAway, normCode };
