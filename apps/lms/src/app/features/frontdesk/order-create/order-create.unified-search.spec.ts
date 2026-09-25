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
 * fills the tile and returns the scope to Tests. Every scope's results open
 * in one dropdown under the pill (touch-first); the grid stays a browse view.
 * Urgent is a switch in the billing card; the patient is required.
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
  c.isWebSearch.set(true);          // web / desktop mode unless a test says otherwise
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

describe('Urgent switch (billing card)', () => {
  it('toggles the same order-priority field the Normal/Urgent switch set', () => {
    const { c } = make();
    expect(c.priority()).toBe('Normal');
    c.toggleUrgent();
    expect(c.priority()).toBe('Urgent');
    c.toggleUrgent();
    expect(c.priority()).toBe('Normal');
  });

  it('is locked on a read-only order', () => {
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

describe('Tests scope — results in the dropdown under the pill', () => {
  const tests = [
    T('esr', 'Erythrocyte Sedimentation Rate', 'Haematology'),
    T('hb', 'Haemoglobin', 'Haematology'),
    T('uglu', 'Urine Glucose', 'Clinical Pathology'),
    T('uket', 'Urine Ketones', 'Clinical Pathology'),
    T('pkg', 'Urine Routine Package', 'Clinical Pathology', { type: 'package' }),
  ];

  it('typing opens the dropdown with matches (tests, profiles and packages)', () => {
    const { c } = make(tests);
    expect(c.dropOpen()).toBe(false);
    c.onPillInput('urine');
    expect(c.dropOpen()).toBe(true);
    expect(c.searchResults().map((t: any) => t.id).sort()).toEqual(['pkg', 'uglu', 'uket']);
    expect(c.testsTitle()).toBe('TESTS · 3 MATCHES');
  });

  it('the catalogue grid is NOT filtered by the query (browse view by tab + department)', () => {
    const { c } = make(tests);
    c.setCategoryTab('recent');
    c.onPillInput('urine');
    expect(c.categoryTab()).toBe('recent');
    expect(c.filteredTests().map((t: any) => t.id).sort()).toEqual(['esr', 'hb', 'uglu', 'uket']);
    c.setDeptFilter('Haematology');
    expect(c.filteredTests().map((t: any) => t.id).sort()).toEqual(['esr', 'hb']);
  });

  it('tap adds (✓) and keeps the panel open; tap again removes', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    const uglu = c.searchResults().find((t: any) => t.id === 'uglu');
    c.addSearchResult(uglu);
    expect(c.isSelected('uglu')).toBe(true);
    expect(c.dropOpen()).toBe(true);
    expect(c.query()).toBe('urine');
    c.addSearchResult(uglu);
    expect(c.isSelected('uglu')).toBe(false);
  });

  it('↓ + ⏎ adds the highlighted match, clears the field and closes the panel', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    const first = c.activeTestId();
    c.onPillArrow(new Event('keydown'), 1);
    const second = c.activeTestId();
    expect(second).not.toBe(first);
    c.onPillEnter(new Event('keydown'));
    expect(c.selected()).toEqual([second]);
    expect(c.query()).toBe('');
    expect(c.dropOpen()).toBe(false);
  });

  it('Esc clears and closes; an empty field shows no panel', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    c.onPillEscape();
    expect(c.query()).toBe('');
    expect(c.dropOpen()).toBe(false);
    c.onPillFocus();
    expect(c.dropOpen()).toBe(false);
  });
});

describe('Patient is required', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with no patient the Patient tile is flagged required; attaching clears it', () => {
    const { c } = make();
    expect(c.patientMissing()).toBe(true);
    c._patient.set(PATIENTS[0]);
    expect(c.patientMissing()).toBe(false);
  });

  it('not flagged on a read-only order', () => {
    const { c } = make();
    c.viewOrderId.set('o1');
    expect(c.patientMissing()).toBe(false);
  });

  it('Confirm without a patient nudges the tile, opens its dropdown and posts nothing', () => {
    const { c, api } = make([T('esr', 'ESR', 'Haematology')]);
    c._selected.set(['esr']);
    c.onConfirmClick();
    vi.advanceTimersByTime(1);
    expect(c.patientNudge()).toBe(true);
    expect(c.scope()).toBe('patient');
    expect(c.dropOpen()).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('Save as draft and Proceed without a patient nudge too', () => {
    const { c, api, router } = make([T('esr', 'ESR', 'Haematology')]);
    c._selected.set(['esr']);
    c.onSaveDraftClick();
    vi.advanceTimersByTime(1);
    expect(c.patientNudge()).toBe(true);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    c.onProceedClick();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('picking the patient clears the nudge', () => {
    const { c } = make();
    c.requirePatient();
    vi.advanceTimersByTime(1);
    c.onPillInput('sa');
    vi.advanceTimersByTime(250);
    c.onPillEnter(new Event('keydown'));
    expect(c.patient()?.id).toBe('p1');
    expect(c.patientNudge()).toBe(false);
    expect(c.patientMissing()).toBe(false);
  });
});

describe('Billing phases (cart → payment)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tests = [T('esr', 'ESR', 'Haematology'), T('hb', 'Haemoglobin', 'Haematology')];

  it('defaults to the cart phase', () => {
    const { c } = make(tests);
    expect(c.billPhaseView()).toBe('cart');
  });

  it('Continue needs tests; with a patient it moves to payment', () => {
    const { c } = make(tests);
    c._patient.set(PATIENTS[0]);
    c.continueToPayment();
    expect(c.billPhaseView()).toBe('cart');          // empty cart
    c.toggleTest(tests[0]);
    c.continueToPayment();
    expect(c.billPhaseView()).toBe('pay');
  });

  it('Continue without a patient nudges and stays on the cart', () => {
    const { c } = make(tests);
    c.toggleTest(tests[0]);
    c.continueToPayment();
    vi.advanceTimersByTime(1);
    expect(c.patientNudge()).toBe(true);
    expect(c.scope()).toBe('patient');
    expect(c.billPhaseView()).toBe('cart');
  });

  it('the summary line (editCart) returns to the cart', () => {
    const { c } = make(tests);
    c._patient.set(PATIENTS[0]);
    c.toggleTest(tests[0]);
    c.continueToPayment();
    c.editCart();
    expect(c.billPhaseView()).toBe('cart');
  });

  it('adding / removing a test (catalogue or dropdown) while paying flips back to the cart', () => {
    const { c } = make(tests);
    c._patient.set(PATIENTS[0]);
    c.toggleTest(tests[0]);
    c.continueToPayment();
    c.onPillInput('haem');
    c.addSearchResult(tests[1]);
    expect(c.billPhaseView()).toBe('cart');
    c.continueToPayment();
    c.removeTest('esr');
    expect(c.billPhaseView()).toBe('cart');
  });

  it('clearing the cart returns to the cart phase', () => {
    const { c } = make(tests);
    c._patient.set(PATIENTS[0]);
    c.toggleTest(tests[0]);
    c.continueToPayment();
    c.clearCart();
    expect(c.billPhaseView()).toBe('cart');
  });

  it('an existing (read-only / paid) order opens on payment; its cart summary expands read-only', () => {
    const { c } = make(tests);
    c.viewOrderId.set('o1');
    c._selected.set(['esr']);
    c.billPhase.set('pay');                            // what ngOnInit does for ?orderId=
    expect(c.billPhaseView()).toBe('pay');
    c.editCart();
    expect(c.billPhaseView()).toBe('cart');
    c.toggleTest(tests[1]);                            // locked: no change
    expect(c.selected()).toEqual(['esr']);
    c.paidOrderId.set('o2');
    c.billPhase.set('pay');
    expect(c.billPhaseView()).toBe('pay');
  });

  it('?orderId= sets the payment phase on load', () => {
    const { c } = make(tests);
    c.route.snapshot.queryParamMap = new Map([['orderId', 'o1']]);
    c.labCfg.ensureLoaded = () => {};
    c.ngOnInit();
    expect(c.billPhase()).toBe('pay');
  });
});

describe('Search focus mode — dropdown filters', () => {
  const tests = [
    T('uglu', 'Urine Glucose', 'Clinical Pathology', { department: { name: 'Clinical Pathology', code: 'CPY' } }),
    T('uket', 'Urine Ketones', 'Clinical Pathology', { department: { name: 'Clinical Pathology', code: 'CPY' } }),
    T('ualb', 'Urine Albumin', 'Biochemistry', { department: { name: 'Biochemistry', code: 'BIO' } }),
    T('uprof', 'Urine Routine Panel', 'Clinical Pathology', { type: 'profile', department: { name: 'Clinical Pathology', code: 'CPY' } }),
    T('upkg', 'Urine Checkup Bundle', 'Biochemistry', { type: 'package', department: { name: 'Biochemistry', code: 'BIO' } }),
  ];

  it('type chips narrow the results; counts reflect each type', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    expect(c.searchResults().length).toBe(5);
    expect(c.searchTypeCounts()).toMatchObject({ all: 5, individual: 3, profile: 1, package: 1 });
    c.setSearchType('profile');
    expect(c.searchResults().map((t: any) => t.id)).toEqual(['uprof']);
    c.setSearchType('individual');
    expect(c.searchResults().map((t: any) => t.id).sort()).toEqual(['ualb', 'uglu', 'uket']);
  });

  it('department chips narrow the results and combine with the type chip', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    c.setSearchDept('Biochemistry');
    expect(c.searchResults().map((t: any) => t.id).sort()).toEqual(['ualb', 'upkg']);
    expect(c.searchTypeCounts()).toMatchObject({ all: 2, individual: 1, package: 1, profile: 0 });
    c.setSearchType('individual');
    expect(c.searchResults().map((t: any) => t.id)).toEqual(['ualb']);
    expect(c.searchDeptCounts()).toMatchObject({ 'Biochemistry': 1, 'Clinical Pathology': 2 });
    c.setSearchDept('Biochemistry');                 // tap again = All
    expect(c.searchDept()).toBe('');
  });

  it('the filters never touch the catalogue grid', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    c.setSearchType('package');
    c.setSearchDept('Biochemistry');
    expect(c.filteredTests().map((t: any) => t.id).sort()).toEqual(['ualb', 'uglu', 'uket']);
  });

  it('changing a filter resets the keyboard highlight to the first result', () => {
    const { c } = make(tests);
    c.onPillInput('urine');
    c.onPillArrow(new Event('keydown'), 1);
    c.onPillArrow(new Event('keydown'), 1);
    expect(c.activeResult()).toBe(2);
    c.setSearchType('individual');
    expect(c.activeResult()).toBe(0);
  });
});

describe('Search mode per device type', () => {
  const tests = [
    T('uglu', 'Urine Glucose', 'Clinical Pathology'),
    T('uket', 'Urine Ketones', 'Clinical Pathology'),
    T('hb', 'Haemoglobin', 'Haematology'),
  ];

  it('mode follows the (hover: hover) and (pointer: fine) media query, reactively', () => {
    const { c } = make(tests);
    expect(c.searchMode()).toBe('dropdown');
    c._onWebChange({ matches: false });
    expect(c.searchMode()).toBe('incard');
    c._onWebChange({ matches: true });
    expect(c.searchMode()).toBe('dropdown');
  });

  it('web: typing opens the dropdown only; the catalogue lists never change', () => {
    const { c } = make(tests);
    c.setCategoryTab('all');
    const before = { all: c.filteredTests().map((t: any) => t.id), recent: c.recentTests(), pk: c.packages(), pr: c.profiles() };
    c.onPillInput('urine');
    expect(c.dropOpen()).toBe(true);
    expect(c.inCardSearch()).toBe(false);
    expect(c.filteredTests().map((t: any) => t.id)).toEqual(before.all);
    expect(c.recentTests()).toEqual(before.recent);
    expect(c.packages()).toEqual(before.pk);
    expect(c.profiles()).toEqual(before.pr);
    expect(c.categoryTab()).toBe('all');
  });

  it('touch: NO dropdown for tests; the card shows the results; clearing restores browse', () => {
    const { c } = make(tests);
    c.isWebSearch.set(false);
    c.onPillInput('urine');
    expect(c.dropOpen()).toBe(false);
    expect(c.inCardSearch()).toBe(true);
    expect(c.searchResults().map((t: any) => t.id).sort()).toEqual(['uglu', 'uket']);
    c.onPillEscape();
    expect(c.inCardSearch()).toBe(false);
  });

  it('touch: Patient / Doctor / Hospital still use the dropdown', () => {
    const { c } = make(tests);
    c.isWebSearch.set(false);
    c.selectScope('doctor');
    expect(c.dropOpen()).toBe(true);
  });

  it('touch: Cancel shows while searching and clears everything', () => {
    const { c } = make(tests);
    c.isWebSearch.set(false);
    c.onPillFocus();
    expect(c.showCancel()).toBe(true);
    c.onPillInput('urine');
    c.cancelSearch();
    expect(c.query()).toBe('');
    expect(c.inCardSearch()).toBe(false);
    expect(c.showCancel()).toBe(false);
  });

  it('web: no Cancel button; activation state follows focus / results', () => {
    const { c } = make(tests);
    expect(c.showCancel()).toBe(false);
    expect(c.searchActive()).toBe(false);
    c.onPillFocus();
    expect(c.searchActive()).toBe(true);
  });
});
