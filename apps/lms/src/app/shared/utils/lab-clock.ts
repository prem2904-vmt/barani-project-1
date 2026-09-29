/**
 * The lab's ONE clock in the UI — strictly India Standard Time
 * (Asia/Kolkata, UTC+05:30, no DST), whatever the device's timezone. TS
 * mirror of the server's LabClock (prefrontal-mw Prefrontal/Services/LabClock.cs).
 * Every "business day" the UI sends or shows (daily statement, finance
 * ranges, reconcile date, dashboard windows, "today" caps) comes from here.
 */

export const LAB_TIME_ZONE = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60_000;

const pad = (n: number) => String(n).padStart(2, '0');

/** The IST calendar date (yyyy-MM-dd) an instant falls on. */
export function istDateOf(instant: Date | string | number = new Date()): string {
  const t = new Date(instant).getTime();
  const ist = new Date(t + IST_OFFSET_MS);   // read the UTC fields of the shifted instant
  return `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
}

/** Today's IST date (yyyy-MM-dd). */
export function labToday(now: Date = new Date()): string {
  return istDateOf(now);
}

/** The IST date `days` days before (negative = after) `from` (yyyy-MM-dd). */
export function labDaysAgo(days: number, now: Date = new Date()): string {
  return addDays(labToday(now), -days);
}

/** Calendar arithmetic on a yyyy-MM-dd date (timezone-free). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** The UTC instant at which an IST calendar day (yyyy-MM-dd) starts. */
export function istDayStart(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** An IST day (or an inclusive span of IST days) as ISO UTC instants
 *  [from, to) — what the API's instant filters expect. */
export function istDayRange(fromYmd: string, toYmdInclusive: string = fromYmd): { from: string; to: string } {
  return {
    from: istDayStart(fromYmd).toISOString(),
    to: istDayStart(addDays(toYmdInclusive, 1)).toISOString(),
  };
}
