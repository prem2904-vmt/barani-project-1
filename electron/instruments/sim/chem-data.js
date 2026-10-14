'use strict';
/**
 * Deterministic chemistry results for the simulators (an Autolab / Eurolab
 * 200 / BS-series style analyzer: one tube, a list of photometric tests).
 * Chemistry is where two-way matters most — the analyzer must be told which
 * of 30+ tests to run on a tube.
 */
const CHEM = [
  // code, unit, low, high, decimals, typical
  ['GLU', 'mg/dL', 70, 110, 0, 92],
  ['UREA', 'mg/dL', 15, 45, 0, 28],
  ['CREA', 'mg/dL', 0.6, 1.3, 2, 0.92],
  ['CHOL', 'mg/dL', 0, 200, 0, 176],
  ['TG', 'mg/dL', 0, 150, 0, 118],
  ['HDL', 'mg/dL', 40, 90, 0, 52],
  ['ALT', 'U/L', 7, 40, 0, 26],
  ['AST', 'U/L', 8, 40, 0, 24],
  ['ALP', 'U/L', 40, 130, 0, 88],
  ['TBIL', 'mg/dL', 0.2, 1.2, 2, 0.74],
  ['UA', 'mg/dL', 3.5, 7.2, 1, 5.1],
  ['CA', 'mg/dL', 8.5, 10.5, 1, 9.4],
];

function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

/** @param {{sampleId:string, tests?:string[]}} o  tests = only these codes (default all) */
function generateChem({ sampleId, tests } = {}) {
  const seed = hash(sampleId);
  return CHEM.filter(([code]) => !tests || tests.includes(code)).map(([code, unit, lo, hi, dp, typ], i) => {
    const f = 0.9 + (((seed >>> (i % 16)) & 0xff) / 255) * 0.2;
    const v = +(typ * f).toFixed(dp);
    return { code, value: v.toFixed(dp), unit, flag: v < lo ? 'L' : v > hi ? 'H' : '' };
  });
}

module.exports = { generateChem, CHEM };
