import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, EMPTY } from 'rxjs';
import { vi } from 'vitest';
import { PendingValidationComponent } from './pending-validation.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { OrderTest } from '../../../shared/models/order.model';
import { CriticalResultEvent } from '../../../shared/models/critical-result.model';

/**
 * Pathologist queue × the NABL critical-result record: after the queue loads
 * the screen looks up the open records of its lines (a GET); a tile whose
 * critical value THIS user has not acknowledged reads "Critical · not
 * acknowledged" and carries an Acknowledge row action (via
 * 'pathologist_queue'); once acknowledged the tile is plain "Critical" again.
 */
const NOW = Date.parse('2026-09-27T10:00:00Z');
const HAEM = { id: 'd-hae', name: 'Haematology', code: 'HEM' };

function line(id: string, sample: string, critical: boolean): OrderTest {
  return {
    id, status: 'entered', subOrderId: sample, testId: 't-' + id,
    resultedAt: new Date(NOW - 5 * 60000).toISOString(),
    currentResult: JSON.stringify({ values: {}, flags: { critical, notifications: [] } }),
    test: { id: 't-' + id, name: 'Potassium', tatHours: 4 } as any,
    subOrder: {
      id: sample, barcode: '0126117', departmentId: HAEM.id, department: HAEM as any,
      receivedAtLab: new Date(NOW - 10 * 60000).toISOString(),
      order: { id: 'o-' + sample, priority: 'routine', patient: { displayName: 'Mrs. Latha Devi', age: 44, sex: 'Female', mrn: 'AA0007' } },
    } as any,
  } as unknown as OrderTest;
}

const EVENT: CriticalResultEvent = {
  id: 'e1', status: 'open', source: 'live', orderTestId: 'l1', orderId: 'o-s1', resultVersion: 1,
  patientId: 'p1', patientName: 'Mrs. Latha Devi', testId: 't-l1', testName: 'Potassium', summary: 'Potassium 7.2 mmol/L CH',
  values: [], detectedAt: '2026-09-27T09:55:00Z', alertedCount: 2, acknowledgements: [],
};

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(events: CriticalResultEvent[]) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  (window as any).matchMedia = (q: string) => ({ matches: q.includes('hover'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/validation/queue')) return of([line('l1', 's1', true), line('l2', 's2', false)]);
      if (url === '/api/validation/scope') return of({ scoped: false, departments: [], validatedToday: 0, validatedTodayByMe: 0 });
      if (url.startsWith('/api/critical-results/lookup')) return of(events);
      return of([]);
    }),
    post: vi.fn((url: string) => of(url.endsWith('/acknowledge')
      ? { ...EVENT, status: 'acknowledged', acknowledgements: [{ userId: 'me', name: 'Me', at: '2026-09-27T10:00:00Z', via: 'pathologist_queue' }] }
      : {})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: signal(true), isDark: signal(false) } },
      { provide: LiveQueueService, useValue: { on: () => EMPTY } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => null), confirm: vi.fn(async () => false), choose: vi.fn(async () => null) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', tenantName: 'Micro World' }), hasPermission: () => false, hasAnyPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: { url: '/pathologist', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(PendingValidationComponent);
  f.detectChanges();
  await f.whenStable();
  f.detectChanges();
  await settle(f);
  return { f, el: f.nativeElement as HTMLElement, api };
}

/** Let the grid render (the queue is a pf-data-grid since 2026-11-20; rows = .ag-row). */
const settle = async (f: { detectChanges(): void }) => { for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 40)); f.detectChanges(); } };

describe('Pathologist queue — critical acknowledgement', () => {
  it('looks up the queued lines\' records with a GET and flags the unacknowledged tile with ONE status word + Acknowledge', async () => {
    const { el, api } = await render([EVENT]);
    const lookups = api.get.mock.calls.map(c => String(c[0])).filter(u => u.startsWith('/api/critical-results/lookup'));
    expect(lookups.length).toBe(1);
    expect(lookups[0]).toContain('orderTestIds=l1');
    expect(lookups[0]).toContain('l2');
    const statuses = [...el.querySelectorAll('.ag-row .pv-status')].map(s => s.textContent?.trim());
    expect(statuses).toContain('Critical · not acknowledged');
    expect(el.querySelectorAll('.pv-ack').length).toBe(1);
    expect(el.querySelector('.pv-ack')?.classList.contains('pf-rowact')).toBe(true);
  });

  it('Acknowledge posts via the queue channel and the tile settles to a plain "Critical"', async () => {
    const { f, el, api } = await render([EVENT]);
    (el.querySelector('.pv-ack') as HTMLButtonElement).click();
    f.detectChanges();
    await settle(f);
    expect(api.post).toHaveBeenCalledWith('/api/critical-results/e1/acknowledge', { via: 'pathologist_queue' });
    const statuses = [...el.querySelectorAll('.ag-row .pv-status')].map(s => s.textContent?.trim());
    expect(statuses).toContain('Critical');
    expect(statuses).not.toContain('Critical · not acknowledged');
    expect(el.querySelector('.pv-ack')).toBeNull();
  });

  it('a record already acknowledged by me needs no button; a communicated one is not even returned', async () => {
    const { el } = await render([{ ...EVENT, status: 'acknowledged', acknowledgements: [{ userId: 'me', name: 'Me', at: '2026-09-27T09:58:00Z', via: 'bell' }] }]);
    expect(el.querySelector('.pv-ack')).toBeNull();
    expect([...el.querySelectorAll('.ag-row .pv-status')].map(s => s.textContent?.trim())).toContain('Critical');
  });
});
