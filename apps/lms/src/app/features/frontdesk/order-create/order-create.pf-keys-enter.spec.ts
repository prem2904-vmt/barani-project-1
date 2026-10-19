import { readFileSync } from 'node:fs';
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
 * PF Keys on the order-create test search: the keypad's primary key says
 * what Enter will do to the HIGHLIGHTED match — "Add ↵" when it is not in
 * the order, "Remove ↵" (destructive-neutral tone) when it already is —
 * live as the highlight moves and the cart changes. Patient scope keeps
 * its fixed "Select".
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

describe('PF Keys primary key: Add ⇄ Remove follows the highlighted test', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const tests = [
    T('uglu', 'Urine Glucose', 'Clinical Pathology'),
    T('uket', 'Urine Ketones', 'Clinical Pathology'),
  ];
  const key = (c: any) => ({ label: c.pfKeysEnter(), aria: c.pfKeysEnterAria(), tone: c.pfKeysEnterTone() });

  it('highlight a not-added test → Add; add it → Remove; Enter removes it → back to Add', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    const hl = c.activeTestId();
    expect(c.isSelected(hl)).toBe(false);
    expect(key(c)).toEqual({ label: 'Add', aria: 'Add selected test', tone: 'primary' });

    // Added (a tap on the row keeps the list and the highlight).
    c.addSearchResult(c.searchResults().find((t: any) => t.id === hl));
    expect(c.isSelected(hl)).toBe(true);
    expect(key(c)).toEqual({ label: 'Remove', aria: 'Remove selected test', tone: 'remove' });

    // Enter on the highlighted, already-added test REMOVES it.
    c.onPillEnter(new Event('keydown'));
    expect(c.isSelected(hl)).toBe(false);
    expect(key(c)).toEqual({ label: 'Add', aria: 'Add selected test', tone: 'primary' });
  });

  it('updates live as the highlight moves between an added and a not-added row', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    const first = c.activeTestId();
    c.addSearchResult(c.searchResults().find((t: any) => t.id === first));
    expect(c.pfKeysEnter()).toBe('Remove');
    c.onPillArrow(new Event('keydown'), 1);
    expect(c.activeTestId()).not.toBe(first);
    expect(c.pfKeysEnter()).toBe('Add');
    expect(c.pfKeysEnterAria()).toBe('Add selected test');
    c.onPillArrow(new Event('keydown'), -1);
    expect(c.pfKeysEnter()).toBe('Remove');
    expect(c.pfKeysEnterAria()).toBe('Remove selected test');
  });

  it('the cart changing elsewhere (e.g. removed from the cart) flips it back', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    const hl = c.activeTestId();
    c.addSearchResult(c.searchResults().find((t: any) => t.id === hl));
    expect(c.pfKeysEnter()).toBe('Remove');
    c.addSearchResult(c.searchResults().find((t: any) => t.id === hl));   // toggled out
    expect(c.pfKeysEnter()).toBe('Add');
  });

  it('no query / no highlight → Add; Patient scope keeps its fixed Select', () => {
    const { c } = make(tests);
    expect(c.pfKeysEnter()).toBe('Add');
    expect(c.pfKeysEnterTone()).toBe('primary');
    c.onPillInput('urine');
    c.addSearchResult(c.searchResults()[0]);
    c.selectScope('patient');
    expect(c.scope()).toBe('patient');
    expect(c.pfKeysEnter()).toBe('Select');
    expect(c.pfKeysEnterAria()).toBe('Select highlighted patient');
    expect(c.pfKeysEnterTone()).toBe('primary');
  });

  it('the template binds the tone to the keypad', () => {
    const html = readFileSync('apps/lms/src/app/features/frontdesk/order-create/order-create.component.html', 'utf8');
    expect(html).toMatch(/\[pfKeysEnterTone\]="pfKeysEnterTone\(\)"/);
  });
});
