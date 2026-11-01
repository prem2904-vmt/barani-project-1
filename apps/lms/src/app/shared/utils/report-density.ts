import type { TypeEl } from './report-theme';

/**
 * REPORT DENSITY — a token OVERLAY on the type theme (report layout plan §3.6).
 *
 * Normal is today's paper (every value below equals the number that used to be
 * written at the draw site, so a template that never opts in prints byte-
 * identically). Compact tightens the vertical rhythm by about 18 percent:
 * slimmer cell padding, a slim department caption instead of the full band, the
 * Method / Specimen lines inline after the test name, notes at 8 pt, a closer
 * sign-off and three trend charts to a row. Relaxed is the opposite (+10).
 *
 * Pure data + two pure helpers (the squeeze decision), no jsPDF, no DI.
 */

export type DensityId = 'normal' | 'compact' | 'relaxed';

export interface DensityTokens {
  id: DensityId;
  /** Top and bottom padding of a results-table body cell (pt). */
  padV: number;
  /** Column-header padding (pt). */
  head: { top: number; bottom: number };
  /** Padding of the Method / Specimen sub-line rows of a split-sub-line theme (pt). */
  subPadV: number;
  /** Extra height under a technician note's text (pt). */
  techPad: number;
  /** A larger note face is capped at this size (pt). Never applied to a result. */
  sizeCap: Readonly<Partial<Record<TypeEl, number>>>;
  /** Air above a department heading (pt). */
  deptLead: number;
  /** A slim left-rule caption instead of the full band with its underline. */
  slimDept: boolean;
  /** Method / Specimen / Tested-at print on the panel's own band (or after a
   *  single test's name) when they fit - never when they would be cut. */
  inlineMethod: boolean;
  /** Gap between the patient strip and the first results (pt). */
  afterStrip: number;
  /** Sign-off rhythm: air above the image row and under the last baseline (pt). */
  sig: { lead: number; tail: number };
  /** Trend charts per row. */
  trendPerRow: 2 | 3;
}

const NOTE_CAP = 8;

export const DENSITY: Readonly<Record<DensityId, DensityTokens>> = Object.freeze({
  normal: {
    id: 'normal', padV: 4, head: { top: 3, bottom: 6 }, subPadV: 2, techPad: 8, sizeCap: {},
    deptLead: 4, slimDept: false, inlineMethod: false, afterStrip: 14, sig: { lead: 10, tail: 7 }, trendPerRow: 2,
  },
  compact: {
    id: 'compact', padV: 2.3, head: { top: 2, bottom: 4 }, subPadV: 1, techPad: 5,
    sizeCap: { note: NOTE_CAP, techNote: NOTE_CAP, description: NOTE_CAP, interpretation: NOTE_CAP, interpretationLabel: NOTE_CAP, narrativeMerged: NOTE_CAP },
    deptLead: 2, slimDept: true, inlineMethod: true, afterStrip: 8, sig: { lead: 6, tail: 4 }, trendPerRow: 3,
  },
  relaxed: {
    id: 'relaxed', padV: 4.9, head: { top: 3.3, bottom: 6.6 }, subPadV: 2.2, techPad: 9, sizeCap: {},
    deptLead: 4, slimDept: false, inlineMethod: false, afterStrip: 15, sig: { lead: 11, tail: 8 }, trendPerRow: 2,
  },
}) as Record<DensityId, DensityTokens>;

export function densityTokens(id: string | null | undefined): DensityTokens {
  return DENSITY[(id as DensityId) in DENSITY ? (id as DensityId) : 'normal'];
}

/** Squeezing is only attempted when the last page holds this share (or less) of a page. */
export const SQUEEZE_MAX_OVERFLOW = 0.12;
/** The last resort after Compact: every body face x 0.95 (never under the fit floor). */
export const SQUEEZE_SCALE = 0.95;

/** What a squeeze attempt did - for the designer's chip and the specs. */
export interface SqueezeReport {
  /** The final paper is the squeezed one. */
  applied: boolean;
  /** Pages before / after. */
  pagesBefore: number;
  pagesAfter: number;
  /** How much of the last page the overflow filled (0..1). */
  overflow: number;
  /** What it took: 'compact', 'compact+scale', or '' when nothing was changed. */
  by: '' | 'compact' | 'scale' | 'compact+scale';
  /** Why nothing was attempted / kept (plain words), when `applied` is false. */
  reason?: 'one-page' | 'too-long' | 'no-gain';
}

/** May a report of `pages` pages whose last page is `overflow` full be squeezed? */
export function squeezeEligible(pages: number, overflow: number): boolean {
  return pages >= 2 && overflow > 0 && overflow <= SQUEEZE_MAX_OVERFLOW;
}

/** The size a body face prints at under a squeeze: x0.95, but never under the
 *  fit floor (and a face already under the floor is left alone). */
export function squeezedSize(size: number, scale: number, floorPt: number): number {
  if (scale >= 1) return size;
  return Math.min(size, Math.max(floorPt, size * scale));
}

/** The designer's plain-words note about what the squeeze did to its sample report. */
export function squeezeMessage(q: SqueezeReport | null): string {
  if (!q) return '';
  if (q.applied) return `Squeezed to ${q.pagesAfter} ${q.pagesAfter === 1 ? 'page' : 'pages'} (was ${q.pagesBefore}) on the sample report.`;
  if (q.reason === 'one-page') return 'The sample report already fits one page.';
  if (q.reason === 'too-long') return 'The sample report runs too far over to squeeze, so it prints as normal.';
  return 'Squeezing would not save a page on the sample report, so it prints as normal.';
}
