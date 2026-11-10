/** Local-calendar date helpers. Strings are built from y / m / d, never from toISOString of a local midnight (no timezone drift). */

export interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toIso(v: Ymd): string {
  return `${String(v.y).padStart(4, '0')}-${pad(v.m)}-${pad(v.d)}`;
}

/** 'yyyy-mm-dd' or an ISO date-time ('2024-01-15T00:00:00Z' → the calendar date as written). */
export function parseIso(v: unknown): Ymd | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  return { y, m: mo, d };
}

export function fromDate(dt: Date): Ymd {
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
}

export function addDays(v: Ymd, n: number): Ymd {
  return fromDate(new Date(v.y, v.m - 1, v.d + n));
}

export function daysIn(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function compare(a: Ymd, b: Ymd): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function same(a: Ymd | null, b: Ymd | null): boolean {
  return !!a && !!b && compare(a, b) === 0;
}

/** dd/mm/yyyy, how the narrative writes it. */
export function display(v: Ymd): string {
  return `${pad(v.d)}/${pad(v.m)}/${v.y}`;
}

/** "9 March 1982" (screen readers). */
export function spoken(v: Ymd): string {
  return `${v.d} ${MONTHS[v.m - 1]} ${v.y}`;
}

/** Monday-first weeks: the leading blanks for day 1 of the month. */
export function leadingBlanks(y: number, m: number): number {
  return (new Date(y, m - 1, 1).getDay() + 6) % 7;
}

/**
 * Is this a date of birth? The v2 config has no explicit "purpose" yet (only
 * allowFuture / quickChips), so it is read from the field's key / label:
 * dob, d.o.b, birth, born. A date of birth gets year-first entry and no
 * recent-day chips. TODO(API): an explicit `config.purpose: 'birth' | 'event'`.
 */
export function isBirthDate(key: string, label: string, purpose?: unknown): boolean {
  if (purpose === 'birth') return true;
  if (purpose === 'event') return false;
  return /(^|[^a-z])(dob|d\.o\.b)([^a-z]|$)|birth|born/i.test(`${key} ${label}`) || /^dob/i.test(key);
}

/** About `years` old today → the same day-of-year that many years ago (an approximate date of birth). */
export function approxBirth(today: Ymd, years: number): Ymd {
  const y = today.y - Math.floor(years);
  return { y, m: today.m, d: Math.min(today.d, daysIn(y, today.m)) };
}
