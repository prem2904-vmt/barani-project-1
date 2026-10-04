import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
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

/**
 * The Test Master's specimen MODE (owner 2026-09-29): one setting per test
 * (fixed / choose / none) saved with the test as `specimenMode`, replacing
 * the "Ask for specimen at order" switch and the forced culture ask. The
 * allowed list itself lives in the Allowed specimens grid (its own spec).
 */
const P = (extra: any = {}) => JSON.stringify({ parameters: [{ name: 'Result', type: 'text' }], ...extra });
const baseTest = (over: any = {}) => ({
  id: 't1', tenantId: 'tn', name: 'Gram Stain', type: 'individual', flow: 'approval',
  price: 100, taxSlab: 0, discount: 0, departmentId: 'mic', tatHours: 24, sampleType: 'As applicable', tubeColor: 'sterile',
  testCode: 'MIC105', shortName: 'Gram', section: '', profile: '', methodology: '', resultType: 'text', unit: '', reportFormat: 'tabular',
  adultReferenceRange: '', conditions: '[]', isActive: true, createdAt: '', parameters: P({ askSpecimen: true, microFormat: 'staining_gram' }),
  ...over,
});

function make(opts: { test?: any; id?: string | null } = {}) {
  const id = opts.id === undefined ? 't1' : opts.id;
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tests/?type=individual' || url === '/api/tests/?type=profile') return of([]);
      if (url === '/api/tenants/departments') return of([{ id: 'mic', name: 'Microbiology' }, { id: 'bio', name: 'Biochemistry' }]);
      if (url === '/api/microbiology/specimens') return of([{ code: 'SPEC013', name: 'Urine', container: null }]);
      if (id && url === `/api/tests/${id}`) return of(opts.test ?? baseTest());
      return of([]);
    }),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({ id: 'new1' })),
    put: vi.fn(() => of({})),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false } },
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } },
      { provide: ReportLayoutService, useValue: {
        getDeptColumns: vi.fn(async () => ({ columns: [] })),
        getTestColumns: vi.fn(async () => ({ configured: false, columns: null })),
        getTestLayout: vi.fn(async () => ({ sections: [], configured: false })) } },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: new Map(id ? [['id', id]] : []), queryParamMap: new Map([['type', 'individual']]) } } },
      { provide: Router, useValue: { navigate: vi.fn() } },
      { provide: NavBackService, useValue: { backTo: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new TestEditorComponent()) as any;
  c.ngOnInit();
  return { c, api };
}

const lastPatchBody = (api: any) => api.patch.mock.calls.at(-1)[1];

describe('TestEditor — the specimen mode is the one setting', () => {
  it('a legacy row (askSpecimen) reads as "choose"; the mode select offers the three modes', () => {
    const { c } = make();
    expect(c.specimenMode()).toBe('choose');
    expect(c.specimenModeOptions.map((o: any) => o.value)).toEqual(['choose', 'fixed', 'none']);
  });

  it('picking a mode writes specimenMode into the Parameters wrapper, drops askSpecimen, and saves with the test', () => {
    const { c, api } = make();
    c.setSpecimenMode('fixed');
    const w = JSON.parse(c._draft().parametersJson);
    expect(w.specimenMode).toBe('fixed');
    expect('askSpecimen' in w).toBe(false);
    expect(w.microFormat).toBe('staining_gram');        // everything else kept
    expect(c.specimenMode()).toBe('fixed');
    c.saveTest();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', expect.anything());
    expect(JSON.parse(lastPatchBody(api).parametersJson).specimenMode).toBe('fixed');
    // "none" is a real setting (it wins over the culture marker).
    c.setSpecimenMode('none');
    expect(c.specimenMode()).toBe('none');
  });

  it('Culture & Sensitivity is no longer forced: its explicit mode wins', () => {
    const { c } = make({ test: baseTest({ parameters: P({ microFormat: 'culture_sensitivity', specimenMode: 'none' }) }) });
    expect(c.cultureBench()).toBe(true);
    expect(c.specimenMode()).toBe('none');
  });

  it('a NEW Microbiology test defaults to "choose" (and a sterile container); another department gets no mode', () => {
    const { c } = make({ id: null });
    c.onDeptPicked('Microbiology');
    expect(c.specimenMode()).toBe('choose');
    expect(c._draft().tubeColor).toBe('sterile');
    TestBed.resetTestingModule();
    const { c: bio } = make({ id: null });
    bio.onDeptPicked('Biochemistry');
    expect(bio.specimenMode()).toBe('none');
  });
});
