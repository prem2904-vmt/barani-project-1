import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { wireMergedOutsourcedLoader } from './merged-outsourced-loader';
import { WorkBounds, WorkStatusFilter } from './work-status-filter';

/**
 * Owner review (2026-10-01): the merged ("no chip") work list must not
 * depend on the desk having visited the Outsourced chip first — the service
 * has to load the WHOLE window itself, on init, on every date-range change
 * and on every refresh, whenever the merged view is the one showing.
 */
describe('wireMergedOutsourcedLoader', () => {
  function fakeOutsourcing() {
    return { dateWindow: { set: vi.fn() }, status: { set: vi.fn() }, loadAll: vi.fn(async () => {}) };
  }
  function harness(initialRightTab: WorkStatusFilter) {
    const rightTab = signal<WorkStatusFilter>(initialRightTab);
    const bounds = signal<WorkBounds>({ start: 0, end: 1, isToday: true });
    const feedIds = signal<ReadonlySet<string>>(new Set());
    const outsourcing = fakeOutsourcing();
    TestBed.runInInjectionContext(() => wireMergedOutsourcedLoader(rightTab, bounds, feedIds, outsourcing));
    return { rightTab, bounds, feedIds, outsourcing, flush: () => TestBed.tick() };
  }

  it('fires on INIT when no chip is selected from the start (the merged view is showing immediately)', () => {
    const h = harness(null);
    h.flush();
    expect(h.outsourcing.status.set).toHaveBeenCalledWith('all');
    expect(h.outsourcing.loadAll).toHaveBeenCalledTimes(1);
  });

  it('a chip selected: the date window still updates, but status/loadAll are left alone (the dedicated tab owns its own load)', () => {
    const h = harness('ip');
    h.flush();
    expect(h.outsourcing.dateWindow.set).toHaveBeenCalled();
    expect(h.outsourcing.status.set).not.toHaveBeenCalled();
    expect(h.outsourcing.loadAll).not.toHaveBeenCalled();
  });

  it('CLEARING the chip (merged view appears) pins status to "all" and loads everything', () => {
    const h = harness('ip');
    h.flush();
    h.rightTab.set(null);
    h.flush();
    expect(h.outsourcing.status.set).toHaveBeenCalledWith('all');
    expect(h.outsourcing.loadAll).toHaveBeenCalledTimes(1);
  });

  it('selecting a chip again (merged view leaves) does not call loadAll again', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAll.mockClear();
    h.rightTab.set('done');
    h.flush();
    expect(h.outsourcing.loadAll).not.toHaveBeenCalled();
  });

  it('a DATE-RANGE change re-fires while the merged view is showing', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAll.mockClear();
    h.bounds.set({ start: 10, end: 20, isToday: false });
    h.flush();
    expect(h.outsourcing.loadAll).toHaveBeenCalledTimes(1);
  });

  it('a REFRESH (feedIds — a fresh Set reference, as refresh() produces) re-fires while the merged view is showing', () => {
    const h = harness(null);
    h.flush();
    h.outsourcing.loadAll.mockClear();
    h.feedIds.set(new Set(['o1'])); // a brand-new Set, exactly what _feedIds() computed produces after refresh()
    h.flush();
    expect(h.outsourcing.loadAll).toHaveBeenCalledTimes(1);
  });

  it('a date-range change while a CHIP is selected never touches status/loadAll', () => {
    const h = harness('billing');
    h.flush();
    h.bounds.set({ start: 10, end: 20, isToday: false });
    h.flush();
    expect(h.outsourcing.status.set).not.toHaveBeenCalled();
    expect(h.outsourcing.loadAll).not.toHaveBeenCalled();
  });
});
