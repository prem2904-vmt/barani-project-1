import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { ValidateResultComponent } from './validate-result.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ZoomTransitionService } from '../../../core/navigation/zoom-transition';
import { PlatformService } from '../../../core/services/platform.service';

/**
 * Validate — LOADING FEEDBACK (ND-PATTERN "Loading feedback"). The screen
 * opens on the kit's detail skeleton (never the PF logo — that's sign-in
 * branding only), and Validate / Reject show their busy state (disabled +
 * aria-busy the same frame, dots after 150ms) while the request runs. The
 * requests themselves are unchanged.
 */
const param = { name: 'hb', title: 'Hb', unit: 'g/dL', referenceRanges: [{ min: 12, max: 15 }] };
const ot = (id: string) => ({
  id, status: 'entered',
  currentResult: JSON.stringify({ values: { hb: '13' } }),
  test: { name: 'Haemoglobin', parameters: JSON.stringify({ parameters: [param] }), department: { id: 'd1', name: 'Haematology' } },
  subOrder: { id: 's1', orderId: 'o1', order: { id: 'o1', patientId: 'p1', patient: { id: 'p1', displayName: 'Priya Nair', sex: 'Female', age: 30 } } },
});

afterEach(() => {
  TestBed.resetTestingModule();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function render(o: { queue$?: Subject<unknown[]>; validate$?: Subject<unknown>; reject$?: Subject<unknown>; reason?: string | null } = {}) {
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/validation/queue') ? (o.queue$ ?? of([ot('t1')])) : of([])),
    post: vi.fn((url: string) => {
      if (url.endsWith('/validate')) return o.validate$ ?? of({});
      if (url.endsWith('/reject')) return o.reject$ ?? of({});
      return of({});
    }),
    patch: vi.fn(() => of({})), put: vi.fn(() => of({})),
  };
  const dialog = { prompt: vi.fn(async () => o.reason ?? null), confirm: vi.fn(async () => false), choose: vi.fn(async () => null) };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: HttpClient, useValue: {} },
      { provide: PlatformService, useValue: { getApiUrl: () => '' } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: DialogService, useValue: dialog },
      { provide: NavBackService, useValue: { showBack: () => true, back: vi.fn(), backTo: vi.fn() } },
      { provide: AuthService, useValue: {
        user: () => ({ id: 'u1', displayName: 'Dr A' }),
        hasPermission: () => true, hasAnyPermission: () => true,
      } },
      { provide: ZoomTransitionService, useValue: { holding: signal(false), attachTarget() {}, detachTarget() {}, attachSource() {}, detachSource() {} } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 't1']]), queryParamMap: new Map() } } },
      { provide: Router, useValue: { url: '/pathologist/validate/t1', navigate: vi.fn(() => Promise.resolve(true)), events: of() } },
    ],
  });
  const f = TestBed.createComponent(ValidateResultComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, api, dialog };
}

const validateBtn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => /^Validate/.test((b.getAttribute('aria-label') ?? '')))!;
const rejectBtn = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLButtonElement>('button[aria-label="Reject"]')][0];

describe('Validate — loading feedback', () => {
  it('first render while the queue loads = the kit detail skeleton, never the PF logo', () => {
    const queue$ = new Subject<unknown[]>();
    const { el } = render({ queue$ });
    expect(el.querySelector('pf-loading-logo')).toBeNull();
    expect(el.querySelector('pf-skeleton-detail[aria-busy="true"]')).not.toBeNull();
    expect(el.textContent).not.toContain('Order test not found');
  });

  it('the queue lands: skeleton gone, the result is on screen', () => {
    const queue$ = new Subject<unknown[]>();
    const { f, el } = render({ queue$ });
    queue$.next([ot('t1')]); queue$.complete();
    f.detectChanges();
    expect(el.querySelector('pf-skeleton-detail')).toBeNull();
    expect(el.textContent).toContain('Haemoglobin');
  });

  it('Validate: disabled + aria-busy at once while the request runs, dots after 150ms; same request', () => {
    vi.useFakeTimers();
    const validate$ = new Subject<unknown>();
    const { f, el, api } = render({ validate$ });
    f.detectChanges();
    const btn = validateBtn(el);
    expect(btn.disabled).toBe(false);
    btn.click();
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/validation/t1/validate', { note: null });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.querySelector('pf-busy')).toBeNull();          // no flicker for a fast answer
    vi.advanceTimersByTime(160);
    f.detectChanges();
    expect(btn.querySelector('pf-busy')).not.toBeNull();
    validate$.next({}); validate$.complete();
    f.detectChanges();
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });

  it('Reject: busy only after the reason is given, while its request runs', async () => {
    const reject$ = new Subject<unknown>();
    const { f, el, api } = render({ reject$, reason: 'Haemolysed' });
    f.detectChanges();
    const btn = rejectBtn(el);
    btn.click();
    await Promise.resolve(); await Promise.resolve();
    f.detectChanges();
    expect(api.post).toHaveBeenCalledWith('/api/validation/t1/reject', { reason: 'Haemolysed', note: null });
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    reject$.error(new Error('boom'));
    f.detectChanges();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-busy')).toBeNull();
  });
});
