import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
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
import { ThemeService } from '../../../core/services/theme.service';
import { timedKeyboard } from '../../../shared/scan/hardware-scan.spec-helpers';

/**
 * Sample collection — a hardware barcode scanner works from anywhere on the
 * screen (focus or not) and lands exactly like a camera read; a tube QR
 * (MRN|SampleID) finds its Sample ID. Embedded in My Work, only scans typed
 * inside this pane are its own.
 */
const S = (id: string, status = 'pending') => ({
  id, orderId: 'o1', status, barcode: 'HAEM2608' + id, specimenType: 'Serum', tubeColor: 'red',
  tests: [{ test: { name: 'Glucose', sampleType: 'Serum' } }], createdAt: '2026-09-25T00:00:00Z',
  order: { orderNumber: 'LAB-2609-000085', patient: { id: 'p1', displayName: 'Ms. Paravai Munusamy Thirunavukkarasu', age: 44, sex: 'Female', mrn: 'AA0007' } },
});

function render(pending: any[], embedded = false) {
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn((url: string) => of(url.includes('pending-collection') ? pending : [])), post: vi.fn(() => of({})), patch: vi.fn(() => of({ status: 'received' })) } },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => false, isEnabled: () => true } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map() } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn() } },
      { provide: NavBackService, useValue: { showBack: () => false, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(SampleCollectionComponent);
  const c = f.componentInstance as any;
  c.embedded = embedded;
  f.detectChanges();
  return { f, c, el: f.nativeElement as HTMLElement };
}

describe('Sample collection — hardware barcode scanner', () => {
  afterEach(() => { document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()); TestBed.resetTestingModule(); });
  const settle = async (f: any) => { await new Promise(r => setTimeout(r, 0)); f.detectChanges(); };

  it('a scan with nothing focused opens the patient whose tube it is', async () => {
    const { f, c } = render([S('00001')]);
    await settle(f);
    timedKeyboard().scan('HAEM260800001');
    expect(c._openOrderId()).toBe('o1');
    expect(c.scanValue()).toBe('');
  });

  it('a tube QR (MRN|SampleID) finds the Sample ID', async () => {
    const { f, c } = render([S('00001')]);
    await settle(f);
    timedKeyboard().scan('AA0007|HAEM260800001');
    expect(c._openOrderId()).toBe('o1');
  });

  it('an all-digit tube not on the list → exact barcode lookup with the bare Sample ID', async () => {
    const { f } = render([S('00001')]);
    await settle(f);
    const api = TestBed.inject(ApiService) as any;
    timedKeyboard().scan('AA0007|2610099999');
    expect(api.get).toHaveBeenCalledWith('/api/samples/by-barcode/2610099999');
  });

  it('embedded: a scan elsewhere is left to the host; a scan into its own field is its own', async () => {
    const { f, c, el } = render([S('00001')], true);
    await settle(f);
    const kb = timedKeyboard();
    kb.scan('HAEM260800001');
    expect(c._openOrderId()).toBeNull();
    kb.wait(500);
    const field = el.querySelector('.pf-scan__input') as HTMLInputElement;
    kb.scan('HAEM260800001', field);
    expect(c._openOrderId()).toBe('o1');
  });
});
