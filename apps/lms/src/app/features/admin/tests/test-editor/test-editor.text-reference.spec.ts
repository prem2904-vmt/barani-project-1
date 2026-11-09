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
  { id: 'p1', name: 'finding', title: 'Finding', type: 'textarea' },
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


const saved = (c: any) => JSON.parse(c._draft().parametersJson).parameters as any[];

describe('TestEditor - textual reference for a written result (OPS-117)', () => {
  it('a free-text value is offered the reference box (not numeric, not options, not family)', () => {
    const { c } = make();
    expect(c.entryKind()).toBe('text');
    expect(c.isTextRefType('textarea')).toBe(true);
    expect(c.isTextRefType('text')).toBe(true);
    expect(c.isTextRefType('number')).toBe(false);
    expect(c.isTextRefType('select')).toBe(false);
    expect(c.isTextRefType('family')).toBe(false);
  });

  it('typing a reference saves it as normalValue (what the report prints); blank clears it', () => {
    const { c, api } = make();
    c.setReferenceText(0, '  Negative ');
    expect(saved(c)[0].normalValue).toBe('Negative');
    c.saveTest();
    const body = JSON.parse((api.patch.mock.calls as any[]).at(-1)[1].parametersJson);
    expect(body.parameters[0].normalValue).toBe('Negative');
    c.setReferenceText(0, '   ');
    expect(saved(c)[0].normalValue ?? null).toBeNull();
  });

  it('a saved reference re-opens on the field', () => {
    const { c } = make({ test: baseTest({ parameters: JSON.stringify({ parameters: [
      { id: 'p1', name: 'finding', title: 'Finding', type: 'textarea', normalValue: 'Non-reactive' } ] }) }) });
    expect(c.fields()[0].normalValue).toBe('Non-reactive');
  });
});
