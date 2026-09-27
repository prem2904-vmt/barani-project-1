import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { AuthService } from '../../../core/auth/auth.service';
import { MIN_LOAD_MS } from '../../../shared/utils/min-duration';

/**
 * Opening a parked draft (owner, 2026-09-27: "no PF loading — just an
 * animation and skeleton loading in that part"). While the draft's patient
 * loads, the patient tile, the phone picks chip and the cart rows show a
 * SKELETON of what will land there (never a blank "No tests selected" flash,
 * never the logo); it holds for at least MIN_LOAD_MS, then the real rows
 * rise in. The body is the zoom target and says aria-busy meanwhile.
 */
const CATALOGUE = [
  { id: 't1', name: 'Haemoglobin', testCode: 'HEM011', type: 'individual', price: 10, priceIsDefault: false, tatHours: 2, isActive: true, department: { name: 'Haematology' } },
];
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  get length() { return this.m.size; }
}

function render(q: Array<[string, string]>, patient$: Subject<unknown>) {
  (window as any).matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/tests/')) return of(CATALOGUE);
    if (/^\/api\/patients\/\w+$/.test(url)) return patient$;
    return of([]);
  });
  TestBed.configureTestingModule({
    imports: [OrderCreateComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info: vi.fn(), warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(new Map(q)), snapshot: { paramMap: new Map(), queryParamMap: new Map(q) } } },
      { provide: Router, useValue: { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)), events: of() } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: Location, useValue: {} },
      { provide: BranchLabConfigService, useValue: { ensureLoaded() {}, billingMode: () => 'front_desk', collectsAtFrontdesk: () => false } },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: TenantStateService, useValue: { tenant: signal(null) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }), activeBranchId: () => null } },
    ],
  });
  const f = TestBed.createComponent(OrderCreateComponent);
  f.detectChanges();
  return { f, c: f.componentInstance as any, el: f.nativeElement as HTMLElement };
}

describe('Order & Payments — opening a draft shows a skeleton, not a flash', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('localStorage', new MemStorage()); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('skeleton while the patient loads, held for the minimum, then the real content', () => {
    const patient$ = new Subject<unknown>();
    const { f, c, el } = render([['patientId', 'pA']], patient$);
    f.detectChanges();
    expect(c.opening()).toBe(true);
    const body = el.querySelector('.pf-oc-body')!;
    expect(body.getAttribute('aria-busy')).toBe('true');
    expect(body.getAttribute('data-zoom-target')).toBe('pA');
    expect(el.querySelector('.pf-us__tile-skel')).not.toBeNull();          // patient tile
    const rows = el.querySelector('.pf-cart-skel pf-skeleton-rows');
    expect(rows).not.toBeNull();                                           // cart rows
    expect(rows!.getAttribute('aria-busy')).toBe('true');
    expect(rows!.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.pf-cart-empty')).toBeNull();                 // no "No tests" flash
    expect(el.querySelector('pf-loading-logo')).toBeNull();                // never the logo
    expect(el.querySelector('.pf-oc-need')).toBeNull();                    // no "pick a patient" nudge

    // The patient arrives fast: the skeleton still holds for the minimum.
    vi.advanceTimersByTime(50);
    patient$.next({ patient: { id: 'pA', displayName: 'Mr. Arun' }, history: [] });
    patient$.complete();
    TestBed.tick();
    f.detectChanges();
    expect(c.patient()?.id).toBe('pA');
    expect(c.opening()).toBe(true);

    vi.advanceTimersByTime(MIN_LOAD_MS);
    TestBed.tick();
    f.detectChanges();
    expect(c.opening()).toBe(false);
    expect(body.getAttribute('aria-busy')).toBeNull();
    expect(el.querySelector('.pf-cart-skel')).toBeNull();
    expect(el.querySelector('.pf-us__tile-skel')).toBeNull();
  });

  it('a plain "New order" (no record to open) never shows the skeleton', () => {
    const { f, c, el } = render([], new Subject());
    f.detectChanges();
    expect(c.opening()).toBe(false);
    expect(el.querySelector('.pf-cart-skel')).toBeNull();
    expect(el.querySelector('.pf-oc-body')!.getAttribute('aria-busy')).toBeNull();
  });

  it('a failed load drops the skeleton (after the minimum) instead of spinning forever', () => {
    const patient$ = new Subject<unknown>();
    const { f, c } = render([['patientId', 'pA']], patient$);
    patient$.error(new Error('500'));
    vi.advanceTimersByTime(MIN_LOAD_MS);
    TestBed.tick();
    f.detectChanges();
    expect(c.opening()).toBe(false);
  });
});
