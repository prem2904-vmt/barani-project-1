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
  return cfg;
}

/** New `metadata` string with the layout written (or removed when null),
 *  keeping every other key the template's metadata carries. */
export function writeHeaderLayout(tpl: Pick<ReportTemplate, 'metadata'> | null | undefined, cfg: HeaderLayoutConfig | null): string {
  const meta = parseMeta(tpl);
  if (cfg) meta['headerLayout'] = cfg; else delete meta['headerLayout'];
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
