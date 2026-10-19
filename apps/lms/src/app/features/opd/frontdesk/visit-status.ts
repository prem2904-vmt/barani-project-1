import type { OpdVisitStatus } from '../shared/opd.models';

/** The desk's words for a visit status (rows, chips, timeline). */
export function statusWord(s: OpdVisitStatus | string): string {
  switch (s) {
    case 'booked': return 'Booked';
    case 'vitals': return 'At vitals';
    case 'waiting': return 'Waiting';
    case 'in_consult': return 'In consult';
    case 'completed': return 'Done';
    case 'cancelled': return 'Cancelled';
    case 'no_show': return 'Did not come';
    default: return s;
  }
}

/** Minutes since an ISO instant, as "just now" / "12 min" / "1 h 5 min". */
export function waitedLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const m = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
