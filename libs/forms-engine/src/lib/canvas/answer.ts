import {
  CanvasLabel,
  CanvasPin,
  CanvasValue,
  HEX,
  InkStroke,
  MAX_DESCRIPTION,
  MAX_LABEL_CHARS,
  MAX_LABELS,
  MAX_NOTE,
  MAX_PIN_LABEL,
  MAX_PINS,
  MAX_POINTS,
  MAX_POINTS_PER_STROKE,
  MAX_STROKES,
  canvasId,
} from './canvas-model';

/**
 * The stored answer of `drawing`, `bodyMap` and `photoMarkup` (TS mirror of
 * the API's "canvas value", docs/API.md "Image kinds"): coordinates are
 * FRACTIONS of the picture (0..1), stroke width a fraction of its width.
 * `toCanvas` / `fromCanvas` convert to and from the engine's working picture;
 * what the engine does not edit (description, photo, markers, region notes)
 * is carried over untouched.
 */
export interface AnswerStroke {
  id?: string;
  tool?: 'pen' | 'highlighter';
  color?: string;
  width?: number;
  points: number[][];
}
export interface AnswerPin {
  id?: string;
  x: number;
  y: number;
  label?: string;
  note?: string;
}
export interface AnswerLabel {
  id?: string;
  x: number;
  y: number;
  text: string;
}
export interface CanvasAnswer {
  description?: string;
  photo?: string;
  regions?: { id: string; note?: string }[];
  pins?: AnswerPin[];
  strokes?: AnswerStroke[];
  labels?: AnswerLabel[];
  markers?: string[];
}

const DEFAULT_WIDTH = 0.004;
const f4 = (n: number) => Math.round(n * 10000) / 10000;
const frac = (n: number) => f4(Math.min(1, Math.max(0, n)));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined;

/** Read a stored answer (anything malformed is dropped, the API's caps applied). */
export function readAnswer(raw: unknown): CanvasAnswer {
  const o = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: CanvasAnswer = {};
  const d = str(o['description'], MAX_DESCRIPTION);
  if (d) out.description = d;
  if (typeof o['photo'] === 'string' && o['photo']) out.photo = o['photo'];
  if (Array.isArray(o['regions'])) {
    const seen = new Set<string>();
    out.regions = (o['regions'] as Record<string, unknown>[])
      .filter((r) => r && typeof r['id'] === 'string' && !seen.has(r['id'] as string) && seen.add(r['id'] as string))
      .map((r) => ({ id: r['id'] as string, ...(str(r['note'], MAX_NOTE) ? { note: str(r['note'], MAX_NOTE) } : {}) }));
  }
  if (Array.isArray(o['markers'])) out.markers = [...new Set((o['markers'] as unknown[]).filter((m): m is string => typeof m === 'string' && !!m))];
  if (Array.isArray(o['pins']))
    out.pins = (o['pins'] as Record<string, unknown>[])
      .filter((p) => p && num(p['x']) && num(p['y']))
      .slice(0, MAX_PINS)
      .map((p) => ({
        ...(typeof p['id'] === 'string' ? { id: p['id'] } : {}),
        x: frac(p['x'] as number),
        y: frac(p['y'] as number),
        ...(str(p['label'], MAX_PIN_LABEL) ? { label: str(p['label'], MAX_PIN_LABEL) } : {}),
        ...(str(p['note'], MAX_NOTE) ? { note: str(p['note'], MAX_NOTE) } : {}),
      }));
  if (Array.isArray(o['labels']))
    out.labels = (o['labels'] as Record<string, unknown>[])
      .filter((l) => l && num(l['x']) && num(l['y']) && str(l['text'], MAX_LABEL_CHARS))
      .slice(0, MAX_LABELS)
      .map((l) => ({
        ...(typeof l['id'] === 'string' ? { id: l['id'] } : {}),
        x: frac(l['x'] as number),
        y: frac(l['y'] as number),
        text: str(l['text'], MAX_LABEL_CHARS)!,
      }));
  if (Array.isArray(o['strokes'])) {
    let total = 0;
    const strokes: AnswerStroke[] = [];
    for (const s of o['strokes'] as Record<string, unknown>[]) {
      if (strokes.length >= MAX_STROKES || total >= MAX_POINTS) break;
      if (!s || !Array.isArray(s['points'])) continue;
      const pts = (s['points'] as unknown[])
        .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && num(p[0]) && num(p[1]))
        .slice(0, Math.min(MAX_POINTS_PER_STROKE, MAX_POINTS - total))
        .map((p) => (num(p[2]) ? [frac(p[0]), frac(p[1]), frac(p[2])] : [frac(p[0]), frac(p[1])]));
      if (!pts.length) continue;
      total += pts.length;
      strokes.push({
        ...(typeof s['id'] === 'string' ? { id: s['id'] } : {}),
        tool: s['tool'] === 'highlighter' ? 'highlighter' : 'pen',
        color: typeof s['color'] === 'string' && HEX.test(s['color']) ? (s['color'] as string).toLowerCase() : '#111827',
        width: num(s['width']) ? Math.min(0.05, Math.max(0.0005, s['width'] as number)) : DEFAULT_WIDTH,
        points: pts,
      });
    }
    out.strokes = strokes;
  }
  return out;
}

/** The answer → the engine's working picture (`w` × `h` units). */
export function toCanvas(a: CanvasAnswer, w: number, h: number): CanvasValue {
  const ink: InkStroke[] = (a.strokes ?? []).map((s) => {
    const points: number[] = [];
    let pen = false;
    for (const p of s.points) {
      if (p.length > 2) pen = true;
      points.push(Math.round(p[0] * w * 10) / 10, Math.round(p[1] * h * 10) / 10, p.length > 2 ? p[2] : 0.5);
    }
    return {
      id: s.id ?? canvasId(),
      color: s.color ?? '#111827',
      size: Math.round((s.width ?? DEFAULT_WIDTH) * w * 100) / 100,
      points,
      ...(pen ? { pen: true } : {}),
      ...(s.tool === 'highlighter' ? { tool: 'highlighter' as const } : {}),
    };
  });
  const pins: CanvasPin[] = (a.pins ?? []).map((p, i) => ({
    id: p.id ?? canvasId('p'),
    x: Math.round(p.x * w * 10) / 10,
    y: Math.round(p.y * h * 10) / 10,
    n: i + 1,
    ...(p.label ? { label: p.label } : {}),
    ...(p.note ? { note: p.note } : {}),
  }));
  const labels: CanvasLabel[] = (a.labels ?? []).map((l) => ({
    id: l.id ?? canvasId('t'),
    x: Math.round(l.x * w * 10) / 10,
    y: Math.round(l.y * h * 10) / 10,
    text: l.text,
  }));
  return { w, h, ink, pins, labels, regions: (a.regions ?? []).map((r) => r.id) };
}

/**
 * The working picture → the answer to store, keeping what the canvas does not
 * edit from `base` (description, photo, markers, the notes of regions still marked).
 * Empty parts are left out; nothing at all → undefined (no answer).
 */
export function fromCanvas(v: CanvasValue, base: CanvasAnswer = {}): CanvasAnswer | undefined {
  const notes = new Map((base.regions ?? []).map((r) => [r.id, r.note]));
  const out: CanvasAnswer = {};
  if (base.description) out.description = base.description;
  if (base.photo) out.photo = base.photo;
  if (v.regions.length) out.regions = v.regions.map((id) => (notes.get(id) ? { id, note: notes.get(id) } : { id }));
  if (v.pins.length)
    out.pins = v.pins.map((p) => ({
      id: p.id,
      x: frac(p.x / v.w),
      y: frac(p.y / v.h),
      ...(p.label ? { label: p.label } : {}),
      ...(p.note ? { note: p.note } : {}),
    }));
  if (v.ink.length)
    out.strokes = v.ink.map((s) => {
      const points: number[][] = [];
      for (let i = 0; i + 2 < s.points.length; i += 3) {
        const x = frac(s.points[i] / v.w);
        const y = frac(s.points[i + 1] / v.h);
        points.push(s.pen ? [x, y, frac(s.points[i + 2])] : [x, y]);
      }
      return {
        id: s.id,
        tool: s.tool ?? 'pen',
        color: s.color,
        width: Math.min(0.05, Math.max(0.0005, f4(s.size / v.w))),
        points,
      };
    });
  if (v.labels.length) out.labels = v.labels.map((l) => ({ id: l.id, x: frac(l.x / v.w), y: frac(l.y / v.h), text: l.text }));
  if (base.markers?.length) out.markers = base.markers;
  return Object.keys(out).length ? out : undefined;
}

/** Is there anything in an answer (a description alone counts)? */
export function answerIsEmpty(a: CanvasAnswer | undefined | null): boolean {
  if (!a) return true;
  return !(
    a.description ||
    a.photo ||
    a.regions?.length ||
    a.pins?.length ||
    a.strokes?.length ||
    a.labels?.length ||
    a.markers?.length
  );
}

/** Change the parts the canvas does not draw (description, photo, markers, a region's note). */
export function patchAnswer(a: CanvasAnswer, patch: Partial<CanvasAnswer>): CanvasAnswer | undefined {
  const next: CanvasAnswer = { ...a, ...patch };
  for (const k of Object.keys(next) as (keyof CanvasAnswer)[]) {
    const v = next[k];
    if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) delete next[k];
  }
  return answerIsEmpty(next) ? undefined : next;
}
