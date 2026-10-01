import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { wireMergedOutsourcedLoader, windowDaysFor } from './merged-outsourced-loader';
import { WorkBounds, WorkStatusFilter } from './work-status-filter';

/**
 * Owner review (2026-10-01): the merged ("no chip") work list must not
 * depend on the desk having visited the Outsourced chip first — the service
 * has to load the WHOLE window itself, on init, on every date-range change
 * and on every refresh, whenever the merged view is the one showing.
 */
describe('wireMergedOutsourcedLoader', () => {
  function fakeOutsourcing() {
    return { dateWindow: { set: vi.fn() }, loadAllFor: vi.fn(async (_status: 'all', _days: number) => {}) };
  }
  function harness(initialRightTab: WorkStatusFilter, boundsInit: WorkBounds = { start: 0, end: 1, isToday: true }) {
    const rightTab = signal<WorkStatusFilter>(initialRightTab);
    const bounds = signal<WorkBounds>(boundsInit);
    const feedIds = signal<ReadonlySet<string>>(new Set());
    const outsourcing = fakeOutsourcing();
    TestBed.runInInjectionContext(() => wireMergedOutsourcedLoader(rightTab, bounds, feedIds, outsourcing));
    return { rightTab, bounds, feedIds, outsourcing, flush: () => TestBed.tick() };
  }

  it('fires on INIT when no chip is selected from the start (the merged view is showing immediately)', () => {
    const h = harness(null);
    h.flush();
    expect(h.outsourcing.loadAllFor).toHaveBeenCalledTimes(1);
    expect(h.outsourcing.loadAllFor.mock.calls[0][0]).toBe('all');
  });

  it('a chip selected: the date window still updates, but loadAllFor is left alone (the dedicated tab owns its own load)', () => {
    const h = harness('ip');
    h.flush();
    expect(h.outsourcing.dateWindow.set).toHaveBeenCalled();
    expect(h.outsourcing.loadAllFor).not.toHaveBeenCalled();
  });

  it('CLEARING the chip (merged view appears) loads everything for "all"', () => {
    const h = harness('ip');
    h.flush();
    h.rightTab.set(null);
    h.flush();
    expect(h.outsourcing.loadAllFor).toHaveBeenCalledTimes(1);
    expect(h.outsourcing.loadAllFor.mock.calls[0][0]).toBe('all');
  });

  it('selecting a chip again (merged view leaves) does not call loadAllFor again', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAllFor.mockClear();
    h.rightTab.set('done');
    h.flush();
    expect(h.outsourcing.loadAllFor).not.toHaveBeenCalled();
  });

  it('a DATE-RANGE change re-fires while the merged view is showing', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAllFor.mockClear();
    h.bounds.set({ start: 10, end: 20, isToday: false });
    h.flush();
    expect(h.outsourcing.loadAllFor).toHaveBeenCalledTimes(1);
  });

  it('a REFRESH (feedIds — a fresh Set reference, as refresh() produces) re-fires while the merged view is showing', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAllFor.mockClear();
    h.feedIds.set(new Set(['o1'])); // a brand-new Set, exactly what _feedIds() computed produces after refresh()
    h.flush();
    expect(h.outsourcing.loadAllFor).toHaveBeenCalledTimes(1);
  });

  it('a date-range change while a CHIP is selected never touches loadAllFor', () => {
    const h = harness('billing');
    h.flush();
    h.bounds.set({ start: 10, end: 20, isToday: false });
    h.flush();
    expect(h.outsourcing.loadAllFor).not.toHaveBeenCalled();
  });

  it('passes a WIDER window for an older custom date range (P2-11)', () => {
    const farBack = Date.now() - 200 * 86_400_000;
    const h = harness(null, { start: farBack, end: Date.now(), isToday: false });
    h.flush();
    const days = h.outsourcing.loadAllFor.mock.calls[0][1];
    expect(days).toBeGreaterThanOrEqual(200);
  });
});

describe('windowDaysFor (P2-11 — a custom range further back than the default must not be silently cut)', () => {
  const now = Date.UTC(2026, 9, 1); // 2026-10-01

  it('never shrinks below the 90-day default for a narrow ("Today") range', () => {
    expect(windowDaysFor({ start: now - 60_000, end: now, isToday: true }, now)).toBe(90);
  });

  it('widens to cover a custom range further back than 90 days', () => {
    const start = now - 150 * 86_400_000;
    expect(windowDaysFor({ start, end: now, isToday: false }, now)).toBeGreaterThanOrEqual(150);
  });

  it('never exceeds the server\'s own 365-day clamp', () => {
    const start = now - 1000 * 86_400_000;
    expect(windowDaysFor({ start, end: now, isToday: false }, now)).toBe(365);
  });
});
