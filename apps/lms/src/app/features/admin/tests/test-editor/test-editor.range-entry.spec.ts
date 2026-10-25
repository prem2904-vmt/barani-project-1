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
 * Test Master switch "Allow a range or < / >" (owner 2026-10-24): numeric
 * values only; on writes `allowRange: true` + `rangeFlag` (default 'ends')
 * into that parameter, off removes BOTH keys so the value saves exactly as a
 * plain number again; untouched values never gain the keys.
 */
const P = (extra: any = {}) => JSON.stringify({ parameters: [
  { id: 'p1', name: 'pus', title: 'Pus cells', type: 'numeric', unit: '/HPF', referenceRanges: [{ min: 0, max: 5 }] },
  { id: 'p2', name: 'epi', title: 'Epithelial cells', type: 'numeric', unit: '/HPF', referenceRanges: [{ min: 0, max: 5 }] },
], ...extra });
const baseTest = (over: any = {}) => ({
  id: 't1', tenantId: 'tn', name: 'Urine Microscopy', type: 'individual', flow: 'approval',
  price: 100, taxSlab: 0, discount: 0, departmentId: 'mic', tatHours: 24, sampleType: 'As applicable', tubeColor: 'sterile',
  testCode: 'CLP026', shortName: 'UM', section: '', profile: '', methodology: '', resultType: 'text', unit: '', reportFormat: 'tabular',
  adultReferenceRange: '', conditions: '[]', isActive: true, createdAt: '', parameters: P(),
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
const saved = (c: any) => JSON.parse(c._draft().parametersJson).parameters as any[];

describe('TestEditor — Allow a range or < / >', () => {
  it('is off for every existing value; the rule list offers ends / upper / lower / middle', () => {
    const { c } = make();
    expect(c.fields().map((f: any) => f.allowRange ?? false)).toEqual([false, false]);
    expect(c.rangeFlagOptions.map((o: any) => o.value)).toEqual(['ends', 'upper', 'lower', 'middle']);
    expect(c.rangeFlagHint('middle')).toContain('middle');
  });

  it('on → allowRange + rangeFlag "ends" on THAT value only; a rule change and Save round-trip', () => {
    const { c, api } = make();
    c.toggleAllowRange(0);
    let ps = saved(c);
    expect(ps[0]).toMatchObject({ name: 'pus', allowRange: true, rangeFlag: 'ends' });
    expect('allowRange' in ps[1]).toBe(false);
    expect('rangeFlag' in ps[1]).toBe(false);
    c.patchField(0, { rangeFlag: 'upper' });
    ps = saved(c);
    expect(ps[0].rangeFlag).toBe('upper');
    c.saveTest();
    const body = JSON.parse(lastPatchBody(api).parametersJson);
    expect(body.parameters[0]).toMatchObject({ allowRange: true, rangeFlag: 'upper' });
    expect('allowRange' in body.parameters[1]).toBe(false);
  });

  it('a saved switch re-opens on; off removes both keys (byte-for-byte the plain value again)', () => {
    const plain = JSON.parse(P()).parameters[0];
    const { c } = make({ test: baseTest({ parameters: JSON.stringify({ parameters: [
      { ...plain, allowRange: true, rangeFlag: 'middle' }, JSON.parse(P()).parameters[1] ] }) }) });
    expect(c.fields()[0]).toMatchObject({ allowRange: true, rangeFlag: 'middle' });
    c.toggleAllowRange(0);
    const ps = saved(c);
    expect('allowRange' in ps[0]).toBe(false);
    expect('rangeFlag' in ps[0]).toBe(false);
    expect(ps[0]).toEqual(plain);
  });

  it('a value that is not a number never stores the keys', () => {
    const { c } = make();
    c.toggleAllowRange(0);
    c.patchField(0, { type: 'text' });
    expect('allowRange' in saved(c)[0]).toBe(false);
  });
});
