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

/** Where the designer/preview's SAMPLE graph for an image code lives — a
 *  generic, synthetic look-alike of the analyzer's own graph (no patient
 *  data; `public/assets/analyzer-samples/`). Codes without a known look get
 *  a neutral stand-in curve. Never used for a real report: a real report
 *  prints the attachment the analyzer actually sent. */
export function analyzerSampleAsset(code: string): string {
  return KNOWN_ANALYZER_IMAGES.some(i => i.code === code)
    ? `assets/analyzer-samples/m51-${code}.png`
    : 'assets/analyzer-samples/generic.png';
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
export const BOX_KINDS: PageLayoutBoxKind[] = ['table', 'chart', 'analyzer', 'signatures', 'notes'];

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

/** The catalogue CBC Basic (HEM001) profile's own parameter count — used
 *  ONLY to size the SHIPPED default layout's table/graph boxes to their
 *  natural content height (never a lab's own saved arrangement, which keeps
 *  whatever height it was dragged to). Kept as a named constant rather than
 *  re-deriving it from the catalogue at layout-build time — this file has no
 *  access to the resolved row count, only the body's geometry. */
const CBC_DEFAULT_ROW_COUNT = 14;

/** Same row-height model `fitMeter` scores a box against, factored out so
 *  the "does it fit" check and the shipped default's own sizing can never
 *  silently diverge. */
function estimateTableHeightPt(rowCount: number, fontPt: number, extraWrappedLines = 0): number {
  const padding = 10; // header row + top/bottom cell padding, pt
  return padding + rowCount * fontPt * 1.5 + extraWrappedLines * fontPt * 1.3;
}

/** The shipped default for the CBC profile (master catalogue only — a
 *  tenant's own CBC never gets this pushed onto it; "Restore to default"
 *  pulls it explicitly). Table + a 2x2 analyzer-image grid side by side,
 *  BOTH sized to the profile's own natural content height (owner,
 *  2026-10-02: a box sized to the full body leaves most of itself blank —
 *  "no large empty block"), with signatures below and a reserved gap sized
 *  for the "****End of Report****" line so a CBC-only order still closes
 *  on the SAME page. All sizes in mm from the body area's own top-left —
 *  the designer/renderer re-anchors them to wherever the body actually
 *  starts on a given template. */
export function defaultCbcLayout(body: BodyArea): PageLayoutBox[] {
  const wMm = ptToMm(body.w), hMm = ptToMm(body.h);
  const gapMm = 4;
  const sigHMm = 24;
  // Room for the End-of-Report line printed between the content and the
  // signatures (report-pdf.ts's own general floor reserve is 26pt).
  const eorGapMm = ptToMm(30);
  const reserveBelowContent = gapMm + eorGapMm;
  const availableForContent = Math.max(20, hMm - sigHMm - reserveBelowContent);

  const tableW = Math.round(wMm * 0.58 * 10) / 10;
  const rightX = tableW + gapMm;
  const rightW = Math.max(20, wMm - tableW - gapMm);

  const desiredContentMm = ptToMm(estimateTableHeightPt(CBC_DEFAULT_ROW_COUNT, DEFAULT_BODY_FONT_PT) + 14);
  const contentHMm = Math.min(desiredContentMm, availableForContent);
  // The 2x2 image grid sits "beside the table height plus a little".
  const gridHMm = Math.min(contentHMm + 6, availableForContent);
  const blockHMm = Math.max(contentHMm, gridHMm);
  const cellWMm = Math.max(18, (rightW - gapMm) / 2);
  const cellHMm = Math.max(14, (gridHMm - gapMm) / 2);
  const sigY = blockHMm + reserveBelowContent;

  const boxes: PageLayoutBox[] = [
    {
      id: 'table', kind: 'table', x: 0, y: 0, w: tableW, h: contentHMm,
      fontSize: DEFAULT_BODY_FONT_PT,
      columns: [
        { name: 'name', visible: true, width: 34 }, { name: 'result', visible: true, width: 16 },
        { name: 'unit', visible: true, width: 10 }, { name: 'range', visible: true, width: 24 },
        { name: 'specimen', visible: false }, { name: 'method', visible: false },
      ],
    },
    ...KNOWN_ANALYZER_IMAGES.map((img, i): PageLayoutBox => ({
      id: `analyzer-${img.code}`, kind: 'analyzer', ref: img.code, label: img.label,
      x: rightX + (i % 2) * (cellWMm + gapMm), y: Math.floor(i / 2) * (cellHMm + gapMm),
      w: cellWMm, h: cellHMm,
    })),
    { id: 'signatures', kind: 'signatures', x: 0, y: sigY, w: wMm, h: sigHMm },
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
  const label = (b: PageLayoutBox) => boxLabel(b);
  boxes = boxes.filter(b => !b.hidden);
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
  const estimate = (size: number) => estimateTableHeightPt(rowCount, size, extraWrappedLines);
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

// ═══════════════════════════════════════════════════════════════════════
// v2 (owner review 2026-10-02): a default for ANY profile, CBC-family
// matching, free-box editing (8 resize handles, edge snapping to the body
// and to the other boxes), a palette that adds boxes into free space, and
// show/hide per box.
// ═══════════════════════════════════════════════════════════════════════

/** The catalogue keys a CBC profile's members carry (Hb, RBC, TLC, PLT) —
 *  three of these four on a profile's members marks it CBC-family, however
 *  the tenant keyed or named the profile itself. */
const CBC_ANCHOR_KEYS = ['HEM011', 'HEM012', 'HEM019', 'HEM030'];
const CBC_PROFILE_KEYS = ['HEM001', 'HEM002'];

/** Is this profile a CBC (complete blood count) — by its own catalogue key
 *  (CBC Basic HEM001 / CBC Comprehensive HEM002), else by its MEMBERS'
 *  keys (any lab-made CBC of the same analytes), else by name as the last
 *  resort ("CBC", "Complete blood count", "Haemogram"). */
export function isCbcFamily(p: { catalogKey?: string | null; name?: string | null; memberKeys?: ReadonlyArray<string | null | undefined> }): boolean {
  const key = (p.catalogKey ?? '').trim().toUpperCase();
  if (CBC_PROFILE_KEYS.includes(key)) return true;
  const members = new Set((p.memberKeys ?? []).map(k => (k ?? '').trim().toUpperCase()).filter(Boolean));
  if (CBC_ANCHOR_KEYS.filter(k => members.has(k)).length >= 3) return true;
  return /\b(cbc|complete blood count|ha?emogram)\b/i.test(p.name ?? '');
}

export interface DefaultLayoutInput {
  body: BodyArea;
  /** Rows the table will print (members' values + notes) — sizes the table box. */
  rowCount: number;
  /** Analyzer image codes to place (linked instrument images; CBC-family
   *  profiles fall back to the 4 M51 graphs). Empty = no image boxes. */
  analyzerCodes: ReadonlyArray<string>;
  /** The profile's report-chart blocks (section ids) — each gets a box, so
   *  turning the layout on never silently drops a chart the lab built. */
  chartIds?: ReadonlyArray<{ id: string; label?: string | null }>;
  labelFor?: (code: string) => string;
}

/**
 * The sensible starting arrangement for ANY profile (owner 2026-10-02:
 * "opening the designer with no saved layout must start from a sensible
 * default"): the results table (sized to its rows), the profile's charts and
 * analyzer graphs in a 2-column grid beside it, the department signatures
 * below. With nothing to put beside it the table takes the full width.
 * All mm, relative to the body's top-left.
 */
export function buildDefaultLayout(input: DefaultLayoutInput): PageLayoutBox[] {
  const { body } = input;
  const wMm = round1(ptToMm(body.w)), hMm = ptToMm(body.h);
  const gap = 4, sigH = 24;
  const eorGap = ptToMm(30);
  const avail = Math.max(30, hMm - sigH - gap - eorGap);
  const side: Array<Omit<PageLayoutBox, 'x' | 'y' | 'w' | 'h'>> = [
    ...(input.chartIds ?? []).map(c => ({ id: `chart-${c.id}`, kind: 'chart' as const, ref: c.id, label: c.label || 'Chart' })),
    ...input.analyzerCodes.map(code => ({
      id: `analyzer-${code}`, kind: 'analyzer' as const, ref: code,
      label: input.labelFor ? input.labelFor(code) : analyzerLabel(code),
    })),
  ];
  const tableNatural = ptToMm(estimateTableHeightPt(Math.max(1, input.rowCount), DEFAULT_BODY_FONT_PT) + 14);
  const tableW = side.length ? round1(wMm * 0.58) : wMm;
  const tableH = round1(Math.min(avail, Math.max(30, tableNatural)));
  const boxes: PageLayoutBox[] = [{
    id: 'table', kind: 'table', x: 0, y: 0, w: tableW, h: tableH, fontSize: DEFAULT_BODY_FONT_PT,
    columns: [
      { name: 'name', visible: true, width: 34 }, { name: 'result', visible: true, width: 16 },
      { name: 'unit', visible: true, width: 10 }, { name: 'range', visible: true, width: 24 },
      { name: 'specimen', visible: false }, { name: 'method', visible: false },
    ],
  }];
  let bottom = tableH;
  if (side.length) {
    const rightX = tableW + gap, rightW = wMm - rightX;
    const cols = side.length === 1 ? 1 : 2;
    const cellW = round1((rightW - gap * (cols - 1)) / cols);
    // Graphs keep the analyzer's own ~4:3 look; the grid never runs past the body.
    const rows = Math.ceil(side.length / cols);
    const cellH = round1(Math.max(14, Math.min(cellW * 0.78, (avail - gap * (rows - 1)) / rows)));
    side.forEach((b, i) => {
      boxes.push({ ...b, x: round1(rightX + (i % cols) * (cellW + gap)), y: round1(Math.floor(i / cols) * (cellH + gap)), w: cellW, h: cellH });
    });
    bottom = Math.max(bottom, rows * cellH + (rows - 1) * gap);
  }
  const sigY = round1(Math.min(bottom + gap + eorGap, hMm - sigH));
  boxes.push({ id: 'signatures', kind: 'signatures', x: 0, y: Math.max(0, sigY), w: wMm, h: sigH });
  return boxes;
}

// ── free placement (palette adds) ────────────────────────────────────────

/** The first free top-left (mm) where a w×h box fits without overlapping any
 *  visible box — scanning top-to-bottom, left-to-right on a 2 mm grid; the
 *  body's top-left when the page is full (the issue list then flags it). */
export function findFreeSpot(boxes: ReadonlyArray<PageLayoutBox>, w: number, h: number, body: BodyArea): { x: number; y: number } {
  const W = ptToMm(body.w), H = ptToMm(body.h);
  const others = boxes.filter(b => !b.hidden);
  const hit = (x: number, y: number) => others.some(b => x < b.x + b.w + 1 && x + w + 1 > b.x && y < b.y + b.h + 1 && y + h + 1 > b.y);
  for (let y = 0; y + h <= H + 0.01; y += 2) {
    for (let x = 0; x + w <= W + 0.01; x += 2) if (!hit(x, y)) return { x: round1(x), y: round1(y) };
  }
  return { x: 0, y: 0 };
}

let boxSeq = 0;
/** A fresh unique box id with a readable prefix. */
export function newBoxId(prefix: string, boxes: ReadonlyArray<PageLayoutBox>): string {
  let id = prefix;
  while (boxes.some(b => b.id === id)) id = `${prefix}-${(++boxSeq).toString(36)}`;
  return id;
}

/** Palette add: a new box of `kind` at its natural size, dropped into the
 *  first free spot. Analyzer / chart boxes are unique per ref (adding one
 *  that's already there just un-hides it). Returns the boxes + the new id. */
export function addPaletteBox(
  boxes: PageLayoutBox[], kind: PageLayoutBoxKind, body: BodyArea,
  opts: { ref?: string | null; label?: string | null; text?: string | null } = {},
): { boxes: PageLayoutBox[]; id: string } {
  const existing = (kind === 'analyzer' || kind === 'chart') && opts.ref
    ? boxes.find(b => b.kind === kind && b.ref === opts.ref)
    : (kind === 'table' || kind === 'signatures') ? boxes.find(b => b.kind === kind) : undefined;
  if (existing) return { boxes: boxes.map(b => (b === existing ? { ...b, hidden: false } : b)), id: existing.id };
  const W = ptToMm(body.w), H = ptToMm(body.h);
  const size: Record<PageLayoutBoxKind, [number, number]> = {
    table: [Math.min(110, W), Math.min(90, H)],
    chart: [Math.min(90, W), Math.min(55, H)],
    analyzer: [Math.min(38, W), Math.min(30, H)],
    signatures: [W, Math.min(24, H)],
    notes: [Math.min(90, W), Math.min(18, H)],
  };
  const [w, h] = size[kind];
  const spot = findFreeSpot(boxes, w, h, body);
  const prefix = kind === 'analyzer' ? `analyzer-${opts.ref ?? 'img'}` : kind === 'chart' ? `chart-${opts.ref ?? 'new'}` : kind;
  const id = newBoxId(prefix, boxes);
  const box: PageLayoutBox = { id, kind, x: spot.x, y: spot.y, w: round1(w), h: round1(h) };
  if (opts.ref) box.ref = opts.ref;
  if (opts.label) box.label = opts.label;
  if (kind === 'notes') box.text = opts.text ?? '';
  if (kind === 'table') box.fontSize = DEFAULT_BODY_FONT_PT;
  return { boxes: [...boxes, box], id };
}

export function setBoxHidden(boxes: PageLayoutBox[], id: string, hidden: boolean): PageLayoutBox[] {
  return boxes.map(b => (b.id === id ? { ...b, hidden: hidden || undefined } : b));
}

export function patchBox(boxes: PageLayoutBox[], id: string, patch: Partial<PageLayoutBox>): PageLayoutBox[] {
  return boxes.map(b => (b.id === id ? { ...b, ...patch } : b));
}

/** The boxes that PRINT (hidden ones are kept in the layout but skipped). */
export function printableBoxes(boxes: ReadonlyArray<PageLayoutBox>): PageLayoutBox[] {
  return boxes.filter(b => !b.hidden);
}

// ── snapping: body edges / centre + every other box's edges ──────────────

/** Snap lines (mm, body-relative) shown while dragging / resizing. */
export interface SnapGuides { v: number[]; h: number[] }

const SNAP_TOL_MM = 1.6;

function snapTargets(boxes: ReadonlyArray<PageLayoutBox>, id: string, body: BodyArea): { xs: number[]; ys: number[] } {
  const W = ptToMm(body.w), H = ptToMm(body.h);
  const xs = [0, W / 2, W], ys = [0, H];
  for (const b of boxes) {
    if (b.id === id || b.hidden) continue;
    xs.push(b.x, b.x + b.w, b.x + b.w / 2);
    ys.push(b.y, b.y + b.h, b.y + b.h / 2);
  }
  return { xs, ys };
}

/** Best snap of any of `edges` (positions of the moving box's edges, mm) to
 *  `targets`, within the tolerance. Returns the delta to apply and the line. */
function bestSnap(edges: number[], targets: number[], tol = SNAP_TOL_MM): { d: number; line: number } | null {
  let best: { d: number; line: number; abs: number } | null = null;
  for (const e of edges) for (const t of targets) {
    const d = t - e, abs = Math.abs(d);
    if (abs <= tol && (!best || abs < best.abs)) best = { d, line: t, abs };
  }
  return best ? { d: best.d, line: best.line } : null;
}

/** Drag a box to (x, y) mm — every edge AND centre snaps to the body edges,
 *  the body centre and the other boxes' edges/centres (both axes), then the
 *  box is clamped inside the body. The letterhead editor's feel, in 2-D. */
export function dragBox(
  boxes: PageLayoutBox[], id: string, xMm: number, yMm: number, body: BodyArea, snap = true,
): { boxes: PageLayoutBox[]; guides: SnapGuides } {
  const b = boxes.find(x => x.id === id);
  if (!b) return { boxes, guides: { v: [], h: [] } };
  let x = xMm, y = yMm;
  const guides: SnapGuides = { v: [], h: [] };
  if (snap) {
    const t = snapTargets(boxes, id, body);
    const sx = bestSnap([x, x + b.w / 2, x + b.w], t.xs);
    if (sx) { x += sx.d; guides.v.push(sx.line); }
    const sy = bestSnap([y, y + b.h / 2, y + b.h], t.ys);
    if (sy) { y += sy.d; guides.h.push(sy.line); }
  }
  const next = clampBox({ ...b, x, y }, body);
  return { boxes: boxes.map(o => (o.id === id ? next : o)), guides };
}

/** Which edges a resize handle moves. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const RESIZE_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_W = 10, MIN_H = 8;

/** Resize from any of the 8 handles, given the box as it was when the drag
 *  STARTED (`start`) and the pointer delta in mm. The moving edges snap like
 *  a drag; the opposite edges stay put; never below the minimum size and
 *  never outside the body. */
export function resizeFromHandle(
  boxes: PageLayoutBox[], start: PageLayoutBox, handle: ResizeHandle, dxMm: number, dyMm: number, body: BodyArea, snap = true,
): { boxes: PageLayoutBox[]; guides: SnapGuides } {
  const W = ptToMm(body.w), H = ptToMm(body.h);
  let l = start.x, r = start.x + start.w, t = start.y, btm = start.y + start.h;
  if (handle.includes('w')) l += dxMm;
  if (handle.includes('e')) r += dxMm;
  if (handle.includes('n')) t += dyMm;
  if (handle.includes('s')) btm += dyMm;
  const guides: SnapGuides = { v: [], h: [] };
  if (snap) {
    const tg = snapTargets(boxes, start.id, body);
    if (handle.includes('w')) { const s = bestSnap([l], tg.xs); if (s) { l += s.d; guides.v.push(s.line); } }
    if (handle.includes('e')) { const s = bestSnap([r], tg.xs); if (s) { r += s.d; guides.v.push(s.line); } }
    if (handle.includes('n')) { const s = bestSnap([t], tg.ys); if (s) { t += s.d; guides.h.push(s.line); } }
    if (handle.includes('s')) { const s = bestSnap([btm], tg.ys); if (s) { btm += s.d; guides.h.push(s.line); } }
  }
  l = Math.max(0, l); t = Math.max(0, t); r = Math.min(W, r); btm = Math.min(H, btm);
  if (r - l < MIN_W) { if (handle.includes('w')) l = r - MIN_W; else r = l + MIN_W; }
  if (btm - t < MIN_H) { if (handle.includes('n')) t = btm - MIN_H; else btm = t + MIN_H; }
  const next = clampBox({ ...start, x: l, y: t, w: r - l, h: btm - t }, body);
  return { boxes: boxes.map(o => (o.id === start.id ? next : o)), guides };
}

/** The label a box shows in the designer / issue list. */
export function boxLabel(b: Pick<PageLayoutBox, 'kind' | 'label' | 'ref'>): string {
  if (b.label) return b.label;
  switch (b.kind) {
    case 'table': return 'Results table';
    case 'signatures': return 'Signatures';
    case 'notes': return 'Notes';
    case 'chart': return 'Chart';
    default: return analyzerLabel(b.ref ?? '');
  }
}
