import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { CultureWorkbenchComponent } from './culture-workbench.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { PRICE_DIFFERS_MESSAGE } from '../../../shared/utils/micro-specimen';

/**
 * The culture bench's specimen (owner 2026-09-29): the picker offers ONLY the
 * ordered test's allowed specimens (codes), the change is posted as the code,
 * and a change the server blocks by price (409 price_differs) shows the
 * front-desk message.
 */
const CASE = {
  id: 'case-1', orderTestId: 'ot-1', testId: 't-cs', caseState: 'active', createdAt: new Date().toISOString(),
  barcode: 'MICRO26001', patientName: 'Mrs. Shanthi Murugesan', testName: 'Bacterial Culture & Sensitivity',
  departmentName: 'Microbiology', specimen: 'Sputum', specimenCode: 'SPEC005', incubateUntil: null,
  stages: [{ key: 'gram', label: 'Gram / Direct smear', state: 'open' }],
};
const MASTER = [{ code: 'SPEC013', name: 'Urine' }, { code: 'SPEC005', name: 'Sputum' }, { code: 'SPEC026', name: 'Blood' }];
const ALLOWED = [{ testId: 't-cs', mode: 'choose', specimens: [{ code: 'SPEC013', name: 'Urine', isDefault: false }, { code: 'SPEC005', name: 'Sputum', isDefault: false }] }];

function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

function render(opts: { caseOver?: Record<string, unknown>; allowed?: any[]; postErr?: any } = {}) {
  stubMatchMedia();
  const c = { ...CASE, ...(opts.caseOver ?? {}) };
  const post = vi.fn((url: string) => (opts.postErr && url.endsWith('/specimen') ? throwError(() => opts.postErr) : of(c)));
  const get = (url: string) => {
    if (url.includes('/stage-schema')) return of({});
    if (url.startsWith('/api/microbiology/test-specimens')) return of(opts.allowed ?? ALLOWED);
    if (url === '/api/microbiology/specimens') return of(MASTER);
    if (url.includes('/culture/')) return of(c);
    return of([]);
  };
  const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
  TestBed.configureTestingModule({
    imports: [CultureWorkbenchComponent],
    providers: [
      { provide: ApiService, useValue: { get, post, put: () => of({}), delete: () => of({}) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', displayName: 'Admin User', tenantName: 'Micro World' }), hasPermission: () => true } },
      { provide: ToastService, useValue: toasts },
      { provide: DialogService, useValue: { prompt: vi.fn(() => Promise.resolve(null)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ orderTestId: 'ot-1' }), queryParamMap: convertToParamMap({}) } } },
    ],
  });
  const f = TestBed.createComponent(CultureWorkbenchComponent);
  f.detectChanges(); TestBed.flushEffects(); f.detectChanges();
  return { f, cmp: f.componentInstance as any, post, toasts };
}

describe('Culture bench — the specimen stays within the test\'s allowed list', () => {
  it('offers only the allowed specimens (by code) and shows the stored code', () => {
    const { cmp } = render();
    expect(cmp.specimenOpts().map((o: any) => o.value)).toEqual(['SPEC013', 'SPEC005']);   // never Blood
    expect(cmp.specimenValue()).toBe('SPEC005');
  });

  it('an older line stored by NAME resolves to its code; an empty allowed list offers the master', () => {
    const { cmp } = render({ caseOver: { specimenCode: null, specimen: 'urine' }, allowed: [{ testId: 't-cs', specimens: [] }] });
    expect(cmp.specimenOpts().map((o: any) => o.value)).toEqual(['SPEC013', 'SPEC005', 'SPEC026']);
    expect(cmp.specimenValue()).toBe('SPEC013');
  });

  it('a change posts the CODE and names the specimen in the toast', () => {
    const { cmp, post, toasts } = render();
    cmp.setSpecimen('SPEC013');
    expect(post).toHaveBeenCalledWith('/api/microbiology/culture/ot-1/specimen', { specimen: 'SPEC013' });
    expect(toasts.success).toHaveBeenCalled();
    // The same value again is a no-op.
    post.mockClear();
    cmp.setSpecimen('SPEC005');
    expect(post).not.toHaveBeenCalled();
  });

  it('a change the server blocks by price shows the front-desk message', () => {
    const { cmp, toasts } = render({ postErr: { status: 409, error: { error: 'price_differs', message: PRICE_DIFFERS_MESSAGE } } });
    cmp.setSpecimen('SPEC013');
    expect(toasts.error).toHaveBeenCalledWith(PRICE_DIFFERS_MESSAGE);
    expect(cmp.busy()).toBe(false);
  });
});
