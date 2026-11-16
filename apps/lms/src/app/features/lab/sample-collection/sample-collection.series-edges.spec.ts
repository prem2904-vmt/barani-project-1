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


const S = (id: string, status: string, off: number | null, extra: Record<string, unknown> = {}) => ({
  id, orderId: 'o1', status, barcode: 'B-' + id, tubeColor: 'grey', rejectionCount: 0, repeatOffsetMin: off,
  repeatSeriesKey: off == null ? null : 'ogtt',
  tests: [{ test: { name: 'Glucose', sampleType: 'Plasma' } }], createdAt: '2026-11-12T00:00:00Z',
  order: { id: 'o1', orderNumber: 'LAB-1', createdAt: '2026-11-12T00:00:00Z',
    patient: { id: 'p1', displayName: 'Demo Patient', age: 40, sex: 'Female', mrn: 'AA1' } },
  ...extra,
});
const tick = () => new Promise(r => setTimeout(r, 0));


const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

/**
 * Re-test 2026-11-13 (rt-lab): edge cases of OPS-124 / OPS-130 / OPS-129 on a three-draw timed series
 * (OGTT shape: fasting 0, +60, +120).
 */
describe('Sample collection - three-draw series edges (OPS-124 / 130 / 129)', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  async function open(pending: any[], deepLink = true) {
    const r = render({ pending, deepLink, order: { id: 'o1', samples: [] } });
    await tick(); r.c._openOrderId.set('o1'); r.f.detectChanges(); await tick(); r.f.detectChanges();
    return r;
  }
  const byId = (c: any, id: string) => c._pending().find((x: any) => x.id === id);

  it('OPS-142 second draw (due) with the third still locked: stays open until Done for now / Dispatch', async () => {
    const { c, router, toasts } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'pending', 60), S('c', 'pending', 120)]);
    expect(c.tubeState(byId(c, 'b')).kind).toBe('due');
    expect(c.tubeState(byId(c, 'c')).kind).toBe('locked');
    c.markCollected(byId(c, 'b'));
    await tick();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c._openOrderId()).toBe('o1');
    expect(toasts.success).not.toHaveBeenCalledWith('Collected');
    c.close();                                        // Done for now
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('OPS-142 a missed middle draw does not hold Done: drawing the last one stays, Done then leaves', async () => {
    const { c, router } = await open([
      S('a', 'collected', 0, { collectedAt: ago(200) }), S('b', 'pending', 60), S('c', 'pending', 120)]);
    expect(c.tubeState(byId(c, 'b')).kind).toBe('missed');
    expect(c.tubeState(byId(c, 'c')).kind).toBe('due');
    expect(c.doneDisabled(c.activeGroup())).toBe(true); // c is still collectable now
    c.markCollected(byId(c, 'c'));
    await tick();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c.doneDisabled(c.activeGroup())).toBe(false);
    c.close();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('a missed draw reopened by double-tap becomes collectable and holds the drawer until drawn', async () => {
    const { c, router } = await open([
      S('a', 'collected', 0, { collectedAt: ago(200) }), S('b', 'pending', 60), S('c', 'collected', 120)]);
    c.reopened.set(new Set(['b']));
    expect(c.tubeState(byId(c, 'b')).kind).toBe('due');
    expect(c.doneDisabled(c.activeGroup())).toBe(true);
    c.markCollected(byId(c, 'b'));
    await tick();
    // everything is drawn now: Dispatch is the next step, the drawer stays for it
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('the LAST draw of the series stays open: Dispatch is the very next step (no Done)', async () => {
    const { c, router, f } = await open([
      S('a', 'collected', 0, { collectedAt: ago(200) }), S('b', 'collected', 60), S('c', 'pending', 120)]);
    c.markCollected(byId(c, 'c'));
    await tick(); f.detectChanges();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(c.dispatchNextStep(c.activeGroup())).toBe(true);
  });

  it('Dispatch of the first draws while a later draw is still locked: tubes patched, then leaves', async () => {
    const { c, api, router, f } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'collected', 60), S('c', 'pending', 120)]);
    f.detectChanges();
    await c.dispatchCollected(c.activeGroup());
    const urls = api.patch.mock.calls.map(([u]: any[]) => u);
    expect(urls).toEqual(['/api/samples/a/dispatch', '/api/samples/b/dispatch']);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('Dispatch while another tube is collectable NOW stays open (nothing to leave yet)', async () => {
    const { c, router } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'pending', 60), S('c', 'pending', 120)]);
    await c.dispatchCollected(c.activeGroup());
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a failed dispatch keeps the drawer and the tube dispatchable', async () => {
    const r = render({
      pending: [S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'pending', 120)], deepLink: true,
      order: { id: 'o1', samples: [] },
      patch: (url: string) => url.endsWith('/dispatch') ? throwError(() => new Error('boom')) : of({}),
    });
    await tick(); r.c._openOrderId.set('o1'); r.f.detectChanges(); await tick();
    await r.c.dispatchCollected(r.c.activeGroup());
    expect(r.router.navigateByUrl).not.toHaveBeenCalled();
    expect(r.toasts.error).toHaveBeenCalled();
    expect(byId(r.c, 'a').status).toBe('collected');
  });

  it('not a deep link (opened from the Collect list): Dispatch closes the drawer to the list', async () => {
    const { c, router } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'pending', 120)], false);
    await c.dispatchCollected(c.activeGroup());
    expect(c._openOrderId()).toBeNull();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a double dispatch tap cannot send twice', async () => {
    const { c, api } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'pending', 120)]);
    const p1 = c.dispatchCollected(c.activeGroup());
    const p2 = c.dispatchCollected(c.activeGroup());
    await Promise.all([p1, p2]);
    expect(api.patch.mock.calls.filter(([u]: any[]) => u.endsWith('/dispatch')).length).toBe(1);
  });

  it('Select tubes mode: helper line is gone while picking, confirm sends only the picked tube', async () => {
    const { c, api, f } = await open([
      S('a', 'collected', 0, { collectedAt: ago(70) }), S('b', 'collected', 60), S('c', 'pending', 120)]);
    c.startPartialDispatch(c.activeGroup());
    c.dispatchSelect.set(new Set(['a']));
    f.detectChanges();
    const d = (document.body.querySelector('.pf-drawer') ?? f.nativeElement) as HTMLElement;
    expect(d.textContent).not.toContain('Select tubes lets you send only some of them');
    await c.confirmPartialDispatch(c.activeGroup());
    expect(api.patch.mock.calls.map(([u]: any[]) => u)).toEqual(['/api/samples/a/dispatch']);
  });

  it('an ordinary order with nothing drawn shows no Select tubes / helper', async () => {
    const { f } = await open([S('a', 'pending', null), S('b', 'pending', null)]);
    const d = (document.body.querySelector('.pf-drawer') ?? f.nativeElement) as HTMLElement;
    expect(d.textContent).not.toContain('Select tubes');
  });
});
