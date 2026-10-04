import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { PostPaymentComponent } from './post-payment.component';
import { LabelCardComponent } from './label-card.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';
import { LabelPrintService } from '../../../core/printer/label-print.service';
import { NavBackService } from '../../../core/services/nav-back.service';

/**
 * Post-payment (order complete) — LOADING FEEDBACK (ND-PATTERN "Loading
 * feedback"): the label grid and the sidebar draw their own shape on the
 * first frame (never a blank page while the order is on its way), held for
 * the minimum so it never flashes, and "Print N labels" is busy (disabled +
 * aria-busy, repeat presses swallowed) while the station printer answers.
 */
const ORDER = {
  id: 'o1', patientId: 'p1', status: 'billed', priority: 'Normal', source: 'walk_in', collectionType: 'walk_in',
  createdAt: '2026-09-29T04:00:00Z',
  patient: { id: 'p1', displayName: 'Paravai Munusamy', sex: 'female' },
  samples: [
    { id: 's1', orderId: 'o1', status: 'pending', barcode: '26220', tests: [], department: { name: 'Biochemistry' } },
    { id: 's2', orderId: 'o1', status: 'pending', barcode: '26221', tests: [], department: { name: 'Haematology' } },
  ],
};

function render(opts: { order$?: Subject<any>; print?: () => Promise<string> } = {}) {
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/orders/o1') return opts.order$ ?? of(ORDER);
      return of([]);
    }),
  };
  const labelPrint = { printTubeLabels: vi.fn(opts.print ?? (async () => 'printed')) };
  TestBed.configureTestingModule({
    imports: [PostPaymentComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: new Map([['orderId', 'o1']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn(), events: of() } },
      { provide: NavBackService, useValue: { backTo: vi.fn(), back: vi.fn(), showBack: () => true } },
      { provide: BranchLabConfigService, useValue: { ensureLoaded: vi.fn(), collectsAtFrontdesk: () => false, config: () => ({}) } },
      { provide: ProcessWorkflowService, useValue: { ensureLoaded: vi.fn(), isEnabled: () => false } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: LabelPrintService, useValue: labelPrint },
    ],
  });
  // The label cards draw barcodes; they are not what this spec is about.
  TestBed.overrideComponent(PostPaymentComponent, {
    remove: { imports: [LabelCardComponent] },
    add: { schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(PostPaymentComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance, labelPrint };
}

describe('Post-payment — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first render while the order is on its way = the grid + sidebar skeletons, not a blank page', () => {
    const order$ = new Subject<any>();
    const { el } = render({ order$ });
    expect(el.querySelector('.pf-pp-main pf-skeleton-tiles[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-pp-sidebar pf-skeleton-detail[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-pp-grid')).toBeNull();
  });

  it('the order lands: skeleton held for the minimum (no flash), then the labels', async () => {
    const order$ = new Subject<any>();
    const { f, el } = render({ order$ });
    await Promise.resolve();                     // the request is genuinely async
    vi.advanceTimersByTime(100);
    order$.next(ORDER); order$.complete();
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-tiles')).not.toBeNull();         // held
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-tiles')).toBeNull();
    expect(el.querySelectorAll('.pf-pp-grid pf-label-card').length).toBe(2);
    expect(el.querySelector('.pf-sb-patient__name')?.textContent).toContain('Paravai Munusamy');
  });

  it('an order that is already there (same turn) never shows the skeleton', () => {
    const { el } = render();
    expect(el.querySelector('pf-skeleton-tiles')).toBeNull();
    expect(el.querySelectorAll('.pf-pp-grid pf-label-card').length).toBe(2);
  });

  it('"Print N labels" is disabled + aria-busy while the printer answers; a second press is swallowed', async () => {
    let finish!: (v: string) => void;
    const { f, el, labelPrint } = render({ print: () => new Promise<string>(r => { finish = r; }) });
    const btn = () => el.querySelector('.pf-pp-toolbar__print') as HTMLButtonElement;
    expect(btn().disabled).toBe(false);
    btn().click();
    f.detectChanges();
    expect(btn().disabled).toBe(true);
    expect(btn().getAttribute('aria-busy')).toBe('true');
    expect(btn().querySelector('pf-busy')).toBeNull();                    // no dots for a fast answer…
    vi.advanceTimersByTime(200);
    f.detectChanges();
    expect(btn().querySelector('pf-busy')).not.toBeNull();                // …dots once it takes a moment
    btn().click();
    expect(labelPrint.printTubeLabels).toHaveBeenCalledTimes(1);
    finish('printed');
    await Promise.resolve(); await Promise.resolve();
    f.detectChanges();
    expect(btn().disabled).toBe(false);
    expect(btn().getAttribute('aria-busy')).toBeNull();
  });
});
