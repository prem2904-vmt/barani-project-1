import type { ServiceId } from '../../../../core/services/service-shelf';
import { foldSteps } from '../../../../shared/utils/work-grid';
import { type SectionColPlan, sectionPlan } from '../work-view/sections';

/**
 * The flow grid NEVER scrolls sideways (owner 2026-11-21). Columns have minimum widths; as the grid narrows, steps
 * fold in this order until the minimums fit (shared `foldSteps`):
 *   1. pay   — Payment rides the patient line
 *   2. wait  — Waiting rides the Where cell (second line, rose when late)
 *   3. token — the token becomes a small chip before the name
 *   4. ring  — the Journey column shrinks to a 32px ring (header kept)
 *   5. tight — Patient / Where / Next at their floor (pills wrap by whole words; the action never clips)
 * A per-service SECTION first drops its own low-value columns (sections.ts `sectionPlan`), then 3–5.
 */
export type FlowFoldStep = 'pay' | 'wait' | 'token' | 'ring' | 'tight';

export const FLOW_MIN = {
  sel: 52, token: 100, patient: 220, patientTight: 132, ring: 80, ringSmall: 56,
  where: 170, whereTight: 120, wait: 112, pay: 110, next: 156, nextTight: 140,
};
/** Room for the grid's own chrome (vertical scrollbar, borders). */
export const FLOW_SLACK = 16;

export interface FlowLayout {
  fold: Set<FlowFoldStep>;
  /** A section's own middle columns (null = the one-table grid's Where · Waiting · Payment). */
  own: SectionColPlan[] | null;
  /** Sum of the visible columns' minimum widths. */
  need: number;
}

const has = (s: Set<FlowFoldStep>, k: FlowFoldStep) => s.has(k);

/** Fixed columns' minimum widths under a fold. */
function fixedNeed(f: Set<FlowFoldStep>, selecting: boolean, tokenW: number = FLOW_MIN.token): number {
  return (selecting ? FLOW_MIN.sel : 0) + (has(f, 'token') ? 0 : tokenW)
    + (has(f, 'tight') ? FLOW_MIN.patientTight : FLOW_MIN.patient)
    + (has(f, 'ring') ? FLOW_MIN.ringSmall : FLOW_MIN.ring)
    + (has(f, 'tight') ? FLOW_MIN.nextTight : FLOW_MIN.next);
}

/** The Token column's width for the labels it holds ("12", "12 · 20 Nov", "R-14"): 92px floor (the header + its filter icon). */
export function tokenWidth(labels: readonly string[]): number {
  const n = Math.max(0, ...labels.map(l => l.length));
  return Math.max(FLOW_MIN.token, Math.ceil(30 + n * 7.6));
}

export function flowLayout(width: number, opts: { selecting?: boolean; service?: ServiceId | null; tokenW?: number } = {}): FlowLayout {
  const selecting = !!opts.selecting;
  const tw = opts.tokenW ?? FLOW_MIN.token;
  if (!opts.service) {
    const base = fixedNeed(new Set(), selecting, tw) + FLOW_MIN.where + FLOW_MIN.wait + FLOW_MIN.pay;
    const tightSaves = (FLOW_MIN.patient - FLOW_MIN.patientTight) + (FLOW_MIN.where - FLOW_MIN.whereTight) + (FLOW_MIN.next - FLOW_MIN.nextTight);
    const fold = foldSteps<FlowFoldStep>(width, base, [
      { id: 'pay', saves: FLOW_MIN.pay }, { id: 'wait', saves: FLOW_MIN.wait }, { id: 'token', saves: tw },
      { id: 'ring', saves: FLOW_MIN.ring - FLOW_MIN.ringSmall }, { id: 'tight', saves: tightSaves },
    ], FLOW_SLACK);
    const need = fixedNeed(fold, selecting, tw) + (has(fold, 'tight') ? FLOW_MIN.whereTight : FLOW_MIN.where)
      + (has(fold, 'wait') ? 0 : FLOW_MIN.wait) + (has(fold, 'pay') ? 0 : FLOW_MIN.pay);
    return { fold, own: null, need };
  }
  // A section: drop its own columns against the full fixed set, then fold the fixed ones.
  const fixed0 = fixedNeed(new Set(), selecting, tw);
  const own = sectionPlan(opts.service, width - FLOW_SLACK - fixed0).cols;
  const ownMin = (o: readonly SectionColPlan[], tight: boolean) =>
    o.reduce((s, c) => s + (tight && c.id === 'where' ? FLOW_MIN.whereTight : c.min), 0);
  const fold = new Set<FlowFoldStep>();
  if (!own.some(c => c.id === 'pay')) fold.add('pay');
  if (!own.some(c => c.id === 'wait')) fold.add('wait');
  const tail: FlowFoldStep[] = ['token', 'ring', 'tight'];
  const needOf = () => fixedNeed(fold, selecting, tw) + ownMin(own, has(fold, 'tight'));
  for (const st of tail) {
    if (width >= needOf() + FLOW_SLACK) break;
    fold.add(st);
  }
  return { fold, own, need: needOf() };
}
