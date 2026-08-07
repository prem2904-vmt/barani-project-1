/**
 * Signature image processing — turn a photographed / scanned signature into a
 * clean transparent-background PNG, matching what the draw pad produces.
 *
 * Pipeline (all client-side):
 *   1. estimate the paper (background) luminance from the image border
 *   2. alpha-mask every pixel by how much DARKER it is than the paper —
 *      paper → fully transparent, ink → fully opaque, soft ramp between
 *      (handles pencil strokes, jpeg noise and uneven lighting gracefully)
 *   3. trim to the ink's bounding box (with padding)
 *
 * The pixel math is pure (no canvas) so it can be unit-tested in node.
 */

/** Relative luminance 0–255 (Rec. 601 weights — cheap and fine for this). */
function lum(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Median of border-pixel luminances = the paper colour. Sampling the border
 *  (not the whole image) keeps a large dark signature from skewing it. */
export function estimateBackgroundLuma(data: Uint8ClampedArray, w: number, h: number): number {
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    samples.push(lum(data[i], data[i + 1], data[i + 2]));
  };
  for (let x = 0; x < w; x += step) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y += step) { push(0, y); push(w - 1, y); }
  samples.sort((a, b) => a - b);
  return samples.length ? samples[Math.floor(samples.length / 2)] : 255;
}

/** In-place: paper → transparent, ink → opaque (soft ramp between). Returns
 *  the ink bounding box, or null when nothing dark enough was found. */
export function stripSignatureBackground(
  data: Uint8ClampedArray,
  w: number,
  h: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  const bg = estimateBackgroundLuma(data, w, h);
  // Anything within NEAR of the paper is paper; anything at least INK darker
  // than the paper is ink. The ramp between keeps anti-aliased stroke edges.
  const NEAR = 28;
  const INK = Math.max(70, Math.min(120, bg * 0.45));
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = bg - lum(data[i], data[i + 1], data[i + 2]);
      let a: number;
      if (d <= NEAR) a = 0;
      else if (d >= INK) a = 255;
      else a = Math.round(((d - NEAR) / (INK - NEAR)) * 255);
      data[i + 3] = a;
      if (a > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/** Full pipeline: file → transparent trimmed PNG data URL sized to fit the
 *  signature box. Throws with a friendly message when no ink is found. */
export async function signatureFileToPng(file: File, maxW = 640, maxH = 260): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('Could not read that image — try a PNG or JPG.');
  // Bound the working size so a 12MP photo doesn't chew memory.
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const work = document.createElement('canvas');
  work.width = w; work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const box = stripSignatureBackground(img.data, w, h);
  if (!box) throw new Error('No signature found in that image — use a clear photo of dark ink on light paper.');
  ctx.putImageData(img, 0, 0);

  // Trim with padding, then scale to fit the target box.
  const pad = Math.round(Math.max(w, h) * 0.02) + 4;
  const sx = Math.max(0, box.x0 - pad), sy = Math.max(0, box.y0 - pad);
  const sw = Math.min(w, box.x1 + pad) - sx, sh = Math.min(h, box.y1 + pad) - sy;
  const fit = Math.min(maxW / sw, maxH / sh, 1);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(sw * fit));
  out.height = Math.max(1, Math.round(sh * fit));
  out.getContext('2d')!.drawImage(work, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
