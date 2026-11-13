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

describe('Sample collection - series auto-return and dispatch (OPS-124 / 130 / 129)', () => {
  afterEach(() => document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()));

  async function open(pending: any[]) {
    const r = render({ pending, deepLink: true, order: { id: 'o1', samples: [] } });
    await tick(); r.c._openOrderId.set('o1'); r.f.detectChanges(); await tick(); r.f.detectChanges();
    return r;
  }

  it('series: drawing the anchor with later draws still pending leaves by itself', async () => {
    const { c, router, toasts } = await open([S('a', 'pending', 0), S('b', 'pending', 120)]);
    c.markCollected(c._pending().find((x: any) => x.id === 'a'));
    await tick();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
    expect(toasts.success).toHaveBeenCalled();
  });

  it('series: stays while a tube that can be drawn NOW is still pending', async () => {
    const { c, router } = await open([S('a', 'pending', 0), S('n', 'pending', null), S('b', 'pending', 120)]);
    c.markCollected(c._pending().find((x: any) => x.id === 'a'));
    await tick();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('a fully drawn order still stays open for the Dispatch step', async () => {
    const { c, router } = await open([S('a', 'pending', null), S('b', 'collected', null)]);
    c.markCollected(c._pending().find((x: any) => x.id === 'a'));
    await tick();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('Dispatch of the drawn tubes leaves the drawer (no Done step afterwards)', async () => {
    const { c, router, f } = await open([S('a', 'collected', 0), S('b', 'pending', 120)]);
    f.detectChanges();
    await c.dispatchCollected(c.activeGroup());
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk');
  });

  it('Choose is now "Select tubes" with a plain helper line', async () => {
    const { f } = await open([S('a', 'collected', 0), S('b', 'pending', 120)]);
    const d = (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;
    const text = d.textContent ?? '';
    expect(text).toContain('Select tubes');
    expect(text).not.toContain('Choose');
    expect(text).toContain('Select tubes lets you send only some of them');
  });
});
