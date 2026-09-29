import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
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

/**
 * Receive samples — LOADING FEEDBACK (ND-PATTERN "Loading feedback"). The
 * intake queue opens on a skeleton of its rows (held 600ms once shown, never
 * a blank list), and a row's Receive shows its busy state while ITS request
 * runs — other rows stay plain-disabled. What is sent is unchanged.
 */
const order = (id: string, name: string) => ({
  id, createdAt: '2026-09-29T04:00:00Z',
  patient: { id: 'p-' + id, firstName: name, displayName: name, mrn: 'MRN-' + id, age: 40, sex: 'Female' },
  samples: [{ id: 's-' + id, status: 'dispatched', barcode: 'B-' + id, dispatchedAt: '2026-09-29T04:10:00Z', tests: [] }],
});

function render(o: { transit$?: Subject<unknown[]>; dispatched$?: Subject<unknown[]>; arrive$?: Subject<unknown>; embedded?: boolean } = {}) {
  // Always install the stub: another spec in the worker may have left one behind.
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/samples/in-transit') return o.transit$ ?? of([]);
      if (url === '/api/orders/dispatched') return o.dispatched$ ?? of([order('o1', 'Asha'), order('o2', 'Ravi')]);
      return of([]);
    }),
    patch: vi.fn(() => o.arrive$ ?? of({ arrived: 1 })),
    post: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', branchId: 'b1' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ vendorCode: 'MW' }), ensureLoaded() {} } },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, sampleFocused: () => false, standaloneLab: () => false, config: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(ReceiveSamplesComponent);
  f.componentInstance.embedded = o.embedded ?? true;
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, api };
}

describe('Receive samples — loading feedback', () => {
  afterEach(() => { vi.useRealTimers(); TestBed.resetTestingModule(); });

  it('first render while the queues load = a skeleton of the rows, not a blank list', () => {
    const { el } = render({ transit$: new Subject(), dispatched$: new Subject() });
    expect(el.querySelector('pf-skeleton-rows[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-rs-row')).toBeNull();
  });

  it('the queues land: the skeleton is held for the minimum, then the rows', async () => {
    vi.useFakeTimers();
    const transit$ = new Subject<unknown[]>();
    const dispatched$ = new Subject<unknown[]>();
    const { f, el } = render({ transit$, dispatched$ });
    await Promise.resolve();                    // the requests are genuinely async
    transit$.next([]); transit$.complete();
    dispatched$.next([order('o1', 'Asha')]); dispatched$.complete();
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-rows')).not.toBeNull();   // held (no flash)
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-rows')).toBeNull();
    expect(el.querySelectorAll('.pf-rs-row').length).toBe(1);
  });

  it('synchronous data (cache / double) never shows a skeleton', () => {
    const { el } = render();
    expect(el.querySelector('pf-skeleton-rows')).toBeNull();
    expect(el.querySelectorAll('.pf-rs-row').length).toBe(2);
  });

  it('Receive on a row: that row busy (disabled + aria-busy), the other just disabled; same request', () => {
    vi.useFakeTimers();
    const arrive$ = new Subject<unknown>();
    const { f, el, api } = render({ arrive$ });
    const btns = () => [...el.querySelectorAll<HTMLButtonElement>('.pf-rs-row button[aria-label^="Receive"]')];
    expect(btns().length).toBe(2);
    const first = btns().find(b => b.getAttribute('aria-label') === 'Receive B-o1')!;
    const other = btns().find(b => b !== first)!;
    first.click();
    f.detectChanges();
    expect(api.patch).toHaveBeenCalledWith('/api/orders/o1/arrive', {});
    expect(first.disabled).toBe(true);
    expect(first.getAttribute('aria-busy')).toBe('true');
    expect(other.disabled).toBe(true);
    expect(other.getAttribute('aria-busy')).toBeNull();
    vi.advanceTimersByTime(160);
    f.detectChanges();
    expect(first.querySelector('pf-busy')).not.toBeNull();
    arrive$.error(new Error('boom'));
    f.detectChanges();
    expect(first.getAttribute('aria-busy')).toBeNull();
    expect(first.disabled).toBe(false);
  });
});
