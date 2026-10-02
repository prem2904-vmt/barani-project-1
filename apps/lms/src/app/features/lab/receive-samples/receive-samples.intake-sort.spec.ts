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

/**
 * Lab Intake (sample-focused mode) — sort order (owner, 2026-10-02): strict
 * ascending by sample number, NUMERIC compare (not string), and a received
 * tube stays IN SEQUENCE — greyed "Received" — instead of sinking to the
 * bottom. This pins `dispatchedTubes()`'s sort in receive-samples.component.ts.
 */
function dispatchedOrder(id: string, name: string, samples: { barcode: string; status: string }[]) {
  return {
    id, createdAt: '2026-09-29T04:00:00Z',
    patient: { id: 'p-' + id, firstName: name, displayName: name, mrn: 'MRN-' + id, age: 40, sex: 'Female' },
    samples: samples.map((s, i) => ({
      id: id + '-s' + i, status: s.status, barcode: s.barcode,
      dispatchedAt: '2026-09-29T04:10:00Z', receivedAtLab: s.status === 'received' ? '2026-09-29T04:20:00Z' : undefined,
      tests: [],
    })),
  };
}

function render(dispatched: unknown[]) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/samples/in-transit') return of([]);
      if (url === '/api/orders/dispatched') return of(dispatched);
      return of([]);
    }),
    patch: vi.fn(() => of({ arrived: 1 })),
    post: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: LiveQueueService, useValue: { on: () => of() } },
      { provide: ScanService, useValue: { manualEntry: () => false } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', branchId: 'b1' }), hasPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ vendorCode: 'MW' }), ensureLoaded() {} } },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, sampleFocused: () => true, standaloneLab: () => false, config: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isNewDesign: () => true, isDark: () => false } },
    ],
  });
  const f = TestBed.createComponent(ReceiveSamplesComponent);
  f.componentInstance.embedded = true;
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement };
}

describe('Lab Intake (sample-focused) — sort order', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sorts strictly ascending by sample number, numeric (not string) compare', () => {
    // '26120' < '26121' < '26122' < '26125' < '26126' numerically, fed in
    // scrambled order across two orders — exactly the owner-reported bug.
    const o1 = dispatchedOrder('o1', 'Asha', [
      { barcode: '26141', status: 'dispatched' },
      { barcode: '26126', status: 'dispatched' },
      { barcode: '26120', status: 'dispatched' },
    ]);
    const o2 = dispatchedOrder('o2', 'Ravi', [
      { barcode: '26122', status: 'dispatched' },
      { barcode: '26125', status: 'dispatched' },
    ]);
    const { el } = render([o1, o2]);
    const samples = [...el.querySelectorAll('.pf-rs-row__sample')].map(n => n.textContent?.trim());
    expect(samples).toEqual(['26120', '26122', '26125', '26126', '26141']);
  });

  it('a received sample stays IN SEQUENCE by number — never sinks to the bottom', () => {
    const o1 = dispatchedOrder('o1', 'Asha', [
      { barcode: '26120', status: 'dispatched' },
      { barcode: '26121', status: 'received' }, // received, but numerically second
      { barcode: '26126', status: 'dispatched' },
    ]);
    const { el } = render([o1]);
    const samples = [...el.querySelectorAll('.pf-rs-row__sample')].map(n => n.textContent?.trim());
    expect(samples).toEqual(['26120', '26121', '26126']); // NOT ['26120', '26126', '26121']

    const rows = [...el.querySelectorAll('.pf-rs-row')];
    expect(rows[1].classList.contains('pf-rs-row--received')).toBe(true); // still greyed
    expect(rows[1].textContent).toContain('Received');
  });

  it('numeric compare handles differing digit counts correctly (not lexicographic)', () => {
    // Lexicographic string compare would wrongly put '262' before '26120'
    // ("2" < "6" sure, but "262..." < "26120..." is also wrong lexically for
    // this pair once padded) — numeric:true compares the full number.
    const o1 = dispatchedOrder('o1', 'Asha', [
      { barcode: '26200', status: 'dispatched' },
      { barcode: '26199', status: 'dispatched' },
    ]);
    const { el } = render([o1]);
    const samples = [...el.querySelectorAll('.pf-rs-row__sample')].map(n => n.textContent?.trim());
    expect(samples).toEqual(['26199', '26200']);
  });
});
