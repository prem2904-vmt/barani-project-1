import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { TestEditorComponent } from './test-editor.component';
import { ApiService } from '../../../../core/services/api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ReportLayoutService } from '../../../../core/services/report-layout.service';
import { AuthService } from '../../../../core/auth/auth.service';
import { NavBackService } from '../../../../core/services/nav-back.service';
import { ThemeService } from '../../../../core/services/theme.service';

/**
 * Test Master single-source — Stage 1 safety net for the TEST EDITOR's
 * load → save round-trip. TODAY one PATCH /api/tests/{id} carries price/tax,
 * the flat unit + adultReferenceRange (derived from a single band), the
 * TEST-LEVEL critical pair ("test-wide alarm"), the test-level methodology
 * and the sampleType column — all on the tenant's own test row.
 */
const P = (parameters: any[], extra: any = {}) => JSON.stringify({ parameters, ...extra });

const baseTest = (over: any = {}) => ({
  id: 't1', tenantId: 'tn', name: 'Sodium', type: 'individual', flow: 'direct',
  price: 250, taxSlab: 0, discount: 0, departmentId: 'd1', tatHours: 6,
  sampleType: 'Serum', tubeColor: 'red', testCode: 'BIO019', shortName: 'Na', section: '', profile: 'Electrolytes',
  methodology: 'ISE', resultType: 'numeric', unit: 'mmol/L', reportFormat: 'tabular',
  adultReferenceRange: '135–145', criticalLow: 120, criticalHigh: 160,
  parameters: P([{ name: 'sodium', title: 'Sodium', type: 'numeric', unit: 'mmol/L',
    referenceRanges: [{ min: 135, max: 145 }] }]),
  conditions: '[]', isActive: true, createdAt: '',
  ...over,
});

function make(opts: { test?: any; id?: string | null; individuals?: any[]; depts?: any[]; patchErr?: any } = {}) {
  const id = opts.id === undefined ? 't1' : opts.id;
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tests/?type=individual') return of(opts.individuals ?? []);
      if (url === '/api/tests/?type=profile') return of([]);
      if (url === '/api/tenants/departments') return of(opts.depts ?? [{ id: 'd1', name: 'Biochemistry' }]);
      if (id && url === `/api/tests/${id}`) return of(opts.test ?? baseTest());
      return of([]);
    }),
    patch: vi.fn(() => (opts.patchErr ? throwError(() => opts.patchErr) : of({}))),
    post: vi.fn(() => of({ id: 'new1' })),
  };
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const layout = {
    getDeptColumns: vi.fn(async () => ({ columns: [] })),
    getTestColumns: vi.fn(async () => ({ configured: false, columns: null })),
    getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
  };
  const router = { navigate: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ReportLayoutService, useValue: layout },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: new Map(id ? [['id', id]] : []), queryParamMap: new Map([['type', 'individual']]) } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { backTo: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false } },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new TestEditorComponent()) as any;
  c.ngOnInit();
  return { c, api, toasts, router };
}

const lastPatchBody = (api: any) => api.patch.mock.calls.at(-1)[1];

describe('TestEditor load → save round-trip (CURRENT)', () => {
  it('hydrates price / methodology / criticals / sampleType / flat unit + range from the test row', () => {
    const { c } = make();
    const d = c._draft();
    expect(d).toMatchObject({ price: 250, methodology: 'ISE', criticalLow: 120, criticalHigh: 160,
      sampleType: 'Serum', unit: 'mmol/L', adultReferenceRange: '135–145', testCode: 'BIO019' });
    expect(c.fields().map((f: any) => f.name)).toEqual(['sodium']);
  });

  it('save PATCHes /api/tests/{id} with price, tax, test-level criticals, methodology, sampleType, unit', () => {
    const { c, api } = make();
    c.saveTest();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', expect.anything());
    expect(lastPatchBody(api)).toMatchObject({
      price: 250, taxSlab: 0, methodology: 'ISE', criticalLow: 120, criticalHigh: 160,
      sampleType: 'Serum', unit: 'mmol/L', resultType: 'numeric', reportFormat: 'tabular', testCode: 'BIO019',
    });
  });

  it('adultReferenceRange on save is RE-DERIVED from the single numeric band (typed flat text is overwritten)', () => {
    const { c, api } = make({ test: baseTest({ adultReferenceRange: 'stale' }) });
    c.saveTest();
    expect(lastPatchBody(api).adultReferenceRange).toBe('135–145');
  });

  it('multi-band numeric value → flat adultReferenceRange is blanked', () => {
    const { c, api } = make({ test: baseTest({ parameters: P([{ name: 'hb', type: 'numeric',
      referenceRanges: [{ min: 13, max: 17, sex: 'M' }, { min: 12, max: 15, sex: 'F' }] }]) }) });
    c.saveTest();
    expect(lastPatchBody(api).adultReferenceRange).toBe('');
  });

  it('parametersJson is passed through verbatim (the wrapper sampleType / methodology ride along untouched)', () => {
    const raw = P([{ name: 'sodium', type: 'numeric', methodology: 'ISE', referenceRanges: [{ min: 135, max: 145 }] }], { sampleType: 'Plasma' });
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.parametersJson).toBe(raw);
    expect(body.sampleType).toBe('Serum');       // column and wrapper can disagree today
  });

  it('a package save drops sampleType/methodology/criticals/unit but still sends price', () => {
    const { c, api } = make({ test: baseTest({ type: 'package', parameters: JSON.stringify({ items: [{ testId: 'a' }] }) }) });
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.price).toBe(250);
    expect(body.sampleType).toBeUndefined();
    expect(body.methodology).toBeUndefined();
    expect(body.criticalLow).toBeUndefined();
    expect(body.unit).toBeUndefined();
    expect(JSON.parse(body.parametersJson)).toEqual({ items: [{ testId: 'a' }] });
  });

  it('summary chips show the price off the draft (₹250.00) and the sample column', () => {
    const { c } = make();
    const chips = c.metaChips();
    expect(chips.find((x: any) => x.k === 'Price').v).toBe('₹250.00');
    expect(chips.find((x: any) => x.k === 'Sample').v).toContain('Serum');
  });

  it('entry kind follows the first value (numeric → "number")', () => {
    const { c } = make();
    expect(c.entryKind()).toBe('number');
  });

  it('a server price error lands as a field error, not a toast', () => {
    const { c, toasts } = make({ patchErr: { error: { message: 'Price must be ≥ 0', field: 'price' } } });
    c.saveTest();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(c.fieldError('price')).toBeTruthy();
  });
});

describe('TestEditor codes (CURRENT)', () => {
  const individuals = [
    { id: 'a', type: 'individual', departmentId: 'd1', testCode: 'CLP015' },
    { id: 'b', type: 'individual', departmentId: 'd1', testCode: 'CLP003' },
    { id: 'c', type: 'individual', departmentId: 'd2', testCode: 'HEM012' },
  ];

  it('new test: picking a department fills the next free code in that dept series (CLP015 → CLP016)', () => {
    const { c } = make({ id: null, individuals, depts: [{ id: 'd1', name: 'Clinical Pathology' }] });
    c.onDeptPicked('Clinical Pathology');
    expect(c._draft().testCode).toBe('CLP016');
  });

  it('duplicate code (case-insensitive, whole catalogue) raises a field error', () => {
    const { c } = make({ id: null, individuals });
    c.onTestCodeChanged('hem012');
    expect(c.fieldError('testCode')).toContain('HEM012');
  });

  it('a tenant may type the master code shape today (BIO777 accepted)', () => {
    const { c } = make({ id: null, individuals });
    c.onTestCodeChanged('BIO777');
    expect(c.fieldError('testCode')).toBeFalsy();
  });
});

describe('TestEditor — TARGET behaviour', () => {
  it.skip('TARGET phase 2: the test save carries NO price/discount/tax (pricing table owns it)', () => {
    const { c, api } = make();
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.price).toBeUndefined();
    expect(body.taxSlab).toBeUndefined();
  });

  it.skip('TARGET phase 0/6: no test-level critical pair — criticals live on bands/params only', () => {
    const { c, api } = make();
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.criticalLow).toBeUndefined();
    expect(body.criticalHigh).toBeUndefined();
  });

  it.skip('TARGET phase 6: flat unit / adultReferenceRange are not written (derived from params on read)', () => {
    const { c, api } = make();
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.unit).toBeUndefined();
    expect(body.adultReferenceRange).toBeUndefined();
  });

  it.skip('TARGET phase 0: hybrid methodology — per-value copies equal to the test-level one are stripped on save', () => {
    const raw = P([{ name: 'sodium', type: 'numeric', methodology: 'ISE' }, { name: 'k', type: 'numeric', methodology: 'Flame' }]);
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    const ps = JSON.parse(lastPatchBody(api).parametersJson).parameters;
    expect(ps[0].methodology).toBeUndefined();    // == test-level ISE → stripped
    expect(ps[1].methodology).toBe('Flame');      // real override kept
  });

  it.skip('TARGET phase 0: specimen = the sampleType column only (no wrapper sampleType in parametersJson)', () => {
    const raw = P([{ name: 'sodium', type: 'numeric' }], { sampleType: 'Plasma' });
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    expect(JSON.parse(lastPatchBody(api).parametersJson).sampleType).toBeUndefined();
  });

  it.skip('TARGET phase 1/5: a tenant typing the reserved master shape ^[A-Z]{3}[0-9]+$ (BIO777) is rejected', () => {
    const { c } = make({ id: null });
    c.onTestCodeChanged('BIO777');
    expect(c.fieldError('testCode')).toBeTruthy();
  });

  it.skip('TARGET phase 1/5: a new tenant test gets an auto code with a hyphen (e.g. MW-0001)', () => {
    const { c } = make({ id: null, depts: [{ id: 'd1', name: 'Clinical Pathology' }] });
    c.onDeptPicked('Clinical Pathology');
    expect(c._draft().testCode).toMatch(/^[A-Z]+-\d{4,}$/);
  });

  it.skip('TARGET phase 3: summary shows the origin badge (master | customised | branch | local)', () => {
    const { c } = make({ test: baseTest({ origin: 'customised' }) });
    expect(c.metaChips().find((x: any) => x.k === 'Origin')?.v).toBe('Customised');
  });
});
