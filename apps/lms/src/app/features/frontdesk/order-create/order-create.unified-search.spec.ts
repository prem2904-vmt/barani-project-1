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
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { ProcessWorkflowService } from '../../../core/services/process-workflow.service';
import { AuthService } from '../../../core/auth/auth.service';

/**
 * Unified search pill (Option A): scope tiles + one input. Picking a match
 * fills the tile and returns the scope to Tests; the Urgent chip is the order
 * priority; the Tests scope filters the catalogue in the page.
 */
const PATIENTS = [
  { id: 'p1', displayName: 'Ms. Sansa Stark', age: 27, sex: 'Female', mrn: 'AA0009', phone: '+91 76545' },
  { id: 'p2', displayName: 'Mr. Jon Snow', age: 31, sex: 'Male', mrn: 'AA0012' },
];

function make(tests: any[] = [], perms: string[] = []) {
  if (!window.matchMedia) {
    (window as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
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
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map(), queryParamMap: new Map() } } },
      { provide: Router, useValue: router },
      { provide: NavBackService, useValue: stub },
      { provide: Location, useValue: stub },
      { provide: FrontdeskSettingsService, useValue: stub },
      { provide: BranchLabConfigService, useValue: stub },
      { provide: ProcessWorkflowService, useValue: { isEnabled: () => true } },
      { provide: AuthService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
      { provide: DomSanitizer, useValue: stub },
    ],
  });
  const c = TestBed.runInInjectionContext(() => new OrderCreateComponent()) as any;
  c._tests.set(tests);
  return { c, api, router };
}

const T = (id: string, name: string, dept: string, extra: any = {}) =>
  ({ id, name, testCode: id.toUpperCase(), type: 'individual', price: 10, tatHours: 4, isActive: true,
     department: { name: dept }, ...extra });

describe('Unified search — scope switching', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts on Tests with the tests placeholder and no dropdown', () => {
    const { c } = make();
    expect(c.scope()).toBe('tests');
    expect(c.scopeOpen()).toBe(false);
    expect(c.pillPlaceholder()).toContain('Search tests');
  });

  it('clicking Doctor makes it the active scope, swaps the placeholder and opens its matches', () => {
    const { c, api } = make();
    c.selectScope('doctor');
    expect(c.scope()).toBe('doctor');
    expect(c.scopeOpen()).toBe(true);
    expect(c.pillPlaceholder()).toBe('Find the referring doctor');
    expect(api.get).toHaveBeenCalledWith('/api/test-picker/doctors');
    expect(c.scopeRows().map((r: any) => r.title)).toEqual(['Dr. A. Sharma', 'Dr. R. Iyer']);
  });

  it('Hospital scope lists referring hospitals; Tests closes the dropdown', () => {
    const { c } = make();
    c.selectScope('hospital');
    expect(c.scopeRows().map((r: any) => r.title)).toEqual(['Apollo ERD', 'Kauvery Hospital']);
    c.selectScope('tests');
    expect(c.scopeOpen()).toBe(false);
  });

  it('Esc closes the dropdown and returns to Tests', () => {
    const { c } = make();
    c.selectScope('patient');
    c.onPillEscape();
    expect(c.scope()).toBe('tests');
    expect(c.scopeOpen()).toBe(false);
  });

  it('typing in the Patient scope searches the real patient endpoint (≥2 chars)', () => {
    const { c, api } = make();
    c.selectScope('patient');
    c.onPillInput('s');
    expect(c.patientStatus()).toBe('hint');
    c.onPillInput('sa');
    vi.advanceTimersByTime(250);
    expect(api.get).toHaveBeenCalledWith('/api/patients?q=sa&limit=10');
    expect(c.scopeRows()[0]).toMatchObject({ key: 'p1', title: 'Ms. Sansa Stark' });
    expect(c.scopeRows()[0].meta).toContain('AA0009');
  });
});

describe('Unified search — picking fills a tile', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('picking a patient attaches it, fills the tile and returns the scope to Tests', () => {
    const { c, router } = make();
    c.selectScope('patient');
    c.onPillInput('sa');
    vi.advanceTimersByTime(250);
    c.onPillArrow(new Event('keydown'), 1);        // ↓ to Jon Snow
    c.onPillEnter(new Event('keydown'));
    expect(c.patient()?.id).toBe('p2');
    expect(c.tileLabel('patient')).toBe('Mr. Jon Snow');
    expect(c.scope()).toBe('tests');
    expect(c.scopeOpen()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { patientId: 'p2' }, queryParamsHandling: 'merge' });
  });

  it('picking a doctor fills the Doctor tile (the refDoctorName the order posts)', () => {
    const { c } = make();
    c.selectScope('doctor');
    c.pickScopeRow(c.scopeRows()[1]);
    expect(c.refDoctorName()).toBe('Dr. R. Iyer');
    expect(c.tileLabel('doctor')).toBe('Dr. R. Iyer');
    expect(c.scope()).toBe('tests');
  });

  it('a name with no match can still be added as a new entry (free text, as before)', () => {
    const { c } = make();
    c.selectScope('hospital');
    c.onPillInput('City Care');
    const rows = c.scopeRows();
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'new', title: 'City Care' });
    c.scopeHighlight.set(rows.length - 1);
    c.onPillEnter(new Event('keydown'));
    expect(c.refHospitalName()).toBe('City Care');
  });

  it('changing the hospital wipes the doctor (doctor list is per hospital)', () => {
    const { c } = make();
    c.pickRefDoctor('Dr. A. Sharma');
    c.pickRefHospital('Apollo ERD');
    expect(c.refDoctorName()).toBe('');
  });

  it('an empty tile shows its scope name; a filled, inactive tile is clearable', () => {
    const { c } = make();
    expect(c.tileLabel('doctor')).toBe('Doctor');
    expect(c.tileClearable('doctor')).toBe(false);
    c.pickRefDoctor('Dr. A. Sharma');
    expect(c.tileClearable('doctor')).toBe(true);
    c.selectScope('doctor');
    expect(c.tileClearable('doctor')).toBe(false);   // not while it is the active scope
  });
});

describe('Unified search — clearing', () => {
  it('× on Doctor / Hospital clears the referral', () => {
    const { c } = make();
    c.pickRefHospital('Apollo ERD');
    c.pickRefDoctor('Dr. A. Sharma');
    c.clearScope('doctor');
    expect(c.refDoctorName()).toBe('');
    expect(c.refHospitalName()).toBe('Apollo ERD');
    c.clearScope('hospital');
    expect(c.refHospitalName()).toBe('');
  });

  it('× on Patient detaches the patient and drops it from the URL', () => {
    const { c, router } = make();
    c._patient.set(PATIENTS[0]);
    c.clearScope('patient');
    expect(c.patient()).toBeNull();
    expect(c.tileLabel('patient')).toBe('Patient');
    expect(router.navigate).toHaveBeenCalledWith([], { queryParams: { patientId: null }, queryParamsHandling: 'merge' });
  });

  it('a read-only order locks the patient and referral tiles', () => {
    const { c } = make();
    c._patient.set(PATIENTS[0]);
    c.pickRefDoctor('Dr. A. Sharma');
    c.viewOrderId.set('o1');
    expect(c.scopeEnabled('patient')).toBe(false);
    expect(c.scopeEnabled('doctor')).toBe(false);
    c.clearScope('patient');
    c.clearScope('doctor');
    expect(c.patient()).not.toBeNull();
    expect(c.refDoctorName()).toBe('Dr. A. Sharma');
    c.selectScope('doctor');
    expect(c.scope()).toBe('tests');
  });
});

describe('Unified search — Urgent chip', () => {
  it('toggles the same order-priority field the Normal/Urgent switch set', () => {
    const { c } = make();
    expect(c.priority()).toBe('Normal');
    c.toggleUrgent();
    expect(c.priority()).toBe('Urgent');
    c.toggleUrgent();
    expect(c.priority()).toBe('Normal');
  });

  it('is inert on a read-only order', () => {
    const { c } = make();
    c.viewOrderId.set('o1');
    c.toggleUrgent();
    expect(c.priority()).toBe('Normal');
  });

  it('the chosen priority is what the order posts', () => {
    const { c, api } = make([T('esr', 'ESR', 'Haematology')]);
    c._patient.set(PATIENTS[0]);
    c._selected.set(['esr']);
    c.labCfg.billingMode = () => 'front_desk';
    c.toggleUrgent();
    c.submit();
    expect(api.post).toHaveBeenCalledWith('/api/orders/', expect.objectContaining({ priority: 'Urgent' }));
  });
});

describe('Unified search — Tests scope filters the catalogue in the page', () => {
  const tests = [
    T('esr', 'Erythrocyte Sedimentation Rate', 'Haematology'),
    T('hb', 'Haemoglobin', 'Haematology'),
    T('uglu', 'Urine Glucose', 'Clinical Pathology'),
    T('uket', 'Urine Ketones', 'Clinical Pathology'),
  ];

  it('typing narrows the in-page list (and switches to the All tests tab)', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    expect(c.categoryTab()).toBe('all');
    expect(c.filteredTests().map((t: any) => t.id).sort()).toEqual(['uglu', 'uket']);
    expect(c.searchResults().map((t: any) => t.id)).toEqual(['uglu', 'uket']);
  });

  it('the department chip narrows the matches too', () => {
    const { c } = make(tests);
    c.setDeptFilter('Haematology');
    c.onPillInput('e');
    expect(c.filteredTests().every((t: any) => t.department.name === 'Haematology')).toBe(true);
  });

  it('↓ + ⏎ adds the highlighted in-page match and clears the query', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    expect(c.activeTestId()).toBe('uglu');
    c.onPillArrow(new Event('keydown'), 1);
    expect(c.activeTestId()).toBe('uket');
    c.onPillEnter(new Event('keydown'));
    expect(c.selected()).toEqual(['uket']);
    expect(c.query()).toBe('');
  });

  it('clearing the query restores the unfiltered catalogue', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    c.onPillInput('');
    expect(c.filteredTests().length).toBe(4);
    expect(c.searchResults()).toEqual([]);
  });
});
