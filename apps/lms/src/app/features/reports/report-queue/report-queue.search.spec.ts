import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { EMPTY, Subject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { ReportQueueComponent } from './report-queue.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { LiveQueueService } from '../../../core/services/live-queue.service';
import { ThemeService } from '../../../core/services/theme.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';

/**
 * OPS-103 — Reports list search by order / invoice number. Reports list — LOADING FEEDBACK (PF-PATTERN "Loading feedback"; owner,
 * 2026-09-29: "wherever there is an action that takes time, there needs to
 * be an animation"). A row's Download renders / fetches the stored PDF and
 * the band's Generate posts: each button turns busy (disabled + aria-busy)
 * the same frame, shows the kit's dots after 150ms, and releases on answer.
 */
const PATIENT = { displayName: 'Mr. Sathish Kumaravel', age: 29, sex: 'Male', mrn: 'AA0012', phone: '9876543210' };
const rep = (id: string, orderNumber = 'LAB-2609-000102', invoiceNumber?: string) => ({
  id, orderId: `o-${id}`, patientId: 'p1', type: 'final', status: 'generated', deliveryStatus: 'pending',
  createdAt: '2026-09-26T13:07:00Z', qrToken: 't',
  order: { id: `o-${id}`, orderNumber, invoiceNumber, patient: PATIENT },
});

const realMatchMedia = (window as any).matchMedia;
afterEach(() => {
  TestBed.resetTestingModule();
  (window as any).matchMedia = realMatchMedia;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(opts: { rows?: unknown[]; generate$?: Subject<unknown>; prompt?: string | null; backfill$?: Subject<unknown>; resolve?: unknown } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('hover'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const api = {
    get: vi.fn((url: string) => {
      if (url.startsWith('/api/reports/queue?view=summary')) return of(opts.rows ?? [rep('r1'), rep('r2')]);
      if (url.startsWith('/api/orders/resolve')) return opts.resolve instanceof Error ? throwError(() => opts.resolve) : of(opts.resolve ?? null);
      return of([]);
    }),
    post: vi.fn((url: string) => (url === '/api/reports/generate' && opts.generate$ ? opts.generate$
      : url === '/api/reports/backfill' && opts.backfill$ ? opts.backfill$ : of({}))),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: ThemeService, useValue: { isNewDesign: signal(true), isDark: signal(false) } },
      { provide: LiveQueueService, useValue: { on: () => EMPTY } },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: { prompt: vi.fn(async () => opts.prompt ?? null), confirm: vi.fn(async () => false) } },
      { provide: NavBackService, useValue: { showBack: () => false, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1', tenantName: 'Micro World' }), hasPermission: () => true, hasAnyPermission: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }), ensureLoaded() {} } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), tap: () => true, rearm() {}, attachSource() {}, detachSource() {} } },
      { provide: Router, useValue: { url: '/reports', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(ReportQueueComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c: f.componentInstance as any, api, toasts };
}


const names = (c: any) => c.visible().map((r: any) => r.id);

describe('Reports list — search by order / invoice number (OPS-103)', () => {
  const rows = [rep('r1', 'LAB-2611-000042', 'INV-2611-000042'), rep('r2', 'LAB-2611-000099', 'INV-2611-000099')];

  it('client filter matches the order number: full, lower-case and partial', () => {
    const { c } = render({ rows });
    for (const q of ['LAB-2611-000042', 'lab-2611-000042', '2611-000042', '000042']) {
      c._query.set(q);
      expect(names(c)).toEqual(['r1']);
    }
  });

  it('client filter matches the invoice number: full, lower-case and partial', () => {
    const { c } = render({ rows });
    for (const q of ['INV-2611-000099', 'inv-2611-000099', 'inv-2611-0000', '000099']) {
      c._query.set(q);
      expect(names(c)).toContain('r2');
    }
    c._query.set('inv-2611-000099');
    expect(names(c)).toEqual(['r2']);
  });

  it('rows the server returned for the term are never hidden by the client filter', () => {
    // The row API carries no invoice number (it lives on the bill); the server
    // matched it, so the list must show it once that answer is in.
    const served = [rep('r7', 'LAB-2611-000007')];
    const { c, api } = render({ rows: served });
    api.get.mockImplementation((url: string) => of(url.startsWith('/api/reports/queue?view=summary')
      ? { items: served, total: 1, counts: null } : []));
    c.setQuery('INV-2611-000042');
    c.loadQueue('reset');
    expect(api.get).toHaveBeenCalled();
    expect(names(c)).toEqual(['r7']);
  });

  it('while typing (server answer not in yet) the client filter still narrows', () => {
    const { c } = render({ rows });
    c.setQuery('lab-2611-000099');
    expect(names(c)).toEqual(['r2']);
  });
});
