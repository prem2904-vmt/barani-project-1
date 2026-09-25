/**
 * Plate vision — the PURE half of "Measure zones from plate".
 *
 * OpenCV.js (plate-detect.ts) finds the plate rim and the candidate circles;
 * everything that decides and MEASURES lives here as plain functions over a
 * grayscale buffer, so it is unit-tested without OpenCV or a DOM:
 *
 *   refineDisk / diskFeatures / classifyDisk   paper disk vs glare
 *   fitDiskEllipse                             per-disk tilt (ellipse)
 *   reconcileScale / tiltCheck / localRadius   the 6 mm disk ruler
 *   measureZone                                zone diameter by radial profile
 *   readingOrder / mosaicLayout                numbering + the AI mosaic
 *
 * No AI anywhere in this file.
 */

/** Grayscale image, 0..255, row-major. */
export interface Gray { w: number; h: number; d: Float32Array; }
export interface Circle { cx: number; cy: number; r: number; }
/** An ellipse: `rx` lies along `angle` (radians), `ry` across it. */
export interface Ellipse { cx: number; cy: number; rx: number; ry: number; angle: number; }

/** Standard AST paper disk (CLSI / HiMedia): 6 mm. */
export const DISK_MM = 6;
/** Plate sizes the technician can pick. */
export const PLATE_SIZES = [90, 100, 150] as const;
/** Plate vs disk scale disagreement that triggers the warning. */
export const SCALE_TOLERANCE = 0.08;
/** Disk ellipse ratio (major / minor) above which the photo is too oblique. */
export const TILT_LIMIT = 1.15;

// ── Sampling ─────────────────────────────────────────────────────────

/** Bilinear sample, clamped to the image. */
export function sample(g: Gray, x: number, y: number): number {
  const w = g.w, h = g.h;
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const d = g.d;
  const a = d[y0 * w + x0], b = d[y0 * w + x1], c = d[y1 * w + x0], e = d[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

export function median(v: ArrayLike<number>): number {
  const n = v.length;
  if (!n) return NaN;
  const s = Array.from(v).sort((a, b) => a - b);
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function mean(v: number[]): number { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; }

const ANG64 = Array.from({ length: 64 }, (_, i) => (i / 64) * Math.PI * 2);
const COS64 = ANG64.map(Math.cos), SIN64 = ANG64.map(Math.sin);

/** Radius of an ellipse in direction `theta`. */
export function ellipseRadiusAt(e: Pick<Ellipse, 'rx' | 'ry' | 'angle'>, theta: number): number {
  const t = theta - e.angle;
  const c = Math.cos(t), s = Math.sin(t);
  return (e.rx * e.ry) / Math.sqrt((e.ry * c) ** 2 + (e.rx * s) ** 2);
}

// ── Disk: refine, features, classify ────────────────────────────────

/** Inside-minus-outside contrast of a circle's rim: the median over 64 rays
 *  and the fraction of rays with a clear bright→dark step. A paper disk has
 *  a crisp edge ALL the way round; a glare patch fades into its surroundings. */
export function rimContrast(g: Gray, cx: number, cy: number, r: number): { edge: number; coverage: number } {
  const diffs = new Array<number>(64);
  let cov = 0;
  for (let i = 0; i < 64; i++) {
    const d = sample(g, cx + COS64[i] * r * 0.8, cy + SIN64[i] * r * 0.8) - sample(g, cx + COS64[i] * r * 1.22, cy + SIN64[i] * r * 1.22);
    diffs[i] = d;
    if (d > 6) cov++;
  }
  return { edge: median(diffs), coverage: cov / 64 };
}

/** Snap a rough circle onto the disk edge (centre ±0.5r, radius 0.78–1.28 of
 *  the expected radius). Hough centres drift on glare; this fixes that. */
export function refineDisk(g: Gray, c: Circle, expectR: number): Circle {
  const span = expectR * 0.5;
  const step = Math.max(0.75, expectR / 18);
  let best = { s: -Infinity, cx: c.cx, cy: c.cy, r: c.r };
  const tryAt = (cx: number, cy: number, r: number) => {
    const { edge, coverage } = rimContrast(g, cx, cy, r);
    const s = edge * 0.5 + coverage * 20;
    if (s > best.s) best = { s, cx, cy, r };
  };
  // Coarse, then fine around the coarse winner.
  for (let r = expectR * 0.78; r <= expectR * 1.28; r += step)
    for (let dx = -span; dx <= span; dx += step * 2)
      for (let dy = -span; dy <= span; dy += step * 2) tryAt(c.cx + dx, c.cy + dy, r);
  const b = best;
  for (let r = b.r - step; r <= b.r + step; r += step / 2)
    for (let dx = -step * 2; dx <= step * 2; dx += step / 2)
      for (let dy = -step * 2; dy <= step * 2; dy += step / 2) tryAt(b.cx + dx, b.cy + dy, r);
  return { cx: best.cx, cy: best.cy, r: best.r };
}

/** |Laplacian| at an integer pixel (texture: printed text, glare speckle). */
function lapAt(g: Gray, x: number, y: number): number {
  const w = g.w;
  if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) return 0;
  const i = y * w + x, d = g.d;
  return Math.abs(4 * d[i] - d[i - 1] - d[i + 1] - d[i - w] - d[i + w]);
}

export interface DiskFeatures {
  edge: number;        // median rim contrast (grey levels)
  coverage: number;    // fraction of rays with a clear rim step
  textRatio: number;   // texture inside (printed code) ÷ texture around
  whiteness: number;   // 60th-percentile grey inside
  ratio: number;       // ellipse major / minor (streaks are long)
}

export function diskFeatures(g: Gray, c: Circle): DiskFeatures {
  const { edge, coverage } = rimContrast(g, c.cx, c.cy, c.r);
  let tIn = 0, nIn = 0, tOut = 0, nOut = 0;
  const inside: number[] = [];
  const R = Math.ceil(c.r * 2);
  for (let y = Math.floor(c.cy - R); y <= c.cy + R; y++) {
    for (let x = Math.floor(c.cx - R); x <= c.cx + R; x++) {
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
      const d = Math.hypot(x - c.cx, y - c.cy);
      if (d < c.r * 0.8) { tIn += lapAt(g, x, y); nIn++; inside.push(g.d[y * g.w + x]); }
      else if (d > c.r * 1.3 && d < c.r * 2) { tOut += lapAt(g, x, y); nOut++; }
    }
  }
  inside.sort((a, b) => a - b);
  const e = fitDiskEllipse(g, c);
  return {
    edge, coverage,
    textRatio: nIn && nOut ? (tIn / nIn) / Math.max(0.5, tOut / nOut) : 0,
    whiteness: inside.length ? inside[Math.floor(inside.length * 0.6)] : 0,
    ratio: Math.max(e.rx, e.ry) / Math.max(1e-6, Math.min(e.rx, e.ry)),
  };
}

export type RejectReason = 'edge' | 'text' | 'shape' | 'size';

/** Paper disk or glare? A disk has a crisp round rim (edge + coverage), a
 *  printed code inside (more texture inside than around — glare speckle is
 *  the same inside and out), a round shape and the expected size. */
export function classifyDisk(f: DiskFeatures, r: number, expectR: number): { ok: boolean; reason?: RejectReason; score: number } {
  const score = f.edge * 0.6 + f.coverage * 30 + Math.min(3, f.textRatio) * 12;
  if (r < expectR * 0.72 || r > expectR * 1.32) return { ok: false, reason: 'size', score };
  if (f.ratio > 1.45) return { ok: false, reason: 'shape', score };
  if (f.edge < 22 || f.coverage < 0.78) return { ok: false, reason: 'edge', score };
  if (f.textRatio < 1.2) return { ok: false, reason: 'text', score };
  return { ok: true, score };
}

/** Fit the disk's outline as an ellipse from 64 radial edge points
 *  (r(θ) ≈ a0 + a1·cos/sin θ + a2·cos/sin 2θ, least squares, one outlier pass).
 *  The 2θ term is the tilt; the 1θ term re-centres. */
export function fitDiskEllipse(g: Gray, c: Circle): Ellipse {
  // Paper level: a high percentile of the inner disk (the printed code is
  // dark and must not drag it down).
  const inner: number[] = [];
  for (let i = 0; i < 64; i += 2) for (let f = 0.3; f <= 0.8; f += 0.1) inner.push(sample(g, c.cx + COS64[i] * c.r * f, c.cy + SIN64[i] * c.r * f));
  inner.sort((a, b) => a - b);
  const paper = inner[Math.floor(inner.length * 0.85)];
  const pts: { t: number; r: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const at = (s: number) => sample(g, c.cx + COS64[i] * s, c.cy + SIN64[i] * s);
    const outs: number[] = [];
    for (let s = c.r * 1.3; s <= c.r * 1.55; s += 0.5) outs.push(at(s));
    const out = median(outs);
    let br = NaN;
    if (paper - out >= 10) {
      // Half-way between paper and agar; the OUTERMOST down-crossing is the
      // paper's edge (text strokes inside cross too, further in).
      const half = (paper + out) / 2;
      let prev = at(c.r * 0.72);
      for (let s = c.r * 0.75; s <= c.r * 1.35; s += 0.5) {
        const v = at(s);
        if (prev >= half && v < half) br = s - 0.5 * (half - v) / Math.max(1e-6, prev - v);
        prev = v;
      }
    }
    if (!Number.isFinite(br)) {
      // Glare brighter than the paper: fall back to the strongest step.
      let best = -1; br = c.r;
      let prev = at(c.r * 0.82);
      for (let s = c.r * 0.85; s <= c.r * 1.3; s += 0.5) { const v = at(s); if (Math.abs(prev - v) > best) { best = Math.abs(prev - v); br = s - 0.25; } prev = v; }
    }
    pts.push({ t: ANG64[i], r: br });
  }
  let use = pts;
  let sol = fitHarmonics(use);
  for (let pass = 0; pass < 2; pass++) {
    const res = use.map(p => Math.abs(p.r - evalHarmonics(sol, p.t)));
    const mad = median(res) || 0.5;
    const keep = use.filter((_, k) => res[k] <= Math.max(1.5, 3 * mad));
    if (keep.length < 16 || keep.length === use.length) break;
    use = keep; sol = fitHarmonics(use);
  }
  const [a0, a1c, a1s, a2c, a2s] = sol;
  const amp = Math.hypot(a2c, a2s);
  return {
    cx: c.cx + a1c, cy: c.cy + a1s,
    rx: a0 + amp, ry: Math.max(1, a0 - amp),
    angle: Math.atan2(a2s, a2c) / 2,
  };
}

function evalHarmonics(s: number[], t: number): number {
  return s[0] + s[1] * Math.cos(t) + s[2] * Math.sin(t) + s[3] * Math.cos(2 * t) + s[4] * Math.sin(2 * t);
}
/** 5-term least squares via the normal equations (tiny, well-conditioned). */
function fitHarmonics(pts: { t: number; r: number }[]): number[] {
  const n = 5;
  const A = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0));
  for (const p of pts) {
    const row = [1, Math.cos(p.t), Math.sin(p.t), Math.cos(2 * p.t), Math.sin(2 * p.t)];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += row[i] * row[j];
      A[i][n] += row[i] * p.r;
    }
  }
  for (let i = 0; i < n; i++) {          // Gauss-Jordan
    let piv = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[piv][i])) piv = k;
    [A[i], A[piv]] = [A[piv], A[i]];
    const d = A[i][i] || 1e-9;
    for (let j = i; j <= n; j++) A[i][j] /= d;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const f = A[k][i];
      for (let j = i; j <= n; j++) A[k][j] -= f * A[i][j];
    }
  }
  return A.map(r => r[n]);
}

/** Merge overlapping candidates (keep the higher score). */
export function suppressOverlaps<T extends Circle & { score: number }>(list: T[], minDist: number): T[] {
  const out: T[] = [];
  for (const c of [...list].sort((a, b) => b.score - a.score))
    if (!out.some(o => Math.hypot(o.cx - c.cx, o.cy - c.cy) < minDist)) out.push(c);
  return out;
}

// ── Scale: plate rim vs the 6 mm disk ruler ──────────────────────────

export interface ScaleReport {
  /** mm per px from the plate rim (null = no plate). */
  plateMmPerPx: number | null;
  /** mm per px from the median disk diameter (null = too few disks). */
  diskMmPerPx: number | null;
  /** The scale used where no local disk scale applies. */
  mmPerPx: number;
  source: 'plate' | 'disk' | 'none';
  /** Plate and disk scales disagree by more than SCALE_TOLERANCE. */
  mismatch: boolean;
  /** The plate size the disks imply, when it is one of PLATE_SIZES. */
  suggestedDishMm: number | null;
}

/** Reconcile the plate scale (dish diameter ÷ rim diameter) with the disk
 *  ruler (6 mm ÷ median disk diameter). They should agree; when they differ
 *  by more than 8% the disks win (a 100 mm plate read as 90, a lid rim…). */
export function reconcileScale(plateDiameterPx: number | null, dishMm: number, diskDiametersPx: number[]): ScaleReport {
  const plateMmPerPx = plateDiameterPx && plateDiameterPx > 0 ? dishMm / plateDiameterPx : null;
  const med = diskDiametersPx.length ? median(diskDiametersPx) : NaN;
  const diskMmPerPx = diskDiametersPx.length >= 2 && med > 0 ? DISK_MM / med : null;
  if (plateMmPerPx == null && diskMmPerPx == null) {
    return { plateMmPerPx, diskMmPerPx, mmPerPx: 0, source: 'none', mismatch: false, suggestedDishMm: null };
  }
  if (plateMmPerPx == null) return { plateMmPerPx, diskMmPerPx, mmPerPx: diskMmPerPx!, source: 'disk', mismatch: false, suggestedDishMm: null };
  if (diskMmPerPx == null) return { plateMmPerPx, diskMmPerPx, mmPerPx: plateMmPerPx, source: 'plate', mismatch: false, suggestedDishMm: null };
  const mismatch = Math.abs(plateMmPerPx / diskMmPerPx - 1) > SCALE_TOLERANCE;
  let suggestedDishMm: number | null = null;
  if (mismatch) {
    const implied = plateDiameterPx! * diskMmPerPx;
    const near = [...PLATE_SIZES].sort((a, b) => Math.abs(a - implied) - Math.abs(b - implied))[0];
    if (near !== dishMm && Math.abs(near / implied - 1) <= SCALE_TOLERANCE) suggestedDishMm = near;
  }
  return {
    plateMmPerPx, diskMmPerPx,
    mmPerPx: mismatch ? diskMmPerPx : plateMmPerPx,
    source: mismatch ? 'disk' : 'plate',
    mismatch, suggestedDishMm,
  };
}

/** The neutral warning line for a scale mismatch (null = none). */
export function scaleWarning(s: ScaleReport): string | null {
  if (!s.mismatch) return null;
  return s.suggestedDishMm
    ? `Plate size looks different — is it ${s.suggestedDishMm} mm?`
    : 'Plate size looks different — measuring with the disks instead.';
}

type Shape = Pick<Ellipse, 'rx' | 'ry' | 'angle'>;

/** The shared ellipse shape of several disks: each outline's 2θ term as a
 *  vector ((rx−ry)/(rx+ry) at 2·angle), averaged. Real tilt is the same on
 *  neighbouring disks and adds up; edge noise points anywhere and cancels. */
export function consensusShape(shapes: Shape[]): { ratio: number; angle: number } {
  if (!shapes.length) return { ratio: 1, angle: 0 };
  let x = 0, y = 0;
  for (const s of shapes) {
    const a = (s.rx - s.ry) / Math.max(1e-6, s.rx + s.ry);
    x += a * Math.cos(2 * s.angle); y += a * Math.sin(2 * s.angle);
  }
  x /= shapes.length; y /= shapes.length;
  const amp = Math.min(0.9, Math.hypot(x, y));
  return { ratio: (1 + amp) / (1 - amp), angle: Math.atan2(y, x) / 2 };
}

/** Too oblique? The plate-wide disk ellipse ratio above TILT_LIMIT → ask for
 *  a retake from directly above. */
export function tiltCheck(shapes: Shape[]): { ratio: number; angle: number; warn: boolean } {
  const c = consensusShape(shapes);
  return { ...c, warn: c.ratio > TILT_LIMIT };
}

/** The disk as the zone measurement sees it: its own centre, the LOCAL
 *  ruler's size (own + nearest neighbours' radius) and the local shared
 *  ellipse shape (own + neighbours) — local tilt correction. */
export function localDisk(disks: (Ellipse & { r: number })[], i: number, k = 2): Ellipse {
  const me = disks[i];
  const idx = disks
    .map((d, j) => ({ j, dist: Math.hypot(d.cx - me.cx, d.cy - me.cy) }))
    .filter(x => x.j !== i).sort((a, b) => a.dist - b.dist).slice(0, k).map(x => x.j);
  const r = localRadius(disks, i, k);
  const { ratio, angle } = consensusShape([me, ...idx.map(j => disks[j])]);
  // Split the mean radius by the ratio ((rx + ry) / 2 = r).
  const ry = (2 * r) / (1 + ratio), rx = ry * ratio;
  return { cx: me.cx, cy: me.cy, rx, ry, angle };
}

/** Local disk radius for disk `i`: the median of its own mean radius and
 *  its `k` nearest neighbours' — the ruler right where the zone is. */
export function localRadius(disks: { cx: number; cy: number; r: number }[], i: number, k = 2): number {
  const me = disks[i];
  const near = disks
    .map((d, j) => ({ d, j, dist: Math.hypot(d.cx - me.cx, d.cy - me.cy) }))
    .filter(x => x.j !== i)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, k)
    .map(x => x.d.r);
  return median([me.r, ...near]);
}

// ── Zone diameter by radial profile ──────────────────────────────────

export interface ZoneResult {
  /** A clear zone beyond the disk was found. */
  found: boolean;
  /** Zone diameter in mm (DISK_MM when there is no zone). */
  mm: number;
  /** Zone radius in units of the local disk radius (1 = no zone). */
  k: number;
  /** Diameter along the disk's long and short axis (mm), averaged into `mm`. */
  axes: [number, number];
  /** Fraction of rays that found the edge. */
  coverage: number;
}

/**
 * Zone diameter for one disk. 72 rays leave the paper's edge (`own`, the
 * disk's fitted outline); on each, the zone edge is where the smoothed
 * profile gets back HALF-way from the zone level (just off the paper) to the
 * lawn level (far out). Each edge is divided by the `ruler` radius IN THAT
 * DIRECTION — the local 6 mm disk (own + neighbours' size and ellipse shape,
 * see localDisk) — so a tilted photo's oval zone reads true; then the long
 * and short axis are averaged. Works for a darker or a lighter zone; a
 * speckled "zone" (glare) is refused. No zone (or under 6.5 mm) → 6 mm, the
 * CLSI convention.
 */
export function measureZone(g: Gray, own: Ellipse, ruler: Ellipse, opts: { maxK?: number; plate?: Circle | null } = {}): ZoneResult {
  const none: ZoneResult = { found: false, mm: DISK_MM, k: 1, axes: [DISK_MM, DISK_MM], coverage: 0 };
  const rMean = (ruler.rx + ruler.ry) / 2;
  if (!(own.rx > 0) || !(rMean > 0)) return none;
  const maxK = opts.maxK ?? 7;
  const N = 72, STEP = 0.5;
  const far: number[] = [], nearV: number[] = [];
  const rays: { t: number; s0: number; rr: number; prof: number[] }[] = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const ro = ellipseRadiusAt(own, t), rr = ellipseRadiusAt(ruler, t);
    const c = Math.cos(t), s = Math.sin(t);
    let sMax = maxK * rr;
    if (opts.plate) {                            // stop short of the plate wall
      const p = opts.plate;
      const ox = own.cx - p.cx, oy = own.cy - p.cy;
      const b = ox * c + oy * s, cc = ox * ox + oy * oy - (p.r * 0.97) ** 2;
      const disc = b * b - cc;
      if (disc > 0) sMax = Math.min(sMax, -b + Math.sqrt(disc));
    }
    const s0 = ro * 1.12;
    const raw: number[] = [];
    for (let d = s0; d <= sMax; d += STEP) raw.push(sample(g, own.cx + c * d, own.cy + s * d));
    const prof = smooth(raw, 3);
    prof.forEach((v, idx) => {
      const d = s0 + idx * STEP;
      if (d >= 4.2 * rr) far.push(v);
      else if (d >= ro * 1.22 && d <= ro * 1.5) nearV.push(v);
    });
    rays.push({ t, s0, rr, prof });
  }
  if (far.length < 40 || !nearV.length) return none;
  const lawn = median(far);
  const noise = median(far.map(v => Math.abs(v - lawn))) * 1.4826;
  const dev = median(nearV) - lawn;
  if (Math.abs(dev) < Math.max(7, 2.5 * noise)) return none;
  // Clear agar is SMOOTH; a glare highlight is speckled. A "zone" band that
  // is much busier than the lawn is glare, not inhibition.
  const ownR = (own.rx + own.ry) / 2;
  if (bandTexture(g, own.cx, own.cy, ownR, 1.25, 1.6) > Math.max(1.5, 1.35 * bandTexture(g, own.cx, own.cy, rMean, 4.2, 6))) return none;
  const sign = Math.sign(dev), half = Math.abs(dev) / 2;
  const past = (v: number) => (v - lawn) * sign < half;
  const ks: { t: number; k: number }[] = [];
  for (const r of rays) {
    // Skip any rim blur until the ray is IN the zone, then the first run of
    // 3 samples back past the half-way level is the zone edge.
    const skipTo = Math.round((r.rr * 0.5) / STEP);
    let idx = 0;
    while (idx < r.prof.length && idx < skipTo && past(r.prof[idx])) idx++;
    let hit = -1;
    for (; idx + 2 < r.prof.length; idx++) {
      if (past(r.prof[idx]) && past(r.prof[idx + 1]) && past(r.prof[idx + 2])) { hit = idx; break; }
    }
    const d = r.s0 + hit * STEP;
    if (hit > 0 && d < 4.2 * r.rr) ks.push({ t: r.t, k: d / r.rr });
  }
  const coverage = ks.length / N;
  if (coverage < 0.4) return { ...none, coverage };
  const kAll = median(ks.map(x => x.k));
  // Long / short axis sectors (±30° either side, both directions).
  const near = (a: number, b: number) => { const d = Math.abs(((a - b) % Math.PI + Math.PI) % Math.PI); return Math.min(d, Math.PI - d) <= Math.PI / 6; };
  const kMaj = ks.filter(x => near(x.t, ruler.angle)).map(x => x.k);
  const kMin = ks.filter(x => near(x.t, ruler.angle + Math.PI / 2)).map(x => x.k);
  const a1 = kMaj.length >= 4 ? median(kMaj) : kAll, a2 = kMin.length >= 4 ? median(kMin) : kAll;
  const k = (a1 + a2) / 2;
  const mm = round1(DISK_MM * k);
  if (mm < 6.5) return { ...none, coverage };
  return { found: true, mm, k, axes: [round1(DISK_MM * a1), round1(DISK_MM * a2)], coverage };
}

/** Mean |Laplacian| over the annulus k0..k1 (in units of `r`) — sampled
 *  on a sparse grid so large zones stay cheap. */
export function bandTexture(g: Gray, cx: number, cy: number, r: number, k0: number, k1: number): number {
  const R = r * k1, step = Math.max(1, Math.round(R / 60));
  let s = 0, n = 0;
  for (let y = Math.floor(cy - R); y <= cy + R; y += step) {
    for (let x = Math.floor(cx - R); x <= cx + R; x += step) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d < k0 || d > k1) continue;
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
      s += lapAt(g, x, y); n++;
    }
  }
  return n ? s / n : 0;
}

function smooth(v: number[], rad: number): number[] {
  return v.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - rad); j <= Math.min(v.length - 1, i + rad); j++) { s += v[j]; n++; }
    return s / n;
  });
}
export function round1(v: number): number { return Math.round(v * 10) / 10; }

// ── Numbering + the mosaic for the ONE AI call ───────────────────────

/** Reading order: rows top→bottom (points within `rowTol` of a row's first
 *  y share it), then left→right. Returns the indices in order. */
export function readingOrder(pts: { cx: number; cy: number }[], rowTol: number): number[] {
  const idx = pts.map((_, i) => i).sort((a, b) => pts[a].cy - pts[b].cy);
  const rows: number[][] = [];
  for (const i of idx) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(pts[i].cy - pts[row[0]].cy) <= rowTol) row.push(i);
    else rows.push([i]);
  }
  return rows.flatMap(r => r.sort((a, b) => pts[a].cx - pts[b].cx));
}

export interface MosaicLayout { width: number; height: number; cols: number; tile: number; tiles: { n: number; x: number; y: number }[]; }

/** Tile positions for `count` numbered disk crops, `cols` per row. Tile i
 *  (0-based) carries number i+1, row-major — the number the AI answers with. */
export function mosaicLayout(count: number, cols = 4, tile = 256): MosaicLayout {
  const c = Math.max(1, Math.min(cols, count || 1));
  const rows = Math.max(1, Math.ceil(count / c));
  return {
    width: c * tile, height: rows * tile, cols: c, tile,
    tiles: Array.from({ length: count }, (_, i) => ({ n: i + 1, x: (i % c) * tile, y: Math.floor(i / c) * tile })),
  };
}
