import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
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
import { signal } from '@angular/core';

/**
 * Band "Collect" (pf-collect-band-button) lands here. With an order it is the
 * existing deep link (back = ?from, default /frontdesk); without one it is the
 * general queue, and Back on the queue band returns to ?from.
 */
function make(q: Record<string, string>) {
  const perms: string[] = []; const dispatchStep = false; const pending: any[] = [];
  const router = { navigate: vi.fn(), navigateByUrl: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending : [])), post: vi.fn(() => of({})), patch: vi.fn(() => of({})) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p), user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => dispatchStep, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map(Object.entries(q)) } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new SampleCollectionComponent()) as any;
  return { c, router };
}

describe('Collect page — back target from the band Collect button', () => {
  it('general queue (?from, no orderId): Back returns to the calling screen', async () => {
    const { c, router } = make({ from: '/billing-counter' });
    await c.ngOnInit();
    expect(c.queueFrom()).toBe('/billing-counter');
    expect(c.deepLinkMode()).toBe(false);
    c.queueBackFn();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/billing-counter');
  });

  it('plain queue (no ?from): no back target', async () => {
    const { c } = make({});
    await c.ngOnInit();
    expect(c.queueFrom()).toBeNull();
  });

  it('rejects a non-app ?from', async () => {
    const { c } = make({ from: '//evil.example' });
    await c.ngOnInit();
    expect(c.queueFrom()).toBeNull();
  });

  it('patient-specific (?orderId&from): opens that order; closing returns to ?from', async () => {
    const { c, router } = make({ orderId: 'o1', from: '/frontdesk/order?orderId=o1' });
    await c.ngOnInit();
    expect(c.deepLinkMode()).toBe(true);
    c.close();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/frontdesk/order?orderId=o1');
  });
});
