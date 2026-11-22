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

/**
 * Collect page, TWO-PANEL (wide, new design): the queue is the side card, the selected patient's collection is hosted
 * inline in the main card (first patient auto-selected, Done moves to the next). Narrow screens keep the grid + drawer.
 */
const S = (id: string, orderId: string, name: string, status = 'pending', at = '2026-09-25T00:00:00Z') => ({
  id, orderId, status, barcode: 'B-' + id, specimenType: 'Serum', tubeColor: 'red',
  tests: [{ test: { name: 'Glucose', sampleType: 'Serum' } }], createdAt: at,
  order: { orderNumber: 'LAB-' + orderId, patient: { id: 'p-' + orderId, displayName: name, age: 44, sex: 'Female', mrn: 'AA0007' } },
});

function render(pending: any[], wide = true) {
  (window as any).matchMedia = (q: string) => ({ matches: wide && q.includes('1024'), media: q, addEventListener() {}, removeEventListener() {} });
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
  f.detectChanges();
  return { f, c, el: f.nativeElement as HTMLElement };
}

describe('Sample collection — two-panel (wide)', () => {
  afterEach(() => { document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove()); delete (window as any).matchMedia; });
  const queue = [S('a', 'o1', 'Ms. First Patient'), S('b', 'o2', 'Mr. Second Patient', 'pending', '2026-09-25T01:00:00Z')];

  it('shows the queue as the side card and auto-selects the oldest patient into the hosted main card', async () => {
    const { f, c, el } = render(queue);
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
    await new Promise(r => setTimeout(r, 0));
    f.detectChanges();
    expect(c.hosted()).toBe(true);
    expect(el.querySelector('[data-testid="collect-two-panel"]')).not.toBeNull();
    expect(el.querySelectorAll('.pf-sc-qrow').length).toBe(2);
    expect(el.querySelector('.pf-sc-qrow.is-on')!.textContent).toContain('First Patient');
    expect(el.querySelector('.pf-drawer--hosted .pf-sc-hhead')!.textContent).toContain('First Patient');
    expect(el.querySelector('.pf-drawer.pf-fullscreen')).toBeNull();     // inline, not an overlay
    expect(el.querySelector('footer.pf-sc-foot')).toBeNull();            // actions live in the head
    expect(el.querySelector('pf-hero-band .pf-hb-btn')).toBeNull();      // no band-corner Refresh
  });

  it('picking another patient swaps the collection in the main card', async () => {
    const { f, c, el } = render(queue);
    await new Promise(r => setTimeout(r, 0)); f.detectChanges(); await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    (el.querySelectorAll('.pf-sc-qrow')[1] as HTMLButtonElement).click();
    f.detectChanges();
    expect(c.openOrderId()).toBe('o2');
    expect(el.querySelector('.pf-drawer--hosted .pf-sc-hhead')!.textContent).toContain('Second Patient');
  });

  it('narrow screens are not hosted: grid + overlay drawer as before', async () => {
    const { f, c, el } = render(queue, false);
    await new Promise(r => setTimeout(r, 0)); f.detectChanges();
    expect(c.hosted()).toBe(false);
    expect(el.querySelector('[data-testid="collect-two-panel"]')).toBeNull();
    expect(el.querySelectorAll('.pf-sc__pcard').length).toBe(2);
    expect(c.openOrderId()).toBeNull();
  });
});
