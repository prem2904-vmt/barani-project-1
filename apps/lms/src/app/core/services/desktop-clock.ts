/**
 * The top-strip clock shown while the desktop app is FULL SCREEN (the OS
 * taskbar / menu-bar clock is hidden then). Looks like the Windows taskbar
 * clock (owner): time on top, dd/mm/yyyy date underneath. Business time, not device time:
 * the lab's ONE clock is IST (lab-clock.ts, LAB_TIME_ZONE), so a desktop in
 * another zone still shows the lab's day and hour. Indian locale: 12 h
 * time, dd/mm/yyyy date. Pure functions + a minute-aligned ticker (no per-second
 * re-render) so the spec can pin both.
 */
import { IST_OFFSET_MS } from '../../shared/utils/lab-clock';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export interface ClockFace {
  /** "30/09/2026" — Indian dd/mm/yyyy, the Windows-taskbar second line. */
  date: string;
  /** "4:32 PM" (12 h) or "16:32" (24 h) */
  time: string;
  /** Full sentence for the accessible name / tooltip. */
  label: string;
  /** <time datetime>: the IST wall time with its offset, minute precision. */
  iso: string;
}

/** The clock's locale: India (the lab's), whatever the UI language. */
export const CLOCK_LOCALE = 'en-IN';

/** Does this locale write the time on a 12-hour clock? */
export function localeUses12h(locale?: string | readonly string[]): boolean {
  try {
    const hc = new Intl.DateTimeFormat(locale as string | string[] | undefined, { hour: 'numeric' })
      .resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & { hourCycle?: string };
    if (hc.hourCycle) return hc.hourCycle === 'h12' || hc.hourCycle === 'h11';
    return !!hc.hour12;
  } catch {
    return true; // India's usual clock
  }
}

/** The clock face for an instant, in the lab's time zone (IST). */
export function formatClock(now: Date, hour12: boolean): ClockFace {
  const ist = new Date(now.getTime() + IST_OFFSET_MS); // read UTC fields = IST wall time
  const y = ist.getUTCFullYear();
  const mo = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const h = ist.getUTCHours();
  const mi = ist.getUTCMinutes();
  const date = `${pad(d)}/${pad(mo + 1)}/${y}`;
  const spoken = `${DAYS[ist.getUTCDay()]}, ${d} ${MONTHS[mo]} ${y}`;
  const time = hour12
    ? `${h % 12 === 0 ? 12 : h % 12}:${pad(mi)} ${h < 12 ? 'AM' : 'PM'}`
    : `${pad(h)}:${pad(mi)}`;
  return {
    date,
    time,
    label: `${time}, ${spoken} IST`,
    iso: `${y}-${pad(mo + 1)}-${pad(d)}T${pad(h)}:${pad(mi)}+05:30`,
  };
}

/** Milliseconds from `now` to the start of the next minute (never 0). */
export function msToNextMinute(now: number): number {
  const rest = 60_000 - (now % 60_000);
  return rest === 0 ? 60_000 : rest;
}

/**
 * Call `tick` now and then on every minute boundary. Each wait is recomputed
 * from the real clock, so a late timer (sleep / a busy main thread) catches
 * up on the next boundary instead of drifting. Returns the stopper.
 */
export function startMinuteTicker(
  tick: (now: Date) => void,
  clock: { now: () => number; setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (h: unknown) => void } = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): () => void {
  let handle: unknown = null;
  let stopped = false;
  const run = () => {
    if (stopped) return;
    const now = clock.now();
    tick(new Date(now));
    // +25 ms: land just after the boundary, never a hair before it.
    handle = clock.setTimeout(run, msToNextMinute(now) + 25);
  };
  run();
  return () => {
    stopped = true;
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
  };
}
