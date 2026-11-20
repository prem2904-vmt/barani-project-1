/**
 * Pill fit (owner 2026-11-20): a segmented pill group never wraps its card head onto a second row,
 * never clips a label and never scrolls sideways. When it does not fit its slot it first tightens
 * (less padding, counts kept), and when even that does not fit it collapses into ONE pill showing
 * the selected option + count + a chevron that opens a menu of the options.
 *
 *  - `full`  : the natural (roomy) width fits the slot;
 *  - `tight` : only the tightened width fits;
 *  - `menu`  : neither fits — show the selected-pill menu.
 *
 * `avail` is the width the slot gives the pill. The component keeps that number the SAME in every
 * state (in `tight` / `menu` it pins its own box to the natural width, which the flex row / max-width
 * then shrinks exactly like the full pill), so the decision can never flip-flop between states.
 */
export type PillFit = 'full' | 'tight' | 'menu';

/** Sub-pixel rounding slack (rects are fractional; a pill that "fits by 0.3px" fits). */
export const PILL_FIT_SLACK = 0.5;

export function pillFitState(avail: number, full: number, tight: number): PillFit {
  // Nothing measured (hidden, not laid out yet, a test DOM without layout): keep today's pill.
  if (!(full > 0) || !(avail > 0)) return 'full';
  if (avail + PILL_FIT_SLACK >= full) return 'full';
  const t = tight > 0 ? Math.min(tight, full) : full;
  if (avail + PILL_FIT_SLACK >= t) return 'tight';
  return 'menu';
}

/** Text the collapsed pill reads for the screen reader / title: "Completed, 17". */
export function pillFitSummary(label: string | null | undefined, count?: number | null): string {
  const l = (label ?? '').trim();
  return count === undefined || count === null ? l : `${l}, ${count}`;
}
