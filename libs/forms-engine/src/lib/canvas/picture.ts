import { Signal, effect, signal } from '@angular/core';
import { FieldDef } from '../core/types';
import { AssetStore } from '../fill/contract';
import { CanvasAnswer, fromCanvas, readAnswer, toCanvas } from './answer';
import { BLANK_H, BLANK_W, CanvasBackground, CanvasMarker, CanvasRegion, CanvasValue, emptyCanvas } from './canvas-model';

/**
 * Where a picture question's picture comes from (API docs "Image kinds",
 * shared canvas settings). One home each:
 *  - `config.template`         a starter picture id (served by the API with its tap areas), or
 *  - `config.templateAssetId`  a template picture Studio uploaded, or neither: a blank sheet
 *                              of `config.canvas` proportions;
 *  - `config.regions`          for a starter: only rewords a built-in area (label / sentence);
 *                              for an upload or a blank sheet: the area with its `points` (fractions);
 *  - `config.markers`          bodyMap's fixed tap markers; each is one of the field's options (same key).
 * A photo in the answer (`value.photo`) is drawn underneath instead (photoMarkup; an imported sketch).
 */
export interface RegionConfig {
  id: string;
  label?: string;
  sentence?: string;
  points?: [number, number][];
}
export interface MarkerConfig {
  key: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
}
export interface PictureConfig {
  template: string | null;
  templateAssetId: string | null;
  canvas: { width: number; height: number } | null;
  regions: RegionConfig[];
  markers: MarkerConfig[];
}

export function pictureConfig(f: FieldDef): PictureConfig {
  const c = (f.config ?? {}) as Record<string, unknown>;
  const canvas = c['canvas'] as { width?: number; height?: number } | undefined;
  return {
    template: typeof c['template'] === 'string' && c['template'] ? (c['template'] as string) : null,
    templateAssetId: typeof c['templateAssetId'] === 'string' && c['templateAssetId'] ? (c['templateAssetId'] as string) : null,
    canvas:
      canvas && Number(canvas.width) > 0 && Number(canvas.height) > 0
        ? { width: Number(canvas.width), height: Number(canvas.height) }
        : null,
    regions: Array.isArray(c['regions']) ? (c['regions'] as RegionConfig[]).filter((r) => r && typeof r.id === 'string') : [],
    markers: Array.isArray(c['markers'])
      ? (c['markers'] as MarkerConfig[]).filter((m) => m && typeof m.key === 'string' && Number.isFinite(m.x) && Number.isFinite(m.y))
      : [],
  };
}

/** The picture, ready to draw: its size in units, what is behind the ink, its tap areas (units). */
export interface ResolvedPicture {
  w: number;
  h: number;
  background: CanvasBackground;
  regions: CanvasRegion[];
  /** The areas come from a starter picture (Studio can reword them, not reshape them). */
  starter: boolean;
  /** The picture could not be fetched (offline): a blank sheet stands in, with a plain note. */
  missing?: boolean;
}

/** Fractions → a polygon in units. */
function poly(points: [number, number][], w: number, h: number): CanvasRegion['shape'] {
  return { type: 'poly', points: points.flatMap(([x, y]) => [Math.round(x * w * 10) / 10, Math.round(y * h * 10) / 10]) };
}

/** Areas of an upload / blank sheet: those with points. */
function ownRegions(c: PictureConfig, w: number, h: number): CanvasRegion[] {
  return c.regions
    .filter((r) => Array.isArray(r.points) && r.points.length >= 3)
    .map((r) => ({ key: r.id, label: r.label?.trim() || r.id, shape: poly(r.points!, w, h) }));
}

/**
 * The picture of a question as a signal (null while it loads). Call in an
 * injection context. `photo` (optional) is an answer's photo drawn underneath.
 */
export function resolvePicture(
  store: AssetStore | null,
  field: () => FieldDef,
  photo: () => string | undefined = () => undefined,
): Signal<ResolvedPicture | null> {
  const out = signal<ResolvedPicture | null>(null);
  let asked = '';
  effect(() => {
    const f = field();
    const c = pictureConfig(f);
    const ph = photo();
    const key = JSON.stringify([c, ph ?? null]);
    if (key === asked) return;
    asked = key;
    const blank = (missing = false): ResolvedPicture => {
      const w = c.canvas?.width ?? BLANK_W;
      const h = c.canvas?.height ?? BLANK_H;
      return { w, h, background: { kind: 'blank' }, regions: ownRegions(c, w, h), starter: false, missing };
    };
    const assetId = ph ?? c.templateAssetId;
    if (!assetId && !c.template) {
      out.set(blank());
      return;
    }
    if (!store) {
      out.set(blank(true));
      return;
    }
    out.set(null);
    const work: Promise<ResolvedPicture> = assetId
      ? store.asset(assetId).then((a) => ({
          w: a.width,
          h: a.height,
          background: { kind: 'image' as const, url: a.url, w: a.width, h: a.height },
          regions: ownRegions(c, a.width, a.height),
          starter: false,
        }))
      : store.starter(c.template!).then((s) => {
          const words = new Map(c.regions.map((r) => [r.id, r]));
          return {
            w: s.width,
            h: s.height,
            background: { kind: 'image' as const, url: s.svgUrl, w: s.width, h: s.height, art: true },
            regions: s.regions.map((r) => ({
              key: r.id,
              label: words.get(r.id)?.label?.trim() || r.label,
              shape: poly(r.points, s.width, s.height),
            })),
            starter: true,
          };
        });
    work
      .then((p) => {
        if (asked === key) out.set(p);
      })
      .catch(() => {
        if (asked === key) out.set(blank(true));
      });
  });
  return out.asReadonly();
}

/** bodyMap's fixed markers, in units, named by their option, `on` when tapped. */
export function pictureMarkers(f: FieldDef, pic: { w: number; h: number }, tapped: readonly string[]): CanvasMarker[] {
  const words = new Map((f.options ?? []).map((o) => [o.key, o.label]));
  const on = new Set(tapped);
  return pictureConfig(f).markers.map((m) => ({
    key: m.key,
    label: words.get(m.key) ?? m.key,
    x: m.x * pic.w,
    y: m.y * pic.h,
    size: Math.min(120, Math.max(48, m.size ?? 48)),
    ...(m.color ? { color: m.color } : {}),
    on: on.has(m.key),
  }));
}

/**
 * The stored answer ↔ the canvas's working picture, keeping object identity:
 * an answer this reader wrote reads back as the very picture the canvas
 * holds (so the canvas's undo history survives its own writes coming back
 * through the form); an outside answer (a reload) is converted afresh.
 */
export class CanvasReader {
  private readonly mine = new WeakMap<object, CanvasValue>();
  private lastRaw: unknown = undefined;
  private lastKey = '';
  private lastOut: CanvasValue | null = null;
  private lastEmpty: CanvasValue | null = null;

  answer(raw: unknown): CanvasAnswer {
    return readAnswer(raw);
  }

  read(raw: unknown, w: number, h: number): CanvasValue {
    if (raw && typeof raw === 'object' && this.mine.has(raw)) return this.mine.get(raw)!;
    if ((raw === null || raw === undefined) && this.lastEmpty && this.lastEmpty.w === w && this.lastEmpty.h === h)
      return this.lastEmpty;
    const key = `${w}x${h}`;
    if (raw === this.lastRaw && key === this.lastKey && this.lastOut) return this.lastOut;
    const out = raw ? toCanvas(readAnswer(raw), w, h) : emptyCanvas(w, h);
    this.lastRaw = raw;
    this.lastKey = key;
    this.lastOut = out;
    return out;
  }

  /** The answer for a picture the canvas wrote (undefined = nothing left), remembered for `read`. */
  write(v: CanvasValue, base: CanvasAnswer): CanvasAnswer | undefined {
    const a = fromCanvas(v, base);
    if (a) this.mine.set(a, v);
    else this.lastEmpty = v;
    if (a) this.lastEmpty = null;
    return a;
  }

  /** Remember that `a` (an answer changed outside the canvas: description, notes) still shows picture `v`. */
  keep(a: CanvasAnswer | undefined, v: CanvasValue): CanvasAnswer | undefined {
    if (a) this.mine.set(a, v);
    else this.lastEmpty = v;
    return a;
  }
}
