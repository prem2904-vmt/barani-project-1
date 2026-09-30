/**
 * Front-desk work card: STATUS chips (In progress / Completed / Payments due /
 * Outsourced) and the DATE filter (Today / Yesterday / … / custom range) are two
 * INDEPENDENT filters that combine (owner, 2026-09-30):
 *  - tapping a status chip filters to that status;
 *  - tapping the SAME chip again turns it off → every status is listed;
 *  - the date range stays applied either way (switching / clearing a status
 *    never resets or hides it).
 * Pure helpers so the rule is unit-testable without the 3k-line component.
 */
export type WorkStatus = 'ip' | 'done' | 'billing' | 'out';
/** null = no status chip on — all statuses. */
export type WorkStatusFilter = WorkStatus | null;

const STATUSES: readonly WorkStatus[] = ['ip', 'done', 'billing', 'out'];

/** Tap on a chip: the same chip again clears the status filter. */
export function toggleWorkStatus(current: WorkStatusFilter, tapped: WorkStatus): WorkStatusFilter {
  return current === tapped ? null : tapped;
}

/** Does the list for status `s` render under `filter`? */
export function workStatusShown(filter: WorkStatusFilter, s: WorkStatus): boolean {
  return filter === null || filter === s;
}

/** localStorage value ('all' = cleared). */
export function workStatusStoreValue(filter: WorkStatusFilter): string {
  return filter ?? 'all';
}

/** Restore a persisted choice. Unknown / nothing stored ⇒ In progress (the
 *  historical default); 'all' ⇒ the cleared state. */
export function parseWorkStatus(raw: string | null | undefined): WorkStatusFilter {
  if (raw === 'all') return null;
  return (STATUSES as readonly string[]).includes(raw ?? '') ? raw as WorkStatus : 'ip';
}

export interface WorkBounds { start: number; end: number; isToday: boolean }

/**
 * THE date rule every status list shares. A custom / past range = created in
 * the range. "Today" = today's work feed: anything created today, plus work
 * the server's today feed carried in (an older order that had activity today —
 * e.g. its report was released today), so hand-over never misses it.
 */
export function inWorkWindow(createdAt: string | Date | null | undefined, b: WorkBounds, inTodayFeed = false): boolean {
  if (b.isToday && inTodayFeed) return true;
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  return t >= b.start && t < b.end;
}
