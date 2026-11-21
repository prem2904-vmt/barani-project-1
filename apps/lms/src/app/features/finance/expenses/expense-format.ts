import { formatDate } from '@angular/common';
import { LAB_TIME_ZONE } from '../../../shared/utils/lab-clock';
import { statusWords, type StatusWords } from '../../../shared/utils/status-words';

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
/** ₹ with paise when present; "—" for no value. */
export const inr = (n: number | null | undefined) => (n == null ? '—' : INR.format(n));

/** yyyy-MM-dd (an IST business date) → "Tue, 29 Sep". */
export function dayLabel(ymd: string, withWeekday = true): string {
  try { return formatDate(ymd + 'T12:00:00Z', withWeekday ? 'EEE, d MMM' : 'd MMM', 'en-US', LAB_TIME_ZONE); } catch { return ymd; }
}

/** A day's Status cell as words: Closed (done) with "by …", or Open. */
export function dayStatusWords(d: { isClosed: boolean; closedByName?: string | null }): StatusWords {
  return d.isClosed ? statusWords('Closed', d.closedByName ? `by ${d.closedByName}` : null, 'done') : statusWords('Open');
}
