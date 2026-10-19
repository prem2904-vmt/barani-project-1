import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { OrderCreateComponent } from './order-create.component';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavBackService } from '../../../core/services/nav-back.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * (Harness copied from order-create.unified-search.spec.ts.)
 * Unified search pill (Option A): scope tiles + one input. Picking a match
 * fills the tile and returns the scope to Tests. Every scope's results open
 * in one dropdown under the pill (touch-first); the grid stays a browse view.
 * Urgent is a switch in the billing card; the patient is required.
 */
const PATIENTS = [
  { id: 'p1', displayName: 'Ms. Sansa Stark', age: 27, sex: 'Female', mrn: 'AA0009', phone: '+91 76545' },
  { id: 'p2', displayName: 'Mr. Jon Snow', age: 31, sex: 'Male', mrn: 'AA0012' },
];

function make(tests: any[] = [], perms: string[] = []) {
  // Always a desktop viewport: these specs assert the LONG placeholders. Only
  // installing a stub "if missing" inherited whatever matchMedia another spec
  // in the same worker left behind (order-create.render.spec's phone() stub),
  // so isPhone() flipped on and the short 'Find doctor' placeholder showed.
  (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const get = vi.fn((url: string) => {
    if (url.startsWith('/api/patients?q=')) return of(PATIENTS);
    if (url.startsWith('/api/patients/')) {
      const id = url.split('/').pop()!;
      return of({ patient: PATIENTS.find(p => p.id === id), history: [] });
    }
    if (url.startsWith('/api/test-picker/doctors')) return of(['Dr. A. Sharma', 'Dr. R. Iyer']);
    if (url.startsWith('/api/test-picker/hospitals')) return of(['Apollo ERD', 'Kauvery Hospital']);
    return of([]);
  });
  const api = { get, post: vi.fn(() => of({})), patch: vi.fn(() => of({})), delete: vi.fn(() => of({})) };
  const router = { navigate: vi.fn(() => Promise.resolve(true)), navigateByUrl: vi.fn(() => Promise.resolve(true)) };
  const stub = {};
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: { success() {}, error() {}, info() {}, warning() {} } },
      { provide: ActivatedRoute, useValue: { queryParamMap: of(new Map()), snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: BranchLabConfigService, useValue: stub },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(tests);
  c.isWebSearch.set(true);          // web / desktop mode unless a test says otherwise
  return { c, api, router };
}

const T = (id: string, name: string, dept: string, extra: any = {}) =>
  ({ id, name, testCode: id.toUpperCase(), type: 'individual', price: 10, tatHours: 4, isActive: true,
     department: { name: dept }, ...extra });


/**
 * Owner 2026-09-27: "we don't need a department mentioned for a package".
 * Order screen: a package shows no department (row / cart card), a legacy
 * stored one never adds a department chip nor matches a search, and a
 * department chip keeps a package whose members are in that department.
 */
const items = (...ids: string[]) => JSON.stringify({ items: ids.map(testId => ({ testId })) });
const CATALOG = [
  T('hb', 'Haemoglobin Check', 'Haematology'),
  T('glu', 'Glucose Check', 'Biochemistry'),
  T('wb', 'Wellness Check', 'Molecular', { type: 'package', testCode: null, parameters: items('hb', 'glu') }),
];

describe('Order screen — a package carries no department', () => {
  it('a package shows no department label; a test shows its own', () => {
    const { c } = make(CATALOG);
    expect(c.deptLabel(CATALOG[2])).toBe('');
    expect(c.deptLabel(CATALOG[0])).toBe('Haematology');
  });

  it('a legacy package department never becomes a department chip', () => {
    const { c } = make(CATALOG);
    expect(c.deptChips().map((d: any) => d.name)).toEqual(['Biochemistry', 'Haematology']);
  });

  it('searching a legacy package department finds nothing', () => {
    const { c } = make(CATALOG);
    c._query.set('Molecular');
    expect(c.searchResults().map((t: any) => t.id)).toEqual([]);
  });

  it('a department chip keeps a package that has members there', () => {
    const { c } = make(CATALOG);
    c._query.set('check');   // matches all three by name
    c.setSearchDept('Haematology');
    expect(c.searchResults().map((t: any) => t.id).sort()).toEqual(['hb', 'wb']);
    expect(c.searchDeptCounts()['Biochemistry']).toBe(2);
    expect(c.searchDeptCounts()['Molecular']).toBeUndefined();
  });
});
