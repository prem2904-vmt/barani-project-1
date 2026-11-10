/**
 * The canvas engine's working picture (plan §4 "one engine, four kinds").
 * Everything a doctor draws is VECTOR: strokes are points with pressure,
 * pins and text labels are positions, marked regions are ids. While editing,
 * coordinates are in the picture's own units (`w` × `h`: a starter picture's
 * size, an upload's pixels, or the blank sheet's proportions) so geometry is
 * simple; what is STORED is the API's answer in fractions 0..1 (`answer.ts`
 * converts both ways, round-trip tested).
 */

/** One ink stroke. `points` is flat `x, y, pressure` triplets in picture units. */
export interface InkStroke {
  id: string;
  /** `#rrggbb`. The default palette's colours are re-tinted for dark mode on screen; print uses them as they are. */
  color: string;
  /** Thickness in picture units. */
  size: number;
  points: number[];
  /** Pressure came from a pen (Apple Pencil); otherwise it is simulated from speed. */
  pen?: boolean;
  /** `highlighter` strokes (from the API) are kept and drawn see-through; the UI draws with the pen. */
  tool?: 'pen' | 'highlighter';
}

/** A dropped pin; `n` is the number shown on it (its place in the list, 1-based). */
export interface CanvasPin {
  id: string;
  x: number;
  y: number;
  n: number;
  label?: string;
  note?: string;
  /** The smallest region it sits on (screen words only; the API works it out for the narrative). */
  region?: string;
}

/** A text label written on the picture. */
export interface CanvasLabel {
  id: string;
  x: number;
  y: number;
  text: string;
}

export interface CanvasValue {
  w: number;
  h: number;
  ink: InkStroke[];
  pins: CanvasPin[];
  labels: CanvasLabel[];
  /** Ids of the regions the doctor marked. */
  regions: string[];
}

/** A named, tappable area of a picture. Geometry in picture units. */
export type RegionShape =
  | { type: 'poly'; points: number[] }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number };

export interface CanvasRegion {
  key: string;
  label: string;
  shape: RegionShape;
}

/** A fixed tap marker of a body map (one of the field's options), in picture units; `size` in CSS px (48..120). */
export interface CanvasMarker {
  key: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color?: string;
  on: boolean;
}

/** What sits behind the ink: nothing, or a picture (a starter SVG, an uploaded template, a photo) by its signed link. */
export type CanvasBackground = { kind: 'blank' } | { kind: 'image'; url: string | null; w: number; h: number };

/** The pen palette when the form gives none: black, red, blue, green. */
export const DEFAULT_INKS = ['#111827', '#dc2626', '#1d4ed8', '#16a34a'] as const;
const INK_NAMES: Record<string, string> = {
  '#111827': 'Black',
  '#dc2626': 'Red',
  '#1d4ed8': 'Blue',
  '#16a34a': 'Green',
};
export function inkName(hex: string): string {
  return INK_NAMES[hex.toLowerCase()] ?? `Colour ${hex}`;
}
export const HEX = /^#[0-9a-fA-F]{6}$/;

/** Three thicknesses, as a share of the picture's width (the API stores width as that fraction: 0.0005..0.05). */
export const INK_SIZES = { thin: 0.003, medium: 0.006, thick: 0.012 } as const;
export type InkSizeName = keyof typeof INK_SIZES;
export const INK_SIZE_NAMES: Record<InkSizeName, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };

/** Text labels are drawn at this share of the picture's width. */
export const LABEL_SIZE = 0.032;

/** A blank sheet when the form gives no proportions. */
export const BLANK_W = 1000;
export const BLANK_H = 625;

/** The API's caps (checked on every save); the canvas never lets a doctor go past them. */
export const MAX_STROKES = 300;
export const MAX_POINTS_PER_STROKE = 2000;
export const MAX_POINTS = 20000;
export const MAX_PINS = 100;
export const DEFAULT_MAX_PINS = 30;
export const MAX_LABELS = 50;
export const MAX_LABEL_CHARS = 80;
export const MAX_PIN_LABEL = 80;
export const MAX_NOTE = 200;
export const MAX_DESCRIPTION = 2000;

export function emptyCanvas(w = BLANK_W, h = BLANK_H): CanvasValue {
  return { w, h, ink: [], pins: [], labels: [], regions: [] };
}

/** Nothing drawn, pinned, written or marked. */
export function canvasIsEmpty(v: CanvasValue | null | undefined): boolean {
  return !v || (v.ink.length === 0 && v.pins.length === 0 && v.labels.length === 0 && v.regions.length === 0);
}

export function totalPoints(v: CanvasValue): number {
  return v.ink.reduce((n, s) => n + s.points.length / 3, 0);
}

let idSeq = 0;
/** A short id, unique within a picture (≤ 40 chars, as the API asks). */
export function canvasId(prefix = 's'): string {
  idSeq = (idSeq + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${idSeq.toString(36)}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Round a live point for the working picture. */
export function storePoint(x: number, y: number, p: number): [number, number, number] {
  return [r1(x), r1(y), r2(clamp(p, 0, 1))];
}

/** Pins renumbered 1…n in their order (after a removal). */
export function renumberPins(pins: CanvasPin[]): CanvasPin[] {
  return pins.map((p, i) => (p.n === i + 1 ? p : { ...p, n: i + 1 }));
}
