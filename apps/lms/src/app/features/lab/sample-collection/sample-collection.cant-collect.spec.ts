import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { SampleCollectionComponent } from './sample-collection.component';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { PrintConfigService } from '../../../core/printer/print-config.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { ScanService } from '../../../core/services/scan.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ThemeService } from '../../../core/services/theme.service';

/**
 * QA #6 (i) — "Can't collect": pick a reason, submit → BLANK PAGE.
 *
 * Root cause: submitReject() cleared the open order without navigating. On a
 * deep link (Frontdesk "Collect" → /lab/collect?orderId=…&from=/frontdesk) the
 * queue is suppressed, so with no open order the page fell into the "Opening
 * collection…" skeleton for ever. Now it records the not-collected state with
 * the reason, toasts, and returns to where the user came from (or the queue).
 */
const S = (id: string, status = 'pending', extra: Record<string, unknown> = {}) => ({
  id, orderId: 'o1', status, barcode: 'B-' + id, tubeColor: 'red', rejectionCount: 0,
  tests: [{ test: { name: 'Glucose', sampleType: 'Serum' } }], createdAt: '2026-09-25T00:00:00Z',
  order: { id: 'o1', orderNumber: 'LAB-2609-000085', createdAt: '2026-09-25T00:00:00Z',
    patient: { id: 'p1', displayName: 'Ms. Paravai Munusamy', age: 44, sex: 'Female', mrn: 'AA0007' } },
  ...extra,
});

function render(opts: { pending: any[]; order?: any; deepLink?: boolean; patch?: (url: string, body?: unknown) => any }) {
  const api = {
    get: vi.fn((url: string) => {
      if (url.includes('pending-collection')) return of(opts.pending);
      if (url === '/api/orders/o1') return of(opts.order ?? null);
      return of([]);
    }),
    post: vi.fn(() => of({})),
    patch: vi.fn(opts.patch ?? ((url: string) => of({ id: url.split('/')[3], status: 'rejected' }))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
  const dialog = { confirm: vi.fn(async () => true) };
  const q = new Map<string, string>(opts.deepLink ? [['orderId', 'o1'], ['from', '/frontdesk']] : []);
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: toasts },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: dialog },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => true, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: q } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(SampleCollectionComponent);
  const c = f.componentInstance as any;
  f.detectChanges();
  return { f, c, api, toasts, router, dialog, el: f.nativeElement as HTMLElement };
}

const tick = () => new Promise(r => setTimeout(r, 0));
const drawerOf = (f: any): HTMLElement =>
  (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;

async function openCantCollect(f: any, c: any) {
  await tick();
  c._openOrderId.set('o1');
  f.detectChanges();
  await tick();
  f.detectChanges();
  const btn = drawerOf(f).querySelector('[aria-label="Can\'t collect"]') as HTMLButtonElement;
  expect(btn).not.toBeNull();
  expect(btn.disabled).toBe(false);
  btn.click();
  f.detectChanges();
}

function pickReasonAndSubmit(f: any, label: string) {
  const root = f.nativeElement as HTMLElement;
  const chip = [...root.querySelectorAll<HTMLButtonElement>('.pf-rej__chip')].find(b => b.textContent!.trim() === label)!;
  chip.click();
  f.detectChanges();
  const submit = root.querySelector('.pf-rej__foot .pf-btn-danger') as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  expect(submit.textContent).toContain('not collected');
  submit.click();
}

describe("Sample collection — Can't collect (QA #6)", () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  it('deep link from the Frontdesk: submit records the reason and returns to the Frontdesk (no blank page)', async () => {
    const { f, c, api, toasts, router } = render({
      pending: [S('a'), S('b')], deepLink: true, order: { id: 'o1', samples: [] },
    });
    await openCantCollect(f, c);
    pickReasonAndSubmit(f, 'Patient refused');
    await tick(); await tick();
    f.detectChanges();

    // The right API call, once per pending tube, with the reason label.
    const rejects = api.patch.mock.calls.filter(([u]) => String(u).endsWith('/reject'));
    expect(rejects.map(([u]) => u).sort()).toEqual(['/api/samples/a/reject', '/api/samples/b/reject']);
    expect(rejects[0][1]).toEqual({ reason: 'Patient refused' });
    // Clear toast + back to where the user came from — never stranded on the
    // "Opening collection…" skeleton.
    expect(toasts.success).toHaveBeenCalledWith('2 tubes marked not collected — Patient refused');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
    expect(c._rejectModal()).toBeNull();
  });

  it('queue mode: stays on the collection screen, the queue renders (not the skeleton)', async () => {
    const { f, c, api, router } = render({ pending: [S('a')] });
    await openCantCollect(f, c);
    pickReasonAndSubmit(f, 'Vein not found');
    await tick(); await tick();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/samples/a/reject', { reason: 'Vein not found' });
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c.openOrderId()).toBeNull();
    expect(f.nativeElement.querySelector('.pf-sc-skel')).toBeNull();
    // Refetched the queue once the drawer closed.
    expect(api.get.mock.calls.filter(([u]) => String(u).includes('pending-collection')).length).toBeGreaterThan(1);
  });

  it('a free-text note rides along with the reason', async () => {
    const { f, c, api } = render({ pending: [S('a')] });
    await openCantCollect(f, c);
    c.setRejectReason('other');
    c.setRejectNote('Patient left before the draw');
    await c.submitReject();
    expect(api.patch).toHaveBeenCalledWith('/api/samples/a/reject', { reason: 'Other — Patient left before the draw' });
  });

  it('when the server refuses, the dialog stays open with the error — nothing navigates', async () => {
    const { f, c, toasts, router } = render({
      pending: [S('a')], deepLink: true, order: { id: 'o1', samples: [] },
      patch: () => throwError(() => ({ error: { message: 'Validated samples cannot be rejected.' } })),
    });
    await openCantCollect(f, c);
    pickReasonAndSubmit(f, 'Patient refused');
    await tick(); await tick();
    f.detectChanges();
    expect(toasts.error).toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c._rejectModal()).not.toBeNull();
    expect(c.openOrderId()).toBe('o1');
  });

  it('a not-collected tube reads "Not collected · reason" — never drawn, never "Dispatched"', async () => {
    const { f, c } = render({
      pending: [S('a', 'collected', { collectedAt: '2026-09-25T01:00:00Z' }), S('b', 'rejected', { rejectedReason: 'Patient refused' })],
    });
    await tick();
    c._openOrderId.set('o1');
    f.detectChanges();
    await tick();
    f.detectChanges();
    const drawer = drawerOf(f);
    const nc = drawer.querySelector('.pf-tube__stamp--nc')!;
    expect(nc.textContent!.trim()).toBe('Not collected · Patient refused');
    expect(drawer.textContent).not.toContain('Dispatched to lab');
    const g = c.activeGroup();
    expect(g.collected).toBe(1);
    expect(g.notCollected).toBe(1);
    expect(c.isDispatched(g)).toBe(false);
    // The collected sibling can still go (partial dispatch); the not-collected
    // tube is never offered as dispatchable.
    expect(c.canPartialDispatch(g)).toBe(true);
    c.startPartialDispatch(g);
    expect([...c.dispatchSelect()]).toEqual(['a']);
    // Timeline: its own "Not collected" stop with the reason.
    const tl = c.collectTimeline(g).find((s: any) => s.key === 'not_collected');
    expect(tl.note).toBe('1 of 2 · Patient refused');
    // Done isn't blocked by the settled tube.
    expect(c.doneDisabled(g)).toBe(false);
  });

  it('tapping a not-collected tube offers Recollect → PATCH recollect → pending', async () => {
    const { f, c, api, dialog } = render({ pending: [S('b', 'rejected', { rejectedReason: 'Patient refused' })] });
    await tick();
    c._openOrderId.set('o1');
    f.detectChanges();
    c.toggleCollected(c.activeGroup().samples[0]);
    await tick(); await tick();
    expect(dialog.confirm).toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith('/api/samples/b/recollect', {});
    expect(c.activeGroup().samples[0].status).toBe('pending');
  });
});
