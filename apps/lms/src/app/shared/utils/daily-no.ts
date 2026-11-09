import { labToday } from './lab-clock';

/**
 * The DAILY PATIENT NUMBER (owner 2026-09-30): the simple 1, 2, 3 … the front
 * desk gives a patient, shown before the name on every lab screen for that
 * visit. Home = the server (`daily_patient_numbers`, per branch × IST day),
 * stamped on the order as `dailyNo` + `dailyNoDay` (yyyy-MM-dd, IST). On-screen
 * aid ONLY — never printed (labels, slips, reports, messages, exports).
 */
export interface DailyNoCarrier {
  dailyNo?: number | null;
  dailyNoDay?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The order-ish object's daily number fields, wherever they sit (the order
 *  itself, or a sample / line that carries its `order`). */
export function dailyNoOf(x: unknown): DailyNoCarrier {
  const o = x as { dailyNo?: number | null; dailyNoDay?: string | null; order?: DailyNoCarrier | null } | null | undefined;
  if (!o) return {};
  if (o.dailyNo != null) return { dailyNo: o.dailyNo, dailyNoDay: o.dailyNoDay ?? null };
  if (o.order?.dailyNo != null) return { dailyNo: o.order.dailyNo, dailyNoDay: o.order.dailyNoDay ?? null };
  return {};
}

/** The chip text: "12" today (no "#" - OPS-125); "12 · 29 Sep" on any other day (so an older
 *  visit's #3 is never mistaken for today's #3). '' when there is none. */
export function dailyNoLabel(no: number | null | undefined, day?: string | null, today: string = labToday()): string {
  if (no == null || !(no > 0)) return '';
  if (!day || day === today) return `${no}`;
  const [, m, d] = day.split('-').map(Number);
  return m && d ? `${no} · ${d} ${MONTHS[m - 1]}` : `${no}`;
}

/** Screen-reader / tooltip wording. */
export function dailyNoTitle(no: number | null | undefined, day?: string | null, today: string = labToday()): string {
  if (no == null || !(no > 0)) return '';
  const label = dailyNoLabel(no, day, today);
  return !day || day === today
    ? `Today's patient number ${no}`
    : `Patient number ${no} on ${label.split(' · ')[1]}`;
}

/** A search text that is a bare daily number ("12" or "#12") → the number,
 *  else null. Mirrors the server's `DailyPatientNumbers.ParseQuery`. */
export function parseDailyNoQuery(q: string | null | undefined): number | null {
  let s = (q ?? '').trim();
  if (s.startsWith('#')) s = s.slice(1).trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n : null;
}

/** Does a search text name this row's daily number? Only TODAY's number
 *  matches ("12" finds today's #12, not yesterday's). */
export function matchesDailyNo(q: string | null | undefined, x: unknown, today: string = labToday()): boolean {
  const n = parseDailyNoQuery(q);
  if (n == null) return false;
  const { dailyNo, dailyNoDay } = dailyNoOf(x);
  return dailyNo === n && (!dailyNoDay || dailyNoDay === today);
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The chip as HTML (AG-Grid cell renderers). '' when there is none. */
export function dailyNoHtml(x: unknown, today: string = labToday()): string {
  const { dailyNo, dailyNoDay } = dailyNoOf(x);
  const label = dailyNoLabel(dailyNo, dailyNoDay, today);
  if (!label) return '';
  return `<span class="pf-dayno" title="${esc(dailyNoTitle(dailyNo, dailyNoDay, today))}">${esc(label)}</span>`;
}
