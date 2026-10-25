'use strict';
/**
 * LifeDx HBPro chromatogram: the record carries the HPLC curve as numbers
 * right after the result block —
 *
 *   …268.0 200 0.0000 0.0000 … 0.2377 … 0.0000 [trailing chars]
 *        eAG  N   N fixed-width values "d.dddd" (absorbance, OD)
 *
 * (no separators; N is 3 digits at block+145, each value 6 chars). The
 * analyzer samples the detector every SAMPLE_INTERVAL_S seconds — fitted
 * against the analyzer screen for a real run (A1a 15.3, A1b 17.8, F 25.2,
 * LA1c+ 32.8, A1c 51.0, A0 76.3 s): peak indices 22/28/38/50/78/117 × 0.65 s.
 *
 * renderChromatogram() draws it like the analyzer's own screen: a fixed
 * 0–90 s axis, the y axis in mOD scaled to the small peaks (≥ 10 mOD, the
 * analyzer's scale) so the A1c region reads well, and the huge A0 peak
 * clipped with an "off-scale" note. Output: PNG bytes (raster.js — pure JS).
 */
const { Canvas } = require('../raster');

const CURVE_OFFSET = 145;          // from the 35-digit block start (after eAG)
const SAMPLE_INTERVAL_S = 0.65;
const X_MAX_S = 90;
const IMAGE_CODE = 'HbA1c-graph';
const IMAGE_LABEL = 'HbA1c chromatogram';

/** Retention windows (s) the peak labels look in; a label is drawn only for a
 *  clear local maximum inside its window. */
const PEAKS = [
  { name: 'A1a', from: 12, to: 16.5 },
  { name: 'A1b', from: 16.5, to: 21.5 },
  { name: 'F', from: 21.5, to: 29 },
  { name: 'LA1c+', from: 29, to: 40 },
  { name: 'A1c', from: 44, to: 58 },
  { name: 'A0', from: 66, to: 86 },
];
const A0_FROM_S = 62;              // y scale ignores everything from here on

/** Curve points (OD) from a record, given its block start; null when the
 *  record carries no well-formed curve. */
function extractCurve(rec, block) {
  if (block < 0) return null;
  const at = block + CURVE_OFFSET;
  const n = Number(rec.slice(at, at + 3));
  if (!/^\d{3}$/.test(rec.slice(at, at + 3)) || n < 20 || n > 999) return null;
  const body = rec.slice(at + 3, at + 3 + n * 6);
  if (body.length !== n * 6) return null;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const v = body.slice(i * 6, i * 6 + 6);
    if (!/^\d\.\d{4}$/.test(v)) return null;
    pts.push(Number(v));
  }
  return pts;
}

/** Peaks found inside their retention windows: [{ name, index, time, od }]. */
function findPeaks(points, interval = SAMPLE_INTERVAL_S) {
  const out = [];
  for (const p of PEAKS) {
    const a = Math.max(1, Math.ceil(p.from / interval));
    const b = Math.min(points.length - 2, Math.floor(p.to / interval));
    let best = -1;
    for (let i = a; i <= b; i++) if (best < 0 || points[i] > points[best]) best = i;
    if (best < 0) continue;
    const v = points[best];
    // A clear local maximum: above the floor and above both neighbours.
    if (v < 0.0003 || !(v > points[best - 1] && v >= points[best + 1])) continue;
    out.push({ name: p.name, index: best, time: Math.round(best * interval * 10) / 10, od: v });
  }
  return out;
}

/** 10 / 20 / 50 / 100 … mOD — the smallest "nice" top ≥ v (at least 10). */
function niceTop(mod) {
  const steps = [10, 20, 30, 50, 100, 200, 300, 500, 1000];
  return steps.find((s) => s >= mod) || Math.ceil(mod / 1000) * 1000;
}

const C = {
  grid: [232, 230, 240], axis: [90, 90, 105], text: [40, 40, 52], muted: [110, 110, 125],
  curve: [74, 30, 140], peak: [74, 30, 140],
};

/**
 * PNG bytes of the chromatogram.
 * @param {number[]} points  OD values
 * @param {{ sampleId?: string|null, when?: string|null, interval?: number }} [meta]
 */
function renderChromatogram(points, meta = {}) {
  const interval = meta.interval || SAMPLE_INTERVAL_S;
  const W = 720, H = 360;
  const L = 62, R = 18, T = 46, B = 50;
  const pw = W - L - R, ph = H - T - B;
  const cv = new Canvas(W, H, 3);

  const mod = points.map((v) => v * 1000);
  const small = mod.filter((_, i) => i * interval < A0_FROM_S);
  const yTop = niceTop(Math.max(0, ...small) * 1.1);
  const xOf = (t) => L + (t / X_MAX_S) * pw;
  const yOf = (m) => T + ph - (m / yTop) * ph;

  // Title + caption.
  cv.text(IMAGE_LABEL, L, 12, C.text, 2);
  cv.text(IMAGE_LABEL, L + 0.5, 12, C.text, 2); // faux bold
  const cap = [meta.sampleId ? `Sample ${meta.sampleId}` : null, meta.when || null].filter(Boolean).join('   ');
  if (cap) cv.text(cap, W - R - cv.textWidth(cap, 1.5), 15, C.muted, 1.5);

  // Grid + ticks.
  const yStep = yTop / 5;
  for (let k = 0; k <= 5; k++) {
    const m = k * yStep, y = yOf(m);
    cv.line(L, y, L + pw, y, C.grid, 1);
    const lab = String(Math.round(m * 10) / 10);
    cv.text(lab, L - 8 - cv.textWidth(lab, 1.5), y - 5, C.muted, 1.5);
  }
  for (let t = 0; t <= X_MAX_S; t += 10) {
    const x = xOf(t);
    cv.line(x, T, x, T + ph, C.grid, 1);
    cv.line(x, T + ph, x, T + ph + 5, C.axis, 1);
    const lab = String(t);
    cv.text(lab, x - cv.textWidth(lab, 1.5) / 2, T + ph + 9, C.muted, 1.5);
  }
  cv.line(L, T, L, T + ph, C.axis, 1.2);
  cv.line(L, T + ph, L + pw, T + ph, C.axis, 1.2);
  const xl = 'Time (s)';
  cv.text(xl, L + pw / 2 - cv.textWidth(xl, 1.5) / 2, H - 16, C.muted, 1.5);
  cv.text('mOD', 8, T - 22, C.muted, 1.5);

  // Curve, clipped to the plot box.
  const lastI = Math.min(points.length - 1, Math.floor(X_MAX_S / interval));
  const clip = (m) => Math.min(yTop, Math.max(0, m));
  for (let i = 1; i <= lastI; i++) {
    cv.line(xOf((i - 1) * interval), yOf(clip(mod[i - 1])), xOf(i * interval), yOf(clip(mod[i])), C.curve, 1.6);
  }

  // Peak labels (name over retention time), raised to avoid overlaps. An
  // off-scale peak (A0) is named above the plot box instead, like the
  // analyzer's "off-scale" note, so the label never sits on the clipped curve.
  const placed = [];
  for (const p of findPeaks(points, interval)) {
    if (p.index > lastI) continue;
    const x = xOf(p.index * interval);
    if (p.od * 1000 > yTop) {
      const note = `${p.name} ${p.time} s  off-scale (${Math.round(p.od * 1000)} mOD)`;
      cv.rect(x - 1, T - 6, 2, 6, C.peak);
      cv.text(note, Math.min(L + pw - cv.textWidth(note, 1.5), x + 6), T - 16, C.peak, 1.5);
      continue;
    }
    const l1 = p.name, l2 = `${p.time}`;
    const w = Math.max(cv.textWidth(l1, 1.5), cv.textWidth(l2, 1.5));
    let bottom = yOf(p.od * 1000) - 6;
    let box = { x0: x - w / 2 - 2, x1: x + w / 2 + 2, y0: bottom - 26, y1: bottom };
    for (let guard = 0; guard < 6 && placed.some((q) => box.x0 < q.x1 && q.x0 < box.x1 && box.y0 < q.y1 && q.y0 < box.y1); guard++) {
      bottom -= 26;
      box = { ...box, y0: bottom - 26, y1: bottom };
    }
    if (box.y0 < T - 4) continue; // no room — skip rather than draw over the title
    placed.push(box);
    cv.text(l1, x - cv.textWidth(l1, 1.5) / 2, bottom - 26, C.peak, 1.5);
    cv.text(l2, x - cv.textWidth(l2, 1.5) / 2, bottom - 12, C.muted, 1.5);
  }
  return cv.toPng();
}

/** "261023" + "114053" → "2026-10-23 11:40" (null when it doesn't parse). */
function runStamp(rec, block) {
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(rec.slice(block + 11, block + 21));
  if (!m || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return null;
  return `20${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** The message image for a record, or null (no curve / disabled / failed). */
function chromatogramImage(rec, block, sampleId) {
  const pts = extractCurve(rec, block);
  if (!pts) return null;
  const png = renderChromatogram(pts, { sampleId, when: runStamp(rec, block) });
  return { code: IMAGE_CODE, label: IMAGE_LABEL, format: 'png', base64: png.toString('base64') };
}

module.exports = {
  extractCurve, findPeaks, renderChromatogram, chromatogramImage, runStamp,
  SAMPLE_INTERVAL_S, CURVE_OFFSET, IMAGE_CODE, IMAGE_LABEL,
};
