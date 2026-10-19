import type { CV } from './opencv-loader';
import {
  Circle, DiskFeatures, Ellipse, Gray, RejectReason,
  classifyDisk, diskFeatures, fitDiskEllipse, refineDisk, suppressOverlaps,
} from './plate-vision';

/** Longest side the analysis runs at (phone photos are ~4000 px). */
export const WORK_MAX_SIDE = 1280;

export interface FoundDisk { cx: number; cy: number; r: number; ellipse: Ellipse; ratio: number; score: number; f: DiskFeatures; }
export interface RejectedCircle { cx: number; cy: number; r: number; reason: RejectReason; }

/**
 * The OpenCV half: grayscale + blur + Hough (plate rim, disk candidates).
 * Everything that DECIDES (refine, glare filter, ellipse, zone) is in
 * plate-vision.ts. Coordinates are WORK coordinates (× `factor` = image px).
 * Call dispose() when done — OpenCV Mats live in WASM memory.
 */
export class PlateVision {
  readonly gray: Gray;
  readonly factor: number;
  private readonly med: CV;       // median-blurred 8-bit gray (Hough input)

  constructor(private readonly cv: CV, source: HTMLImageElement | HTMLCanvasElement, naturalW: number, naturalH: number) {
    const f = Math.max(1, Math.max(naturalW, naturalH) / WORK_MAX_SIDE);
    const w = Math.round(naturalW / f), h = Math.round(naturalH / f);
    this.factor = naturalW / w;
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, w, h);
    const rgba = cv.matFromImageData(ctx.getImageData(0, 0, w, h));
    const g8 = new cv.Mat(), sm = new cv.Mat(), gf = new cv.Mat();
    try {
      cv.cvtColor(rgba, g8, cv.COLOR_RGBA2GRAY);
      this.med = new cv.Mat();
      cv.medianBlur(g8, this.med, 5);
      cv.GaussianBlur(g8, sm, new cv.Size(0, 0), 1.2);
      sm.convertTo(gf, cv.CV_32F);
      this.gray = { w, h, d: new Float32Array(gf.data32F) };
    } finally { rgba.delete(); g8.delete(); sm.delete(); gf.delete(); }
  }

  /** The plate rim — the strongest big circle (25–50% of the short side). */
  findPlate(): Circle | null {
    const cv = this.cv, { w, h } = this.gray, m = Math.min(w, h);
    const out = new cv.Mat();
    try {
      cv.HoughCircles(this.med, out, cv.HOUGH_GRADIENT, 1.5, Math.max(w, h), 80, 40, Math.round(m * 0.25), Math.round(m * 0.5));
      if (!out.cols) return null;
      const d = out.data32F;
      return { cx: d[0], cy: d[1], r: d[2] };
    } finally { out.delete(); }
  }

  /** Paper disks inside `bounds` (the plate). `expectR` = 3 mm in work px. */
  findDisks(bounds: Circle, expectR: number): { disks: FoundDisk[]; rejected: RejectedCircle[] } {
    const cv = this.cv;
    const out = new cv.Mat();
    const cands: Circle[] = [];
    try {
      cv.HoughCircles(this.med, out, cv.HOUGH_GRADIENT, 1, Math.max(4, expectR * 1.6), 60, 14,
        Math.max(3, Math.round(expectR * 0.72)), Math.round(expectR * 1.32));
      const d = out.data32F;
      for (let i = 0; i < out.cols; i++) cands.push({ cx: d[i * 3], cy: d[i * 3 + 1], r: d[i * 3 + 2] });
    } finally { out.delete(); }
    return classifyCandidates(this.gray, cands, bounds, expectR);
  }

  dispose() { try { this.med.delete(); } catch { /* already freed */ } }
}

/** Refine → features → classify → de-duplicate. Pure (no OpenCV). */
export function classifyCandidates(g: Gray, cands: Circle[], bounds: Circle, expectR: number): { disks: FoundDisk[]; rejected: RejectedCircle[] } {
  const ok: (FoundDisk & { score: number })[] = [];
  const bad: (RejectedCircle & { score: number })[] = [];
  for (const c of cands) {
    if (Math.hypot(c.cx - bounds.cx, c.cy - bounds.cy) > bounds.r - expectR * 1.2) continue;
    const rc = refineDisk(g, c, expectR);
    const f = diskFeatures(g, rc);
    const v = classifyDisk(f, rc.r, expectR);
    if (v.ok) {
      const e = fitDiskEllipse(g, rc);
      ok.push({ cx: e.cx, cy: e.cy, r: (e.rx + e.ry) / 2, ellipse: e, ratio: f.ratio, score: v.score, f });
    } else {
      bad.push({ cx: rc.cx, cy: rc.cy, r: rc.r, reason: v.reason!, score: v.score });
    }
  }
  const disks = suppressOverlaps(ok, expectR * 1.5);
  const rejected = suppressOverlaps(bad, expectR * 1.5)
    .filter(b => !disks.some(d => Math.hypot(d.cx - b.cx, d.cy - b.cy) < expectR * 1.5));
  return { disks, rejected: rejected.map(({ cx, cy, r, reason }) => ({ cx, cy, r, reason })) };
}
