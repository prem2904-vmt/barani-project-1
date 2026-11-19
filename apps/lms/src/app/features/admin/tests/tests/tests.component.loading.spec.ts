import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { isPrefetched, resetPrefetchForTests } from '../../../../shared/utils/prefetch';
import { vi } from 'vitest';
import { TestsComponent } from './tests.component';
import { BusyDirective } from '../../../../shared/directives/busy.directive';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { AuthService } from '../../../../core/auth/auth.service';

/**
 * Test Master LIST — loading feedback (PF-PATTERN "Loading feedback"): the
 * first load draws skeleton rows in the grid's box, "Edit" turns busy the
 * same frame it is pressed (PageOpenService.markSource) and warms the
 * test editor's code on hover / focus so the tap doesn't wait on a download.
 */
const KEY = 'pf:tm:depts-collapsed:u1';

const test = (over: any = {}) => ({
  id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012',
  price: 150, department: { id: 'd1', name: 'Haematology' }, ...over,
});
const TESTS = [
  test(),
  test({ id: 't2', name: 'Platelets', testCode: 'HEM013' }),
  test({ id: 't3', name: 'Glucose', testCode: 'BIO001', department: { id: 'd2', name: 'Biochemistry' } }),
];
const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd3', name: 'Molecular', code: 'MOL', isActive: false },
];

function render(opts: { confirm?: boolean; narrow?: boolean; tests$?: Subject<any> } = {}) {
  (window as any).matchMedia = (q: string) => ({
    matches: q.includes('900px') ? !!opts.narrow : false,
    addEventListener() {}, removeEventListener() {},
  });
  const api = {
    get: vi.fn((url: string) => url.startsWith('/api/tests') && opts.tests$ ? opts.tests$ : of(url.startsWith('/api/tests') ? TESTS
      : url.startsWith('/api/catalog-proposals') ? [] : DEPTS)),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({})),
  };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? false) };
  TestBed.configureTestingModule({
    imports: [TestsComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false, priceFor: () => null } },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: DialogService, useValue: dialog },
      { provide: AuthService, useValue: { user: () => ({ id: 'u1' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
    ],
  });
  TestBed.overrideComponent(TestsComponent, {
    set: { imports: [FormsModule, NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(TestsComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const c = f.componentInstance as any;
  const rerender = () => { f.detectChanges(); };
  return { f, el, c, api, dialog, rerender };
}


describe('Test Master grid — loading feedback', () => {
  beforeEach(() => resetPrefetchForTests());

  it('first load: skeleton rows over the grid until the catalogue lands (held, then gone)', async () => {
    vi.useFakeTimers();
    try {
      const tests$ = new Subject<any>();
      const { el, rerender } = render({ tests$ });
      const skel = el.querySelector('.pf-tm-main__body .pf-tm-grid-skel');
      expect(skel).not.toBeNull();
      expect(skel!.getAttribute('label')).toBe('Loading tests…');
      // The department side card is a skeleton too — never "All · 0" /
      // "No departments yet." before the catalogue has answered.
      expect(el.querySelector('pf-skel-side-list[label="Loading departments…"]')).not.toBeNull();
      expect(el.textContent).not.toContain('No departments yet.');
      await Promise.resolve();
      tests$.next(TESTS); tests$.complete();
      vi.advanceTimersByTime(600);
      rerender();
      expect(el.querySelector('.pf-tm-grid-skel')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a catalogue already there (synchronous) shows no skeleton', () => {
    const { el } = render();
    expect(el.querySelector('.pf-tm-grid-skel')).toBeNull();
  });

  it('"Edit": busy the same frame it is pressed, navigates after that frame is painted', async () => {
    const { c } = render();
    const router = TestBed.inject(Router) as unknown as { navigate: ReturnType<typeof vi.fn> };
    const wrap: HTMLElement = c.actionsRenderer({ data: TESTS[0], context: {} });
    const edit = wrap.querySelector('button') as HTMLButtonElement;
    expect(edit.getAttribute('aria-label')).toBe('Edit Haemoglobin');
    edit.click();
    expect(edit.getAttribute('aria-busy')).toBe('true');
    expect(edit.classList.contains('pf-nav-pending')).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();           // the press paints first
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 5)));
    expect(router.navigate).toHaveBeenCalledWith(['/admin/tests', 't1', 'edit'], { queryParams: { type: 'individual' } });
  });

  it('"Edit": hover / focus warms the test editor code', () => {
    const { c } = render();
    const wrap: HTMLElement = c.actionsRenderer({ data: TESTS[0], context: {} });
    const edit = wrap.querySelector('button') as HTMLButtonElement;
    expect(isPrefetched('test-editor')).toBe(false);
    edit.dispatchEvent(new Event('pointerenter'));
    expect(isPrefetched('test-editor')).toBe(true);
  });
});
