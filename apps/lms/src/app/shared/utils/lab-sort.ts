// Lab list sorting (OPS-52). The lab lists (Intake, My Work, Queue, Completed)
// keep their fixed default order; a tech may pick another. PURE: the
// comparators and the option lists live here, the remembered choice lives in
// LabSortService.

export type LabSortKey = 'default' | 'oldest' | 'newest' | 'patient' | 'sample';
export type LabSortScope = 'work' | 'completed' | 'intake';

export interface LabSortOption { value: LabSortKey; label: string }

export const LAB_SORT_OPTIONS: Record<LabSortScope, LabSortOption[]> = {
  work: [
    { value: 'default', label: 'Priority' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'newest', label: 'Newest first' },
    { value: 'patient', label: 'Patient name' },
    { value: 'sample', label: 'Sample ID' },
  ],
  completed: [
    { value: 'default', label: 'Newest completed' },
    { value: 'oldest', label: 'Oldest completed' },
    { value: 'patient', label: 'Patient name' },
    { value: 'sample', label: 'Sample ID' },
  ],
  intake: [
    { value: 'default', label: 'Default order' },
    { value: 'oldest', label: 'Oldest first' },
    { value: 'newest', label: 'Newest first' },
    { value: 'patient', label: 'Patient name' },
    { value: 'sample', label: 'Sample ID' },
  ],
};

export function isLabSortKey(scope: LabSortScope, v: unknown): v is LabSortKey {
  return LAB_SORT_OPTIONS[scope].some(o => o.value === v);
}

export interface LabSortAccessors<T> {
  patient: (t: T) => string | null | undefined;
  sample: (t: T) => string | null | undefined;
  /** When the row entered this list (ISO string or epoch ms). */
  at: (t: T) => string | number | null | undefined;
}

const ms = (v: string | number | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

/** 'default' returns the rows untouched (the caller's own order). Anything else
 *  is a stable re-sort; rows missing the sort value go last either way. */
export function applyLabSort<T>(rows: T[], key: LabSortKey, acc: LabSortAccessors<T>): T[] {
  if (key === 'default') return rows;
  const out = [...rows];
  const timeCmp = (dir: 1 | -1) => (a: T, b: T) => {
    const x = ms(acc.at(a)), y = ms(acc.at(b));
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * dir;
  };
  const textCmp = (get: (t: T) => string | null | undefined, numeric: boolean) => (a: T, b: T) => {
    const x = (get(a) ?? '').trim(), y = (get(b) ?? '').trim();
    if (!x && !y) return 0;
    if (!x) return 1;
    if (!y) return -1;
    return x.localeCompare(y, undefined, { numeric, sensitivity: 'base' });
  };
  switch (key) {
    case 'oldest': return out.sort(timeCmp(1));
    case 'newest': return out.sort(timeCmp(-1));
    case 'patient': return out.sort(textCmp(acc.patient, false));
    case 'sample': return out.sort(textCmp(acc.sample, true));
  }
}
