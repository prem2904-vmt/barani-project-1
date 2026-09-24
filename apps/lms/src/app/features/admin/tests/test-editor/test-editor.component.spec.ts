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
import { TestPricingService } from '../../../../core/services/test-pricing.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { ApiError } from '../../../../shared/models/api-response.model';

/**
 * Test Master single-source — Stage 1 safety net for the TEST EDITOR's
 * load → save round-trip. One PATCH /api/tests/{id} carries the content —
 * NOT price/tax (phase 2: those go to the pricing table through
 * TestPricingService → PATCH /api/tests/prices/bulk, only when changed) — the flat unit + adultReferenceRange (derived from a single band), the
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

function make(opts: { test?: any; id?: string | null; individuals?: any[]; depts?: any[]; patchErr?: any; priceErr?: any;
  patchResult?: any; postResult?: any; confirm?: boolean; revertResult?: any; tests?: Record<string, any> } = {}) {
  const id = opts.id === undefined ? 't1' : opts.id;
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tests/?type=individual') return of(opts.individuals ?? []);
      if (url === '/api/tests/?type=profile') return of([]);
      if (url === '/api/tenants/departments') return of(opts.depts ?? [{ id: 'd1', name: 'Biochemistry' }]);
      if (id && url === `/api/tests/${id}`) return of(opts.test ?? baseTest());
      const other = /^\/api\/tests\/([^/?]+)$/.exec(url)?.[1];
      if (other && opts.tests?.[other]) return of(opts.tests[other]);
      return of([]);
    }),
    patch: vi.fn(() => (opts.patchErr ? throwError(() => opts.patchErr) : of(opts.patchResult ?? {}))),
    post: vi.fn((url: string, _body?: unknown) => of(url.endsWith('/revert-to-master') ? (opts.revertResult ?? null) : (opts.postResult ?? { id: 'new1' }))),
  };
  const dialog = { confirm: vi.fn(async () => opts.confirm ?? false) };
  const toasts = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  const layout = {
    getDeptColumns: vi.fn(async () => ({ columns: [] })),
    getTestColumns: vi.fn(async () => ({ configured: false, columns: null })),
    getTestLayout: vi.fn(async () => ({ sections: [], configured: false })),
  };
  const router = { navigate: vi.fn() };
  const pricing = {
    save: vi.fn(() => (opts.priceErr ? throwError(() => opts.priceErr) : of({}))),
    ensureLoaded: vi.fn(), isolationOn: () => false,
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: TestPricingService, useValue: pricing },
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: toasts },
      { provide: ReportLayoutService, useValue: layout },
      { provide: AuthService, useValue: { hasPermission: () => true, user: () => null } },
      { provide: ActivatedRoute, useValue: { snapshot: {
        paramMap: new Map(id ? [['id', id]] : []), queryParamMap: new Map([['type', 'individual']]) } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: { backTo: vi.fn() } },
      { provide: ThemeService, useValue: { isDark: () => false } },
      { provide: DialogService, useValue: dialog },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new TestEditorComponent()) as any;
  c.ngOnInit();
  return { c, api, toasts, router, pricing, dialog };
}

const lastPatchBody = (api: any) => api.patch.mock.calls.at(-1)[1];

describe('TestEditor load → save round-trip (CURRENT)', () => {
  it('hydrates price / methodology / sampleType / flat unit + range from the test row (no test-level criticals)', () => {
    const { c } = make();
    const d = c._draft();
    expect(d).toMatchObject({ price: 250, methodology: 'ISE',
      sampleType: 'Serum', unit: 'mmol/L', adultReferenceRange: '135–145', testCode: 'BIO019' });
    expect(d.criticalLow).toBeUndefined();
    expect(d.criticalHigh).toBeUndefined();
    expect(c.fields().map((f: any) => f.name)).toEqual(['sodium']);
  });

  it('save PATCHes /api/tests/{id} with methodology, sampleType, unit (no price) — unchanged price writes nothing', () => {
    const { c, api, pricing } = make();
    c.saveTest();
    expect(api.patch).toHaveBeenCalledWith('/api/tests/t1', expect.anything());
    expect(pricing.save).not.toHaveBeenCalled();
    expect(lastPatchBody(api)).toMatchObject({
      methodology: 'ISE',
      sampleType: 'Serum', unit: 'mmol/L', resultType: 'numeric', reportFormat: 'tabular',
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

  it('an already-tidy parametersJson is passed through verbatim (real per-value overrides kept)', () => {
    const raw = P([{ name: 'sodium', type: 'numeric', methodology: 'Flame', referenceRanges: [{ min: 135, max: 145 }] }], { microFormat: 'x' });
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.parametersJson).toBe(raw);
    expect(body.sampleType).toBe('Serum');       // the column is the specimen
  });

  it('a package save drops sampleType/methodology/criticals/unit (and price)', () => {
    const { c, api } = make({ test: baseTest({ type: 'package', parameters: JSON.stringify({ items: [{ testId: 'a' }] }) }) });
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.price).toBeUndefined();
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

  it('a server field error on the content save lands as a field error, not a toast', () => {
    const { c, toasts } = make({ patchErr: { error: { message: 'Name taken', field: 'name' } } });
    c.saveTest();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(c.fieldError('name')).toBeTruthy();
  });
});

describe('TestEditor codes — server-assigned, read-only (9-series)', () => {
  const individuals = [
    { id: 'a', type: 'individual', departmentId: 'd1', testCode: 'CLP015' },
    { id: 'c', type: 'individual', departmentId: 'd2', testCode: 'HEM012' },
  ];

  for (const mode of ['tenant', 'master'] as const) {
    it(`no client-side code generation (${mode} mode): picking a department never fills a code`, () => {
      const { c } = make({ id: null, individuals, depts: [{ id: 'd1', name: 'Clinical Pathology' }] });
      c.setCodeMode(mode);
      c.onDeptPicked('Clinical Pathology');
      expect(c._draft().testCode).toBe('');
      expect(c.codeText()).toBe('Assigned automatically');
      expect((TestEditorComponent.prototype as any).nextCodeForDept).toBeUndefined();
      expect((TestEditorComponent.prototype as any).onTestCodeChanged).toBeUndefined();
    });
  }

  it('a saved test shows its code; the save never sends a code', () => {
    const { c, api } = make();
    expect(c.codeText()).toBe('BIO019');
    c.saveTest();
    expect(lastPatchBody(api).testCode).toBeUndefined();
  });

  it('a new test (profile included) saves without a code and toasts the one the server assigned', () => {
    const { c, api, toasts } = make({ id: null, individuals, depts: [{ id: 'd1', name: 'Clinical Pathology' }],
      postResult: { id: 'new1', testCode: 'CLP900' } });
    c.onDeptPicked('Clinical Pathology');
    expect(c.metaChips().find((x: any) => x.k === 'Code').v).toBe('Auto');
    c.patch({ name: 'Ferritin' });
    c.saveTest();
    expect((api.post.mock.calls[0][1] as any).testCode).toBeUndefined();
    expect(toasts.success).toHaveBeenCalledWith('Created — code CLP900');
  });

  it('a server code_readonly refusal is a warning toast, not a code-field error', () => {
    const { c, toasts } = make({ patchErr: new ApiError('Test codes are assigned automatically', 'code_readonly') });
    c.saveTest();
    expect(toasts.warning).toHaveBeenCalledWith(expect.stringContaining('assigned automatically'));
    expect(c.fieldError('testCode')).toBeFalsy();
  });

  it('clone mode: a customised copy offers no revert (the server would refuse it)', () => {
    const { c } = make({ test: baseTest({ origin: 'customised', catalogMode: 'clone' }) });
    expect(c.canRevert()).toBe(false);
  });

  it('reference mode: a customised copy can revert to the master', () => {
    const { c } = make({ test: baseTest({ origin: 'customised', catalogMode: 'reference' }) });
    expect(c.canRevert()).toBe(true);
  });
});

describe('TestEditor — TARGET behaviour', () => {
  it('TARGET phase 2: the test save carries NO price/discount/tax (pricing table owns it)', () => {
    const { c, api } = make();
    c.patch({ price: 400, taxSlab: 5 });
    c.saveTest();
    const body = lastPatchBody(api);
    expect(body.price).toBeUndefined();
    expect(body.taxSlab).toBeUndefined();
    expect(body.discount).toBeUndefined();
  });

  it('TARGET phase 0/6: no test-level critical pair — criticals live on bands/params only', () => {
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

  it('TARGET phase 0: hybrid methodology — per-value copies equal to the test-level one are stripped on save', () => {
    const raw = P([{ name: 'sodium', type: 'numeric', methodology: 'ISE' }, { name: 'k', type: 'numeric', methodology: 'Flame' }]);
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    const ps = JSON.parse(lastPatchBody(api).parametersJson).parameters;
    expect(ps[0].methodology).toBeUndefined();    // == test-level ISE → stripped
    expect(ps[1].methodology).toBe('Flame');      // real override kept
  });

  it('TARGET phase 0: specimen = the sampleType column only (no wrapper sampleType in parametersJson)', () => {
    const raw = P([{ name: 'sodium', type: 'numeric' }], { sampleType: 'Plasma' });
    const { c, api } = make({ test: baseTest({ parameters: raw }) });
    c.saveTest();
    expect(JSON.parse(lastPatchBody(api).parametersJson).sampleType).toBeUndefined();
  });


  it('TARGET phase 3: summary shows the origin badge (master | customised | branch | local)', () => {
    const { c } = make({ test: baseTest({ origin: 'customised' }) });
    expect(c.metaChips().find((x: any) => x.k === 'Origin')?.v).toBe('Customised');
  });
});

describe('TestEditor — price via the pricing table (phase 2)', () => {
  it('a changed price saves the test first, then ONE bulk price write (price + tax)', () => {
    const { c, api, pricing, toasts } = make();
    c.patch({ price: 400, taxSlab: 5 });
    c.saveTest();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 't1', price: 400, taxSlab: 5 }]);
    expect(toasts.success).toHaveBeenCalledWith('Saved');
    expect(c.dirty()).toBe(false);
  });

  it('a new test posts content, then prices the NEW id only when the price left the ₹1 default', () => {
    const { c, api, pricing } = make({ id: null });
    expect(c._draft().price).toBe(1);
    c.patch({ name: 'Ferritin', price: 650 });
    c.saveTest();
    expect(api.post).toHaveBeenCalledWith('/api/tests/', expect.not.objectContaining({ price: expect.anything() }));
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 'new1', price: 650, taxSlab: 0 }]);
  });

  it('a new test left at ₹1 writes no price (stays "not priced yet")', () => {
    const { c, pricing } = make({ id: null });
    c.patch({ name: 'Ferritin' });
    c.saveTest();
    expect(pricing.save).not.toHaveBeenCalled();
  });

  it('a price-write failure keeps the editor dirty, marks the price field and says the test itself saved', () => {
    const { c, toasts } = make({ priceErr: { error: { message: 'invalid_branch' } } });
    c.patch({ price: 999 });
    c.saveTest();
    expect(c.fieldError('price')).toBe('invalid_branch');
    expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining('Test saved, but the price was not'));
    expect(c.dirty()).toBe(true);
  });

  it('a test still at the default shows the "₹1 · not priced yet" chip until the price changes', () => {
    const { c } = make({ test: baseTest({ price: 1, priceIsDefault: true }) });
    expect(c.priceIsDefault()).toBe(true);
    expect(c.metaChips().find((x: any) => x.k === 'Price').v).toBe('₹1 · not priced yet');
    c.patch({ price: 120 });
    expect(c.priceIsDefault()).toBe(false);
    expect(c.metaChips().find((x: any) => x.k === 'Price').v).toBe('₹120.00');
  });

  it('package "sum of parts" totals member effective prices (₹1 for unpriced members)', () => {
    const { c } = make({
      test: baseTest({ type: 'package', parameters: JSON.stringify({ items: [{ testId: 'a' }, { testId: 'b' }] }) }),
      individuals: [
        { id: 'a', type: 'individual', name: 'A', price: 200, priceIsDefault: false },
        { id: 'b', type: 'individual', name: 'B', price: 1, priceIsDefault: true },
      ],
    });
    expect(c.packageMembersTotal()).toBe(201);
  });
});

describe('TestEditor — copy-on-write (phases 3 + 5)', () => {
  it('first save of a MASTER test follows the lab\'s new copy: replaceUrl to the new id, re-read it', () => {
    const { c, api, router, toasts } = make({ test: baseTest({ origin: 'master' }),
      patchResult: baseTest({ id: 'copy1', origin: 'customised' }),
      tests: { copy1: baseTest({ id: 'copy1', origin: 'customised' }) } });
    c.patch({ name: 'Sodium (lab)' });
    c.saveTest();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/tests', 'copy1', 'edit'], { queryParams: { type: 'individual' }, replaceUrl: true });
    expect(api.get).toHaveBeenCalledWith('/api/tests/copy1');
    expect(c._draft().id).toBe('copy1');
    expect(c.origin()).toBe('customised');
    expect(toasts.success).toHaveBeenCalledWith(expect.stringContaining('own version'));
  });

  it('a price change on that first save is written against the NEW id', () => {
    const { c, pricing } = make({ test: baseTest({ origin: 'master' }),
      patchResult: baseTest({ id: 'copy1', origin: 'customised' }),
      tests: { copy1: baseTest({ id: 'copy1', origin: 'customised' }) } });
    c.patch({ price: 480 });
    c.saveTest();
    expect(pricing.save).toHaveBeenCalledWith([{ testId: 'copy1', price: 480, taxSlab: 0 }]);
  });

  it('a save that stays on the same row does not navigate', () => {
    const { c, router } = make({ test: baseTest({ origin: 'customised' }), patchResult: baseTest({ origin: 'customised' }) });
    c.saveTest();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('Revert to master: offered for customised / branch only, never in master mode', () => {
    expect(make({ test: baseTest({ origin: 'customised' }) }).c.canRevert()).toBe(true);
    TestBed.resetTestingModule();
    expect(make({ test: baseTest({ origin: 'branch' }) }).c.canRevert()).toBe(true);
    TestBed.resetTestingModule();
    expect(make({ test: baseTest({ origin: 'master' }) }).c.canRevert()).toBe(false);
    TestBed.resetTestingModule();
    expect(make({ test: baseTest({ origin: 'local' }) }).c.canRevert()).toBe(false);
    TestBed.resetTestingModule();
    const m = make({ test: baseTest({ origin: 'customised' }) });
    m.c.setCodeMode('master');
    expect(m.c.canRevert()).toBe(false);
  });

  it('Revert confirms through DialogService, POSTs revert-to-master and follows the master row', async () => {
    const master = baseTest({ id: 'm1', origin: 'master' });
    const { c, api, dialog, router } = make({ test: baseTest({ origin: 'customised' }), confirm: true, revertResult: master });
    await c.revertToMaster();
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ confirmLabel: 'Revert to master', tone: 'danger' }));
    expect(api.post).toHaveBeenCalledWith('/api/tests/t1/revert-to-master', {});
    expect(router.navigate).toHaveBeenCalledWith(['/admin/tests', 'm1', 'edit'], { queryParams: { type: 'individual' }, replaceUrl: true });
    expect(c._draft().id).toBe('m1');
    expect(c.origin()).toBe('master');
  });

  it('Revert cancelled sends nothing', async () => {
    const { c, api } = make({ test: baseTest({ origin: 'customised' }) });
    await c.revertToMaster();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('TestEditor — profile member order + code-wise picker (QA 2026-09-24)', () => {
  const members = [
    { id: 'a', type: 'individual', name: 'Albumin', testCode: 'BIO010', department: { name: 'Biochemistry' } },
    { id: 'b', type: 'individual', name: 'Bilirubin', testCode: 'BIO002', department: { name: 'Biochemistry' } },
    { id: 'c', type: 'individual', name: 'Creatinine', testCode: 'BIO1000', department: { name: 'Biochemistry' } },
    { id: 'd', type: 'individual', name: 'Globulin', testCode: 'BIO2', department: { name: 'Biochemistry' } },
  ];
  const profile = (ids: string[]) =>
    baseTest({ type: 'profile', parameters: JSON.stringify({ items: ids.map(testId => ({ testId })) }) });

  it('an existing profile keeps its STORED member order (no re-sort on load)', () => {
    const { c } = make({ test: profile(['c', 'a', 'b']), individuals: members });
    expect(c.orderedMembers().map((m: any) => m.id)).toEqual(['c', 'a', 'b']);
    expect(c.orderedMembers()[0]).toMatchObject({ name: 'Creatinine', code: 'BIO1000' });
  });

  it('up/down arrows reorder, and the save persists that order in items[]', () => {
    const { c, api } = make({ test: profile(['c', 'a', 'b']), individuals: members });
    c.moveMember(0, 1);          // c ↓  → a, c, b
    c.moveMember(2, -1);         // b ↑  → a, b, c
    c.moveMember(0, -1);         // top can't go up — no-op
    c.moveMember(2, 1);          // bottom can't go down — no-op
    expect(c.orderedMembers().map((m: any) => m.id)).toEqual(['a', 'b', 'c']);
    c.saveTest();
    expect(JSON.parse(lastPatchBody(api).parametersJson))
      .toEqual({ items: [{ testId: 'a' }, { testId: 'b' }, { testId: 'c' }] });
  });

  it('drag-and-drop moves a member to the dropped slot', () => {
    const { c } = make({ test: profile(['a', 'b', 'c']), individuals: members });
    c.dropMember({ previousIndex: 2, currentIndex: 0 });
    expect(c.orderedMembers().map((m: any) => m.id)).toEqual(['c', 'a', 'b']);
    c.dropMember({ previousIndex: 1, currentIndex: 1 });
    expect(c.orderedMembers().map((m: any) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('a newly ticked member lands at the end of the order', () => {
    const { c } = make({ test: profile(['b']), individuals: members });
    c.togglePackageMember('a');
    expect(c.orderedMembers().map((m: any) => m.id)).toEqual(['b', 'a']);
  });

  it('the member picker is arranged code-wise (natural number order, name breaks ties)', () => {
    const { c } = make({ test: profile(['a']), individuals: members });
    const groups = c.filteredPackageCatalogByDept();
    const dept = groups.find((g: any) => g.department === 'Biochemistry');
    // BIO002 and BIO2 tie on number → name breaks the tie; then BIO010, BIO1000.
    expect(dept.tests.map((t: any) => t.testCode)).toEqual(['BIO002', 'BIO2', 'BIO010', 'BIO1000']);
    const selected = groups.find((g: any) => g.department === 'Selected');
    expect(selected.tests.map((t: any) => t.id)).toEqual(['a']);
  });

  it('the picker search also matches a test code', () => {
    const { c } = make({ test: profile([]), individuals: members });
    c.packageQuery.set('bio01');
    const all = c.filteredPackageCatalogByDept().flatMap((g: any) => g.tests.map((t: any) => t.testCode));
    expect(all).toEqual(['BIO010']);
  });
});
