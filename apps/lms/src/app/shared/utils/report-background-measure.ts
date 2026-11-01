import { PAGE, backgroundRect, ptToMm, type BgFit } from './report-header-layout';

/**
 * AUTO-MEASURE for pre-printed stationery (report layout plan §3.8).
 *
 * The lab uploads a scan or photo of its letterhead paper. We find the lowest
 * printed row in the top 40 percent of the sheet and the highest printed row in
 * the bottom 25 percent, and turn them into "blank at the top / bottom" in mm -
 * the two numbers the Pre-printed paper setting already has. The lab can edit
 * both afterwards.
 *
 * Pure: works on an RGBA pixel array, so it is tested with synthetic images. The
 * browser part (`readImagePixels`) only fills that array from an image.
 *
 * What it ignores, because real scans have them:
 *  - the paper colour (it is measured, so cream or grey paper is not "ink");
 *  - speckle and scanner noise (a row needs a few real marks);
 *  - tall side borders and edge shadows (columns inked down most of the page);
 *  - the outer 1 percent of the sheet.
 */

export interface PixelImage { data: ArrayLike<number>; width: number; height: number }

export interface StationeryMeasure {
  /** mm of blank paper needed at the top, or null when nothing is printed there. */
  headerMm: number | null;
  /** mm of blank paper needed at the bottom, or null when nothing is printed there. */
  footerMm: number | null;
  /** Lowest printed row in the top zone / highest in the bottom zone (image rows), -1 = none. */
  headerRow: number;
  footerRow: number;
  /** The paper colour found (0-255 per channel). */
  paper: [number, number, number];
}

export const MEASURE_TOP_ZONE = 0.40;
export const MEASURE_BOTTOM_ZONE = 0.25;
/** Breathing room added under the lowest mark and above the highest (mm). */
export const MEASURE_PAD_MM = 2;
const INK_DIFF = 32;          // max channel difference from the paper that counts as printed
const EDGE = 0.01;            // outer share of the sheet ignored
const BORDER_COL = 0.6;       // a column inked on more of the page than this is a border, not content

function rgb(px: ArrayLike<number>, i: number): [number, number, number] {
  const a = (px[i + 3] ?? 255) / 255;         // transparent = white paper
  return [px[i] * a + 255 * (1 - a), px[i + 1] * a + 255 * (1 - a), px[i + 2] * a + 255 * (1 - a)];
}

/** The paper colour: the commonest colour in the middle of the sheet. */
function paperColour(img: PixelImage): [number, number, number] {
  const { data, width: w, height: h } = img;
  const bins = new Map<number, number>();
  const y0 = Math.floor(h * 0.3), y1 = Math.floor(h * 0.7), x0 = Math.floor(w * 0.1), x1 = Math.floor(w * 0.9);
  const stepY = Math.max(1, Math.floor((y1 - y0) / 80)), stepX = Math.max(1, Math.floor((x1 - x0) / 80));
  let best = 0, bestKey = 0xffffff;
  const key = (r: number, g: number, b: number) => ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const [r, g, b] = rgb(data, (y * w + x) * 4);
      const k = key(r, g, b);
      const n = (bins.get(k) ?? 0) + 1;
      bins.set(k, n);
      if (n > best) { best = n; bestKey = k; }
    }
  }
  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const [r, g, b] = rgb(data, (y * w + x) * 4);
      if (key(r, g, b) === bestKey) { sr += r; sg += g; sb += b; c++; }
    }
  }
  return c ? [sr / c, sg / c, sb / c] : [255, 255, 255];
}

/** Find the printed rows. `fit` is how the image will sit on the page (default: cover). */
export function measureStationery(img: PixelImage, fit: BgFit = 'cover'): StationeryMeasure {
  const { data, width: w, height: h } = img;
  const paper = paperColour(img);
  const empty: StationeryMeasure = { headerMm: null, footerMm: null, headerRow: -1, footerRow: -1, paper };
  if (w < 8 || h < 8) return empty;

  const xa = Math.floor(w * EDGE), xb = Math.ceil(w * (1 - EDGE));
  const ink = (x: number, y: number): boolean => {
    const [r, g, b] = rgb(data, (y * w + x) * 4);
    return Math.max(Math.abs(r - paper[0]), Math.abs(g - paper[1]), Math.abs(b - paper[2])) > INK_DIFF;
  };

  // Columns inked on most of the page are borders / scanner shadows: leave them out.
  const skipCol = new Uint8Array(w);
  const ya = Math.floor(h * 0.05), yb = Math.ceil(h * 0.95), stepY = Math.max(1, Math.floor((yb - ya) / 120));
  for (let x = xa; x < xb; x++) {
    let on = 0, all = 0;
    for (let y = ya; y < yb; y += stepY) { all++; if (ink(x, y)) on++; }
    if (all && on / all > BORDER_COL) skipCol[x] = 1;
  }
  const usable = [...skipCol.subarray(xa, xb)].filter(v => !v).length;
  if (usable < 4) return empty;
  const need = Math.max(3, Math.round(usable * 0.0025));

  const rowIsInk = (y: number): boolean => {
    let n = 0;
    for (let x = xa; x < xb; x++) { if (!skipCol[x] && ink(x, y) && ++n >= need) return true; }
    return false;
  };
  const edgeRows = Math.floor(h * EDGE);
  let headerRow = -1, footerRow = -1;
  for (let y = Math.floor(h * MEASURE_TOP_ZONE); y >= edgeRows; y--) { if (rowIsInk(y)) { headerRow = y; break; } }
  for (let y = Math.ceil(h * (1 - MEASURE_BOTTOM_ZONE)); y < h - edgeRows; y++) { if (rowIsInk(y)) { footerRow = y; break; } }

  // Image row -> page position, the way the background will really be drawn.
  const rect = backgroundRect({ fit }, { x: 0, y: 0, w: PAGE.w, h: PAGE.h }, { w, h });
  const mm = (v: number) => Math.min(120, Math.max(0, Math.round(v)));
  const topPt = (row: number) => rect.y + ((row + 1) / h) * rect.h;
  const botPt = (row: number) => PAGE.h - (rect.y + (row / h) * rect.h);
  return {
    headerMm: headerRow < 0 ? null : mm(ptToMm(topPt(headerRow)) + MEASURE_PAD_MM),
    footerMm: footerRow < 0 ? null : mm(ptToMm(botPt(footerRow)) + MEASURE_PAD_MM),
    headerRow, footerRow, paper,
  };
}

/** Longest side read for measuring - plenty to see a 0.3 mm rule, quick to scan. */
const MEASURE_EDGE = 1100;

/** Browser: the pixels of an image (a data URL, a blob URL or a File). */
export async function readImagePixels(src: string | Blob): Promise<PixelImage> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const el = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read that image.'));
      i.src = url;
    });
    const k = Math.min(1, MEASURE_EDGE / Math.max(el.naturalWidth, el.naturalHeight));
    const w = Math.max(1, Math.round(el.naturalWidth * k)), h = Math.max(1, Math.round(el.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Could not read that image.');
    ctx.drawImage(el, 0, 0, w, h);
    return { data: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
  } finally {
    if (typeof src !== 'string') URL.revokeObjectURL(url);
  }
}
