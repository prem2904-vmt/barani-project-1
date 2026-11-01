import type { ReportTemplate } from '../models/report.model';
import {
  MARGIN_X, MM, PAGE, ptToMm, readHeaderLayout, setItem, snapBoxX, writeHeaderLayout,
  type Align, type LayoutItem, type ReportLayoutResult,
} from './report-header-layout';
import {
  MIN_HIGH_LOW_GAP, MIN_TEXT_CONTRAST, PALETTES, checkColors, contrastRatio, lightness, mix, normalizeHex, paletteById, paletteColumns,
  templateColors, type PaletteColors, type PaletteId,
} from './report-palettes';
import type { SqueezeReport } from './report-density';
import { samplePlan } from './report-signature-space';
import { STYLE_PRESETS, readReportStyle, writeReportStyle, type ReportStylePatch } from './report-style';

/**
 * Cortex "Tidy up" - the DETERMINISTIC half (report layout plan 6). Pure TypeScript, no model, free, instant.
 *
 * `runTidy` looks at the template (its letterhead layout, its report style, its colours) and a `probe` of how the
 * sample report prints with long names, and returns a list of NAMED changes, each with a plain-words reason. It
 * changes nothing itself: `applyChanges` turns the ticked changes into ONE patch of the template (`metadata` + colour
 * columns), which the editor pushes onto its undo history as a single step. Released / stored PDFs are never touched -
 * only the template changes, and only when the person presses Save.
 *
 * Rules (each one named, each with a reason the person can read):
 *   fit / fit-columns / fit-lines  long names overlapped -> text fitting, a wider name column, 3 lines
 *   squeeze        a small overflow onto a last page -> squeeze onto fewer pages
 *   flags          High and Low look alike in black and white -> nudge those two colours
 *   signature      signatures on every page cost a lot of room -> once, at the end
 *   clamp          a letterhead item runs past the margin / off the paper -> back inside
 *   snap           an item a hair off the margin / centre line -> onto it
 *   align          left edges (or baselines) a hair apart -> the same
 *   overlap        two letterhead items collide -> the lower / right one moves clear
 *   spacing        a column of 3+ lines with uneven gaps -> even gaps
 *   size           an odd text size (11.3 pt) -> the nearest half point
 * and the JUDGEMENT questions (`choices`) it leaves for Cortex: which style preset, which palette, how to resolve a
 * collision it could not move clear.
 */

export type TidyRuleId =
  | 'fit' | 'fit-columns' | 'fit-lines' | 'squeeze' | 'flags' | 'signature'
  | 'clamp' | 'snap' | 'align' | 'overlap' | 'spacing' | 'size';

/** The code word the server knows each rule by (its list of finding codes). */
export const RULE_CODE: Readonly<Record<TidyRuleId, string>> = Object.freeze({
  fit: 'fit', 'fit-columns': 'fit', 'fit-lines': 'fit', squeeze: 'squeeze', flags: 'flags', signature: 'signature',
  clamp: 'overflow', snap: 'snap', align: 'align', overlap: 'overlap', spacing: 'spacing', size: 'size',
});

export type TidyItemKey = 'x' | 'y' | 'size' | 'wrap' | 'align';

export type TidyPatch =
  /** Move a letterhead item by a distance (mm) from where it is NOW - so the changes compose in any ticked subset. */
  | { kind: 'move'; id: string; dx: number; dy: number }
  /** Set one letterhead-item value (mm / pt / alignment). */
  | { kind: 'item'; id: string; key: TidyItemKey; to: number | string }
  /** Set one report-style value; `path` is dotted under the style ("fit.enabled"). */
  | { kind: 'style'; path: string; to: unknown }
  /** Set one of the seven template colours. */
  | { kind: 'color'; key: keyof PaletteColors; to: string }
  /** Write a curated palette (the seven colours + the remembered choice). */
  | { kind: 'palette'; id: PaletteId };

export interface TidyChange {
  id: string;
  source: 'rule' | 'cortex';
  rule: TidyRuleId | 'cortex';
  title: string;
  /** Plain words: what is wrong and what this does. */
  why: string;
  patches: TidyPatch[];
  /** Changes (ids) that must be ticked for this one to make sense. */
  requires?: string[];
}

export interface TidyChoiceOption { key: string; label: string; patches: TidyPatch[] }
export interface TidyChoice { id: string; title: string; options: TidyChoiceOption[] }

/** The letterhead item as it sat before any change - the base the move patches add to. */
export interface TidyBaseItem { id: string; kind: LayoutItem['kind']; region: LayoutItem['region']; label: string; align: Align;
  xMm: number; yMm: number; wMm: number; hMm: number; size: number | null; textLen: number; hidden: boolean }

export interface TidyProbe {
  /** Places where the stress sample (long names) makes text run into text. */
  issues: number;
  layout: ReportLayoutResult;
  /** Present when the probed template has squeeze on. */
  squeeze: SqueezeReport | null;
}
export type TidyProbeFn = (tpl: ReportTemplate) => TidyProbe;

export interface TidyFinding { code: string; target?: string }

export interface TidyResult {
  changes: TidyChange[];
  choices: TidyChoice[];
  base: Record<string, TidyBaseItem>;
  /** What is still wrong after the rules (the model is told these as codes). */
  findings: TidyFinding[];
  /** Rule codes that fired. */
  applied: string[];
  issuesBefore: number;
}

export interface TidyOptions {
  /** Does the template print High / Low in colour? Default: its flag style is "bold + colour". */
  flagsColoured?: boolean;
}

// ── geometry ────────────────────────────────────────────────────────────────

const TOL_SNAP = 1.5 * MM;     // snap onto a guide
const TOL_ALIGN = 2 * MM;      // left edges within 2 mm count as one edge
const TOL_ROW = 1.5 * MM;      // baselines within 1.5 mm count as one row
const GAP = 2;                 // pt of clear air left after a push
const EPS = 0.05;

interface W {
  id: string; kind: LayoutItem['kind']; region: LayoutItem['region']; label: string; align: Align;
  x: number; y: number; box: { x: number; y: number; w: number; h: number };
  size: number | null; text: boolean; moved: boolean;
  /** The lab placed / resized this item by hand (an override exists). Untouched items keep the header style's own rhythm. */
  custom: boolean;
}

const rnd2 = (n: number) => Math.round(n * 100) / 100;
const mm2 = (pt: number) => rnd2(ptToMm(pt));

function workOf(layout: ReportLayoutResult): W[] {
  return layout.items
    .filter(i => !i.hidden && (i.kind === 'text' || i.kind === 'logo' || i.kind === 'nabl'))
    .map(i => ({
      id: i.id, kind: i.kind, region: i.region, label: i.label, align: i.align, x: i.x, y: i.y,
      box: { ...i.box }, size: i.kind === 'text' ? (i.sizeValue ?? i.size ?? null) : null, text: i.kind === 'text', moved: false, custom: !!i.customized,
    }));
}
const left = (w: W) => w.box.x;
const right = (w: W) => w.box.x + w.box.w;
const top = (w: W) => w.box.y;
const bottom = (w: W) => w.box.y + w.box.h;
function shift(w: W, dx: number, dy: number) {
  w.x += dx; w.y += dy; w.box.x += dx; w.box.y += dy; if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) w.moved = true;
}
function hit(a: W, b: W, pad = 0.6): boolean {
  return left(a) + pad < right(b) - pad && left(b) + pad < right(a) - pad && top(a) + pad < bottom(b) - pad && top(b) + pad < bottom(a) - pad;
}
const decorative = (a: W, b: W) => [a.id, b.id].sort().join('|') === 'accentBar|website';

/** Records where each item stood so a rule can emit the distance it moved. */
function mark(ws: W[]): Map<string, { x: number; y: number }> {
  return new Map(ws.map(w => [w.id, { x: w.x, y: w.y }]));
}
function movesSince(ws: W[], before: Map<string, { x: number; y: number }>): TidyPatch[] {
  const out: TidyPatch[] = [];
  for (const w of ws) {
    const b = before.get(w.id);
    if (!b) continue;
    const dx = w.x - b.x, dy = w.y - b.y;
    if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) continue;
    out.push({ kind: 'move', id: w.id, dx: Math.abs(dx) < EPS ? 0 : mm2(dx), dy: Math.abs(dy) < EPS ? 0 : mm2(dy) });
  }
  return out;
}
const names = (ws: Array<{ label: string }>, max = 3) =>
  ws.length <= max ? ws.map(w => w.label).join(', ') : `${ws.slice(0, max).map(w => w.label).join(', ')} and ${ws.length - max} more`;

// ── the geometry rules ──────────────────────────────────────────────────────

function ruleClamp(ws: W[], push: (c: TidyChange | null) => void) {
  const lo = MARGIN_X, hi = PAGE.w - MARGIN_X, usable = hi - lo;
  const before = mark(ws);
  const patches: TidyPatch[] = [];
  const hit: W[] = [];
  for (const w of ws) {
    if (left(w) >= lo - 0.5 && right(w) <= hi + 0.5) continue;
    if (w.box.w <= usable + 0.5) {
      shift(w, left(w) < lo ? lo - left(w) : hi - right(w), 0);
    } else if (w.text) {
      // Wider than the page can hold: wrap it at the printable width and start it at the margin.
      const wrapMm = Math.floor(ptToMm(usable));
      patches.push({ kind: 'item', id: w.id, key: 'wrap', to: wrapMm });
      shift(w, lo - left(w), 0);
      w.box.w = usable;
    } else continue;
    hit.push(w);
  }
  patches.push(...movesSince(ws, before));
  if (!patches.length) return push(null);
  push({
    id: 'rule:clamp', source: 'rule', rule: 'clamp', title: 'Bring letterhead items inside the margins',
    why: `${names(hit)} ${hit.length === 1 ? 'runs' : 'run'} past the margin and may be cut when printed. ${hit.length === 1 ? 'It moves' : 'They move'} back inside the printable area.`,
    patches,
  });
}

function ruleSnap(ws: W[], push: (c: TidyChange | null) => void) {
  const before = mark(ws);
  const hitW: W[] = [];
  for (const w of ws) {
    if (!w.custom) continue;
    const s = snapBoxX(left(w), w.box.w, TOL_SNAP);
    const dx = s.left - left(w);
    if (s.guide === null || Math.abs(dx) < EPS || Math.abs(dx) > TOL_SNAP + EPS) continue;
    if (left(w) + dx < MARGIN_X - 0.5 || right(w) + dx > PAGE.w - MARGIN_X + 0.5) continue;
    shift(w, dx, 0);
    hitW.push(w);
  }
  if (!hitW.length) return push(null);
  push({
    id: 'rule:snap', source: 'rule', rule: 'snap', title: 'Line items up with the margins and the centre',
    why: `${names(hitW)} sat a hair off the margin or centre line (under 1.5 mm). ${hitW.length === 1 ? 'It snaps' : 'They snap'} onto it so the edges look deliberate.`,
    patches: movesSince(ws, before),
  });
}

function ruleAlign(ws: W[], push: (c: TidyChange | null) => void) {
  const before = mark(ws);
  const hitW = new Set<W>();
  // Left / right / centre edges that are almost, but not quite, the same.
  for (const al of ['left', 'right', 'center'] as const) {
    const group = ws.filter(w => w.text && w.align === al && w.region === 'header');
    const edge = (w: W) => (al === 'left' ? left(w) : al === 'right' ? right(w) : left(w) + w.box.w / 2);
    const sorted = group.slice().sort((a, b) => edge(a) - edge(b));
    let run: W[] = [];
    const flush = () => {
      if (run.length > 1) {
        const lo = edge(run[0]), hi = edge(run[run.length - 1]);
        if (hi - lo > EPS) {
          // Keep the edge that sits on a margin / centre guide; else the one most items share; else the first.
          const guides = [MARGIN_X, PAGE.w / 2, PAGE.w - MARGIN_X];
          const onGuide = run.find(w => guides.some(g => Math.abs(edge(w) - g) < 0.1));
          const target = edge(onGuide ?? run[0]);
          for (const w of run) {
            const dx = target - edge(w);
            if (!w.custom || Math.abs(dx) < EPS) continue;
            if (left(w) + dx < MARGIN_X - 0.5 || right(w) + dx > PAGE.w - MARGIN_X + 0.5) continue;
            shift(w, dx, 0); hitW.add(w);
          }
        }
      }
      run = [];
    };
    for (const w of sorted) {
      if (run.length && edge(w) - edge(run[run.length - 1]) > TOL_ALIGN) flush();
      run.push(w);
    }
    flush();
  }
  // Baselines of text that sit side by side.
  const texts = ws.filter(w => w.text && w.region === 'header').sort((a, b) => a.y - b.y);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const dy = b.y - a.y;
      if (dy > TOL_ROW) break;
      if (dy < EPS || !b.custom) continue;
      const apart = right(a) <= left(b) + 0.5 || right(b) <= left(a) + 0.5;
      if (!apart) continue;
      shift(b, 0, -dy); hitW.add(b);
    }
  }
  if (!hitW.size) return push(null);
  const list = [...hitW];
  push({
    id: 'rule:align', source: 'rule', rule: 'align', title: 'Align edges and baselines',
    why: `${names(list)} ${list.length === 1 ? 'was' : 'were'} a hair out of line (under 2 mm sideways or 1.5 mm up and down) with its neighbours. ${list.length === 1 ? 'It lines' : 'They line'} up now.`,
    patches: movesSince(ws, before),
  });
}

function ruleOverlap(ws: W[], layout: ReportLayoutResult, push: (c: TidyChange | null) => void): W[] {
  const before = mark(ws);
  const moved = new Set<W>();
  const limitFor = (w: W) => (w.region === 'header' ? (layout.bodyTopAuto ? Infinity : layout.bodyTop - GAP) : PAGE.h - 10);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const order = ws.slice().sort((a, b) => top(a) - top(b) || left(a) - left(b));
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const a = order[i], b = order[j];
        if (a.region !== b.region || !hit(a, b) || decorative(a, b)) continue;
        const sameRow = Math.abs(top(a) - top(b)) < 0.5 * Math.min(a.box.h, b.box.h) + 1;
        const dxRight = right(a) + 4 - left(b);
        if (sameRow && left(b) >= left(a) && right(b) + dxRight <= PAGE.w - MARGIN_X + 0.5 && b.align !== 'center') {
          shift(b, dxRight, 0); moved.add(b); changed = true; continue;
        }
        const dy = bottom(a) + GAP - top(b);
        if (dy > 0 && bottom(b) + dy <= limitFor(b) + 0.5) { shift(b, 0, dy); moved.add(b); changed = true; }
      }
    }
    if (!changed) break;
  }
  const still: W[] = [];
  for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
    if (ws[i].region === ws[j].region && !decorative(ws[i], ws[j]) && hit(ws[i], ws[j])) still.push(top(ws[i]) <= top(ws[j]) ? ws[j] : ws[i]);
  }
  if (moved.size) {
    const list = [...moved];
    push({
      id: 'rule:overlap', source: 'rule', rule: 'overlap', title: 'Move apart letterhead items that collide',
      why: `${names(list)} ${list.length === 1 ? 'printed' : 'printed'} on top of a neighbour. ${list.length === 1 ? 'It moves' : 'They move'} just clear of it, keeping your reading order.`,
      patches: movesSince(ws, before),
    });
  } else push(null);
  return [...new Set(still)];
}

function ruleSpacing(ws: W[], push: (c: TidyChange | null) => void) {
  const before = mark(ws);
  const hitW: W[] = [];
  const texts = ws.filter(w => w.text && w.region === 'header').sort((a, b) => top(a) - top(b));
  const overlapX = (a: W, b: W) => Math.min(right(a), right(b)) - Math.max(left(a), left(b)) >= 0.5 * Math.min(a.box.w, b.box.w);
  const used = new Set<W>();
  for (const start of texts) {
    if (used.has(start)) continue;
    const chain = [start];
    for (const n of texts) {
      const last = chain[chain.length - 1];
      if (n === last || used.has(n) || top(n) < bottom(last) - 0.5 || !overlapX(last, n)) continue;
      if (top(n) - bottom(last) > 40) continue;
      chain.push(n);
    }
    if (chain.length < 3) continue;
    chain.forEach(c => used.add(c));
    if (!chain.slice(1, -1).every(c => c.custom)) continue;
    const gaps = chain.slice(1).map((c, i) => top(c) - bottom(chain[i]));
    if (Math.max(...gaps) - Math.min(...gaps) < 0.5 * MM) continue;
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    if (mean < 0) continue;
    for (let i = 1; i < chain.length - 1; i++) {
      const want = bottom(chain[i - 1]) + mean;
      const dy = want - top(chain[i]);
      if (Math.abs(dy) > EPS) { shift(chain[i], 0, dy); hitW.push(chain[i]); }
    }
  }
  if (!hitW.length) return push(null);
  push({
    id: 'rule:spacing', source: 'rule', rule: 'spacing', title: 'Even out the spacing between lines',
    why: `The gaps between ${names(hitW)} and the lines around ${hitW.length === 1 ? 'it' : 'them'} were uneven. The space is now the same between each line.`,
    patches: movesSince(ws, before),
  });
}

function ruleSize(ws: W[], layout: ReportLayoutResult, minPt: number, push: (c: TidyChange | null) => void) {
  const hitW: W[] = [];
  const patches: TidyPatch[] = [];
  for (const it of layout.items) {
    if (it.hidden || it.kind !== 'text' || !it.customized) continue;
    const size = it.sizeValue;
    if (!isFinite(size)) continue;
    const near = Math.max(minPt, Math.round(size * 2) / 2);
    if (Math.abs(near - size) < 0.05 || Math.abs(near - size) > 0.5 + EPS) continue;
    patches.push({ kind: 'item', id: it.id, key: 'size', to: near });
    hitW.push({ label: it.label } as W);
  }
  if (!patches.length) return push(null);
  push({
    id: 'rule:size', source: 'rule', rule: 'size', title: 'Use tidy text sizes',
    why: `${names(hitW)} ${hitW.length === 1 ? 'has' : 'have'} an odd text size (like 11.3 pt). ${hitW.length === 1 ? 'It becomes' : 'They become'} the nearest half point, never below your ${minPt} pt floor.`,
    patches,
  });
}

// ── helpers shared with the wire / apply side ───────────────────────────────

/** Style paths a Cortex / option patch may set. A mirror of the server's allow-list (`ReportTidyContract.StyleLeaves`). */
export const TIDY_STYLE_PATHS: ReadonlyArray<string> = Object.freeze([
  'preset', 'fit.enabled', 'fit.minPt', 'fit.maxLines', 'fit.autoColumns', 'patient.ageSex', 'patient.ageStyle', 'patient.sexStyle',
  'patient.frame', 'patient.continuation', 'patient.showReportStatus', 'pageNumbers', 'density', 'squeeze', 'letterhead.continuation',
  'signatures.placement', 'signatures.show', 'signatures.imageH', 'signatures.maxPerRow', 'charts.trend.style', 'charts.trend.layout',
  'charts.trend.band', 'charts.trend.values', 'charts.rangeBar', 'charts.previous',
]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** `{ fit: { enabled: true } }` -> [['fit.enabled', true]] (only the allow-listed leaves). */
export function flattenStylePatch(p: ReportStylePatch, prefix = ''): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) out.push(...flattenStylePatch(v as ReportStylePatch, path));
    else if (TIDY_STYLE_PATHS.includes(path)) out.push([path, v]);
  }
  return out;
}

function getPath(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((c, k) => (isObj(c) ? c[k] : undefined), o);
}
function nest(entries: Array<[string, unknown]>): ReportStylePatch {
  const out: Record<string, unknown> = {};
  for (const [path, v] of entries) {
    const parts = path.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) cur = (cur[parts[i]] = isObj(cur[parts[i]]) ? cur[parts[i]] : {}) as Record<string, unknown>;
    cur[parts[parts.length - 1]] = v;
  }
  return out as ReportStylePatch;
}

const baseOf = (layout: ReportLayoutResult): Record<string, TidyBaseItem> => {
  const out: Record<string, TidyBaseItem> = {};
  for (const it of layout.items) {
    out[it.id] = {
      id: it.id, kind: it.kind, region: it.region, label: it.label, align: it.align, xMm: ptToMm(it.x), yMm: ptToMm(it.y),
      wMm: ptToMm(it.box.w), hMm: ptToMm(it.box.h), size: it.kind === 'text' ? it.sizeValue ?? null : null,
      textLen: it.kind === 'text' ? (it.lines?.join('').length ?? it.text?.length ?? 0) : 0, hidden: !!it.hidden,
    };
  }
  return out;
};

// ── applying ticked changes ─────────────────────────────────────────────────

/**
 * The template patch for the ticked `changes`: ONE object for the editor's `patch()` (so Apply is one undo step).
 * Letterhead items are written through `setItem` / `writeHeaderLayout`, the style through `writeReportStyle`, colours into
 * their template columns. A move adds to where the item stood before the tidy (`base`), whatever else is ticked.
 */
export function applyChanges(tpl: ReportTemplate, changes: ReadonlyArray<TidyChange>, base: Record<string, TidyBaseItem>): Partial<ReportTemplate> {
  const patches = changes.flatMap(c => c.patches);
  if (!patches.length) return {};

  // style (+ remembered palette)
  const styleEntries: Array<[string, unknown]> = [];
  let palette: PaletteId | null = null;
  for (const p of patches) {
    if (p.kind === 'style') styleEntries.push([p.path, p.to]);
    if (p.kind === 'palette') { palette = p.id; styleEntries.push(['colors.palette', p.id]); }
  }
  let metadata = styleEntries.length ? writeReportStyle(tpl, nest(styleEntries)) : (tpl.metadata ?? null);

  // letterhead items
  const items = new Map<string, { dx: number; dy: number; set: Partial<Record<TidyItemKey, number | string>> }>();
  const slot = (id: string) => items.get(id) ?? (items.set(id, { dx: 0, dy: 0, set: {} }).get(id)!);
  for (const p of patches) {
    if (p.kind === 'move') { const s = slot(p.id); s.dx += p.dx; s.dy += p.dy; }
    if (p.kind === 'item') slot(p.id).set[p.key] = p.to;
  }
  if (items.size) {
    let cfg = readHeaderLayout({ metadata });
    for (const [id, s] of items) {
      const b = base[id];
      const patch: Record<string, unknown> = { ...s.set };
      if (b) {
        if (s.dx && patch['x'] === undefined) patch['x'] = rnd2(b.xMm + s.dx);
        if (s.dy && patch['y'] === undefined) patch['y'] = rnd2(b.yMm + s.dy);
      }
      if (Object.keys(patch).length) cfg = setItem(cfg, id, patch);
    }
    metadata = writeHeaderLayout({ metadata }, cfg);
  }

  // colours
  const out: Partial<ReportTemplate> = { metadata: metadata ?? undefined };
  if (palette) Object.assign(out, paletteColumns(paletteById(palette)!.colors));
  for (const p of patches) if (p.kind === 'color') (out as Record<string, unknown>)[p.key] = p.to;
  return out;
}

/** Apply a handful of style entries to a copy of the template (what the probe measures). */
function withStyle(tpl: ReportTemplate, entries: Array<[string, unknown]>): ReportTemplate {
  return { ...tpl, metadata: writeReportStyle(tpl, nest(entries)) };
}

// ── High / Low colours ──────────────────────────────────────────────────────

/** Nudge the High and Low colours until both read (4.5:1) and differ in greyscale (>= 25 lightness points). */
export function fixFlagColors(high: string, low: string): { high: string; low: string } | null {
  const readable = (c: string) => contrastRatio(c, '#ffffff') >= MIN_TEXT_CONTRAST;
  const gap = (a: string, b: string) => Math.abs(lightness(a) - lightness(b));
  const darkerIsHigh = lightness(high) <= lightness(low);
  const dark = darkerIsHigh ? high : low, light = darkerIsHigh ? low : high;
  let best: { dark: string; light: string; cost: number } | null = null;
  // d: how far the darker colour goes toward black; l: the lighter one toward white (+) or back toward black (-) until it reads.
  for (let d = 0; d <= 16; d++) {
    for (let l = -10; l <= 12; l++) {
      const nd = mix(dark, '#000000', d * 0.05), nl = l >= 0 ? mix(light, '#ffffff', l * 0.05) : mix(light, '#000000', -l * 0.05);
      if (!readable(nd) || !readable(nl) || gap(nd, nl) < MIN_HIGH_LOW_GAP) continue;
      const cost = d + Math.abs(l);
      if (!best || cost < best.cost) best = { dark: nd, light: nl, cost };
    }
  }
  if (!best) return null;
  return darkerIsHigh ? { high: best.dark, low: best.light } : { high: best.light, low: best.dark };
}

// ── the run ─────────────────────────────────────────────────────────────────

export function runTidy(tpl: ReportTemplate, probe: TidyProbeFn, opts: TidyOptions = {}): TidyResult {
  const style = readReportStyle(tpl);
  const p0 = probe(tpl);
  const changes: TidyChange[] = [];
  const choices: TidyChoice[] = [];
  const findings: TidyFinding[] = [];
  const add = (c: TidyChange | null) => { if (c && c.patches.length) changes.push(c); };

  // 1. letterhead geometry
  const ws = workOf(p0.layout);
  ruleClamp(ws, add);
  ruleSnap(ws, add);
  ruleAlign(ws, add);
  const stuck = ruleOverlap(ws, p0.layout, add);
  ruleSpacing(ws, add);
  ruleSize(ws, p0.layout, style.fit.minPt, add);

  // anything still colliding is a judgement call (Cortex) - and a finding either way
  for (const w of stuck.slice(0, 4)) {
    findings.push({ code: 'overlap', target: w.id });
    const options: TidyChoiceOption[] = [];
    if (w.text && w.size && w.size > 7) options.push({ key: 'shrink', label: 'Make it a little smaller', patches: [{ kind: 'item', id: w.id, key: 'size', to: Math.max(style.fit.minPt, Math.round((w.size - 1.5) * 2) / 2) }] });
    if (w.text) options.push({ key: 'wrap', label: 'Let it wrap onto two lines', patches: [{ kind: 'item', id: w.id, key: 'wrap', to: Math.max(30, Math.floor(ptToMm(w.box.w * 0.6))) }] });
    if (options.length) choices.push({ id: `overlap:${w.id}`, title: `Resolve an overlap (${w.label})`, options });
  }

  // 2. text fitting, measured with the long-name sample
  let issues = p0.issues;
  let cur = tpl;
  const stage = (id: string, rule: TidyRuleId, title: string, why: (b: number, a: number) => string, entries: Array<[string, unknown]>, requires?: string[]) => {
    const next = withStyle(cur, entries);
    const after = probe(next).issues;
    changes.push({ id, source: 'rule', rule, title, why: why(issues, after), patches: entries.map(([path, to]) => ({ kind: 'style', path, to })), requires });
    issues = after; cur = next;
  };
  if (issues > 0) {
    findings.push({ code: 'overlap' });
    let fitId: string | undefined;
    if (!style.fit.enabled) {
      fitId = 'rule:fit';
      stage(fitId, 'fit', 'Turn on text fitting',
        (b, a) => `With long patient or doctor names ${b} ${b === 1 ? 'place' : 'places'} on the report print on top of each other. Text fitting wraps a long name, then shrinks it a little (never below ${style.fit.minPt} pt)${a < b ? `, which fixes ${b - a}` : ''}.`,
        [['fit.enabled', true]]);
    }
    if (issues > 0 && !style.fit.autoColumns) {
      stage('rule:fit-columns', 'fit-columns', 'Widen the name column when names are long',
        (b, a) => `${b} ${b === 1 ? 'place still collides' : 'places still collide'}. Letting the results table size its columns to what is in them gives long test names room${a < b ? ` and fixes ${b - a} more` : ''}.`,
        [['fit.autoColumns', true]], fitId ? [fitId] : undefined);
    }
    if (issues > 0 && style.fit.maxLines < 3) {
      stage('rule:fit-lines', 'fit-lines', 'Allow three lines for long names',
        (b, a) => `${b} ${b === 1 ? 'place still collides' : 'places still collide'}. Allowing a third line lets a very long name wrap instead of colliding${a < b ? ` and fixes ${b - a} more` : ''}.`,
        [['fit.maxLines', 3]], fitId ? [fitId] : undefined);
    }
    if (issues > 0) findings.push({ code: 'fit' });
  }

  // 3. squeeze onto fewer pages
  if (!style.squeeze) {
    const sq = probe(withStyle(cur, [['squeeze', true]])).squeeze;
    if (sq?.applied && sq.pagesAfter < sq.pagesBefore) {
      changes.push({
        id: 'rule:squeeze', source: 'rule', rule: 'squeeze', title: 'Squeeze the report onto fewer pages',
        why: `The sample report spills a little onto a ${sq.pagesBefore}${sq.pagesBefore === 2 ? 'nd' : 'th'} page (${Math.round(sq.overflow * 100)}% of a page). A slightly tighter layout brings it to ${sq.pagesAfter} ${sq.pagesAfter === 1 ? 'page' : 'pages'}, so the lab prints less paper.`,
        patches: [{ kind: 'style', path: 'squeeze', to: true }],
      });
    }
  }

  // 4. High / Low readable in black and white
  const colors = templateColors(tpl);
  const flagsColoured = opts.flagsColoured ?? tpl.flagStyle === 'bold_color';
  const colorIn = { ...colors, bodyTextColor: tpl.bodyTextColor };
  const flagChecks = checkColors(colorIn, flagsColoured).filter(c => c.id === 'flags-text' || c.id === 'flags-grey');
  if (flagChecks.some(c => !c.ok)) {
    findings.push({ code: 'flags' });
    const fixed = fixFlagColors(colors.abnormalColor, colors.abnormalLowColor);
    if (fixed) {
      const patches: TidyPatch[] = [];
      if (fixed.high.toLowerCase() !== colors.abnormalColor.toLowerCase()) patches.push({ kind: 'color', key: 'abnormalColor', to: fixed.high });
      if (fixed.low.toLowerCase() !== colors.abnormalLowColor.toLowerCase()) patches.push({ kind: 'color', key: 'abnormalLowColor', to: fixed.low });
      if (patches.length) changes.push({
        id: 'rule:flags', source: 'rule', rule: 'flags', title: 'Make High and Low easy to tell apart in black and white',
        why: `${flagChecks.find(c => !c.ok)!.detail} The two colours are deepened just enough that a photocopy still shows which is High and which is Low.`,
        patches,
      });
    }
  }

  // 5. signatures
  const sig = style.signatures;
  if (sig.placement === 'every-page' && sig.show === 'image') {
    const plan = samplePlan(sig, 2);
    const mmPerPage = Math.round(ptToMm(plan.perPageH));
    if (mmPerPage >= 15) {
      changes.push({
        id: 'rule:signature', source: 'rule', rule: 'signature', title: 'Print signatures once, at the end',
        why: `Signatures on every page take about ${mmPerPage} mm of every page, leaving less room for results. Printing them once, on the last page, saves that space and usually a page.`,
        patches: [{ kind: 'style', path: 'signatures.placement', to: 'end' }],
      });
      findings.push({ code: 'signature' });
    }
  }

  // 6. judgement questions for Cortex (only what could really go either way)
  const presetOptions: TidyChoiceOption[] = [];
  for (const id of ['modern', 'compact'] as const) {
    if (style.preset === id) continue;
    const entries = flattenStylePatch(STYLE_PRESETS[id]).filter(([path, v]) => !sameJson(getPath(style, path), v));
    if (entries.length) presetOptions.push({ key: id, label: id === 'modern' ? 'Modern' : 'Compact', patches: entries.map(([path, to]) => ({ kind: 'style', path, to })) });
  }
  if (presetOptions.length) choices.push({ id: 'preset', title: 'Style preset', options: presetOptions });

  const bad = checkColors(colorIn, flagsColoured).filter(c => c.id !== 'flags-text' && c.id !== 'flags-grey' && !c.ok);
  if (bad.length) {
    findings.push({ code: 'flags' });
    const acc = colors.accentColor;
    const near = PALETTES.slice().sort((a, b) => dist(a.colors.accentColor, acc) - dist(b.colors.accentColor, acc)).slice(0, 3);
    choices.push({ id: 'palette', title: 'Colour palette', options: near.map(p => ({ key: p.id, label: p.label, patches: [{ kind: 'palette', id: p.id }] })) });
  }

  const applied = [...new Set(changes.map(c => RULE_CODE[c.rule as TidyRuleId]).filter(Boolean))];
  return { changes, choices, base: baseOf(p0.layout), findings, applied, issuesBefore: p0.issues };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function dist(a: string, b: string): number {
  const h = (x: string) => { const n = normalizeHex(x) ?? '#000000'; return [1, 3, 5].map(i => parseInt(n.slice(i, i + 2), 16)); };
  const [p, q] = [h(a), h(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// ── ticking ─────────────────────────────────────────────────────────────────

/** Tick / untick one change, keeping `requires` consistent (a change needs its prerequisites; unticking one drops its dependants). */
export function toggleChange(selected: ReadonlySet<string>, id: string, on: boolean, all: ReadonlyArray<TidyChange>): Set<string> {
  const out = new Set(selected);
  if (on) {
    const add = (cid: string) => {
      out.add(cid);
      for (const r of all.find(c => c.id === cid)?.requires ?? []) if (!out.has(r)) add(r);
    };
    add(id);
  } else {
    const drop = (cid: string) => {
      out.delete(cid);
      for (const c of all) if (c.requires?.includes(cid) && out.has(c.id)) drop(c.id);
    };
    drop(id);
  }
  return out;
}
