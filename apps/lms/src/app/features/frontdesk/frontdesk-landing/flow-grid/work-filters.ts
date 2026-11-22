import { compareByDailySerial } from '../work-merge';
import type { FlowRow } from './flow-row';

/**
 * Work card "More filters" (owner-approved redesign 2026-11-19) — the popover behind the card head's filter icon.
 * The DATE range is the existing one (Yesterday · Today · Custom — setWorkDateRange); everything here is an extra,
 * offered only where the loaded rows carry the data:
 *  - Doctor: the order's referral doctor (`refDoctorName`), only when the rows name at least one;
 *  - Branch: only when the feed really holds more than one branch (branch isolation normally scopes it to one);
 *  - Only late (over 30 min at the current stage) · Only with dues (an outstanding bill balance);
 *  - Sort: Token (the day's #N — the list's default and THE comparator, work-merge.ts) · Longest wait · Newest.
 */
export type WorkSort = 'token' | 'wait' | 'newest';

export interface WorkFilters {
  doctor: string | null;
  branch: string | null;
  onlyLate: boolean;
  onlyDues: boolean;
  sort: WorkSort;
}

export const NO_WORK_FILTERS: WorkFilters = { doctor: null, branch: null, onlyLate: false, onlyDues: false, sort: 'token' };

export const WORK_SORT_LABEL: Record<WorkSort, string> = { token: 'Token', wait: 'Longest wait', newest: 'Newest' };

/** How many filters are on (the filter icon shows the violet "on" look when > 0). Sort is not a filter. */
export function activeWorkFilterCount(f: WorkFilters): number {
  return (f.doctor ? 1 : 0) + (f.branch ? 1 : 0) + (f.onlyLate ? 1 : 0) + (f.onlyDues ? 1 : 0);
}

/** Distinct, sorted referral doctors named on the rows. */
export function doctorChoices(rows: readonly Pick<FlowRow, 'order'>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const n = (r.order?.refDoctorName ?? '').trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Distinct branch ids on the rows (the Branch filter shows only for 2+). */
export function branchChoices(rows: readonly Pick<FlowRow, 'order'>[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.order?.branchId) set.add(r.order.branchId);
  return [...set].sort();
}

/** Narrow the rows by the More filters (not by sort). */
export function filterFlowRows(rows: readonly FlowRow[], f: WorkFilters): FlowRow[] {
  return rows.filter(r => {
    if (f.doctor && (r.order?.refDoctorName ?? '').trim() !== f.doctor) return false;
    if (f.branch && r.order?.branchId !== f.branch) return false;
    if (f.onlyLate && !r.late) return false;
    if (f.onlyDues && !r.payDue) return false;
    return true;
  });
}

/** Order the rows. Token = the day's #N ledger (compareByDailySerial); a draft (no number) keeps its place on top. */
export function sortFlowRows(rows: readonly FlowRow[], sort: WorkSort): FlowRow[] {
  const drafts = rows.filter(r => r.kind === 'draft');
  const rest = rows.filter(r => r.kind !== 'draft');
  const sorted = [...rest];
  if (sort === 'token') {
    sorted.sort((a, b) => compareByDailySerial(
      { createdAt: new Date(a.createdMs), dailyNo: a.dailyNo, dailyNoDay: a.dailyNoDay },
      { createdAt: new Date(b.createdMs), dailyNo: b.dailyNo, dailyNoDay: b.dailyNoDay }));
  } else if (sort === 'newest') {
    sorted.sort((a, b) => b.createdMs - a.createdMs);
  } else {
    // Longest wait first; finished rows (no wait) last, by token.
    sorted.sort((a, b) => (b.waitMin ?? -1) - (a.waitMin ?? -1) || b.createdMs - a.createdMs);
  }
  return [...drafts, ...sorted];
}
