import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Observable, Subject, of } from 'rxjs';
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
 * Sample collection — LOADING FEEDBACK (ND-PATTERN "Loading feedback").
 * The queue never claims "No samples waiting" before it has answered (a
 * skeleton of its rows after 150ms instead), and Dispatch shows its busy
 * state while the dispatch request runs. What is sent is unchanged.
 */
const S = (id: string, status = 'pending') => ({
  id, orderId: 'o1', status, barcode: 'B-' + id, specimenType: 'Serum', tubeColor: 'red',
  tests: [{ test: { name: 'Glucose', sampleType: 'Serum' } }], createdAt: '2026-09-25T00:00:00Z',
  order: { id: 'o1', orderNumber: 'LAB-2609-000085', patient: { id: 'p1', displayName: 'Ms. Asha Rao', age: 44, sex: 'Female', mrn: 'AA0007' } },
});

function render(o: { pending$?: Observable<unknown[]>; dispatch$?: Subject<unknown> } = {}) {
  const api = {
    get: vi.fn((url: string) => url.includes('pending-collection') ? (o.pending$ ?? of([])) : of([])),
    post: vi.fn(() => of({})),
    patch: vi.fn((url: string) => url.endsWith('/dispatch') && o.dispatch$ ? o.dispatch$ : of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: PrinterService, useValue: {} },
      { provide: PrintConfigService, useValue: {} },
      { provide: BranchLabConfigService, useValue: { standaloneLab: () => false, ensureLoaded() {}, config: () => null } },
      { provide: DialogService, useValue: {} },
      { provide: ProcessWorkflowService, useValue: { dispatchStepEnabled: () => true, isEnabled: () => true } },
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
  c.embedded = true;
  f.detectChanges();
  return { f, c, api, el: f.nativeElement as HTMLElement };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('Sample collection — loading feedback', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.querySelectorAll('.pf-drawer').forEach(n => n.remove());
    TestBed.resetTestingModule();
  });

  it('queue on its way: no "No samples waiting" claim; a skeleton of the rows after 150ms', async () => {
    vi.useFakeTimers();
    const pending$ = new Subject<unknown[]>();
    const { f, el } = render({ pending$ });
    expect(el.querySelector('.pf-sc__empty')).toBeNull();
    expect(el.querySelector('pf-skeleton-rows')).toBeNull();      // a fast answer never flashes one
    vi.advanceTimersByTime(160);
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-rows[aria-busy="true"]')).not.toBeNull();
    pending$.next([S('a')]); pending$.complete();
    await flush();
    vi.advanceTimersByTime(300);
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-rows')).toBeNull();
    expect(el.querySelectorAll('.pf-sc__card').length).toBe(1);
  });

  it('an empty queue says so once it has answered', async () => {
    const { f, el } = render({ pending$: of([]) });
    await flush();
    f.detectChanges();
    expect(el.querySelector('.pf-sc__empty')?.textContent).toContain('No samples waiting');
  });

  it('Dispatch: disabled + aria-busy the same frame while the request runs; same request', async () => {
    const dispatch$ = new Subject<unknown>();
    const { f, c, api } = render({ pending$: of([S('a', 'collected'), S('b', 'collected')]), dispatch$ });
    await flush();
    c._openOrderId.set('o1');
    f.detectChanges();
    await flush();
    f.detectChanges();
    const drawer = (f.nativeElement.querySelector('.pf-drawer') ?? document.body.querySelector('.pf-drawer')) as HTMLElement;
    const btn = drawer.querySelector('button[aria-label="Dispatch"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    btn.click();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/orders/o1/dispatch', {});
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    dispatch$.next({}); dispatch$.complete();
    await flush();
    f.detectChanges();
    expect(c.dispatching()).toBe(false);
    expect(drawer.querySelector('[aria-busy="true"]:not(pf-skeleton-rows)')).toBeNull();
  });
});
