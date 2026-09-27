import type { ReportTemplate } from '../models/report.model';

/**
 * Report letterhead / footer LAYOUT MODEL (owner, 2026-09-27: "the user can
 * see where things are in the preview and arrange them — left/right, more
 * pixels — crystal clear").
 *
 * One model drives BOTH the printed PDF (report-pdf.ts draws the resolved
 * items) and the report designer (it outlines the SAME resolved items over the
 * rendered page). There is no second geometry.
 *
 * Storage: the lab's edits live as OVERRIDES on top of the header preset's own
 * positions, in the template's existing `metadata` JSON column under
 * `headerLayout` — no new column, no migration. A template without it (every
 * template saved before this) prints byte-for-byte as before; see
 * report-header-legacy.spec.ts. Once the lab edits the letterhead in the
 * designer the object exists ("active" layout), which also turns on the fixes
 * an old template never had: typed line breaks are kept, text that would run
 * past the page margin wraps, and the patient details move down instead of
 * printing under a tall letterhead.
 *
 * Units: page geometry is PDF points (A4 = 595.28 × 841.89 pt); everything a
 * person reads or types is millimetres, except font sizes (pt, as in any
 * word processor).
 */

export const MM = 2.834645669;           // 1 mm in PDF points
export const PAGE = { w: 595.28, h: 841.89 } as const;
export const MARGIN_X = 30;              // printable area: left/right (pt)
export const MARGIN_TOP = 28;            // top of the letterhead (pt)
/** Where the patient details start on an untouched template (pt). */
export const LEGACY_BODY_TOP = MARGIN_TOP + 70;
/** Gap kept between the lowest letterhead element and the patient details. */
export const BODY_GAP = 6;

export type Align = 'left' | 'center' | 'right';
export type HeaderField = 'address' | 'phone' | 'email' | 'website';
export type LayoutRegion = 'header' | 'footer';

/** What the lab changed about ONE element. Every key is optional; an absent
 *  key means "as the header style places it". */
export interface ItemOverride {
  hidden?: boolean;
  align?: Align;
  /** mm from the page's left edge — text: the anchor for its alignment
   *  (left edge / centre / right edge); images & bars: the left edge. */
  x?: number;
  /** mm from the page's top edge — text: the first line's baseline;
   *  images & bars: the top edge. */
  y?: number;
  /** Text: font size in pt. Logo / NABL badge: height in mm.
   *  Accent bar: thickness in mm. Banner: height in mm. */
  size?: number;
  bold?: boolean;
  /** Text: wrap width in mm (0 = never wrap). */
  wrap?: number;
  /** Logo: 'square' (as before — the image is fitted into a square) or
   *  'natural' (keeps the upload's proportions). */
  fit?: 'square' | 'natural';
  /** A joined line ("Phone · Email · Website"): which fields it carries. */
  fields?: HeaderField[];
  /** A field the header style doesn't print on its own line, added by the lab. */
  added?: boolean;
}

export interface HeaderLayoutConfig {
  v: 1;
  items: Record<string, ItemOverride>;
  /** Extra free-text lines (registration no., GSTIN, timings…). */
  lines?: Array<{ id: string; text: string }>;
  /** mm from the top where the patient details start; absent = automatic. */
  bodyTop?: number;
  /** Background images, drawn BEHIND everything (first = bottom-most). */
  backgrounds?: BackgroundImage[];
}

// ── background images ───────────────────────────────────────────────────

export type BgFit = 'cover' | 'contain' | 'stretch' | 'original';
export type BgArea = 'page' | 'header' | 'footer';
export const MAX_BACKGROUNDS = 3;
/** Height (pt) of the footer area a footer background fills — the band the
 *  signatures, disclaimer and date strip live in (report-pdf FOOTER_RESERVE). */
export const FOOTER_AREA_H = 64;

/** One background image (letterhead artwork, watermark…). Stored in the
 *  template metadata next to the element overrides. */
export interface BackgroundImage {
  id: string;
  /** Private upload path ("/uploads/<tenant>/<file>"). */
  url: string;
  /** Which part of the page it fills (and is clipped to). */
  area: BgArea;
  fit: BgFit;
  /** 0.05 – 1. */
  opacity: number;
  pages: 'first' | 'all';
  /** Also print it on pre-printed letterhead paper (default: left out — the
   *  paper already carries the design). */
  onLetterhead?: boolean;
  /** Size in % of the fitted size (100 = as the fit places it). */
  scale?: number;
  /** mm — the image's top-left once the lab moves it. */
  x?: number;
  y?: number;
  hidden?: boolean;
}

/** A background resolved onto the page — what the PDF draws and the designer outlines. */
export interface ResolvedBackground {
  id: string;
  index: number;
  label: string;
  url: string;
  area: BgArea;
  fit: BgFit;
  opacity: number;
  pages: 'first' | 'all';
  onLetterhead: boolean;
  hidden: boolean;
  scale: number;
  moved: boolean;
  /** The image rectangle (pt) — may extend past the clip (cover / moved). */
  rect: { x: number; y: number; w: number; h: number };
  /** The area it is clipped to (pt). */
  clip: { x: number; y: number; w: number; h: number };
  /** rect ∩ clip — the part that actually prints (the designer's outline). */
  box: { x: number; y: number; w: number; h: number };
  /** True when the image bytes were available (it will actually print). */
  loaded: boolean;
}

const FITS: BgFit[] = ['cover', 'contain', 'stretch', 'original'];
const AREAS: BgArea[] = ['page', 'header', 'footer'];

function cleanBackground(o: unknown): BackgroundImage | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  if (typeof s['id'] !== 'string' || typeof s['url'] !== 'string' || !s['url']) return null;
  const op = NUM(s['opacity']);
  const b: BackgroundImage = {
    id: s['id'] as string, url: s['url'] as string,
    area: AREAS.includes(s['area'] as BgArea) ? s['area'] as BgArea : 'page',
    fit: FITS.includes(s['fit'] as BgFit) ? s['fit'] as BgFit : 'cover',
    opacity: op === undefined ? 1 : Math.min(1, Math.max(0.05, op)),
    pages: s['pages'] === 'all' ? 'all' : 'first',
  };
  if (s['onLetterhead'] === true) b.onLetterhead = true;
  if (NUM(s['scale']) !== undefined && (s['scale'] as number) > 0) b.scale = Math.min(400, s['scale'] as number);
  if (NUM(s['x']) !== undefined) b.x = NUM(s['x']);
  if (NUM(s['y']) !== undefined) b.y = NUM(s['y']);
  if (s['hidden'] === true) b.hidden = true;
  return b;
}

/** The clip box (pt) of an area. `bodyTop` = where the patient details start. */
export function backgroundArea(area: BgArea, bodyTop: number): { x: number; y: number; w: number; h: number } {
  if (area === 'header') return { x: 0, y: 0, w: PAGE.w, h: bodyTop };
  if (area === 'footer') return { x: 0, y: PAGE.h - FOOTER_AREA_H, w: PAGE.w, h: FOOTER_AREA_H };
  return { x: 0, y: 0, w: PAGE.w, h: PAGE.h };
}

/** Where the image lands (pt) for a fit inside the area.
 *  cover = fill the area, cropping the overflow · contain = whole image, letterboxed
 *  · stretch = exactly the area · original = the image's own size at 96 dpi.
 *  Then `scale` % about the centre, then the lab's move (x/y, mm) if any. */
export function backgroundRect(
  bg: Pick<BackgroundImage, 'fit' | 'scale' | 'x' | 'y'>,
  clip: { x: number; y: number; w: number; h: number },
  img: { w: number; h: number } | null,
): { x: number; y: number; w: number; h: number } {
  let w = clip.w, h = clip.h;
  if (img && img.w > 0 && img.h > 0 && bg.fit !== 'stretch') {
    if (bg.fit === 'original') { w = img.w * 0.75; h = img.h * 0.75; }       // px @96 dpi → pt
    else {
      const k = bg.fit === 'cover' ? Math.max(clip.w / img.w, clip.h / img.h) : Math.min(clip.w / img.w, clip.h / img.h);
      w = img.w * k; h = img.h * k;
    }
  }
  const s = (bg.scale ?? 100) / 100;
  const cx = clip.x + clip.w / 2, cy = clip.y + clip.h / 2;
  w *= s; h *= s;
  let x = cx - w / 2, y = cy - h / 2;
  if (bg.x !== undefined) x = bg.x * MM;
  if (bg.y !== undefined) y = bg.y * MM;
  return { x, y, w, h };
}

export function intersectBox(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w), btm = Math.min(a.y + a.h, b.y + b.h);
  return { x, y, w: Math.max(0, r - x), h: Math.max(0, btm - y) };
}

/** Does this background print on this page of this job? */
export function backgroundPrints(bg: Pick<ResolvedBackground, 'hidden' | 'pages' | 'onLetterhead' | 'loaded'>, page: number, letterheadPaper: boolean): boolean {
  if (bg.hidden || !bg.loaded) return false;
  if (letterheadPaper && !bg.onLetterhead) return false;
  return bg.pages === 'all' || page === 1;
}

/** Immutable background edits. */
export function setBackground(cfg: HeaderLayoutConfig | null, id: string, patch: Partial<Record<keyof BackgroundImage, unknown>>): HeaderLayoutConfig {
  const base: HeaderLayoutConfig = cfg ? { ...cfg, items: { ...cfg.items } } : { v: 1, items: {} };
  base.backgrounds = (base.backgrounds ?? []).map(b => {
    if (b.id !== id) return b;
    const cur: Record<string, unknown> = { ...b };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete cur[k];
      else cur[k] = (k === 'x' || k === 'y') && typeof v === 'number' ? round1(v) : v;
    }
    return cleanBackground(cur) ?? b;
  });
  return base;
}
export function addBackground(cfg: HeaderLayoutConfig | null, url: string, id: string, area: BgArea = 'page'): HeaderLayoutConfig {
  const base: HeaderLayoutConfig = cfg ? { ...cfg, items: { ...cfg.items } } : { v: 1, items: {} };
  const list = base.backgrounds ?? [];
  if (list.length >= MAX_BACKGROUNDS) return base;
  base.backgrounds = [...list, { id, url, area, fit: area === 'page' ? 'cover' : 'contain', opacity: 1, pages: 'first' }];
  return base;
}
export function removeBackground(cfg: HeaderLayoutConfig | null, id: string): HeaderLayoutConfig {
  const base: HeaderLayoutConfig = cfg ? { ...cfg, items: { ...cfg.items } } : { v: 1, items: {} };
  base.backgrounds = (base.backgrounds ?? []).filter(b => b.id !== id);
  if (!base.backgrounds.length) delete base.backgrounds;
  return base;
}

/** Background upload rules — checked before anything is sent. */
export const BG_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
export const BG_MAX_PICK_BYTES = 15 * 1024 * 1024;   // what you may pick (it is then shrunk)
export const BG_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;  // what the server takes
/** Longest side kept (px): A4 at 300 dpi — sharp in print, small in the PDF. */
export const BG_MAX_EDGE = 2480;

export function validateBackgroundFile(f: { type: string; name: string; size: number }): string | null {
  const svg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
  if (svg) return 'SVG files can’t be used — export the design as PNG or JPG.';
  if (!BG_ACCEPT.includes((f.type || '').toLowerCase())) return 'Use a PNG, JPG or WebP image.';
  if (f.size > BG_MAX_PICK_BYTES) return `That image is ${(f.size / 1048576).toFixed(1)} MB — pick one under 15 MB.`;
  return null;
}
/** Target pixel size after shrinking to BG_MAX_EDGE on the longest side. */
export function downscaleSize(w: number, h: number, max = BG_MAX_EDGE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** A resolved, positioned element — what the PDF draws and the designer outlines. */
export interface LayoutItem {
  id: string;
  region: LayoutRegion;
  kind: 'text' | 'logo' | 'nabl' | 'bar' | 'banner';
  label: string;
  /** Text: anchor x + first baseline. Others: top-left. (pt) */
  x: number;
  y: number;
  align: Align;
  // ── text ──
  text?: string;
  lines?: string[];
  fields?: HeaderField[];
  style?: 'normal' | 'bold' | 'italic';
  size?: number;
  color?: string;
  tone?: 'plain' | 'twoTone' | 'pipes' | 'pill';
  lineH?: number;
  /** Draw the lines bottom-up (the disclaimer always did). */
  reverse?: boolean;
  /** Width actually available before the text wraps (pt), null = no wrap. */
  wrapW?: number | null;
  /** True when a line had to wrap to fit. */
  wraps?: boolean;
  /** Draw each typed line separately (active layouts). Legacy passes the raw string once. */
  splitLines?: boolean;
  /** Two-tone name / piped tagline: x where drawing starts (pt). */
  startX?: number;
  /** Exact per-line baselines when they must match an old loop (pt). */
  lineYs?: number[];
  // ── images / bars ──
  w?: number;
  h?: number;
  url?: string | null;
  fit?: 'square' | 'natural';
  /** Pill: the white backing rectangle width (pt). */
  pillW?: number;
  /** NABL: accreditation number under the badge. */
  sub?: string;
  /** Bounding box in pt (page coordinates), for the designer + checks. */
  box: { x: number; y: number; w: number; h: number };
  hidden?: boolean;
  customized: boolean;
  /** The value the designer's size control edits (pt for text, mm otherwise). */
  sizeValue: number;
  /** Size-control unit shown to the user. */
  sizeUnit: 'pt' | 'mm';
}

export interface ReportLayoutResult {
  preset: string;
  /** True once the lab has edited the letterhead in the designer. */
  active: boolean;
  items: LayoutItem[];
  /** Lowest letterhead point (pt). */
  headerBottom: number;
  /** Where the patient details start (pt). */
  bodyTop: number;
  bodyTopAuto: boolean;
  /** Letterpad blank areas (pt) — print-only, shown as guides. */
  letterpad?: { top: number; bottom: number } | null;
  /** Background images, bottom-most first. Drawn before anything else on a page. */
  backgrounds: ResolvedBackground[];
}

export interface LayoutIssue {
  itemId: string;
  kind: 'overflow' | 'wrap' | 'overlap' | 'body';
  message: string;
  /** 'warn' = prints badly; 'info' = prints fine, worth knowing. */
  level: 'warn' | 'info';
}

// ── storage ─────────────────────────────────────────────────────────────

function parseMeta(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): Record<string, unknown> {
  const raw = tpl?.metadata;
  if (!raw) return {};
  if (typeof raw === 'object') return { ...(raw as Record<string, unknown>) };
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

const NUM = (v: unknown): number | undefined => (typeof v === 'number' && isFinite(v) ? v : undefined);
const ALIGNS: Align[] = ['left', 'center', 'right'];
const FIELDS: HeaderField[] = ['address', 'phone', 'email', 'website'];

function cleanOverride(o: unknown): ItemOverride | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const out: ItemOverride = {};
  if (typeof s['hidden'] === 'boolean') out.hidden = s['hidden'];
  if (ALIGNS.includes(s['align'] as Align)) out.align = s['align'] as Align;
  if (NUM(s['x']) !== undefined) out.x = NUM(s['x']);
  if (NUM(s['y']) !== undefined) out.y = NUM(s['y']);
  if (NUM(s['size']) !== undefined && (s['size'] as number) > 0) out.size = NUM(s['size']);
  if (typeof s['bold'] === 'boolean') out.bold = s['bold'];
  if (NUM(s['wrap']) !== undefined && (s['wrap'] as number) >= 0) out.wrap = NUM(s['wrap']);
  if (s['fit'] === 'square' || s['fit'] === 'natural') out.fit = s['fit'];
  if (Array.isArray(s['fields'])) out.fields = (s['fields'] as unknown[]).filter((f): f is HeaderField => FIELDS.includes(f as HeaderField));
  if (s['added'] === true) out.added = true;
  return Object.keys(out).length ? out : null;
}

/** The lab's letterhead layout, or null for a template never edited in the
 *  designer (prints exactly as before). Tolerates junk. */
export function readHeaderLayout(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined): HeaderLayoutConfig | null {
  const hl = parseMeta(tpl)['headerLayout'];
  if (!hl || typeof hl !== 'object') return null;
  const src = hl as Record<string, unknown>;
  const items: Record<string, ItemOverride> = {};
  if (src['items'] && typeof src['items'] === 'object') {
    for (const [k, v] of Object.entries(src['items'] as Record<string, unknown>)) {
      const c = cleanOverride(v);
      if (c) items[k] = c;
    }
  }
  const cfg: HeaderLayoutConfig = { v: 1, items };
  if (Array.isArray(src['lines'])) {
    cfg.lines = (src['lines'] as unknown[])
      .filter((l): l is { id: string; text: string } => !!l && typeof (l as { id?: unknown }).id === 'string')
      .map(l => ({ id: l.id, text: typeof l.text === 'string' ? l.text : '' }));
  }
  if (NUM(src['bodyTop']) !== undefined) cfg.bodyTop = NUM(src['bodyTop']);
  if (Array.isArray(src['backgrounds'])) {
    const bgs = (src['backgrounds'] as unknown[]).map(cleanBackground).filter((b): b is BackgroundImage => !!b).slice(0, MAX_BACKGROUNDS);
    if (bgs.length) cfg.backgrounds = bgs;
  }
  return cfg;
}

/** New `metadata` string with the layout written (or removed when null),
 *  keeping every other key the template's metadata carries. */
export function writeHeaderLayout(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, cfg: HeaderLayoutConfig | null): string {
  const meta = parseMeta(tpl);
  if (cfg) meta['headerLayout'] = cfg; else delete meta['headerLayout'];
  return JSON.stringify(meta);
}

/** Report print options kept in the template metadata (`options`), for
 *  switches that have no column of their own — e.g. `specimenLine`.
 *  `abnormalSummary` = the consolidated "Summary of abnormal results" first
 *  page (Lab settings → Report). */
export type ReportOption = 'specimenLine' | 'abnormalSummary';

export function readReportOption(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, key: ReportOption): boolean {
  const o = parseMeta(tpl)['options'];
  return !!o && typeof o === 'object' && (o as Record<string, unknown>)[key] === true;
}

/** Immutable: the template metadata with one option set (other keys kept). */
export function writeReportOption(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, key: ReportOption, on: boolean): string {
  const meta = parseMeta(tpl);
  const cur = meta['options'];
  const opts: Record<string, unknown> = cur && typeof cur === 'object' && !Array.isArray(cur) ? { ...(cur as Record<string, unknown>) } : {};
  if (on) opts[key] = true; else delete opts[key];
  if (Object.keys(opts).length) meta['options'] = opts; else delete meta['options'];
  return JSON.stringify(meta);
}

const round1 = (n: number) => Math.round(n * 100) / 100;   // 0.01 mm

/** Immutable: merge a patch into one element's override. `undefined` values
 *  clear that key; an override left empty is removed. */
export function setItem(cfg: HeaderLayoutConfig | null, id: string, patch: Partial<Record<keyof ItemOverride, unknown>>): HeaderLayoutConfig {
  const base: HeaderLayoutConfig = cfg ? { ...cfg, items: { ...cfg.items } } : { v: 1, items: {} };
  const cur: Record<string, unknown> = { ...(base.items[id] ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete cur[k];
    else cur[k] = (k === 'x' || k === 'y' || k === 'wrap') && typeof v === 'number' ? round1(v) : v;
  }
  const c = cleanOverride(cur);
  if (c) base.items[id] = c; else delete base.items[id];
  return base;
}

/** Immutable: forget everything the lab changed about one element. */
export function resetItem(cfg: HeaderLayoutConfig | null, id: string): HeaderLayoutConfig {
  const base: HeaderLayoutConfig = cfg ? { ...cfg, items: { ...cfg.items } } : { v: 1, items: {} };
  delete base.items[id];
  return base;
}

// ── geometry helpers (pure) ─────────────────────────────────────────────

export const ptToMm = (pt: number) => pt / MM;
export const mmToPt = (mm: number) => mm * MM;

/** Page x (pt) of the printable-area edge a given alignment anchors to. */
export function anchorX(align: Align): number {
  return align === 'center' ? PAGE.w / 2 : align === 'right' ? PAGE.w - MARGIN_X : MARGIN_X;
}

/** Snap guides (pt) on the x axis: margins + centre line. */
export const GUIDES_X: ReadonlyArray<{ x: number; label: string }> = [
  { x: MARGIN_X, label: 'Left margin' },
  { x: PAGE.w / 2, label: 'Centre' },
  { x: PAGE.w - MARGIN_X, label: 'Right margin' },
];

/** Snap an item moved to a new box-left `left` (pt): when its left edge,
 *  centre or right edge lands within `tol` of a guide, pull it onto it.
 *  Returns the snapped left + the guide it snapped to (for a flash). */
export function snapBoxX(left: number, width: number, tol = 1.5 * MM): { left: number; guide: number | null } {
  let best: { d: number; left: number; guide: number } | null = null;
  for (const g of GUIDES_X) {
    for (const [edge, off] of [[left, 0], [left + width / 2, width / 2], [left + width, width]] as const) {
      const d = Math.abs(edge - g.x);
      if (d <= tol && (!best || d < best.d)) best = { d, left: g.x - off, guide: g.x };
    }
  }
  return best ? { left: best.left, guide: best.guide } : { left, guide: null };
}

/** A NUDGE that would carry an edge (left, centre or right) ACROSS a guide
 *  stops exactly on it — so small steps land on the margin / centre line
 *  instead of skipping past it; the next nudge moves on. */
export function nudgeSnapX(from: number, to: number, width: number): { left: number; guide: number | null } {
  if (Math.abs(to - from) < 1e-6) return { left: to, guide: null };
  let best: { d: number; left: number; guide: number } | null = null;
  for (const g of GUIDES_X) {
    for (const off of [0, width / 2, width]) {
      const a = from + off, b = to + off;
      const crosses = (a < g.x - 0.01 && b > g.x + 0.01) || (a > g.x + 0.01 && b < g.x - 0.01);
      if (crosses) {
        const d = Math.abs(g.x - a);
        if (!best || d < best.d) best = { d, left: g.x - off, guide: g.x };
      }
    }
  }
  return best ? { left: best.left, guide: best.guide } : { left: to, guide: null };
}

/** Text box-left (pt) from anchor x, alignment and width. */
export function boxLeft(x: number, align: Align, w: number): number {
  return align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
}
/** Inverse of boxLeft — the anchor x for a box that starts at `left`. */
export function anchorFromLeft(left: number, align: Align, w: number): number {
  return align === 'center' ? left + w / 2 : align === 'right' ? left + w : left;
}

// ── checks ──────────────────────────────────────────────────────────────

const HUMAN = (it: LayoutItem) => it.label;

function intersects(a: LayoutItem['box'], b: LayoutItem['box'], pad = 0.6): boolean {
  return a.x + pad < b.x + b.w - pad && b.x + pad < a.x + a.w - pad
      && a.y + pad < b.y + b.h - pad && b.y + pad < a.y + a.h - pad;
}

/** What will print badly (or notably) — shown in the designer, next to the
 *  element and in the side card. Pure: works on the resolved items. */
export function detectIssues(res: ReportLayoutResult): LayoutIssue[] {
  const out: LayoutIssue[] = [];
  const shown = res.items.filter(i => !i.hidden);
  const lo = MARGIN_X - 0.5, hi = PAGE.w - MARGIN_X + 0.5;
  for (const it of shown) {
    if (it.kind === 'banner' || it.kind === 'bar') continue;
    const b = it.box;
    if (b.x < lo || b.x + b.w > hi) {
      const past = b.x + b.w > hi ? b.x + b.w - (PAGE.w - MARGIN_X) : MARGIN_X - b.x;
      const off = b.x + b.w > PAGE.w || b.x < 0;
      out.push({ itemId: it.id, kind: 'overflow', level: 'warn',
        message: off
          ? `${HUMAN(it)} runs off the paper by ${ptToMm(Math.max(b.x + b.w - PAGE.w, -b.x)).toFixed(1)} mm — it will be cut.`
          : `${HUMAN(it)} goes ${ptToMm(past).toFixed(1)} mm past the ${b.x + b.w > hi ? 'right' : 'left'} margin.` });
    }
    if (it.kind === 'text' && it.wraps) {
      out.push({ itemId: it.id, kind: 'wrap', level: 'info',
        message: `${HUMAN(it)} wraps onto ${it.lines?.length ?? 2} lines to stay inside the page.` });
    }
  }
  const header = shown.filter(i => i.region === 'header' && i.kind !== 'banner');
  for (let i = 0; i < header.length; i++) {
    for (let j = i + 1; j < header.length; j++) {
      const a = header[i], b = header[j];
      // The website pill sits ON the accent bar by design.
      const pair = [a.id, b.id].sort().join('|');
      if (pair === 'accentBar|website' && (a.tone === 'pill' || b.tone === 'pill')) continue;
      if (intersects(a.box, b.box)) {
        out.push({ itemId: b.id, kind: 'overlap', level: 'warn', message: `${HUMAN(b)} overlaps ${HUMAN(a)}.` });
      }
    }
  }
  if (res.headerBottom > res.bodyTop + 0.5) {
    const low = header.reduce<LayoutItem | null>((m, i) => (!m || i.box.y + i.box.h > m.box.y + m.box.h ? i : m), null);
    out.push({ itemId: low?.id ?? '', kind: 'body', level: 'warn',
      message: `${low ? HUMAN(low) : 'The letterhead'} prints over the patient details — move it up, or let the patient details start lower.` });
  }
  return out;
}

/** Human "where is it" readout: offset from the edge its alignment anchors to. */
export function positionReadout(it: LayoutItem): { h: string; v: string } {
  const b = it.box;
  const v = `${ptToMm(b.y).toFixed(1)} mm from the top`;
  if (it.align === 'center') {
    const d = ptToMm(b.x + b.w / 2 - PAGE.w / 2);
    return { h: Math.abs(d) < 0.05 ? 'Centred on the page' : `${Math.abs(d).toFixed(1)} mm ${d < 0 ? 'left' : 'right'} of centre`, v };
  }
  if (it.align === 'right') return { h: `${ptToMm(PAGE.w - MARGIN_X - (b.x + b.w)).toFixed(1)} mm in from the right margin`, v };
  return { h: `${ptToMm(b.x - MARGIN_X).toFixed(1)} mm in from the left margin`, v };
}
