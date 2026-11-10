import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
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

/**
 * Lab → Completed → Print (owner 2026-10-09): when every test on the order is
 * validated but no report exists yet, Print used to block on a "Report not
 * generated yet — Generate now?" confirm dialog. Print should just print:
 * generate the final report with the SAME call "Generate now" used, then
 * print it — no dialog. If generation turns out to be impossible, a clear
 * toast takes the dialog's place, never a silent no-op.
 */
function harness(opts: {
  get?: ReturnType<typeof vi.fn>;
  post?: ReturnType<typeof vi.fn>;
}) {
  // MyWorkComponent reads window.matchMedia (phone layout) when constructed; the unit-test DOM has none
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const dialogConfirm = vi.fn(() => Promise.resolve(true));
  const toastError = vi.fn();
  const loose = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
  TestBed.configureTestingModule({
    providers: [
      {
        provide: ApiService,
        useValue: { get: opts.get ?? vi.fn(() => of(null)), post: opts.post ?? vi.fn(() => of({})) },
      },
      { provide: DraftShelfService, useValue: loose() },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ToastService, useValue: { error: toastError, success: vi.fn() } },
      { provide: DialogService, useValue: { confirm: dialogConfirm, actions: vi.fn(() => Promise.resolve({ action: null })) } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true, dispatchStepEnabled: () => false } },
      { provide: BranchLabConfigService, useValue: loose() },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: TenantEntitlementsService, useValue: loose() },
      // deliver_report ⇒ canReleaseReport() is true ⇒ a complete order plans 'generate'.
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: TenantStateService, useValue: { tenant: signal(null), ensureLoaded: () => undefined } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn(), url: '/lab/my-work', events: of(), createUrlTree: () => ({}), serializeUrl: () => '' } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new MyWorkComponent()) as any;
  return { c, dialogConfirm, toastError };
}

const READY_TO_GENERATE = { hasReport: false, complete: true, pending: [], partialSampleIds: [] };

describe('My Work — Completed → Print generates automatically, no confirm dialog', () => {
  it('every test validated, no report yet: Print calls the SAME "Generate now" endpoint directly, no dialog', async () => {
    const get = vi.fn(() => of(READY_TO_GENERATE));
    const { c, dialogConfirm } = harness({ get });
    const releaseAndPrint = vi.fn(() => Promise.resolve());
    c.releaseAndPrint = releaseAndPrint;

    await c.explainNoReport('order-1');

    expect(dialogConfirm).not.toHaveBeenCalled();
    expect(releaseAndPrint).toHaveBeenCalledTimes(1);
    expect(releaseAndPrint).toHaveBeenCalledWith('/api/reports/generate', { orderId: 'order-1', type: 'final' });
  });

  it('generation turns out to be impossible (a line was un-validated): a clear toast, never a dialog', async () => {
    const get = vi.fn(() => of(READY_TO_GENERATE));
    const post = vi.fn(() =>
      throwError(() => ({ error: { message: 'Cannot release the final report — 2 test(s) not yet validated: CBC, LFT.' } })));
    const { c, dialogConfirm, toastError } = harness({ get, post });

    await c.explainNoReport('order-2');

    expect(dialogConfirm).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Cannot release the final report — 2 test(s) not yet validated: CBC, LFT.');
  });

  it('report already exists (the by-order read raced): prints it directly, no generate call', async () => {
    const get = vi.fn(() => of({ hasReport: true, reportId: 'r1', reportType: 'final', complete: true, pending: [], partialSampleIds: [] }));
    const post = vi.fn(() => of({}));
    const { c, dialogConfirm } = harness({ get, post });
    const printReport = vi.fn(() => Promise.resolve());
    c.printReport = printReport;

    await c.explainNoReport('order-3');

    expect(dialogConfirm).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
