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
import { TenantStateService } from '../../../../core/services/tenant-state.service';

/**
 * "(unknown test)" inside profiles (owner 2026-10-25). Reference mode: the
 * profile stores the MASTER member ids, the tenant's list holds override rows
 * with other ids but the same catalog key — the server orders them fine
 * (resolved by catalog key), so the editor must name them the same way. What
 * still doesn't resolve says why: "Inactive: CRP", a family line's name,
 * "Removed from Test Master". (Harness from test-editor.profile-print-picker.spec.ts.)
 */
const PROFILE = {
  id: 'p1', tenantId: 'tn', name: 'Fever Panel', type: 'profile', flow: 'direct',
  price: 900, taxSlab: 0, discount: 0, departmentId: 'd1', tatHours: 4,
  sampleType: 'Serum', tubeColor: 'sst', testCode: 'PRO020', shortName: '', section: '',
  methodology: '', resultType: '', unit: '', reportFormat: 'tabular',
  parameters: JSON.stringify({ items: [{ testId: 'm-hb' }, { testId: 'm-crp' }, { testId: 'fam-1' }, { testId: 'gone' }, { testId: 'l-wbc' }] }),
  conditions: '[]', isActive: true, createdAt: '', origin: 'master', fastingRequired: false, priceIsDefault: true,
};
// The tenant's lists: override rows (other ids) + one plain local test.
const INDIVIDUALS = [
  { id: 'l-hb', name: 'Haemoglobin', type: 'individual', testCode: 'HEM001', catalogKey: 'K-HB', price: 100, tatHours: 2 },
  { id: 'l-wbc', name: 'Total WBC Count', type: 'individual', testCode: 'HEM002', catalogKey: 'K-WBC', price: 100, tatHours: 2 },
];
// The server's REAL answer: `memberId` = the id as stored in the profile, `testId` = the RESOLVED row
// (the lab's override row — a different id — for a customised member).
const MEMBERS = [
  { memberId: 'm-hb', testId: 'l-hb', catalogKey: 'K-HB', name: 'Haemoglobin', code: 'HEM001', status: 'active', type: 'individual' },
  { memberId: 'm-crp', testId: 'm-crp', catalogKey: 'K-CRP', name: 'CRP', code: 'BIO040', status: 'inactive', type: 'individual' },
  { memberId: 'fam-1', testId: 'fam-1', catalogKey: 'K-FAM', name: 'Urine casts', code: 'FAM001', status: 'family_line', type: 'individual' },
  { memberId: 'gone', testId: 'gone', catalogKey: null, name: null, code: null, status: 'missing', type: null },
  { memberId: 'l-wbc', testId: 'l-wbc', catalogKey: 'K-WBC', name: 'Total WBC Count', code: 'HEM002', status: 'active', type: 'individual' },
];

function render(opts: { members?: 'ok' | 'error'; profile?: typeof PROFILE; membersAnswer?: unknown[] } = {}) {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => {
      if (url === '/api/tenants/departments') return of([{ id: 'd1', name: 'Biochemistry' }]);
      if (url === '/api/tests/p1') return of(opts.profile ?? PROFILE);
      if (url === '/api/tests/p1/members')
        return opts.members === 'error' ? throwError(() => new Error('404')) : of(opts.membersAnswer ?? MEMBERS);
      if (url === '/api/tests/?type=individual') return of(INDIVIDUALS);
      if (url === '/api/tests/?type=profile') return of([]);
      return of([]);
    }),
    patch: vi.fn((_u: string, body: any) => of({ ...(opts.profile ?? PROFILE), ...body })), post: vi.fn(() => of({})), put: vi.fn(() => of({})), delete: vi.fn(() => of({})),
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
        paramMap: new Map([['id', 'p1']]), queryParamMap: new Map([['type', 'profile']]) } } },
      { provide: Router, useValue: { navigate: vi.fn(), url: '/admin/tests/p1/edit', events: of() } },
      { provide: NavBackService, useValue: { backTo: vi.fn(), back: vi.fn(), showBack: () => true } },
      { provide: ThemeService, useValue: { isDark: () => false, isNewDesign: () => true } },
      { provide: TestPricingService, useValue: { save: vi.fn(() => of({})), ensureLoaded: vi.fn(), isolationOn: () => false } },
      { provide: DialogService, useValue: { confirm: vi.fn(async () => false) } },
      { provide: TenantStateService, useValue: { tenant: () => null } },
    ],
  });
  TestBed.overrideComponent(TestEditorComponent, { set: { schemas: [] } });
  const f = TestBed.createComponent(TestEditorComponent);
  f.detectChanges();
  TestBed.flushEffects();
  f.detectChanges();
  const c = f.componentInstance as any;
  c.jumpToSection('results');
  f.detectChanges();
  const el = f.nativeElement as HTMLElement;
  return { f, el, c, api };
}

describe('Test editor — profile member names (no "(unknown test)")', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('asks the server for the profile’s members', () => {
    const { api } = render();
    expect(api.get).toHaveBeenCalledWith('/api/tests/p1/members');
  });

  it('reference mode: a master member id resolves by catalog key to the tenant’s row', () => {
    const { c } = render();
    expect(c.memberName('m-hb')).toBe('Haemoglobin');
    // …and the editor reads the tenant's row for it (price, code, calc).
    expect(c._memberById().get('m-hb')?.id).toBe('l-hb');
    expect(c.memberName('l-wbc')).toBe('Total WBC Count');
  });

  it('unresolved members say why in plain words', () => {
    const { c } = render();
    expect(c.memberName('m-crp')).toBe('Inactive: CRP');
    expect(c.memberName('fam-1')).toBe('Urine casts');
    expect(c.memberName('gone')).toBe('Removed from Test Master');
  });

  it('the member order list never shows "(unknown test)"', () => {
    const { el, c } = render();
    const names = c.orderedMembers().map((m: any) => m.name);
    expect(names).toEqual(['Haemoglobin', 'Inactive: CRP', 'Urine casts', 'Removed from Test Master', 'Total WBC Count']);
    expect(el.textContent).not.toContain('unknown test');
    expect(c.orderedMembers()[1].code).toBe('BIO040');
  });

  it('an older server without the endpoint: list names still resolve; the rest reads "Not in the test list"', () => {
    const { c } = render({ members: 'error' });
    expect(c.membersState()).toBe('none');
    expect(c.memberName('l-wbc')).toBe('Total WBC Count');
    expect(c.memberName('m-hb')).toBe('Not in the test list');
  });

  // ── the owner's repro: add → remove → re-add → save → reopen ──
  it('add, remove, re-add, save, reopen: every stored member still has a name', async () => {
    const { c, api } = render();
    const crp = { id: 'l-crp', name: 'C-Reactive Protein', type: 'individual', testCode: 'BIO040', catalogKey: 'K-CRP', price: 100, tatHours: 2 };
    c._allIndividualTests.update((l: any[]) => [...l, crp]);
    c.togglePackageMember('l-crp');           // add
    c.togglePackageMember('l-crp');           // remove
    c.togglePackageMember('l-crp');           // add it again
    c.togglePackageMember('l-hb');            // and a list row the profile already holds as 'm-hb'
    expect(c.memberName('l-crp')).toBe('C-Reactive Protein');
    c.saveTest();
    const sent = (api.patch.mock.calls as any[][])[0][1] as { parametersJson: string };
    const items = JSON.parse(sent.parametersJson).items as { testId: string }[];
    expect(items.map(i => i.testId)).toContain('l-crp');

    // Reopen: a fresh editor on the saved blob + what the server answers for it (authored order).
    TestBed.resetTestingModule();
    const saved = { ...PROFILE, parameters: sent.parametersJson };
    const answer = items.map(i => {
      const known = (MEMBERS as any[]).find(m => m.memberId === i.testId);
      return known ?? { memberId: i.testId, testId: i.testId, catalogKey: 'K-CRP', name: 'C-Reactive Protein', code: 'BIO040', status: 'active', type: 'individual' };
    });
    const re = render({ profile: saved as any, membersAnswer: answer });
    // 'gone' really is removed from the Test Master; every other stored member must be named.
    for (const i of items.filter(i => i.testId !== 'gone')) expect(re.c.memberName(i.testId)).not.toMatch(/Removed from Test Master|Not in the test list|Loading|unknown/i);
    expect(re.c.memberName('m-hb')).toBe('Haemoglobin');
    expect(re.c.memberName('l-crp')).toBe('C-Reactive Protein');
    expect(re.el.textContent).not.toContain('unknown test');
  });

  it('refreshes the member answer after a save', () => {
    const { c, api } = render();
    c.togglePackageMember('l-hb');
    const before = (api.get.mock.calls as any[][]).filter(a => a[0] === '/api/tests/p1/members').length;
    c.saveTest();
    const after = (api.get.mock.calls as any[][]).filter(a => a[0] === '/api/tests/p1/members').length;
    expect(after).toBe(before + 1);
  });

  it('an older server without memberId: pairs by position with the ids the profile was loaded with', () => {
    const old = (MEMBERS as any[]).map(({ memberId, ...rest }) => rest);
    const { c } = render({ membersAnswer: old });
    expect(c.memberName('m-hb')).toBe('Haemoglobin');
    expect(c.memberName('gone')).toBe('Removed from Test Master');
  });
});
