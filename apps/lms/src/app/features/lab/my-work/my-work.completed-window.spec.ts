import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { MyWorkComponent } from './my-work.component';
import { ApiService } from '../../../core/services/api.service';
import { DraftShelfService } from '../../../core/services/draft-shelf.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ScanService } from '../../../core/services/scan.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';
import { istDayStart, labDaysAgo } from '../../../shared/utils/lab-clock';

/**
 * My Work → Completed (owner 2026-10-09): used to always show the last 7
 * days — "Showing the last 7 days." with no way to narrow it. Defaults to
 * TODAY only now, with a small Today/7-days toggle (no existing range
 * control to reuse). The IST calendar-day cutoff — never a rolling
 * `Date.now() - N*24h` one, which drifts across the IST midnight boundary.
 */
function harness(getMock: ReturnType<typeof vi.fn>) {
  const loose = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
  // MyWorkComponent reads window.matchMedia (phone layout) when constructed; the unit-test DOM has none (this spec
  // used to pass only when an earlier spec in the same run had left its own stub behind).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: getMock, post: vi.fn(() => of({})) } },
      { provide: DraftShelfService, useValue: loose() },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ToastService, useValue: loose() },
      { provide: DialogService, useValue: loose() },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true, dispatchStepEnabled: () => false } },
      { provide: BranchLabConfigService, useValue: loose() },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: TenantEntitlementsService, useValue: loose() },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: TenantStateService, useValue: { tenant: signal(null), ensureLoaded: () => undefined } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn(), url: '/lab/my-work', events: of(), createUrlTree: () => ({}), serializeUrl: () => '' } },
    ],
  });
  return TestBed.runInInjectionContext(() => new MyWorkComponent()) as any;
}

/** A minimal OrderTest-shaped row `completedTubes()` can group. */
function row(id: string, resultedAtIso: string) {
  return {
    id, subOrderId: 's-' + id, testId: 't-' + id, status: 'validated',
    resultedAt: resultedAtIso, validatedAt: null,
    test: { id: 't-' + id, name: 'Glucose' },
    subOrder: { id: 's-' + id, barcode: 'B-' + id, openLines: 0, order: { patient: { displayName: 'Pat' } } },
  };
}

describe('My Work — Completed defaults to TODAY, with a Today/7-days toggle', () => {
  it('defaults to Today (completedDays() === 1), never the old 7-day default', () => {
    const c = harness(vi.fn(() => of([])));
    expect(c.completedWindow()).toBe('today');
    expect(c.completedDays()).toBe(1);
  });

  it('switching to "7 days" re-requests the server with days=7, switching back re-requests days=1', () => {
    const get = vi.fn(() => of([]));
    const c = harness(get);
    get.mockClear();

    c.setCompletedWindow('7d');
    expect(c.completedDays()).toBe(7);
    expect(get).toHaveBeenCalledWith(expect.stringContaining('days=7'));

    get.mockClear();
    c.setCompletedWindow('today');
    expect(c.completedDays()).toBe(1);
    expect(get).toHaveBeenCalledWith(expect.stringContaining('days=1'));
  });

  it('re-selecting the SAME window is a no-op (no extra request)', () => {
    const get = vi.fn(() => of([]));
    const c = harness(get);
    get.mockClear();
    c.setCompletedWindow('today');
    expect(get).not.toHaveBeenCalled();
  });

  it('completedTubes(): the Today window excludes a row from YESTERDAY (IST), even one minute before midnight — never a rolling 24h window', () => {
    const todayIstStartUtc = istDayStart(labDaysAgo(0));
    const yesterdayLate = new Date(todayIstStartUtc.getTime() - 60_000).toISOString();  // 23:59 IST yesterday
    const todayEarly = new Date(todayIstStartUtc.getTime() + 60_000).toISOString();     // 00:01 IST today

    const c = harness(vi.fn(() => of([row('y', yesterdayLate), row('t', todayEarly)])));
    c.loadCompleted();

    const ids = c.completedTubes().map((t: { sampleId: string }) => t.sampleId);
    expect(ids).toContain('s-t');
    expect(ids).not.toContain('s-y');
  });

  it('completedTubes(): switching to 7 days brings the week-old (but not 8-day-old) row back', () => {
    const todayIstStartUtc = istDayStart(labDaysAgo(0));
    const sixDaysAgo = new Date(todayIstStartUtc.getTime() - 6 * 86_400_000 + 3_600_000).toISOString();
    const eightDaysAgo = new Date(todayIstStartUtc.getTime() - 8 * 86_400_000 + 3_600_000).toISOString();

    const c = harness(vi.fn(() => of([row('w', sixDaysAgo), row('old', eightDaysAgo)])));
    c.setCompletedWindow('7d');
    c.loadCompleted();

    const ids = c.completedTubes().map((t: { sampleId: string }) => t.sampleId);
    expect(ids).toContain('s-w');
    expect(ids).not.toContain('s-old');
  });
});
