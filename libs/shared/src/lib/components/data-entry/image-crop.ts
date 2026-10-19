/**
 * Pure geometry for the image crop/resize editor (OPS-14). All rectangles are
 * expressed in NATURAL image pixels; the component converts pointer deltas
 * (display px) into natural px before calling these. Kept DOM-free so the
 * clamping/resize/output rules can be unit-tested without a canvas.
 */
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Size { w: number; h: number; }
export type Handle = 'nw' | 'ne' | 'sw' | 'se';

/** Smallest crop we allow, in natural px — stops the box collapsing to nothing. */
export const MIN_CROP = 16;

/** Keep a rect inside [0,0 … bounds] and no smaller than `min` on either axis. */
export function clampRect(r: Rect, bounds: Size, min = MIN_CROP): Rect {
  const w = Math.max(min, Math.min(r.w, bounds.w));
  const h = Math.max(min, Math.min(r.h, bounds.h));
  const x = Math.max(0, Math.min(r.x, bounds.w - w));
  const y = Math.max(0, Math.min(r.y, bounds.h - h));
  return { x, y, w, h };
}

/** Translate the whole crop box, clamped to the image. */
export function moveRect(r: Rect, dx: number, dy: number, bounds: Size): Rect {
  return clampRect({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }, bounds);
}

/**
 * Resize from one corner handle, keeping the opposite corner anchored. Enforces
 * MIN_CROP without letting the box invert, then clamps to the image bounds.
 */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, bounds: Size, min = MIN_CROP): Rect {
  let { x, y, w, h } = r;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  if (west) { x += dx; w -= dx; } else { w += dx; }
  if (north) { y += dy; h -= dy; } else { h += dy; }
  // Enforce the minimum without crossing the anchored edge.
  if (w < min) { if (west) x = r.x + r.w - min; w = min; }
  if (h < min) { if (north) y = r.y + r.h - min; h = min; }
  return clampRect({ x, y, w, h }, bounds, min);
}

/**
 * Output dimensions for the exported image. Preserves the crop's aspect ratio
 * and NEVER upscales past the cropped source resolution — a null/zero/too-large
 * target width just yields the crop's own pixel size.
 */
export function computeOutputSize(cropW: number, cropH: number, targetW: number | null | undefined): Size {
  const cw = Math.max(1, Math.round(cropW));
  const ch = Math.max(1, Math.round(cropH));
  if (!targetW || targetW <= 0 || targetW >= cw) return { w: cw, h: ch };
  const w = Math.round(targetW);
  const h = Math.max(1, Math.round(ch * (w / cw)));
  return { w, h };
}

/** A centred crop of the given aspect ratio (w/h) that fits inside the image. */
export function centeredCrop(bounds: Size, aspect: number | null): Rect {
  if (!aspect || aspect <= 0) return { x: 0, y: 0, w: bounds.w, h: bounds.h };
  let w = bounds.w;
  let h = w / aspect;
  if (h > bounds.h) { h = bounds.h; w = h * aspect; }
  return { x: (bounds.w - w) / 2, y: (bounds.h - h) / 2, w, h };
}
