import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { environment } from '../../../../environments/environment';
import { CasesApi } from '../data/cases/cases-api';
import { CasesheetNav, casesheetNavFor } from '../data/casesheet-nav';
import { CasePatientError, CasePatientsApi, patientMeta, toCasePatient } from '../data/patients/case-patients-api';
import { FormsPage } from './forms.page';
import { CsPatientStepComponent, readAge } from './patient-step.component';

/**
 * The public site's patient step (plan §3.5): a personal space's sheet needs one of ITS patients (the server answers
 * 400 patient_required otherwise). Search (GET /api/casesheets/patients?q=) or quick-create (POST), then the sheet starts with
 * that patientId. A lab never sees the step: its sheets start from the LMS patient profile.
 */
const B = `${environment.apiUrl}/api/casesheets`;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('CasePatientsApi', () => {
  let api: CasePatientsApi;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CasePatientsApi);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('searches my patients (raw JSON items)', async () => {
    const p = api.search(' asha ');
    const r = http.expectOne((req) => req.url === `${B}/patients`);
    expect(r.request.params.get('q')).toBe('asha');
    r.flush({ items: [{ id: 'p1', name: 'Asha K', age: '34 yrs', sex: 'Female', phone: '9800000000', mrn: 'M1' }] });
    expect(await p).toEqual([{ id: 'p1', name: 'Asha K', age: '34 yrs', sex: 'Female', phone: '9800000000', mrn: 'M1' }]);
  });

  it('quick-creates with only what was given (age OR date of birth)', async () => {
    const a = api.create({ firstName: ' Asha ', lastName: '', sex: 'Female', age: 34, phone: ' 98000 00000 ' });
    const r = http.expectOne(`${B}/patients`);
    expect(r.request.method).toBe('POST');
    expect(r.request.body).toEqual({ firstName: 'Asha', sex: 'Female', age: 34, phone: '98000 00000' });
    r.flush({ id: 'p9', name: 'Asha' }, { status: 201, statusText: 'Created' });
    expect((await a).id).toBe('p9');

    const b = api.create({ firstName: 'Ravi', dateOfBirth: '1990-01-02', age: 5 });
    const rb = http.expectOne(`${B}/patients`);
    expect(rb.request.body).toEqual({ firstName: 'Ravi', dateOfBirth: '1990-01-02' });
    rb.flush({ id: 'p10', firstName: 'Ravi' });
    expect((await b).name).toBe('Ravi');
  });

  it('a duplicate (409) carries the patient it already is; other refusals their own words', async () => {
    const a = api.create({ firstName: 'Asha', phone: '9800000000', age: 3 });
    http.expectOne(`${B}/patients`).flush(
      { status: 409, code: 'duplicate_patient', title: 'x', detail: 'Already there.', patientId: 'p1' },
      { status: 409, statusText: 'Conflict' });
    await expect(a).rejects.toMatchObject({ code: 'duplicate_patient', duplicateOf: 'p1' });

    const b = api.create({ firstName: 'Asha', age: 3 });
    http.expectOne(`${B}/patients`).flush({ status: 400, code: 'invalid_patient', detail: 'Enter a valid phone.' }, { status: 400, statusText: 'Bad' });
    await expect(b).rejects.toBeInstanceOf(CasePatientError);
    await expect(b).rejects.toMatchObject({ message: 'Enter a valid phone.' });
  });

  it('helpers', () => {
    expect(readAge('')).toBeNull();
    expect(readAge(' 42 ')).toBe(42);
    expect(readAge('151')).toBeNaN();
    expect(readAge('4x')).toBeNaN();
    expect(patientMeta(toCasePatient({ id: 'p', name: 'A', age: '3 yrs', sex: null, phone: '98' }))).toBe('3 yrs · 98');
  });
});

describe('the patient step', () => {
  function mount() {
    const search = vi.fn(async (q: string) => (q ? [] : [{ id: 'p1', name: 'Asha K', age: '34 yrs', sex: 'Female', phone: null, mrn: null }]));
    const create = vi.fn(async () => ({ id: 'p-new', name: 'Ravi', age: '40 yrs', sex: null, phone: null, mrn: null }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: CasePatientsApi, useValue: { search, create } }] });
    const fx = TestBed.createComponent(CsPatientStepComponent);
    fx.componentRef.setInput('formTitle', 'ENT case sheet');
    const chosen: string[] = [];
    fx.componentInstance.chosen.subscribe((id) => chosen.push(id));
    return { fx, el: fx.nativeElement as HTMLElement, search, create, chosen };
  }

  it('lists my recent patients and picks one', async () => {
    const t = mount();
    await tick(); t.fx.detectChanges(); await t.fx.whenStable();
    expect(t.search).toHaveBeenCalledWith('');
    const pick = t.el.querySelector<HTMLButtonElement>('[data-ps-pick]')!;
    expect(pick.textContent).toContain('Asha K');
    pick.click();
    expect(t.chosen).toEqual(['p1']);
  });

  it('adds a new patient (name + age) and starts with them', async () => {
    const t = mount();
    await tick(); t.fx.detectChanges();
    t.el.querySelector<HTMLButtonElement>('[data-ps-new]')!.click();
    t.fx.detectChanges();
    const add = () => t.el.querySelector<HTMLButtonElement>('[data-ps-add]')!;
    expect(add().disabled).toBe(true);   // a name and an age (or date of birth) first
    const type = (sel: string, v: string) => {
      const i = t.el.querySelector<HTMLInputElement>(sel)!;
      i.value = v; i.dispatchEvent(new Event('input'));
    };
    type('[data-ps-first]', 'Ravi'); type('[data-ps-age]', '40');
    t.fx.detectChanges();
    expect(add().disabled).toBe(false);
    add().click();
    await tick();
    expect(t.create).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Ravi', age: 40, force: false }));
    expect(t.chosen).toEqual(['p-new']);
  });

  it('uses no native select / date / datalist controls', async () => {
    const t = mount();
    await tick(); t.fx.detectChanges();
    t.el.querySelector<HTMLButtonElement>('[data-ps-new]')!.click();
    t.fx.detectChanges();
    // (the kit pf-date keeps a hidden, aria-hidden helper input; nothing visible is native)
    expect(t.el.querySelector('select, datalist, input[type=date]:not(.pf-date__native)')).toBeNull();
    expect(t.el.querySelector('pf-date')).not.toBeNull();
  });
});

describe('Departments on the public site: a sheet starts for a chosen patient', () => {
  function mount(mode: 'casesheets' | 'lms') {
    const createCase = vi.fn(async () => ({ id: 's1' }));
    const api = {
      listForms: vi.fn(async () => [{ id: 'f1', title: 'ENT case sheet', specialty: 'ENT', pinned: false, departmentKey: 'ent' }]),
      listDepartments: vi.fn(async () => []),
      listCases: vi.fn(async () => ({ items: [] })),
      createCase,
    };
    const nav = casesheetNavFor(mode);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: CasesheetNav, useValue: { ...nav, isLab: mode === 'lms' } },
        { provide: CasePatientsApi, useValue: { search: vi.fn(async () => []), create: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(FormsPage, { add: { providers: [{ provide: CasesApi, useValue: api }] } });
    const fx = TestBed.createComponent(FormsPage);
    const router = TestBed.inject(Router);
    const go = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    return { fx, page: fx.componentInstance as unknown as { start(f: unknown): Promise<void>; startFor(id: string): Promise<void>; pickingFor(): unknown }, createCase, go };
  }

  it('personal space: start opens the patient step; the sheet is created WITH the patient id', async () => {
    const t = mount('casesheets');
    await tick(); t.fx.detectChanges();
    await t.page.start({ id: 'f1', title: 'ENT case sheet' });
    t.fx.detectChanges();
    expect(t.createCase).not.toHaveBeenCalled();
    expect((t.fx.nativeElement as HTMLElement).querySelector('[data-patient-step]')).not.toBeNull();
    await t.page.startFor('p7');
    expect(t.createCase).toHaveBeenCalledWith('f1', undefined, { patientId: 'p7', contextKind: 'patient', contextId: null });
    expect(t.go).toHaveBeenCalledWith('/cases/s1');
    expect(t.page.pickingFor()).toBeNull();
  });
});
