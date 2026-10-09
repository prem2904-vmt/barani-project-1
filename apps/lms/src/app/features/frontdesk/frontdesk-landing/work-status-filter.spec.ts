import { readFileSync } from 'node:fs';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { FrontdeskLandingComponent } from './frontdesk-landing.component';
import {
  WorkStatusFilter, hadTodayActivity, inWorkWindow, parseWorkStatus, toggleWorkStatus, workStatusShown, workStatusStoreValue,
} from './work-status-filter';

/**
 * Owner (2026-09-30): tapping a status chip filters; tapping the SAME chip
 * again turns it off and shows the whole list — while the date filter
 * (Today / Yesterday / range) stays applied and combines with the status.
 */
describe('work-status-filter — the chip + date rule', () => {
  it('same chip again clears the status; another chip switches', () => {
    expect(toggleWorkStatus('ip', 'ip')).toBeNull();
    expect(toggleWorkStatus(null, 'done')).toBe('done');
    expect(toggleWorkStatus('done', 'out')).toBe('out');
  });

  it('no chip on ⇒ every status list renders; a chip ⇒ only its list', () => {
    for (const s of ['ip', 'done', 'billing', 'out'] as const) expect(workStatusShown(null, s)).toBe(true);
    expect(workStatusShown('done', 'done')).toBe(true);
    expect(workStatusShown('done', 'ip')).toBe(false);
  });

  it('persists round-trip, cleared state included; unknown ⇒ In progress', () => {
    for (const f of ['ip', 'done', 'billing', 'out', null] as WorkStatusFilter[])
      expect(parseWorkStatus(workStatusStoreValue(f))).toBe(f);
    expect(parseWorkStatus(null)).toBe('ip');
    expect(parseWorkStatus('bogus')).toBe('ip');
  });

  it('date window: a range = created in range; Today also keeps work the today feed carried in', () => {
    const day = Date.UTC(2026, 8, 29, 18, 30); // 30 Sep IST 00:00
    const today = { start: day, end: day + 86_400_000, isToday: true };
    const yesterday = { start: day - 86_400_000, end: day, isToday: false };
    const older = new Date(day - 3 * 86_400_000).toISOString();
    const y = new Date(day - 3_600_000).toISOString();
    expect(inWorkWindow(y, yesterday)).toBe(true);
    expect(inWorkWindow(older, yesterday)).toBe(false);
    expect(inWorkWindow(older, today)).toBe(false);
    expect(inWorkWindow(older, today, true)).toBe(true);     // in today's feed
    expect(inWorkWindow(older, yesterday, true)).toBe(false); // feed only means "today"
    expect(inWorkWindow(null, today)).toBe(false);
  });

  /**
   * Owner (2026-10-09): "Completed shows 20+ including old orders". The
   * today feed's 30-day ready-for-handover floor (OrderRepository.TodayQuery)
   * makes a 3-week-old-but-still-undelivered order trivially "in the feed",
   * so passing bare feed membership as `inWorkWindow`'s today-feed bit
   * defeated the date scope. `hadTodayActivity` checks the order's OWN
   * `updatedAt` instead — only real today activity earns the bonus.
   */
  it('hadTodayActivity: only Today view + a genuinely TODAY updatedAt qualifies', () => {
    const day = Date.UTC(2026, 8, 29, 18, 30); // 30 Sep IST 00:00
    const today: import('./work-status-filter').WorkBounds = { start: day, end: day + 86_400_000, isToday: true };
    const yesterday: import('./work-status-filter').WorkBounds = { start: day - 86_400_000, end: day, isToday: false };
    const updatedToday = new Date(day + 3_600_000).toISOString();
    const updatedWeeksAgo = new Date(day - 21 * 86_400_000).toISOString();

    // A straggler the today feed's 30-day floor carried in, last touched
    // three weeks ago — no bonus; falls back to its own creation date.
    expect(hadTodayActivity(updatedWeeksAgo, today)).toBe(false);
    // The same order, but actually validated/completed an hour ago today.
    expect(hadTodayActivity(updatedToday, today)).toBe(true);
    // Never a bonus outside the Today view, however fresh updatedAt is.
    expect(hadTodayActivity(updatedToday, yesterday)).toBe(false);
    // No updatedAt at all (legacy row) — no bonus, never a thrown error.
    expect(hadTodayActivity(null, today)).toBe(false);
    expect(hadTodayActivity(undefined, today)).toBe(false);
  });

  it('end to end: inWorkWindow(createdAt, bounds, hadTodayActivity(updatedAt, bounds)) scopes Completed to Today', () => {
    const day = Date.UTC(2026, 8, 29, 18, 30);
    const today: import('./work-status-filter').WorkBounds = { start: day, end: day + 86_400_000, isToday: true };
    const createdWeeksAgo = new Date(day - 21 * 86_400_000).toISOString();
    const updatedWeeksAgo = createdWeeksAgo;
    const updatedToday = new Date(day + 3_600_000).toISOString();

    // The reported bug: an order created AND last touched weeks ago, merely
    // swept in by the 30-day floor, must NOT show under Today.
    expect(inWorkWindow(createdWeeksAgo, today, hadTodayActivity(updatedWeeksAgo, today))).toBe(false);
    // The legitimate hand-over: created weeks ago, but genuinely validated
    // TODAY — still surfaces under Today.
    expect(inWorkWindow(createdWeeksAgo, today, hadTodayActivity(updatedToday, today))).toBe(true);
  });
});

describe('Front desk — status chips on the component', () => {
  const proto = FrontdeskLandingComponent.prototype as any;
  function landing(initial: WorkStatusFilter) {
    const h = Object.create(proto);
    Object.assign(h, {
      _rightTab: signal<WorkStatusFilter>(initial),
      workSel: { clear: vi.fn() },
      refreshDrafts: vi.fn(),
    });
    h.rightTab = h._rightTab.asReadonly();
    return h;
  }
  // In-memory Storage (the spec env has no usable localStorage).
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('tap → filter; tap the same chip → all statuses (persisted as "all")', () => {
    const h = landing('ip');
    h.setRightTab('done');
    expect(h.rightTab()).toBe('done');
    expect(localStorage.getItem('pf.lms.frontdesk.rightTab')).toBe('done');
    h.setRightTab('done');
    expect(h.rightTab()).toBeNull();
    expect(localStorage.getItem('pf.lms.frontdesk.rightTab')).toBe('all');
    expect(h.statusShown('ip') && h.statusShown('done') && h.statusShown('billing') && h.statusShown('out')).toBe(true);
    // Coming back to the screen restores the cleared state.
    expect(proto.loadRightTab.call(h)).toBeNull();
  });

  it('never touches the date range', () => {
    const h = landing('ip');
    h._workDateRange = signal('yesterday');
    h.setRightTab('ip');
    h.setRightTab('out');
    expect(h._workDateRange()).toBe('yesterday');
  });
});

describe('Front desk — status chips + date filter markup', () => {
  const html = readFileSync('apps/lms/src/app/features/frontdesk/frontdesk-landing/frontdesk-landing.component.html', 'utf8');
  const doc = new DOMParser().parseFromString(`<div id="r">${html}</div>`, 'text/html');
  const group = doc.querySelector('[aria-label="Filter by status"]')!;

  it('chips are toggle buttons (aria-pressed), not tabs, with a count each', () => {
    expect(group.getAttribute('role')).toBe('group');
    const chips = [...group.querySelectorAll('button')];
    expect(chips.length).toBe(4);
    for (const c of chips) {
      expect(c.getAttribute('role')).toBeNull();
      expect(c.hasAttribute('[attr.aria-pressed]')).toBe(true);
      expect(c.hasAttribute('[class.pf-tabs__btn--on]')).toBe(true);
      expect(c.querySelector('.pf-tabs__count')).not.toBeNull();
    }
  });

  it('the date filter is no longer hidden behind the In progress chip', () => {
    expect(html).not.toMatch(/@if \(rightTab\(\) === 'ip'\) \{\s*<div class="flex items-center gap-1\.5 ml-auto"/);
    const i = html.indexOf('Filter by status');
    const j = html.indexOf('<!-- Date filters for Right Pane -->');
    expect(html.slice(i, j)).not.toMatch(/@if \(rightTab\(\)/);
  });

  it('each single-status chip still renders its own list under statusShown, gated to that chip', () => {
    for (const s of ['ip', 'done', 'billing']) expect(html).toContain(`@if (statusShown('${s}')`);
    // The sectioned "all statuses" render (a header + list per feed, incl. a
    // separate embedded Outsourced list) is gone — replaced by ONE merged
    // list (work-merge.ts) when no chip is on.
    expect(html).not.toContain("@else if (rightTab() === null && outsourcing.visible().length > 0)");
    expect(html).toContain('@if (rightTab() === null) {');
    expect(html).toContain('data-list="merged"');
    expect(doc.querySelector('[data-empty="all"]')).not.toBeNull();
  });
});
