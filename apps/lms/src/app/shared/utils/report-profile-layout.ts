import type { PageLayoutBox, PageLayoutBoxKind, PageLayoutSection, ReportSection } from '../models/report-layout.model';
import {
  MARGIN_X, MM, PAGE, intersectBox, mmToPt, nudgeSnapX, ptToMm, snapBoxX,
} from './report-header-layout';

/**
 * Profile ONE-PAGE report layout — the designer that lets a lab arrange a
 * profile's (CBC, etc.) results table, report charts, analyzer images and
 * department signatures side by side so the whole profile prints on one
 * page (owner, 2026-10-02).
 *
 * Storage: ONE extra section, `{ type: 'page_layout', v: 1, enabled, boxes }`,
 * living in the SAME `sections` JSON array every other report-layout block
 * already uses (report-layout.model.ts — "intentionally loose JSON …so
 * layouts can evolve without migrations"). Exactly the pattern the report
 * chart block (`{ type: 'chart', trend }`) already set. No new storage, no
 * migration, no new save endpoint — ReportLayoutService.saveTestLayout(...)
 * carries it like any other section.
 *
 * Geometry: this file defines the BOX model only. Every mm/pt conversion,
 * margin guide, drag-snap and nudge-snap helper is the SAME pure function the
 * letterhead editor (report-header-layout.ts) already ships — imported here,
 * never duplicated, so the two designers can never drift apart. The one
 * thing this file owns that the letterhead model doesn't need: the BODY
 * area's bounds (below the letterhead, above the footer/signature band),
 * overlap/out-of-body checks over an arbitrary box list, the fit meter, and
 * the "missing analyzer image → hide its box, table reclaims the width" rule.
 */

export const PAGE_LAYOUT_SECTION_TYPE = 'page_layout' as const;

/** Printed body text never shrinks below this at render time (owner decision 1). */
export const MIN_BODY_FONT_PT = 8;
/** The table box's normal/starting font size. */
export const DEFAULT_BODY_FONT_PT = 9;

/** The 4 Medonic M51 image codes the connector attaches to CBC order lines
 *  (docs: `Param = "instrument:<code>"`), with their lab-facing labels.
 *  Offered in the designer's "add analyzer image slot" palette for ANY
 *  profile whose tests have carried these codes — nothing here is
 *  CBC-specific; this is simply the catalogue CBC happens to populate. */
export const KNOWN_ANALYZER_IMAGES: ReadonlyArray<{ code: string; label: string }> = [
  { code: '12003', label: 'WBC histogram' },
  { code: '12053', label: 'RBC histogram' },
  { code: '12103', label: 'PLT histogram' },
  { code: '12153', label: 'WBC DIFF scattergram' },
];

export function analyzerLabel(code: string): string {
  return KNOWN_ANALYZER_IMAGES.find(i => i.code === code)?.label ?? `Analyzer image ${code}`;
}

// ── storage (read/write the section inside the array) ──────────────────

function isPageLayoutSection(s: unknown): s is PageLayoutSection {
  return !!s && typeof s === 'object' && (s as { type?: unknown }).type === PAGE_LAYOUT_SECTION_TYPE;
}

/** The profile's page-layout section, or null — a profile never edited in
 *  this designer has none, and prints exactly as before (no behaviour
 *  change for every test/profile that doesn't use this feature). Tolerant
 *  of junk (a hand-edited export, a future field this build doesn't know).
 *
 *  Accepts BOTH shapes this one section travels in: the raw, author-side
 *  `ReportSection[]` the designer reads/writes (GET/POST
 *  /api/report-layout/test/{id} — `enabled`/`boxes` directly on the
 *  section), and mw's RESOLVED `ResolvedSection[]` the PDF/report snapshot
 *  carries (same "verbatim passthrough" pattern as the chart block's
 *  `trend` — the box data rides under a nested `pageLayout` key). One
 *  reader for both so the designer and the renderer can never read it two
 *  different (and driftable) ways. */
export function readPageLayout(sections: ReadonlyArray<unknown> | null | undefined): PageLayoutSection | null {
  const hit = (sections ?? []).find(isPageLayoutSection) as unknown as Record<string, unknown> | undefined;
  if (!hit) return null;
  // Resolved shape: { type: 'page_layout', pageLayout: { v, enabled, boxes, ... } }.
  const nested = hit['pageLayout'];
  const raw = (nested && typeof nested === 'object') ? (nested as Record<string, unknown>) : hit;
  const boxes = Array.isArray(raw['boxes']) ? (raw['boxes'] as unknown[]).filter(isBox) : [];
  return { id: String(hit['id'] ?? 'page-layout'), type: PAGE_LAYOUT_SECTION_TYPE, order: Number(hit['order'] ?? 0),
    v: 1, enabled: raw['enabled'] === true, boxes };
}

function isBox(o: unknown): o is PageLayoutBox {
  if (!o || typeof o !== 'object') return false;
  const b = o as Record<string, unknown>;
  return typeof b['id'] === 'string' && BOX_KINDS.includes(b['kind'] as PageLayoutBoxKind)
    && isFiniteNum(b['x']) && isFiniteNum(b['y']) && isFiniteNum(b['w']) && isFiniteNum(b['h']);
}
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && isFinite(v);
const BOX_KINDS: PageLayoutBoxKind[] = ['table', 'chart', 'analyzer', 'signatures', 'notes'];

/** Immutable: the section array with the page-layout section replaced (or
 *  added, in first-position-after-grid order — it does not affect normal
 *  print order since the renderer special-cases it entirely). */
export function writePageLayout(
  sections: ReadonlyArray<ReportSection>,
  cfg: Pick<PageLayoutSection, 'enabled' | 'boxes'>,
): ReportSection[] {
  const existing = sections.find(isPageLayoutSection);
  const next: PageLayoutSection = {
    id: existing?.id ?? 'page-layout',
    type: PAGE_LAYOUT_SECTION_TYPE,
    order: existing?.order ?? (Math.max(0, ...sections.map(s => (s as { order?: number }).order ?? 0)) + 1),
    v: 1,
    enabled: cfg.enabled,
    boxes: cfg.boxes,
  };
  return existing
    ? sections.map(s => (isPageLayoutSection(s) ? next : s))
    : [...sections, next];
}

// ── body area geometry ───────────────────────────────────────────────────

export interface BodyArea { top: number; bottom: number; left: number; right: number; w: number; h: number; }

/** The editable BODY rectangle (pt) — below the letterhead's resolved
 *  `bodyTop`, above the footer/signature reserve `footerTop`. Both come from
 *  the SAME resolved header layout + footerFloor the real PDF uses (no
 *  second geometry — report-header-layout.ts / report-pdf.ts). */
export function bodyArea(bodyTop: number, footerTop: number): BodyArea {
  return { top: bodyTop, bottom: footerTop, left: MARGIN_X, right: PAGE.w - MARGIN_X, w: PAGE.w - 2 * MARGIN_X, h: Math.max(0, footerTop - bodyTop) };
}

// ── CBC default layout ───────────────────────────────────────────────────

/** The shipped default for the CBC profile (master catalogue only — a
 *  tenant's own CBC never gets this pushed onto it; "Restore to default"
 *  pulls it explicitly). Table on the left (~60%), the 4 M51 images stacked
 *  on the right, signatures across the bottom. All sizes in mm from the
 *  body area's own top-left — the designer/renderer re-anchors them to
 *  wherever the body actually starts on a given template. */
export function defaultCbcLayout(body: BodyArea): PageLayoutBox[] {
  const wMm = ptToMm(body.w), hMm = ptToMm(body.h);
  const gapMm = 4;
  const sigHMm = 24;
  const tableW = Math.round(wMm * 0.6 * 10) / 10;
  const rightX = tableW + gapMm;
  const rightW = Math.max(20, wMm - tableW - gapMm);
  const topH = Math.max(10, hMm - sigHMm - gapMm);
  const imgH = Math.max(10, (topH - gapMm * 3) / 4);
  const boxes: PageLayoutBox[] = [
    {
      id: 'table', kind: 'table', x: 0, y: 0, w: tableW, h: topH,
      fontSize: DEFAULT_BODY_FONT_PT,
      columns: [
        { name: 'name', visible: true, width: 34 }, { name: 'result', visible: true, width: 16 },
        { name: 'unit', visible: true, width: 10 }, { name: 'range', visible: true, width: 24 },
        { name: 'specimen', visible: false }, { name: 'method', visible: false },
      ],
    },
    ...KNOWN_ANALYZER_IMAGES.map((img, i): PageLayoutBox => ({
      id: `analyzer-${img.code}`, kind: 'analyzer', ref: img.code, label: img.label,
      x: rightX, y: i * (imgH + gapMm), w: rightW, h: imgH,
    })),
    { id: 'signatures', kind: 'signatures', x: 0, y: topH + gapMm, w: wMm, h: sigHMm },
  ];
  return boxes;
}

// ── mutation helpers (mm-based; reuse the letterhead editor's snap math) ──

/** Clamp a box fully inside the body rect (used after drag/nudge/resize so a
 *  box can approach but never leave the printable body area by a stray px). */
function clampBox(b: PageLayoutBox, body: BodyArea): PageLayoutBox {
  const bw = Math.min(b.w, ptToMm(body.w)), bh = Math.min(b.h, ptToMm(body.h));
  const x = Math.min(Math.max(0, b.x), ptToMm(body.w) - bw);
  const y = Math.min(Math.max(0, b.y), ptToMm(body.h) - bh);
  return { ...b, x: round1(x), y: round1(y), w: round1(bw), h: round1(bh) };
}
const round1 = (n: number) => Math.round(n * 100) / 100;

/** Drag a box to a new top-left (mm, relative to the body origin). X snaps
 *  to the page's margin/centre guides (translated into the body's own
 *  coordinate space) exactly like a letterhead element being dragged. */
export function moveBox(boxes: PageLayoutBox[], id: string, xMm: number, yMm: number, body: BodyArea): { boxes: PageLayoutBox[]; guide: number | null } {
  const b = boxes.find(x => x.id === id);
  if (!b) return { boxes, guide: null };
  const pageLeftPt = body.left + mmToPt(xMm);
  const snapped = snapBoxX(pageLeftPt, mmToPt(b.w));
  const xSnapped = ptToMm(snapped.left - body.left);
  const next = clampBox({ ...b, x: xSnapped, y: yMm }, body);
  return { boxes: boxes.map(x => (x.id === id ? next : x)), guide: snapped.guide };
}

/** Arrow-key nudge (mm step). A move that would carry an edge across the
 *  margin/centre line stops exactly on it, like the letterhead editor. */
export function nudgeBox(boxes: PageLayoutBox[], id: string, dxMm: number, dyMm: number, body: BodyArea): { boxes: PageLayoutBox[]; guide: number | null } {
  const b = boxes.find(x => x.id === id);
  if (!b) return { boxes, guide: null };
  const fromPt = body.left + mmToPt(b.x), toPt = fromPt + mmToPt(dxMm);
  const snapped = dxMm ? nudgeSnapX(fromPt, toPt, mmToPt(b.w)) : { left: fromPt, guide: null };
  const next = clampBox({ ...b, x: ptToMm(snapped.left - body.left), y: b.y + dyMm }, body);
  return { boxes: boxes.map(x => (x.id === id ? next : x)), guide: snapped.guide };
}

/** Resize (drag a handle) — width/height only; position unchanged. */
export function resizeBox(boxes: PageLayoutBox[], id: string, wMm: number, hMm: number, body: BodyArea): PageLayoutBox[] {
  const b = boxes.find(x => x.id === id);
  if (!b) return boxes;
  const next = clampBox({ ...b, w: Math.max(10, wMm), h: Math.max(8, hMm) }, body);
  return boxes.map(x => (x.id === id ? next : x));
}

export function removeBox(boxes: PageLayoutBox[], id: string): PageLayoutBox[] {
  return boxes.filter(b => b.id !== id);
}

export function addAnalyzerSlot(boxes: PageLayoutBox[], code: string, body: BodyArea): PageLayoutBox[] {
  const id = `analyzer-${code}`;
  if (boxes.some(b => b.id === id)) return boxes;
  const w = Math.min(50, ptToMm(body.w) * 0.3), h = Math.min(40, ptToMm(body.h) * 0.2);
  return [...boxes, { id, kind: 'analyzer', ref: code, label: analyzerLabel(code), x: 0, y: 0, w, h }];
}

// ── column visibility / width (table box) ────────────────────────────────

export function setColumnVisible(boxes: PageLayoutBox[], tableId: string, name: string, visible: boolean): PageLayoutBox[] {
  return boxes.map(b => {
    if (b.id !== tableId || b.kind !== 'table') return b;
    const cols = (b.columns ?? []).map(c => (c.name === name ? { ...c, visible } : c));
    return { ...b, columns: cols.some(c => c.name === name) ? cols : [...cols, { name, visible }] };
  });
}

export function setColumnWidth(boxes: PageLayoutBox[], tableId: string, name: string, width: number): PageLayoutBox[] {
  return boxes.map(b => {
    if (b.id !== tableId || b.kind !== 'table') return b;
    return { ...b, columns: (b.columns ?? []).map(c => (c.name === name ? { ...c, width: Math.max(5, Math.round(width)) } : c)) };
  });
}

// ── issue detection (overlap / out-of-body) ──────────────────────────────

export interface PageLayoutIssue {
  boxId: string;
  kind: 'overlap' | 'out_of_body' | 'missing_graph';
  level: 'warn' | 'info';
  message: string;
}

/** Pixel-space (pt) rect of a box, given the body origin. */
function boxRectPt(b: PageLayoutBox, body: BodyArea) {
  return { x: body.left + mmToPt(b.x), y: body.top + mmToPt(b.y), w: mmToPt(b.w), h: mmToPt(b.h) };
}

/** What will print badly: two boxes overlapping, or a box that runs outside
 *  the editable body area (over the letterhead, over the footer, or off the
 *  page). Pure — same shape as the letterhead editor's detectIssues(). */
export function detectLayoutIssues(boxes: PageLayoutBox[], body: BodyArea): PageLayoutIssue[] {
  const out: PageLayoutIssue[] = [];
  const label = (b: PageLayoutBox) => b.label ?? (b.kind === 'table' ? 'Results table' : b.kind === 'signatures' ? 'Signatures' : b.kind);
  for (const b of boxes) {
    const r = boxRectPt(b, body);
    if (r.x < body.left - 0.5 || r.x + r.w > body.right + 0.5 || r.y < body.top - 0.5 || r.y + r.h > body.bottom + 0.5) {
      out.push({ boxId: b.id, kind: 'out_of_body', level: 'warn', message: `${label(b)} runs outside the printable body area.` });
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], c = boxes[j];
      const ov = intersectBox(boxRectPt(a, body), boxRectPt(c, body));
      if (ov.w > 2 && ov.h > 2) out.push({ boxId: c.id, kind: 'overlap', level: 'warn', message: `${label(c)} overlaps ${label(a)}.` });
    }
  }
  return out;
}

// ── missing analyzer image → collapse (owner decision 2) ─────────────────

/** `availableCodes` = instrument image codes actually attached for this
 *  sample/preview. An analyzer box whose code isn't among them is HIDDEN
 *  (never an empty frame); when that empties out every chart/analyzer box,
 *  the table box reclaims the whole body width. Partial collapse (some
 *  analyzer boxes still have images) leaves the remaining layout as the lab
 *  arranged it — only a FULL collapse reclaims space, so a deliberately
 *  spaced-out partial arrangement is never second-guessed. */
export function collapseMissingAnalyzerBoxes(
  boxes: PageLayoutBox[], availableCodes: ReadonlySet<string>, body: BodyArea,
): { boxes: PageLayoutBox[]; hiddenIds: string[] } {
  const hiddenIds: string[] = [];
  const kept = boxes.filter(b => {
    if (b.kind !== 'analyzer') return true;
    const have = !!b.ref && availableCodes.has(b.ref);
    if (!have) hiddenIds.push(b.id);
    return have;
  });
  const table = kept.find(b => b.kind === 'table');
  const othersVisible = kept.some(b => b.kind === 'chart' || b.kind === 'analyzer');
  if (table && !othersVisible && hiddenIds.length > 0) {
    const expanded = { ...table, w: ptToMm(body.w) };
    return { boxes: kept.map(b => (b === table ? expanded : b)), hiddenIds };
  }
  return { boxes: kept, hiddenIds };
}

/** For the result-entry / validation screen: "Analyzer graphs not received"
 *  warning when the layout EXPECTS graphs that aren't attached yet. */
export function missingAnalyzerWarning(boxes: PageLayoutBox[], availableCodes: ReadonlySet<string>): PageLayoutIssue[] {
  return boxes
    .filter(b => b.kind === 'analyzer' && b.ref && !availableCodes.has(b.ref))
    .map(b => ({ boxId: b.id, kind: 'missing_graph' as const, level: 'info' as const,
      message: `${b.label ?? analyzerLabel(b.ref ?? '')} not received from the analyzer yet.` }));
}

// ── fit meter (owner decision 1) ─────────────────────────────────────────

export interface FitMeter {
  fits: boolean;
  /** The font size (pt) the table would need to use to fit, clamped to
   *  MIN_BODY_FONT_PT. Equal to the box's configured size when it already fits. */
  shrinkToPt: number;
  /** True only when even MIN_BODY_FONT_PT isn't enough — the real PDF then
   *  flows the remainder onto a second page (never cuts results). */
  overflowsToPage2: boolean;
  estimatedRows: number;
}

/** Rough but stable row-height model, matching the report table's own
 *  typesetting closely enough for a live "will it fit" meter: line height is
 *  ~1.5x the font size + fixed cell padding; a value's note/description, if
 *  wrapped, is charged as the main CBC default has none — callers passing a
 *  true `extraWrappedLines` get a closer estimate for notes-heavy profiles. */
export function fitMeter(rowCount: number, tableBoxHeightPt: number, fontPt: number, extraWrappedLines = 0): FitMeter {
  const padding = 10; // header row + top/bottom cell padding, pt
  const rowH = (size: number) => size * 1.5;
  const estimate = (size: number) => padding + rowCount * rowH(size) + extraWrappedLines * size * 1.3;
  if (estimate(fontPt) <= tableBoxHeightPt) {
    return { fits: true, shrinkToPt: fontPt, overflowsToPage2: false, estimatedRows: rowCount };
  }
  // Binary-search the largest font (0.5pt steps) down to the minimum that fits.
  let lo = MIN_BODY_FONT_PT, hi = fontPt, best = MIN_BODY_FONT_PT;
  for (let i = 0; i < 20 && hi - lo > 0.05; i++) {
    const mid = (lo + hi) / 2;
    if (estimate(mid) <= tableBoxHeightPt) { best = mid; lo = mid; } else hi = mid;
  }
  const fitsAtMin = estimate(MIN_BODY_FONT_PT) <= tableBoxHeightPt;
  return {
    fits: fitsAtMin,
    shrinkToPt: Math.max(MIN_BODY_FONT_PT, Math.round(best * 2) / 2),
    overflowsToPage2: !fitsAtMin,
    estimatedRows: rowCount,
  };
}

export { MM, PAGE, MARGIN_X };
