import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { ReceiveSamplesComponent } from './receive-samples.component';
import { ApiService } from '../../../core/services/api.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ScanService } from '../../../core/services/scan.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ToastService } from '../../../core/services/toast.service';
import { ThemeService } from '../../../core/services/theme.service';
import { SampleSearchPresetService } from '../../../core/services/sample-search-preset.service';
import { timedKeyboard } from '../../../shared/scan/hardware-scan.spec-helpers';

/** Receive samples — a hardware barcode scanner works from anywhere on the
 *  screen (focus or not), a dispatch package code previews the package, a
 *  tube QR receives its Sample ID, and the ND camera button follows the lab's
 *  Scan / Manual setting like every other camera button. */
function render(o: { embedded?: boolean; manual?: boolean } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/samples/by-barcode/')) return of({ id: 'db-1', barcode: decodeURIComponent(url.split('/').pop()!) });
      if (url.startsWith('/api/dispatch-packages/')) return of({ code: 'PKG-7XQ4M2', orderCount: 2, orders: [] });
      return of([]);
    }),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ScanService, useValue: { manualEntry: () => !!o.manual } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', branchId: 'b1' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ vendorCode: 'MW' }), ensureLoaded() {} } },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, sampleFocused: () => false, standaloneLab: () => false, config: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
      { provide: SampleSearchPresetService, useValue: { ensure: () => {}, current: () => null } },
    ],
  });
  const f = TestBed.createComponent(ReceiveSamplesComponent);
  f.componentInstance.embedded = o.embedded ?? false;
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, api, kb: timedKeyboard() };
}

describe('Receive samples — hardware barcode scanner', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('a scan with nothing focused receives the tube (iPad: no keyboard up)', () => {
    const { api, kb } = render();
    kb.scan('HAEM260800001');
    expect(api.get).toHaveBeenCalledWith('/api/samples/by-barcode/HAEM260800001');
    expect(api.patch).toHaveBeenCalledWith('/api/samples/db-1/receive');
  });

  it('a tube QR (MRN|SampleID) receives the Sample ID', () => {
    const { api, kb } = render();
    kb.scan('MW-26-0012|HAEM260800001');
    expect(api.get).toHaveBeenCalledWith('/api/samples/by-barcode/HAEM260800001');
  });

  it('a PKG- code previews the dispatch package; a bare suffix scanned into the package box too', () => {
    const { el, api, kb } = render();
    kb.scan('PKG-7XQ4M2');
    expect(api.get).toHaveBeenCalledWith('/api/dispatch-packages/PKG-7XQ4M2');
    api.get.mockClear();
    kb.wait(500);
    const box = el.querySelector('.pf-rs-scanrow--pkg input') as HTMLInputElement;
    kb.scan('7XQ4M2', box);
    expect(api.get).toHaveBeenCalledWith('/api/dispatch-packages/PKG-7XQ4M2');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/samples/by-barcode/'));
  });

  it('people typing in the package box are untouched (no lookup until their own Enter)', () => {
    const { el, api, kb } = render();
    const box = el.querySelector('.pf-rs-scanrow--pkg input') as HTMLInputElement;
    kb.human('PKG-1', box, null);
    expect(box.value).toBe('PKG-1');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/dispatch-packages/'));
  });

  it('embedded in My Work: the host routes scans, this pane does not', () => {
    const { api, kb } = render({ embedded: true });
    kb.scan('HAEM260800001');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/api/samples/by-barcode/'));
  });

  it('Manual lab: no ND camera button in the band, but a connected scanner still works', () => {
    let r = render();
    expect(r.el.querySelector('pf-hero-band button[aria-label="Scan with camera"]')).not.toBeNull();
    TestBed.resetTestingModule();
    r = render({ manual: true });
    expect(r.el.querySelector('pf-hero-band button[aria-label="Scan with camera"]')).toBeNull();
    r.kb.scan('HAEM260800001');
    expect(r.api.get).toHaveBeenCalledWith('/api/samples/by-barcode/HAEM260800001');
  });
});
