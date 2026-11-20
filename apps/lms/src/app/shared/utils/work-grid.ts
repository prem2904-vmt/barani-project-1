import { formatDuration } from './lab-priority';

/**
 * Work-list grids (owner 2026-11-20: "the grid format we had against Frontdesk and Results — touch devices get more
 * room for taps"). The pure rules My Work and the Pathologist queue share; the look lives in
 * `shared/styles/_work-grid.scss`, the row height in the shared grid theme (never per screen).
 */

/** Smallest tap target on touch (ND §1) and the room between two neighbouring controls. */
export const TOUCH_TARGET_PX = 44;
export const TOUCH_GAP_PX = 8;

/** How a row action is drawn: text on web (fine pointer + hover), a 44 px target on touch; always 8 px apart. */
export function rowActionSizing(touch: boolean): { minSize: number; gap: number } {
  return { minSize: touch ? TOUCH_TARGET_PX : 32, gap: TOUCH_GAP_PX };
}

export interface Box { left: number; right: number; top: number; bottom: number; name?: string }

/**
 * The touch rule as data: every control ≥ 44×44 and ≥ 8 px from the next control on the same line.
 * Returns the problems (empty = fine). Used by the unit specs and the screens audit.
 */
export function touchViolations(boxes: readonly Box[]): string[] {
  const out: string[] = [];
  for (const b of boxes) {
    const w = b.right - b.left, h = b.bottom - b.top;
    if (w < TOUCH_TARGET_PX - 0.5 || h < TOUCH_TARGET_PX - 0.5) out.push(`${b.name ?? 'control'} is ${Math.round(w)}×${Math.round(h)}`);
  }
  const s = [...boxes].sort((a, b) => a.left - b.left);
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i];
    const sameLine = b.top < a.bottom && b.bottom > a.top;
    if (sameLine && b.left - a.right < TOUCH_GAP_PX - 0.5) out.push(`${a.name ?? 'control'} → ${b.name ?? 'control'}: ${Math.round(b.left - a.right)}px apart`);
  }
  return out;
}

/**
 * Column tiers by the GRID's own width (My Work's pane and the Pathologist's main card change width with their side
 * panes): `full` = every column; `fold` (iPad landscape, a narrow window) = low-value columns fold into the patient /
 * tests cells so the row actions keep their full size; `tight` = only what a tech needs to pick the row.
 */
export type GridFold = 'full' | 'fold' | 'tight';
export function gridFold(width: number, full = 1040, fold = 700): GridFold {
  if (width >= full) return 'full';
  if (width >= fold) return 'fold';
  return 'tight';
}

/**
 * The tier that FITS: the widest tier whose visible columns' minimum widths (+ room for the grid's own chrome) fit the
 * grid. Fixed breakpoints drifted from the real column sums and clipped the row actions; this never can.
 */
export function fitFold(width: number, need: (f: GridFold) => number, slack = 20): GridFold {
  if (width >= need('full') + slack) return 'full';
  if (width >= need('fold') + slack) return 'fold';
  return 'tight';
}

/** Sum of the minimum widths of the columns a plan shows. */
export function minWidthOf(plan: ReadonlyArray<{ colId: string; hide: boolean }>, mins: Record<string, number>): number {
  return plan.filter(c => !c.hide).reduce((n, c) => n + (mins[c.colId] ?? 0), 0);
}

/** Status pill tones (neutral pill + a small coloured dot). No yellow: rose = late / sent back, violet = in hand. */
export type WorkTone = 'neutral' | 'violet' | 'green' | 'rose' | 'sky';
export interface WorkStatus { label: string; tone: WorkTone }

/** "40m" / "2h 5m" since an ISO time (empty when unknown). */
export function waitText(fromIso: string | null | undefined, now: number = Date.now()): string {
  const t = fromIso ? Date.parse(fromIso) : NaN;
  if (!Number.isFinite(t)) return '';
  return formatDuration(Math.max(0, (now - t) / 60000));
}

/** One step of a row's journey (done · now · late · still to come). */
export type JourneyState = 'done' | 'now' | 'late' | 'todo';
export interface JourneyStep { label: string; state: JourneyState }
