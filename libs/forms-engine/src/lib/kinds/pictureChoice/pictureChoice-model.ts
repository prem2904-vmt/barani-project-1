import { FieldDef, OptionDef, PicturePlace } from '../../core/types';
import { totalConfig } from '../../narrative/combinations';

/**
 * pictureChoice: the pure half (no DOM, no Angular). Config, where a part sits in the box, the pick toggle, the
 * Studio edits (place, snap, resize, upload / draw) and the path-data checks. Specs: pictureChoice.spec.ts.
 *
 * The box is `aspect` (width ÷ height) wide; every part is a rectangle in FRACTIONS of the box, so the picture
 * scales with the screen. A part's picture is `asset` (an uploaded image / SVG) or `drawn` (path data in a
 * 0–100 square, drawn in Studio); neither = a plain tile with the part's name.
 */

export interface PictureChoiceConfig {
  multiple: boolean;
  /** width ÷ height of the box. */
  aspect: number;
  /** An optional picture behind the parts (an asset id). */
  background: string | null;
  showLabels: boolean;
}

export const ASPECT_MIN = 0.4;
export const ASPECT_MAX = 3;
/** Smallest a part can be made, as a share of the box. */
export const MIN_PART = 0.06;
/** The "light" snap grid: 2.5% of the box. */
export const SNAP = 0.025;
export const DRAW_BOX = 100;
export const MAX_DRAWN = 20000;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export function pictureChoiceConfig(f: Pick<FieldDef, 'config'>): PictureChoiceConfig {
  const c = (f.config ?? {}) as Record<string, unknown>;
  return {
    multiple: c['multiple'] !== false,
    aspect: clamp(num(c['aspect'], 1), ASPECT_MIN, ASPECT_MAX),
    background: typeof c['background'] === 'string' && c['background'] ? (c['background'] as string) : null,
    showLabels: c['showLabels'] !== false,
  };
}

/** Where a part sits, kept inside the box. A part with no place yet gets a tidy default by its position in the list. */
export function placeOf(o: Pick<OptionDef, 'place'>, index = 0, count = 1): PicturePlace {
  const p = o.place;
  if (p && [p.x, p.y, p.w, p.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return fit(p);
  const cols = Math.min(Math.max(count, 1), 2);
  const rows = Math.ceil(Math.max(count, 1) / cols);
  const w = 1 / cols;
  const h = 1 / rows;
  return fit({ x: (index % cols) * w + w * 0.1, y: Math.floor(index / cols) * h + h * 0.1, w: w * 0.8, h: h * 0.8 });
}

/** A rectangle clamped to the box, no smaller than MIN_PART. */
export function fit(p: PicturePlace): PicturePlace {
  const w = clamp(p.w, MIN_PART, 1);
  const h = clamp(p.h, MIN_PART, 1);
  return { x: r4(clamp(p.x, 0, 1 - w)), y: r4(clamp(p.y, 0, 1 - h)), w: r4(w), h: r4(h) };
}

export const snap = (n: number, on = true) => (on ? Math.round(n / SNAP) * SNAP : n);

/** Move a part by a fraction of the box (snapped to the light grid when `grid`). */
export function movePlace(p: PicturePlace, dx: number, dy: number, grid = true): PicturePlace {
  return fit({ ...p, x: snap(p.x + dx, grid), y: snap(p.y + dy, grid) });
}

/** Drag the bottom-right corner (or any: `corner`) by a fraction of the box; the opposite corner stays put. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se';
export function resizePlace(p: PicturePlace, corner: Corner, dx: number, dy: number, grid = true): PicturePlace {
  let x0 = p.x;
  let y0 = p.y;
  let x1 = p.x + p.w;
  let y1 = p.y + p.h;
  if (corner === 'nw' || corner === 'sw') x0 = snap(x0 + dx, grid);
  else x1 = snap(x1 + dx, grid);
  if (corner === 'nw' || corner === 'ne') y0 = snap(y0 + dy, grid);
  else y1 = snap(y1 + dy, grid);
  x0 = clamp(x0, 0, 1);
  y0 = clamp(y0, 0, 1);
  x1 = clamp(x1, 0, 1);
  y1 = clamp(y1, 0, 1);
  // never smaller than MIN_PART, and the dragged corner is the one that stops
  if (x1 - x0 < MIN_PART) {
    if (corner === 'nw' || corner === 'sw') x0 = x1 - MIN_PART;
    else x1 = x0 + MIN_PART;
  }
  if (y1 - y0 < MIN_PART) {
    if (corner === 'nw' || corner === 'ne') y0 = y1 - MIN_PART;
    else y1 = y0 + MIN_PART;
  }
  return fit({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** Line the given parts up on one edge or centre (Studio "align"). */
export type Align = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';
export function alignPlaces(places: PicturePlace[], how: Align): PicturePlace[] {
  if (places.length < 2) return places;
  const L = Math.min(...places.map((p) => p.x));
  const R = Math.max(...places.map((p) => p.x + p.w));
  const T = Math.min(...places.map((p) => p.y));
  const B = Math.max(...places.map((p) => p.y + p.h));
  return places.map((p) => {
    switch (how) {
      case 'left':
        return fit({ ...p, x: L });
      case 'right':
        return fit({ ...p, x: R - p.w });
      case 'centre':
        return fit({ ...p, x: (L + R) / 2 - p.w / 2 });
      case 'top':
        return fit({ ...p, y: T });
      case 'bottom':
        return fit({ ...p, y: B - p.h });
      default:
        return fit({ ...p, y: (T + B) / 2 - p.h / 2 });
    }
  });
}

// ───────────────────────── the worked-out total ─────────────────────────

/** Studio: switch the total on / off and set its words; the defaults are not stored. */
export function setTotal(f: FieldDef, total: Partial<TotalConfig> | null): void {
  const c: Record<string, unknown> = { ...(f.config ?? {}) };
  if (!total) delete c['total'];
  else {
    const cur = totalConfig(f) ?? { label: 'Total', unit: '', decimals: 0 };
    const n = { ...cur, ...total };
    c['total'] = { label: n.label.trim() || 'Total', unit: n.unit, decimals: clamp(Math.round(n.decimals), 0, 4) };
  }
  f.config = c;
}

/** A part's number from what the author typed ('' = none). */
export function setPartValue(o: OptionDef, v: unknown): void {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (String(v ?? '').trim() === '' || !Number.isFinite(n)) delete o.value;
  else o.value = Math.round(n * 10000) / 10000;
}

// ───────────────────────── the answer ─────────────────────────

/** The picked keys (always an array), in the option's own spelling; with `multiple` off at most one. */
export function pickedOf(f: FieldDef, value: unknown): string[] {
  const opts = f.options ?? [];
  const raw = Array.isArray(value) ? value.map(String) : typeof value === 'string' && value ? [value] : [];
  const keys = raw.map((x) => opts.find((o) => o.key.toLowerCase() === x.toLowerCase())?.key ?? x);
  const out = keys.filter((k, i) => keys.indexOf(k) === i);
  return pictureChoiceConfig(f).multiple ? out : out.slice(0, 1);
}

/** The new answer after a tap on `key`: undefined when nothing is left; the form's order, never the tap order. */
export function toggled(f: FieldDef, value: unknown, key: string): string[] | undefined {
  const cur = pickedOf(f, value);
  const multiple = pictureChoiceConfig(f).multiple;
  let next: string[];
  if (cur.includes(key)) next = cur.filter((k) => k !== key);
  else if (multiple) {
    next = (f.options ?? []).map((o) => o.key).filter((k) => k === key || cur.includes(k));
  } else next = [key];
  return next.length ? next : undefined;
}

// ───────────────────────── Studio edits ─────────────────────────

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

/** A new part: its key is unique among the field's options; it lands in the next free tidy spot. */
export function addPart(f: FieldDef, label: string, picture?: { asset?: string; drawn?: string }): OptionDef {
  const opts = (f.options ??= []);
  let key = slug(label) || `part_${opts.length + 1}`;
  for (let n = 2; opts.some((o) => o.key === key); n++) key = `${slug(label) || 'part'}_${n}`;
  const free = freeSpot(opts.map((o, i) => placeOf(o, i, opts.length)));
  const o: OptionDef = { key, label: label.trim() || 'Part', subFields: [], place: free, ...(picture?.asset ? { asset: picture.asset } : {}), ...(picture?.drawn ? { drawn: picture.drawn } : {}) };
  opts.push(o);
  return o;
}

/** The first spot of a default size that overlaps no other part (a row-major scan on the snap grid); the box centre when full. */
export function freeSpot(taken: PicturePlace[], w = 0.3, h = 0.3): PicturePlace {
  for (let y = 0; y + h <= 1 + 1e-9; y += SNAP * 2) {
    for (let x = 0; x + w <= 1 + 1e-9; x += SNAP * 2) {
      const c = { x: r4(x), y: r4(y), w, h };
      if (!taken.some((t) => overlap(c, t))) return c;
    }
  }
  return fit({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}

export function overlap(a: PicturePlace, b: PicturePlace): boolean {
  return a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
}

export function setPicture(o: OptionDef, pic: { asset?: string; drawn?: string } | null): void {
  delete o.asset;
  delete o.drawn;
  if (pic?.asset) o.asset = pic.asset;
  else if (pic?.drawn) o.drawn = pic.drawn;
}

/** Studio's setting for the box proportions, and the rest of the config, with the defaults dropped. */
export function setBoxConfig(f: FieldDef, change: Partial<PictureChoiceConfig>): void {
  const next = { ...pictureChoiceConfig(f), ...change };
  next.aspect = clamp(next.aspect, ASPECT_MIN, ASPECT_MAX);
  const c: Record<string, unknown> = { ...(f.config ?? {}) };
  c['multiple'] = next.multiple;
  c['aspect'] = r4(next.aspect);
  c['showLabels'] = next.showLabels;
  if (next.background) c['background'] = next.background;
  else delete c['background'];
  f.config = c;
  // a single choice carries no combination sentences (they are for sets of picks)
  if (!next.multiple && f.says?.combinations) delete f.says.combinations;
}

// ───────────────────────── drawn path data ─────────────────────────

/**
 * Path data a part may carry: the commands an ink outline uses (and the rest of the plain path alphabet), numbers
 * and separators only, a bounded length. The API cleans it again (SvgSanitizer); this only keeps Studio from
 * ever sending, or drawing, anything else.
 */
const PATH_OK = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-., \n\t]*$/;
export function safePath(d: unknown): string | null {
  if (typeof d !== 'string') return null;
  const s = d.trim();
  if (!s || s.length > MAX_DRAWN || !PATH_OK.test(s) || !/^[Mm]/.test(s)) return null;
  return s;
}

/** A drawn stroke's flat x,y,p triplets (a square pad, 0..size) → one path in the 0–100 square. */
export function scalePathPoints(points: number[], size: number): number[] {
  const out: number[] = [];
  const k = DRAW_BOX / size;
  for (let i = 0; i + 2 < points.length; i += 3) out.push(Math.round(points[i] * k * 10) / 10, Math.round(points[i + 1] * k * 10) / 10, points[i + 2]);
  return out;
}
