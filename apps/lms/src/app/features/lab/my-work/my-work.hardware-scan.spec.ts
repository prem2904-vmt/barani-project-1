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
import { timedKeyboard } from '../../../shared/scan/hardware-scan.spec-helpers';

/**
 * My Work — a hardware barcode scanner works from anywhere on the screen
 * (focus or not): a scan into the Lab Intake box receives the tube, every
 * other scan goes through the band (open / claim-by-scan) exactly like typing
 * it there + Enter; a tube QR (MRN|SampleID) is reduced to the Sample ID.
 */
function harness(getMock: ReturnType<typeof vi.fn>) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const loose = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
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

describe('My Work — hardware barcode scanner', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a scan with nothing focused goes through the band (resolve → result entry), as the Sample ID', () => {
    const get = vi.fn(() => of({ sampleId: 's1', orderId: 'o1' }));
    const c = harness(get);
    timedKeyboard().scan('MW-26-0012|HAEM260800001');
    expect(get).toHaveBeenCalledWith('/api/results/resolve-sample?barcode=HAEM260800001');
    expect((TestBed.inject(Router) as any).navigate).toHaveBeenCalledWith(['/lab/sample', 's1']);
    expect(c._scan()).toBe('');
  });

  it('a scan into the Lab Intake box receives the tube instead', () => {
    const get = vi.fn(() => of({}));
    const c = harness(get);
    const box = document.createElement('input');
    document.body.appendChild(box);
    const receiveByCode = vi.fn();
    c.intakeSearchField = () => ({ nativeElement: box });
    c.intakeRef = () => ({ receiveByCode });
    try {
      timedKeyboard().scan('MRN1|HAEM260800001', box);
      expect(receiveByCode).toHaveBeenCalledWith('HAEM260800001');
      expect(box.value).toBe('');
      expect(get).not.toHaveBeenCalledWith(expect.stringContaining('resolve-sample'));
    } finally { box.remove(); }
  });

  it('an order QR (/o/<id>) still opens the order', () => {
    const c = harness(vi.fn(() => of({})));
    timedKeyboard().scan('https://lab.example/o/1234abcd-1111-2222-3333-444455556666');
    expect((TestBed.inject(Router) as any).navigate).toHaveBeenCalledWith(['/o', '1234abcd-1111-2222-3333-444455556666']);
    expect(c._scan()).toBe('');
  });
});
