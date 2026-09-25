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
function make(newDesign: boolean, web = false) {
  (window as any).matchMedia = (q: string) => ({ matches: web && q === '(hover: hover) and (pointer: fine)', addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
      // Selected state is the icon chip, so every tab needs an icon.
      expect(o.iconPath?.length).toBeGreaterThan(0);
    }
  });

  it('classic keeps its colour dots', () => {
    const c = make(false);
    expect(c.tabOptions().every((o: any) => !!o.dot)).toBe(true);
    expect(c.tabOptions().every((o: any) => o.iconPath === undefined)).toBe(true);
  });
});

describe('My Work — counter row hidden in the new design', () => {
  it('the queue filter defaults to "all" (nothing is filtered while the row is hidden)', () => {
    const c = make(true);
    expect(c.counter()).toBe('all');
  });
});

describe('My Work — round 5 (owner): headers, counts, row actions, dots', () => {
  const css = () => ((MyWorkComponent as any).ɵcmp.styles as string[]).join('\n');

  it('pane header label has no fill; only the icon chip is tinted', () => {
    // The classic tab-strip track behind icon + word is stripped in the new design…
    expect(css()).toMatch(/\.design-new[^{]*\.pf-mw-tabs[^{]*\{[^}]*background:\s*none/);
    // …and the title itself never carries a background.
    expect(css()).toMatch(/\.pf-mw-pane__title[^{]*\{[^}]*background:\s*none/);
  });

  it('row actions follow the device mode: text on web, icon on touch', () => {
    expect(make(true, true).webPointer()).toBe(true);
    TestBed.resetTestingModule();
    expect(make(true, false).webPointer()).toBe(false);
  });

  it('NORMAL group dot is neutral in the new design (no green)', () => {
    const rule = css().match(/\.design-new[^{]*\.pf-dot\[data-level=["']?normal["']?\][^{]*\{([^}]*)\}/);
    expect(rule).toBeTruthy();
    expect(rule![1]).not.toMatch(/#10b981|#34d399|16,\s*185,\s*129/i);
  });

  it('queue "done" stat is violet, not green, in the new design', () => {
    expect(css()).toMatch(/\.design-new[^{]*\.pf-tq__stat--done[^{]*\{[^}]*violet-text/);
  });

  it('pane count is pluralised', () => {
    const c = make(true);
    expect(c.paneCountLabel()).toBe('0 items');
    expect(c.plural(1, 'sample')).toBe('1 sample');
    expect(c.plural(2, 'sample')).toBe('2 samples');
  });
});
