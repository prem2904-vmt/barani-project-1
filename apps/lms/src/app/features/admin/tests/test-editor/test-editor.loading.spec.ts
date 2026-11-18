import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { TestEditorComponent } from './test-editor.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { NavBackService } from '../../../../core/services/nav-back.service';
import { ThemeService } from '../../../../core/services/theme.service';
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { TenantStateService } from '../../../../core/services/tenant-state.service';

/**
 * Test editor — LOADING FEEDBACK (PF-PATTERN "Loading feedback"; owner,
 * 2026-09-29: "if I hit Edit, the screen stays still for a long time and
 * then things appear"). Opening an existing record draws the editor's own
 * shape on the FIRST render (never a blank "Edit test" form), Save is not
 * offered for a record that isn't on screen yet, the catalogue-wide lists
 * wait for an individual test's own record, and Save shows its busy state
 * while the request runs.
 */
const P = (parameters: any[]) => JSON.stringify({ parameters });
const OGTT = (over: any = {}) => ({
  id: 't1', tenantId: 'tn', name: 'Oral Glucose Challenge Test', type: 'individual', flow: 'direct',
  price: 1, taxSlab: 0, discount: 0, departmentId: 'd1', tatHours: 2,
  sampleType: 'Serum', tubeColor: 'grey', testCode: 'BIO005', shortName: 'OGCT', section: '',
  methodology: 'GOD-POD', resultType: 'numeric', unit: 'mg/dL', reportFormat: 'tabular',
  parameters: P([{ name: 'glucose', title: 'Glucose', type: 'numeric', unit: 'mg/dL', referenceRanges: [{ min: 70, max: 140 }] }]),
  conditions: '[]', isActive: true, createdAt: '', origin: 'master', fastingRequired: false, priceIsDefault: true,
  ...over,
});

function render(opts: { test?: any; type?: string; nd?: boolean; record$?: Subject<any>; save$?: Subject<any> } = {}) {
  // Always install the stub (never 'only if missing'): another spec in the same
  // worker may have left a phone / fine-pointer matchMedia behind (order-dependent flake).
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const test = opts.test ?? OGTT();
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tenants/departments') return of([{ id: 'd1', name: 'Biochemistry' }]);
      if (url === '/api/tests/t1') return opts.record$ ?? of(test);
      if (url === '/api/tests/?type=profile') return of([{ id: 'p1', name: 'Diabetes Panel', type: 'profile', testCode: 'PRO012', price: 900, tatHours: 4 }]);
      return of([]);
    }),
    patch: vi.fn(() => opts.save$ ?? of({})), post: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    imports: [TestEditorComponent],
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      { provide: ReportLayoutService, useValue: {
        getDeptColumns: vi.fn(async () => ({ columns: [] })),
        getTestColumns: vi.fn(async () => ({ configured: false, columns: null })),
        getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
      } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => ({ tenantName: 'Micro World' }) } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: new Map([['id', 't1']]), queryParamMap: new Map([['type', opts.type ?? 'individual']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(), url: '/admin/tests/t1/edit', events: of() } },
      { provide: NavBackService, useValue: { backTo: vi.fn(), back: vi.fn(), showBack: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => opts.nd ?? true } },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
    ],
  });
  // The live PDF preview renders on a canvas; keep it inert in jsdom.
  TestBed.overrideComponent(TestEditorComponent, { set: { schemas: [] } });
  const f = TestBed.createComponent(TestEditorComponent);
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { f, el, c: f.componentInstance as any, api, txt };
}


describe('Test editor — loading feedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('first render of /:id/edit = skeleton (card + form + name, side card in place), not a blank form', () => {
    const record$ = new Subject<any>();
    const { el } = render({ record$ });
    const skel = el.querySelector('.pf-te2-loading');
    expect(skel).not.toBeNull();
    expect(skel!.querySelector('pf-skeleton-form[aria-busy="true"]')).not.toBeNull();
    expect(el.querySelector('.pf-te2-ctx__nameskel')).not.toBeNull();
    expect(el.querySelector('.pf-te2-ctx__nametext')).toBeNull();          // no "Edit test" placeholder
    expect(el.querySelector('#sec-identity')).toBeNull();                  // no empty form
    expect(el.querySelector('aside.pf-sg-side')).not.toBeNull();            // the sections side card holds its place
    expect(el.querySelector('.pf-livewrap, pf-report-pdf-preview')).toBeNull(); // no permanent preview
    expect(el.textContent).not.toContain('Save the test to see its live report preview');
  });

  it('Save is not offered while the record is on its way', () => {
    const record$ = new Subject<any>();
    const { el } = render({ record$ });
    const save = el.querySelector('.pf-te2-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('the record lands: skeleton held for the minimum, then the real form and name', async () => {
    const record$ = new Subject<any>();
    const { f, el } = render({ record$ });
    await Promise.resolve();                   // the request is genuinely async
    vi.advanceTimersByTime(200);
    record$.next(OGTT()); record$.complete();
    f.detectChanges();
    expect(el.querySelector('.pf-te2-loading')).not.toBeNull();            // held (no flash)
    vi.advanceTimersByTime(600);
    f.detectChanges();
    expect(el.querySelector('.pf-te2-loading')).toBeNull();
    expect(el.querySelector('#sec-identity')).not.toBeNull();
    expect(el.querySelector('.pf-te2-ctx__nametext')!.textContent).toContain('Oral Glucose Challenge Test');
    expect((el.querySelector('.pf-te2-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('an error releases the skeleton (the form + toast, as before)', async () => {
    const record$ = new Subject<any>();
    const { f, el } = render({ record$ });
    await Promise.resolve();
    record$.error(new Error('boom'));
    vi.advanceTimersByTime(700);
    f.detectChanges();
    expect(el.querySelector('.pf-te2-loading')).toBeNull();
  });

  it('a synchronous record (cache / double) never shows a skeleton', () => {
    const { el } = render();
    expect(el.querySelector('.pf-te2-loading')).toBeNull();
    expect(el.querySelector('#sec-identity')).not.toBeNull();
  });

  it('individual test: the catalogue-wide lists wait for the record; profile: they load with it', async () => {
    const record$ = new Subject<any>();
    const { api } = render({ record$ });
    const urls = () => api.get.mock.calls.map((c: any[]) => c[0]);
    expect(urls()).toContain('/api/tests/t1');
    expect(urls()).not.toContain('/api/tests/?type=individual');
    expect(urls()).not.toContain('/api/tests/?type=profile');
    record$.next(OGTT()); record$.complete();
    expect(urls()).toContain('/api/tests/?type=individual');
    expect(urls()).toContain('/api/tests/?type=profile');
    TestBed.resetTestingModule();
    const r2 = render({ type: 'profile', record$: new Subject<any>() });
    const urls2 = r2.api.get.mock.calls.map((c: any[]) => c[0]);
    expect(urls2).toContain('/api/tests/?type=individual');
    expect(urls2).toContain('/api/tests/?type=profile');
  });

  it('Save: disabled + aria-busy the same frame, busy dots after 150ms, released on answer', () => {
    const save$ = new Subject<any>();
    const { f, el, c } = render({ save$ });
    c.patch({ name: 'Oral Glucose Challenge Test (edited)' });
    f.detectChanges();
    const save = el.querySelector('.pf-te2-save') as HTMLButtonElement;
    save.click();
    f.detectChanges();
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.textContent).toContain('Saving');
    expect(save.querySelector('pf-busy')).toBeNull();
    vi.advanceTimersByTime(150);
    f.detectChanges();
    expect(save.querySelector('pf-busy')).not.toBeNull();
    save$.next({ ...OGTT(), name: 'Oral Glucose Challenge Test (edited)' }); save$.complete();
    vi.advanceTimersByTime(1000);
    f.detectChanges();
    expect(save.getAttribute('aria-busy')).toBeNull();
  });
});
