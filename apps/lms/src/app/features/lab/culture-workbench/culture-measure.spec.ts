import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { Subject, of, throwError } from 'rxjs';
import { CultureWorkbenchComponent } from './culture-workbench.component';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { PlatformService } from '../../../core/services/platform.service';
import { CapacitorService } from '../../../core/services/capacitor.service';
import { DiskReadApi } from '../culture-entry/disk-read';

/**
 * Owner (2026-09-26): "Measure" lives on the ORGANISM IDENTIFICATION header,
 * left of the pencil. It opens the plate measure inside the AST editor; OK
 * adds the organism to "Organism isolated" and the AST stage below fills —
 * nothing is submitted by it.
 */

const CASE = {
  id: 'case-1', orderTestId: 'ot-1', caseState: 'active', createdAt: new Date().toISOString(),
  barcode: 'MICRO26001', patientName: 'Mrs. Shanthi Murugesan', testName: 'Bacterial Culture & Sensitivity',
  departmentName: 'Microbiology', specimen: 'Urine', incubateUntil: null,
  stages: [
    { key: 'gram', label: 'Gram / Direct smear', state: 'open' },
    { key: 'growth', label: 'Growth check', state: 'open' },
    { key: 'identification', label: 'Organism identification', state: 'open' },
    { key: 'ast', label: 'Antibiotic sensitivity', state: 'open' },
  ],
};
const SCHEMA = {
  identification: [
    { name: 'organism', title: 'Organism isolated', type: 'text', options: [], suggest: 'organisms' },
    { name: 'significance', title: 'Clinical significance', type: 'select', options: ['Significant', 'Not significant'] },
  ],
};

let postSpy: ReturnType<typeof vi.fn>;
function render(caseOver: Record<string, unknown> = {}, perms?: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => new Promise(() => { /* */ }) } });
  try { localStorage.clear(); } catch { /* */ }
  const c = { ...CASE, ...caseOver };
  postSpy = vi.fn(() => of(c));
  const get = (url: string) => {
    if (url.includes('/stage-schema')) return of(SCHEMA);
    if (url.includes('/microbiology/organisms')) return of([{ name: 'Escherichia coli' }, { name: 'Klebsiella pneumoniae' }]);
    if (url.includes('/culture/')) return of(c);
    return of([]);
  };
  TestBed.configureTestingModule({
    imports: [CultureWorkbenchComponent],
    providers: [
      { provide: ApiService, useValue: { get, post: postSpy, put: () => of({}), delete: () => of({}) } },
      { provide: AuthService, useValue: { user: () => ({ id: 'me', displayName: 'Admin User' }),
        hasPermission: (p: string) => (perms ? perms.includes(p) : true) } },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: DialogService, useValue: { prompt: vi.fn(() => Promise.resolve(null)), confirm: vi.fn(() => Promise.resolve(true)) } },
      { provide: NavBackService, useValue: { showBack: () => true, back() {}, backTo() {} } },
      { provide: TenantStateService, useValue: { tenant: signal({ name: 'Micro World' }) } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ orderTestId: 'ot-1' }), queryParamMap: convertToParamMap({}) } } },
      { provide: PlatformService, useValue: { isCapacitor: () => false, isNative: () => false, getApiUrl: () => '' } },
      { provide: HttpClient, useValue: {} },
      { provide: CapacitorService, useValue: {} },
      { provide: DiskReadApi, useValue: { usage: () => throwError(() => ({ status: 404 })), read: () => new Subject(), confirm: () => of({}) } },
    ],
  });
  const f = TestBed.createComponent(CultureWorkbenchComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, cmp: f.componentInstance as any };
}
const hdr = (el: HTMLElement, key: string) => el.querySelector(`[data-stage="${key}"] .pf-stg__hdr`) as HTMLElement | null;

afterEach(() => { document.querySelectorAll('pf-plate-measure').forEach(n => n.remove()); vi.useRealTimers(); });

describe('Culture case — Measure on the Identification header', () => {
  it('a quiet neutral "Measure" with the PF mark, LEFT of the pencil, on Identification only', () => {
    const { el } = render();
    const h = hdr(el, 'identification')!;
    const btn = h.querySelector<HTMLButtonElement>('.pf-cse-measure')!;
    expect(btn).toBeTruthy();
    expect(btn.textContent?.trim()).toBe('Measure');
    expect(btn.querySelector('pf-logo-mark')).toBeTruthy();
    expect(btn.classList.contains('pf-btn--primary')).toBe(false);
    expect(btn.classList.contains('pf-btn--secondary')).toBe(false);   // neutral, not violet
    expect(btn.textContent).not.toMatch(/\bAI\b/);
    const acts = [...h.querySelectorAll('.pf-stg__acts > *')];
    expect(acts.indexOf(btn)).toBeLessThan(acts.indexOf(h.querySelector('.pf-cse-note')!));
    for (const k of ['gram', 'growth', 'ast']) expect(hdr(el, k)!.querySelector('.pf-cse-measure')).toBeNull();
  });

  it('hidden when the AST stage is done, when there is no sensitivity stage, in sign-out, or without bench rights', () => {
    const astDone = CASE.stages.map(s => s.key === 'ast' ? { ...s, state: 'done' } : s);
    expect(hdr(render({ stages: astDone }).el, 'identification')!.querySelector('.pf-cse-measure')).toBeNull();
    TestBed.resetTestingModule();
    const noAst = CASE.stages.filter(s => s.key !== 'ast');
    expect(hdr(render({ stages: noAst }).el, 'identification')!.querySelector('.pf-cse-measure')).toBeNull();
    TestBed.resetTestingModule();
    expect(hdr(render({ caseState: 'awaiting_signout' }).el, 'identification')!.querySelector('.pf-cse-measure')).toBeNull();
    TestBed.resetTestingModule();
    expect(hdr(render({}, ['validate_result']).el, 'identification')!.querySelector('.pf-cse-measure')).toBeNull();
  });

  it('click → claims both stages, opens the AST editor and the measure, pre-filling the isolated organism', () => {
    const { f, el, cmp } = render();
    cmp.setOrgs('identification', 'organism', ['Klebsiella pneumoniae']);
    hdr(el, 'identification')!.querySelector<HTMLButtonElement>('.pf-cse-measure')!.click();
    f.detectChanges();
    const picked = (postSpy.mock.calls as unknown as [string][]).map(x => x[0]);
    expect(picked).toEqual(expect.arrayContaining([
      '/api/microbiology/culture/ot-1/stage/identification/pick', '/api/microbiology/culture/ot-1/stage/ast/pick']));
    expect(cmp.astOpen()).toBe(true);
    expect(cmp.measureReq()).toMatchObject({ org: 'Klebsiella pneumoniae' });
    expect(document.querySelector('pf-plate-measure')).toBeTruthy();
  });

  it('OK → the organism joins "Organism isolated" (others kept), AST highlighted, NOTHING submitted', () => {
    vi.useFakeTimers();
    const { f, el, cmp } = render();
    const scrolled = vi.fn();
    (HTMLElement.prototype as any).scrollIntoView = scrolled;
    cmp.setOrgs('identification', 'organism', ['Klebsiella pneumoniae']);
    cmp.startMeasure();
    f.detectChanges();
    postSpy.mockClear();
    cmp.onOrganismMeasured('Escherichia coli');
    vi.advanceTimersByTime(20);
    f.detectChanges();
    expect(cmp.orgList('identification', 'organism')).toEqual(['Klebsiella pneumoniae', 'Escherichia coli']);
    cmp.onOrganismMeasured('escherichia coli');                            // already there → not duplicated
    expect(cmp.orgList('identification', 'organism')).toEqual(['Klebsiella pneumoniae', 'Escherichia coli']);
    expect(scrolled).toHaveBeenCalled();
    expect(el.querySelector('[data-stage="ast"]')!.classList.contains('pf-stg--flash')).toBe(true);
    vi.advanceTimersByTime(2000);
    f.detectChanges();
    expect(el.querySelector('[data-stage="ast"]')!.classList.contains('pf-stg--flash')).toBe(false);
    const posted = (postSpy.mock.calls as unknown as [string][]).map(x => x[0]);
    expect(posted.some(p => /submit/.test(p))).toBe(false);
  });

  it('the AST stage keeps its own entry point', () => {
    const { el } = render();
    expect(el.querySelector('[data-stage="ast"] .pf-cse__astbtn')).toBeTruthy();
  });

  it('highlight respects reduced motion (no animation, a static outline)', () => {
    const css = ((CultureWorkbenchComponent as any).ɵcmp.styles as string[]).join('\n');
    const rm = css.slice(css.lastIndexOf('prefers-reduced-motion'));
    expect(rm).toMatch(/\.pf-stg--flash[^{]*\{[^}]*animation:\s*none/);
  });
});
