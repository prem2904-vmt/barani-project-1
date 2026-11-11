import { Injectable } from '@angular/core';
import { AppMode, appMode } from '../../../core/app-mode';
import { casesheetLinks } from '../casesheets.routes';

/**
 * Where the case-sheet screens go, in each app mode (Prepare hard-coded `/forms`, `/cases`, `/cases/:id`):
 *  - public site (casesheets mode, plan §4): Departments `/`, Cases `/cases`, a sheet `/cases/:id`;
 *  - lab (LMS mode): Departments FOR a patient `/casesheets/new?patientId=` (a sheet always starts from the patient,
 *    never a patient picker — plan §3.5), the patient's sheets `/casesheets/patient/:patientId`, a sheet
 *    `/casesheets/:id`. Without a patient, "home" is the Prepare tab: Departments `/prepare`, all sheets `/prepare/cases`.
 * Pure (the mode is a parameter) so it is unit-tested; {@link CasesheetNav} binds it to this page load's mode.
 */
export interface CasesheetLinks {
  readonly mode: AppMode;
  /** Departments (start a sheet). In a lab, for this patient. */
  departments(patientId?: string | null): { path: string; queryParams?: Record<string, string> };
  /** One sheet. */
  sheet(id: string): string;
  /** The list a sheet belongs to: public = all mine; lab = this patient's. */
  list(patientId?: string | null): string;
}

export function casesheetNavFor(mode: AppMode): CasesheetLinks {
  if (mode === 'casesheets') {
    return {
      mode,
      departments: () => ({ path: '/' }),
      sheet: (id) => `/cases/${encodeURIComponent(id)}`,
      list: () => '/cases',
    };
  }
  return {
    mode,
    departments: (patientId) =>
      patientId ? { path: casesheetLinks.start(), queryParams: { patientId } } : { path: casesheetLinks.prepare() },
    sheet: (id) => casesheetLinks.sheet(id),
    list: (patientId) => (patientId ? casesheetLinks.patientSheets(patientId) : casesheetLinks.prepareCases()),
  };
}

/** {@link casesheetNavFor} for this page load's mode (core/app-mode). */
@Injectable({ providedIn: 'root' })
export class CasesheetNav {
  private readonly links = casesheetNavFor(appMode());
  readonly mode = this.links.mode;
  readonly isLab = this.mode === 'lms';
  departments = this.links.departments;
  sheet = this.links.sheet;
  list = this.links.list;
}
