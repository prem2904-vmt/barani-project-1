import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { casesheetLinks } from '../casesheets.routes';
import { CASESHEET_FILL, CASESHEET_VIEW } from './casesheet-permissions';
import { CasesheetGateService } from './casesheet-gate.service';

/** What a sheet is started FROM (plan §7). Phase 1: the patient only; OPD / IPD "Admit" pass their own later. */
export interface CaseSheetContext {
  kind: 'patient' | 'opd_visit' | 'ipd_admission';
  id?: string | null;
}

export interface CaseSheetLaunch {
  patientId: string;
  context?: CaseSheetContext;
  /** Open Departments on this master department (its key, plan §3.3). */
  departmentKey?: string | null;
}

/** The URL a launch goes to (pure; the launcher and its spec share it). */
export function launchUrl(l: CaseSheetLaunch): { path: string; queryParams: Record<string, string> } {
  const q: Record<string, string> = { patientId: l.patientId };
  if (l.departmentKey) q['deptKey'] = l.departmentKey;
  if (l.context && l.context.kind !== 'patient') {
    q['ctx'] = l.context.kind;
    if (l.context.id) q['ctxId'] = l.context.id;
  }
  return { path: casesheetLinks.start(), queryParams: q };
}

/**
 * THE way into a new case sheet from anywhere in the lab app (plan §7, the admit hook): the patient profile today,
 * OPD / IPD "Admit" later. Opens Departments for that patient (a sheet always starts from the patient — no patient
 * picker); the patient's snapshot is taken from the LMS patient when the doctor picks a form.
 * Refuses (resolves false) while the case-sheet gate is closed or without casesheet_fill — the button that calls it
 * is hidden then anyway, this is the second lock. {@link openList} opens the patient's sheets (casesheet_view).
 */
@Injectable({ providedIn: 'root' })
export class CaseSheetLauncher {
  private readonly router = inject(Router);
  private readonly gate = inject(CasesheetGateService);
  private readonly auth = inject(AuthService);

  /** Gate open AND casesheet_view (the patient profile shows its Case sheet button + list only then). */
  canView(): boolean {
    return this.gate.visible() && this.auth.hasAnyPermission([CASESHEET_VIEW]);
  }

  /** Gate open, Prepare switched on (Settings → IPD) AND may start one. */
  canFill(): boolean {
    return this.gate.prepareOn() && this.auth.hasAnyPermission([CASESHEET_FILL]);
  }

  open(l: CaseSheetLaunch): Promise<boolean> {
    if (!l.patientId || !this.canFill()) return Promise.resolve(false);
    const to = launchUrl(l);
    return this.router.navigate([to.path], { queryParams: to.queryParams });
  }

  openList(patientId: string): Promise<boolean> {
    if (!patientId || !this.canView()) return Promise.resolve(false);
    return this.router.navigateByUrl(casesheetLinks.patientSheets(patientId));
  }
}
