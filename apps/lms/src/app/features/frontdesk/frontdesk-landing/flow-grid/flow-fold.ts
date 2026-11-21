import type { ServiceId } from '../../../../core/services/service-shelf';
import { foldSteps } from '../../../../shared/utils/work-grid';
import { type SectionColPlan, sectionPlan } from '../work-view/sections';

/**
 * The flow grid NEVER scrolls sideways (owner 2026-11-21). Columns have minimum widths; as the grid narrows, steps
 * fold in this order until the minimums fit (shared `foldSteps`):
 *   1. pay   — Payment rides the patient line
 *   2. wait  — Waiting rides the Where cell (second line, rose when late)
 *   3. token — the token becomes a small chip before the name
 *   4. tight — Patient / Where now / Next at their floor (words wrap by whole words; the action never clips)
 * Where now is ONE column = the 32px journey ring + the two lines of words (owner design D, 2026-11-21) — every
 * layout and every per-service section has it. A SECTION first drops its own low-value columns (sections.ts
 * `sectionPlan`), then 3–4.
 */
export type FlowFoldStep = 'pay' | 'wait' | 'token' | 'tight';

export const FLOW_MIN = {
  sel: 52, token: 100, patient: 220, patientTight: 132,
  /** Where now: 44px ring target + 8px gap + the words (the Journey column merged in, design D). */
  where: 212, whereTight: 136, wait: 112, pay: 110, next: 156, nextTight: 140,
};
/** One floor for every service's own columns (so the fixed columns fold alike in every section). */
export const OWN_FLOOR = 130;

/** Old column ids still found in saved settings / view state → today's (the Journey column merged into Where now). */
export const FLOW_COL_ALIAS: Readonly<Record<string, string>> = { journey: 'where' };
/** A saved column id → the live one ("journey" → "where"); unknown ids pass through. */
export function flowColId(id: string): string { return FLOW_COL_ALIAS[id] ?? id; }
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
    + (has(f, 'tight') ? FLOW_MIN.whereTight : FLOW_MIN.where)
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
    const base = fixedNeed(new Set(), selecting, tw) + FLOW_MIN.wait + FLOW_MIN.pay;
    const tightSaves = (FLOW_MIN.patient - FLOW_MIN.patientTight) + (FLOW_MIN.where - FLOW_MIN.whereTight) + (FLOW_MIN.next - FLOW_MIN.nextTight);
    const fold = foldSteps<FlowFoldStep>(width, base, [
      { id: 'pay', saves: FLOW_MIN.pay }, { id: 'wait', saves: FLOW_MIN.wait }, { id: 'token', saves: tw },
      { id: 'tight', saves: tightSaves },
    ], FLOW_SLACK);
    const need = fixedNeed(fold, selecting, tw) + (has(fold, 'wait') ? 0 : FLOW_MIN.wait) + (has(fold, 'pay') ? 0 : FLOW_MIN.pay);
    return { fold, own: null, need };
  }
  // A section (owner 2026-11-21: Token · Patient · Where now · Waiting · Next sit at the SAME x in every section): the
  // fixed columns — selection, Token, Patient, Where now, Waiting, Next — fold by the WIDTH alone (+ one shared floor for
  // the service's own columns), so every section folds them alike; the service's own columns then take what is left.
  const secFixed = (f: Set<FlowFoldStep>) => fixedNeed(f, selecting, tw) + (has(f, 'wait') ? 0 : FLOW_MIN.wait);
  const tightSaves = (FLOW_MIN.patient - FLOW_MIN.patientTight) + (FLOW_MIN.where - FLOW_MIN.whereTight) + (FLOW_MIN.next - FLOW_MIN.nextTight);
  const fold = foldSteps<FlowFoldStep>(width, secFixed(new Set()) + OWN_FLOOR, [
    { id: 'wait', saves: FLOW_MIN.wait }, { id: 'token', saves: tw }, { id: 'tight', saves: tightSaves },
  ], FLOW_SLACK);
  const own = sectionPlan(opts.service, width - FLOW_SLACK - secFixed(fold)).cols;
  if (!own.some(c => c.id === 'pay')) fold.add('pay');
  const ownMin = own.reduce((s, c) => s + c.min, 0);
  return { fold, own, need: secFixed(fold) + ownMin };
}
