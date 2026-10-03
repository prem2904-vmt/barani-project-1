/**
 * Order-LINE (order test) status labels — the one place a line status turns
 * into words. `not_reported` (owner 2026-10-03, Salem 26285): a line the tech
 * or validator closed without a value ("N tests have no value … Submit
 * without them?"); it never prints and never holds the report back. Mirrors
 * mw `LineStatus`.
 */
export const NOT_REPORTED = 'not_reported';

const LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  entered: 'Entered',
  re_entry: 'Re-entry',
  resulted: 'Resulted',
  validated: 'Validated',
  completed: 'Completed',
  reported: 'Reported',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  missed: 'Missed',
  [NOT_REPORTED]: 'Not reported',
};

/** "Not reported", "In progress", … — never raw snake_case. */
export function lineStatusLabel(status: string | null | undefined): string {
  const s = (status || '').trim();
  if (!s) return '—';
  return LABELS[s] ?? (s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '));
}

/** A line that is DONE for its tube/order: signed off, or closed as not reported. */
export function isSignedOrSkipped(status: string | null | undefined): boolean {
  return status === 'validated' || status === NOT_REPORTED;
}
