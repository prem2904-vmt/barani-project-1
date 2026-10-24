/**
 * Order-LINE (order test) status labels — the one place a line status turns
 * into words. `not_reported` (owner 2026-10-03, Salem 26285): a line the tech
 * or validator closed without a value ("N tests have no value … Submit
 * without them?"); it never prints and never holds the report back. Mirrors
 * mw `LineStatus`.
 */
import { isFamilyFilled, isFamilyValue } from './option-family';

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

/** Does a saved result snapshot (currentResult JSON) hold any real value?
 *  Mirrors mw `LineStatus.HasAnyValue`: a draft is never closed as Not
 *  reported. Unreadable JSON counts as data. */
export function savedResultHasValue(json: string | null | undefined): boolean {
  if (!json || !json.trim()) return false;
  try {
    const values = JSON.parse(json)?.values;
    if (!values || typeof values !== 'object') return false;
    const filled = (v: unknown): boolean => {
      if (v === null || v === undefined) return false;
      if (typeof v === 'string') return v.trim() !== '';
      if (Array.isArray(v)) return v.some(filled);
      if (typeof v === 'boolean') return v;
      if (isFamilyValue(v)) return isFamilyFilled(v);
      if (typeof v === 'object') return 'value' in (v as object) ? filled((v as { value: unknown }).value) : Object.keys(v as object).length > 0;
      return true;
    };
    return Object.values(values as Record<string, unknown>).some(filled);
  } catch { return true; }
}
