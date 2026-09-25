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

/** My Work in the new design: palette only (no colour dots on the tabs). */
function make(newDesign: boolean) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const loose = () => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => undefined) });
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: { get: vi.fn(() => of([])), post: vi.fn(() => of({})) } },
      { provide: DraftShelfService, useValue: loose() },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ToastService, useValue: loose() },
      { provide: DialogService, useValue: loose() },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true, dispatchStepEnabled: () => false } },
      { provide: BranchLabConfigService, useValue: loose() },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: TenantEntitlementsService, useValue: loose() },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: ThemeService, useValue: { isNewDesign: () => newDesign, isDark: () => false } },
      { provide: Router, useValue: { navigate: vi.fn() } },
    ],
  });
  return TestBed.runInInjectionContext(() => new MyWorkComponent()) as any;
}

describe('My Work — new-design remap', () => {
  it('band tabs carry counts but no colour dots in the new design', () => {
    const c = make(true);
    const opts = c.tabOptions();
    expect(opts.length).toBeGreaterThanOrEqual(3);
    for (const o of opts) {
      expect(o.dot).toBeUndefined();
      expect(typeof o.count).toBe('number');
    }
  });

  it('classic keeps its colour dots', () => {
    const c = make(false);
    expect(c.tabOptions().every((o: any) => !!o.dot)).toBe(true);
  });
});

describe('My Work — counter row hidden in the new design', () => {
  it('the queue filter defaults to "all" (nothing is filtered while the row is hidden)', () => {
    const c = make(true);
    expect(c.counter()).toBe('all');
  });
});
