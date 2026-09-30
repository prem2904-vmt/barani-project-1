import { describe, expect, it, vi } from 'vitest';
import { formatClock, localeUses12h, msToNextMinute, startMinuteTicker } from './desktop-clock';
import { IST_OFFSET_MS, istDateOf } from '../../shared/utils/lab-clock';

/** Full-screen top-strip clock: IST (the lab's one clock), minute ticks. */
describe('Desktop clock — face', () => {
  it('owner example: Wed, 30 Sep · 4:32 PM (IST), 12 h', () => {
    const f = formatClock(new Date('2026-09-30T11:02:10Z'), true); // 16:32 IST
    expect(f.date).toBe('Wed, 30 Sep');
    expect(f.time).toBe('4:32 PM');
    expect(f.iso).toBe('2026-09-30T16:32+05:30');
    expect(f.label).toBe('Wed, 30 Sep 2026, 4:32 PM IST');
  });

  it('24 h locale: zero-padded hours', () => {
    expect(formatClock(new Date('2026-09-30T11:02:10Z'), false).time).toBe('16:32');
    expect(formatClock(new Date('2026-09-30T20:35:00Z'), false).time).toBe('02:05'); // next IST day
  });

  it('midnight / noon read 12:xx AM / PM', () => {
    expect(formatClock(new Date('2026-09-30T18:30:00Z'), true).time).toBe('12:00 AM'); // 00:00 IST 1 Oct
    expect(formatClock(new Date('2026-09-30T06:30:00Z'), true).time).toBe('12:00 PM');
  });

  it('the IST date flips at IST midnight, whatever the device zone — same day as labToday()', () => {
    const before = new Date('2026-09-30T18:29:00Z'); // 23:59 IST 30 Sep
    const after = new Date('2026-09-30T18:30:00Z');  // 00:00 IST 1 Oct
    expect(formatClock(before, true).date).toBe('Wed, 30 Sep');
    expect(formatClock(after, true).date).toBe('Thu, 1 Oct');
    // Single source: the clock's day == lab-clock's IST day.
    for (const t of [before, after]) expect(formatClock(t, false).iso.slice(0, 10)).toBe(istDateOf(t));
    expect(IST_OFFSET_MS).toBe(330 * 60_000);
  });

  it('12 / 24 h follows the locale', () => {
    expect(localeUses12h('en-US')).toBe(true);
    expect(localeUses12h('en-IN')).toBe(true);
    expect(localeUses12h('en-GB')).toBe(false);
    expect(localeUses12h('de-DE')).toBe(false);
  });
});

describe('Desktop clock — minute ticker (no per-second re-render)', () => {
  it('msToNextMinute lands on the boundary', () => {
    expect(msToNextMinute(Date.UTC(2026, 8, 30, 11, 2, 10))).toBe(50_000);
    expect(msToNextMinute(Date.UTC(2026, 8, 30, 11, 2, 0))).toBe(60_000);
  });

  it('ticks now, then once per minute on the boundary; stop() ends it', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-09-30T11:02:10Z'));
      const seen: string[] = [];
      const stop = startMinuteTicker(now => seen.push(formatClock(now, true).time));
      expect(seen).toEqual(['4:32 PM']);
      vi.advanceTimersByTime(49_000);            // 16:32:59 — no re-render mid-minute
      expect(seen).toHaveLength(1);
      vi.advanceTimersByTime(1_100);             // just past 16:33:00
      expect(seen).toEqual(['4:32 PM', '4:33 PM']);
      vi.advanceTimersByTime(60_000 * 3);
      expect(seen).toEqual(['4:32 PM', '4:33 PM', '4:34 PM', '4:35 PM', '4:36 PM']);
      stop();
      vi.advanceTimersByTime(60_000 * 5);
      expect(seen).toHaveLength(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late timer (sleep / busy thread) re-aligns to the next boundary instead of drifting', () => {
    let now = Date.UTC(2026, 8, 30, 11, 2, 10);
    const waits: number[] = [];
    let pending: (() => void) | null = null;
    const stop = startMinuteTicker(() => undefined, {
      now: () => now,
      setTimeout: (fn, ms) => { waits.push(ms); pending = fn; return 1; },
      clearTimeout: () => { pending = null; },
    });
    expect(waits[0]).toBe(50_000 + 25);
    now += 50_000 + 25 + 17_000; // the timer fired 17 s late
    pending!();
    expect(waits[1]).toBe(43_000); // fired at 11:03:17.025 → next boundary 11:04:00 (+25 ms)
    stop();
    expect(pending).toBeNull();
  });
});
