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
import { doctorOptionLabel, toDoctorOptions } from './unified-search';

/**
 * Referring network, doctor-first (owner 2026-09-30): the Doctor scope finds a
 * doctor with or without a hospital. A linked doctor reads "Dr X · Hospital Y"
 * (one row per hospital they refer from); picking it fills an EMPTY Hospital
 * tile, never overrides a picked one. The order still stores names only.
 */
const OPTIONS = [
  { doctorId: 'd1', name: 'Dr. A. Sharma', hospitalName: 'Apollo ERD' },
  { doctorId: 'd1', name: 'Dr. A. Sharma', hospitalName: 'Kauvery Hospital' },
  { doctorId: 'd2', name: 'Dr. R. Iyer', hospitalName: null },
];

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
    if (url.startsWith('/api/test-picker/doctors')) return of(OPTIONS);
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


describe('Doctor-first picker — labels', () => {
  it('reads "Dr X · Hospital Y" when linked, the bare name when independent', () => {
    expect(doctorOptionLabel({ name: 'Dr X', hospitalName: 'Hospital Y' })).toBe('Dr X · Hospital Y');
    expect(doctorOptionLabel({ name: 'Dr X', hospitalName: null })).toBe('Dr X');
    expect(doctorOptionLabel({ name: 'Dr X', hospitalName: '  ' })).toBe('Dr X');
  });

  it('accepts the older names-only payload', () => {
    expect(toDoctorOptions(['Dr A', { name: 'Dr B', hospitalName: 'H' }, ''])).toEqual([
      { name: 'Dr A', hospitalName: null }, { name: 'Dr B', hospitalName: 'H' },
    ]);
    expect(toDoctorOptions(null)).toEqual([]);
  });
});

describe('Doctor-first picker — order create', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the options endpoint and lists one row per affiliation plus independent doctors', () => {
    const { c, api } = make();
    c.selectScope('doctor');
    expect(api.get).toHaveBeenCalledWith('/api/test-picker/doctors/options');
    expect(c.scopeRows().map((r: any) => r.title)).toEqual([
      'Dr. A. Sharma · Apollo ERD', 'Dr. A. Sharma · Kauvery Hospital', 'Dr. R. Iyer',
    ]);
    // Row keys stay unique although the same doctor appears twice.
    const keys = c.scopeRows().map((r: any) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('passes the picked hospital to narrow the list', () => {
    const { c, api } = make();
    c.pickRefHospital('Apollo ERD');
    c.selectScope('doctor');
    expect(api.get).toHaveBeenCalledWith('/api/test-picker/doctors/options?hospital=Apollo+ERD');
  });

  it('picking a linked doctor stores the NAME and fills the empty Hospital tile', () => {
    const { c } = make();
    c.selectScope('doctor');
    c.pickScopeRow(c.scopeRows()[1]);
    expect(c.refDoctorName()).toBe('Dr. A. Sharma');
    expect(c.refHospitalName()).toBe('Kauvery Hospital');
    expect(c.scope()).toBe('tests');
  });

  it('never overrides a hospital the receptionist already picked', () => {
    const { c } = make();
    c.pickRefHospital('City Care');
    c.selectScope('doctor');
    c.pickScopeRow(c.scopeRows()[0]);
    expect(c.refDoctorName()).toBe('Dr. A. Sharma');
    expect(c.refHospitalName()).toBe('City Care');
  });

  it('an independent doctor leaves the Hospital tile empty', () => {
    const { c } = make();
    c.selectScope('doctor');
    c.pickScopeRow(c.scopeRows().find((r: any) => r.title === 'Dr. R. Iyer'));
    expect(c.refDoctorName()).toBe('Dr. R. Iyer');
    expect(c.refHospitalName()).toBe('');
  });

  it('typing a known doctor offers no "add new" row; an unknown name does', () => {
    const { c } = make();
    c.selectScope('doctor');
    c.onPillInput('dr. r. iyer');
    expect(c.scopeRows().some((r: any) => r.kind === 'new')).toBe(false);
    c.onPillInput('Dr. New Person');
    const last = c.scopeRows().at(-1);
    expect(last).toMatchObject({ kind: 'new', title: 'Dr. New Person' });
    c.pickScopeRow(last);
    expect(c.refDoctorName()).toBe('Dr. New Person');
    expect(c.refHospitalName()).toBe('');
  });
});
