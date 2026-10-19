import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
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
 * Owner 2026-09-27: "we don't need a department mentioned for a package".
 * Test Master grid, Packages view: a package has no department of its own —
 * the Departments filter lists it under every department its members are in
 * (never "Unassigned", never by a legacy stored department), "All" lists
 * every package, and the Tests / Profiles views are unchanged.
 * (Harness copied from tests.component.side-card.spec.ts.)
 */
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const test = (over: any = {}) => ({
  id: 't1', name: 'Haemoglobin', type: 'individual', isActive: true, testCode: 'HEM012',
  price: 150, department: { id: 'd1', name: 'Haematology' }, ...over,
});
const TESTS = [
  test(),
  test({ id: 't3', name: 'Glucose', testCode: 'BIO001', department: { id: 'd2', name: 'Biochemistry' } }),
  test({ id: 't4', name: 'SGOT', testCode: 'BIO010', department: { id: 'd2', name: 'Biochemistry' } }),
  test({ id: 'p1', name: 'LFT', type: 'profile', testCode: 'PRO001', parameters: items('t4'),
         department: { id: 'd2', name: 'Biochemistry' } }),
  // Spans Haematology + Biochemistry (through the LFT profile); a LEGACY
  // stored department (Molecular) that must never be used.
  test({ id: 'k1', name: 'Wellness Basic', type: 'package', testCode: null, parameters: items('t1', 'p1'),
         department: { id: 'd3', name: 'Molecular' } }),
  // Biochemistry only; no stored department.
  test({ id: 'k2', name: 'Sugar Check', type: 'package', testCode: null, parameters: items('t3'), department: null }),
  // No members yet: listed under "All" only.
  test({ id: 'k3', name: 'Empty Package', type: 'package', testCode: null, parameters: items(), department: null }),
];
const DEPTS = [
  { id: 'd1', name: 'Haematology', code: 'HEM', isActive: true },
  { id: 'd2', name: 'Biochemistry', code: 'BIO', isActive: true },
  { id: 'd3', name: 'Molecular', code: 'MOL', isActive: true },
];

function render(type: 'individual' | 'profile' | 'package') {
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const api = {
    get: vi.fn((url: string) => of(url.startsWith('/api/tests') ? TESTS
      : url.startsWith('/api/catalog-proposals') ? [] : DEPTS)),
    patch: vi.fn(() => of({})),
    post: vi.fn(() => of({})),
  };
  const dialog = { confirm: vi.fn(async (_opts: any) => false) };
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
      { provide: ActivatedRoute, useValue: { queryParams: of({ type }) } },
    ],
  });
  TestBed.overrideComponent(TestsComponent, {
    set: { imports: [FormsModule, NgTemplateOutlet, BusyDirective], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
  });
  const f = TestBed.createComponent(TestsComponent);
  f.detectChanges();
  return { f, el: f.nativeElement as HTMLElement, c: f.componentInstance as any, dialog };
}

const bucket = (c: any, name: string) => c.departments().find((d: any) => d.name === name);
const rootIds = (c: any) => c.rowData().filter((r: any) => (r._level ?? 0) === 0).map((r: any) => r.id);

describe('Test Master grid — a package has no department', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('Packages view: counts follow the members, never the stored department or "Unassigned"', () => {
    const { c } = render('package');
    expect(bucket(c, 'Haematology').count).toBe(1);   // k1
    expect(bucket(c, 'Biochemistry').count).toBe(2);  // k1 (via LFT) + k2
    expect(bucket(c, 'Molecular').count).toBe(0);     // k1's legacy department is ignored
    expect(bucket(c, 'Unassigned')).toBeUndefined();  // k3 has no members → only under All
  });

  it('Packages view: "All" lists every package; a department lists the packages with members there', () => {
    const { c } = render('package');
    expect(rootIds(c).sort()).toEqual(['k1', 'k2', 'k3']);
    c.selectDept('Biochemistry');
    expect(rootIds(c).sort()).toEqual(['k1', 'k2']);
    c.selectDept('Haematology');
    expect(rootIds(c)).toEqual(['k1']);
    c.selectDept('Molecular');
    expect(rootIds(c)).toEqual([]);
    c.selectDept(null);
    expect(rootIds(c).length).toBe(3);
  });

  it('Packages view: the grid shows no department column (Kind says Package)', () => {
    const { c } = render('package');
    const cols = c.colDefs();
    expect(cols.some((x: any) => /department/i.test(String(x.headerName ?? '')))).toBe(false);
    const kind = cols.find((x: any) => x.colId === 'kind');
    expect(kind.valueGetter({ data: TESTS.find(t => t.id === 'k1') })).toBe('Package');
  });

  it('Packages view: turning a department off says packages stay listed', async () => {
    const { c, dialog } = render('package');
    await c.toggleDept(bucket(c, 'Haematology'));
    expect((dialog.confirm.mock.calls[0] as any[])[0].message).toContain('Packages stay listed');
  });

  it('Tests and Profiles views are unchanged: a row counts under its own department', () => {
    const tests = render('individual');
    expect(bucket(tests.c, 'Biochemistry').count).toBe(2);
    expect(bucket(tests.c, 'Haematology').count).toBe(1);
    TestBed.resetTestingModule();
    const profiles = render('profile');
    expect(bucket(profiles.c, 'Biochemistry').count).toBe(1);
    profiles.c.selectDept('Haematology');
    expect(rootIds(profiles.c)).toEqual([]);
  });
});
