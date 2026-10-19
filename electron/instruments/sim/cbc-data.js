'use strict';
/**
 * Realistic CBC result generator for the simulators. Deterministic per
 * (sampleId, run, profile) so tests can predict the exact values.
 *
 * Analyzer-side units (what a haematology analyzer typically reports):
 * counts in 10^3/uL (WBC, PLT, absolute differentials) and 10^6/uL (RBC).
 * The LMS Test Master stores WBC/PLT in cells/µL, so the code maps carry a
 * ×1000 factor — the e2e proves the conversion.
 */

// code, unit, low, high (adult reference, for H/L flags), decimals, typical
const FIVE_PART = [
  ['WBC', '10^3/uL', 4.0, 10.0, 1, 7.2],
  ['RBC', '10^6/uL', 4.5, 5.5, 2, 4.9],
  ['HGB', 'g/dL', 13.0, 17.0, 1, 14.6],
  ['HCT', '%', 40.0, 50.0, 1, 44.1],
  ['MCV', 'fL', 83.0, 101.0, 1, 90.0],
  ['MCH', 'pg', 27.0, 32.0, 1, 29.8],
  ['MCHC', 'g/dL', 31.5, 34.5, 1, 33.1],
  ['RDW-CV', '%', 11.6, 14.0, 1, 12.9],
  ['PLT', '10^3/uL', 150, 410, 0, 265],
  ['MPV', 'fL', 7.5, 11.5, 1, 9.4],
  ['NEUT%', '%', 40.0, 80.0, 1, 58.0],
  ['LYMPH%', '%', 20.0, 40.0, 1, 31.0],
  ['MONO%', '%', 2.0, 10.0, 1, 6.5],
  ['EOS%', '%', 1.0, 6.0, 1, 3.8],
  ['BASO%', '%', 0.0, 2.0, 1, 0.7],
];
const ABS = [['NEUT#', 'NEUT%', 2.0, 7.0], ['LYMPH#', 'LYMPH%', 1.0, 3.0], ['MONO#', 'MONO%', 0.2, 1.0], ['EOS#', 'EOS%', 0.02, 0.5], ['BASO#', 'BASO%', 0.02, 0.1]];

const THREE_PART = [
  ['WBC', '10^3/uL', 4.0, 10.0, 1, 7.2],
  ['LYM%', '%', 20.0, 40.0, 1, 31.0],
  ['MID%', '%', 3.0, 15.0, 1, 9.0],
  ['GRAN%', '%', 50.0, 70.0, 1, 60.0],
  ['RBC', '10^6/uL', 4.5, 5.5, 2, 4.9],
  ['HGB', 'g/dL', 13.0, 17.0, 1, 14.6],
  ['HCT', '%', 40.0, 50.0, 1, 44.1],
  ['MCV', 'fL', 83.0, 101.0, 1, 90.0],
  ['MCH', 'pg', 27.0, 32.0, 1, 29.8],
  ['MCHC', 'g/dL', 31.5, 34.5, 1, 33.1],
  ['RDW-CV', '%', 11.6, 14.0, 1, 12.9],
  ['PLT', '10^3/uL', 150, 410, 0, 265],
  ['MPV', 'fL', 7.5, 11.5, 1, 9.4],
];

function hash(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function rng(seed) {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

function flag(v, lo, hi) { return v < lo ? 'L' : v > hi ? 'H' : ''; }

/**
 * @param {{sampleId:string, run?:number, variant?:'5part'|'3part', profile?:'normal'|'anemia'|'infection'|'qc'}} o
 * @returns {Array<{code,value,unit,flag}>}
 */
function generateCbc({ sampleId, run = 1, variant = '5part', profile } = {}) {
  const r = rng(hash(`${sampleId}#${run}#${variant}`));
  // Deterministic "clinical picture" per sample so some results flag H/L.
  const p = profile || ['normal', 'anemia', 'infection'][hash(sampleId) % 3];
  const table = variant === '3part' ? THREE_PART : FIVE_PART;
  const vals = {};
  const out = [];
  for (const [code, unit, lo, hi, dp, typ] of table) {
    let v = typ * (0.93 + r() * 0.14);
    if (p === 'anemia' && ['HGB', 'HCT', 'RBC', 'MCV', 'MCH'].includes(code)) v = typ * 0.72;
    if (p === 'infection' && code === 'WBC') v = 14.8 + r() * 2;
    if (p === 'infection' && (code === 'NEUT%' || code === 'GRAN%')) v = 82 + r() * 4;
    if (p === 'qc') v = typ;                                   // QC material sits on target
    v = +v.toFixed(dp);
    vals[code] = v;
    out.push({ code, value: v.toFixed(dp), unit, flag: p === 'qc' ? '' : flag(v, lo, hi) });
  }
  if (variant !== '3part') {
    // Keep the differential summing to 100 %.
    const pct = ['NEUT%', 'LYMPH%', 'MONO%', 'EOS%'];
    const sum = pct.reduce((a, c) => a + vals[c], 0);
    const baso = Math.max(0.1, +(100 - sum).toFixed(1));
    const b = out.find((x) => x.code === 'BASO%');
    b.value = baso.toFixed(1); vals['BASO%'] = baso; b.flag = p === 'qc' ? '' : flag(baso, 0, 2);
    for (const [abs, pctCode, lo, hi] of ABS) {
      const v = +(vals.WBC * vals[pctCode] / 100).toFixed(2);
      out.push({ code: abs, value: v.toFixed(2), unit: '10^3/uL', flag: p === 'qc' ? '' : flag(v, lo, hi) });
    }
  } else {
    const g = out.find((x) => x.code === 'GRAN%');
    const l = vals['LYM%']; const m = vals['MID%'];
    g.value = Math.max(0, 100 - l - m).toFixed(1);
    for (const [abs, pctCode] of [['LYM#', 'LYM%'], ['MID#', 'MID%'], ['GRAN#', 'GRAN%']]) {
      const pv = Number(out.find((x) => x.code === pctCode).value);
      out.push({ code: abs, value: (vals.WBC * pv / 100).toFixed(2), unit: '10^3/uL', flag: '' });
    }
  }
  return out;
}

module.exports = { generateCbc, FIVE_PART, THREE_PART };
