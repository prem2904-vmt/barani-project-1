import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../../../core/auth/auth.service';
import { CaseSheetLauncher, launchUrl } from './case-sheet-launcher';
import { CasesheetGateService } from './casesheet-gate.service';

/** THE way into a new case sheet (plan §7): Departments for the patient; refused while the gate is closed. */
describe('CaseSheetLauncher', () => {
  function setup(open: boolean, perms: string[]) {
    const router = { navigate: vi.fn(async () => true), navigateByUrl: vi.fn(async () => true) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: CasesheetGateService, useValue: { visible: signal(open) } },
        { provide: AuthService, useValue: { hasAnyPermission: (p: string[]) => p.some((x) => perms.includes(x)) } },
      ],
    });
    return { l: TestBed.inject(CaseSheetLauncher), router };
  }

  it('launch URL: Departments for the patient, + department key, + a non-patient context', () => {
    expect(launchUrl({ patientId: 'p1' })).toEqual({ path: '/casesheets/new', queryParams: { patientId: 'p1' } });
    expect(launchUrl({ patientId: 'p1', departmentKey: 'ent', context: { kind: 'patient' } })).toEqual({
      path: '/casesheets/new',
      queryParams: { patientId: 'p1', deptKey: 'ent' },
    });
    expect(launchUrl({ patientId: 'p1', context: { kind: 'ipd_admission', id: 'a9' } }).queryParams).toEqual({
      patientId: 'p1',
      ctx: 'ipd_admission',
      ctxId: 'a9',
    });
  });

  it('open: gate open + casesheet_fill → Departments for the patient', async () => {
    const { l, router } = setup(true, ['casesheet_fill', 'casesheet_view']);
    expect(await l.open({ patientId: 'p1' })).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/casesheets/new'], { queryParams: { patientId: 'p1' } });
    await l.openList('p1');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/casesheets/patient/p1');
  });

  it('gate closed: nothing opens, nothing is shown (canView / canFill false)', async () => {
    const { l, router } = setup(false, ['casesheet_fill', 'casesheet_view']);
    expect(l.canView()).toBe(false);
    expect(l.canFill()).toBe(false);
    expect(await l.open({ patientId: 'p1' })).toBe(false);
    expect(await l.openList('p1')).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('gate open: viewing needs casesheet_view, starting needs casesheet_fill', async () => {
    const view = setup(true, ['casesheet_view']);
    expect(view.l.canView()).toBe(true);
    expect(view.l.canFill()).toBe(false);
    expect(await view.l.open({ patientId: 'p1' })).toBe(false);
    const none = setup(true, ['view_patient']);
    expect(none.l.canView()).toBe(false);
  });
});
