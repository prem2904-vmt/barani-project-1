import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent } from '@prefrontal/shared';
import { CaseSheetDepartment, CaseSummary, FormSummary } from '../data/cases/case-models';
import { CasesApi } from '../data/cases/cases-api';
import { CasesheetNav } from '../data/casesheet-nav';
import { LabPatient, LabPatientService } from '../data/lab-patient';
import { whenText } from '../data/when';
import { CsStylesComponent } from '../styles/cs-styles.component';
import { CsPatientStepComponent } from './patient-step.component';
import { CASESHEETS_DATA_PROVIDERS } from '../data/casesheets-data.providers';

/** A department (the form's `specialty`) and its case sheets, pinned first. */
export interface Department {
  name: string;
  forms: FormSummary[];
}

/**
 * The master departments (plan §3.3) put the forms in THEIR order (sort order), each form named by its department;
 * forms whose department is unknown keep their place after them. Stable, so {@link groupDepartments} then groups in
 * that order. No departments set up = the forms as they came (Prepare's behaviour).
 */
export function orderByDepartments(forms: readonly FormSummary[], departments: readonly CaseSheetDepartment[]): FormSummary[] {
  if (!departments.length) return [...forms];
  const rank = new Map(departments.map((d, i) => [d.key, { i, name: d.name }]));
  return forms
    .map((f, at) => {
      const d = f.departmentKey ? rank.get(f.departmentKey) : undefined;
      return { f: d ? { ...f, specialty: d.name } : f, r: d ? d.i : departments.length, at };
    })
    .sort((a, b) => a.r - b.r || a.at - b.at)
    .map((x) => x.f);
}

/** Forms with no specialty sit under this department. */
export const NO_DEPARTMENT = 'General';

/**
 * Group published forms into departments (legacy speciality page: categories → their case sheets).
 * Departments keep the admin's order of first appearance; within one, pinned case sheets come first
 * (stable). A search keeps only matching case sheets (title or department), and drops empty departments.
 */
export function groupDepartments(forms: readonly FormSummary[], query = ''): Department[] {
  const q = query.trim().toLowerCase();
  const out = new Map<string, FormSummary[]>();
  for (const f of forms) {
    const name = (f.specialty ?? '').trim() || NO_DEPARTMENT;
    if (q && !f.title.toLowerCase().includes(q) && !name.toLowerCase().includes(q)) continue;
    const list = out.get(name) ?? [];
    list.push(f);
    out.set(name, list);
  }
  return [...out].map(([name, list]) => ({
    name,
    forms: [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned)),
  }));
}

/** The big letter on a case-sheet tile (legacy: the specialty's first character). */
export function initialOf(title: string): string {
  return (title.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

/**
 * Forms, the doctor's home: Departments → the department's case sheets → tap one to start
 * (legacy MyPrefrontal /home/speciality, 1:1 in layout). The department sits in the URL
 * (`?dept=`), so the phone's back gesture returns to the list.
 */
@Component({
  selector: 'app-forms-page',
  standalone: true,
  imports: [PfIconComponent, SkeletonRowsComponent, RouterLink, CsStylesComponent, CsPatientStepComponent],
  providers: [...CASESHEETS_DATA_PROVIDERS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forms.page.html',
  styleUrls: ['./forms.page.scss'],
})
export class FormsPage {
  private readonly api = inject(CasesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly patients = inject(LabPatientService);
  /** Public site vs the lab (Prepare: /cases/:id). */
  protected readonly nav = inject(CasesheetNav);

  protected readonly query = signal('');
  protected readonly forms = signal<FormSummary[] | null>(null);
  protected readonly drafts = signal<CaseSummary[] | null>(null);
  protected readonly error = signal('');
  protected readonly starting = signal<string | null>(null);
  /** Public site: the case sheet waiting for its patient (the patient step is open). */
  protected readonly pickingFor = signal<FormSummary | null>(null);
  protected readonly when = whenText;
  protected readonly initial = initialOf;

  private readonly deptParam = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('dept'))), {
    initialValue: null,
  });
  /** The launcher's department (its master key, plan §7 `departmentKey`). */
  private readonly deptKeyParam = toSignal(this.route.queryParamMap.pipe(map((p) => p.get('deptKey'))), {
    initialValue: null,
  });
  /** Lab: the patient the sheet starts from (`?patientId=`, from the patient profile — never a patient picker). */
  protected readonly patientId = this.route.snapshot?.queryParamMap?.get('patientId') ?? null;
  /** Lab: what the sheet is started from (plan §7; phase 1 = the patient). */
  private readonly context = {
    kind: (this.route.snapshot?.queryParamMap?.get('ctx') as 'patient' | 'opd_visit' | 'ipd_admission' | null) ?? 'patient',
    id: this.route.snapshot?.queryParamMap?.get('ctxId') ?? null,
  };
  protected readonly patient = signal<LabPatient | null>(null);
  /** Lab without a patient: nothing can start here (the sheet starts from the patient's profile). */
  protected readonly needsPatient = this.nav.isLab && !this.patientId;

  protected readonly departments = computed(() => groupDepartments(this.forms() ?? [], this.query()));

  /** The open department; while searching with one department left, that one opens by itself. */
  protected readonly pickedDept = computed<Department | null>(() => {
    const all = this.departments();
    const want = this.deptParam();
    const key = this.deptKeyParam();
    const hit = want
      ? all.find((d) => d.name === want)
      : key
        ? all.find((d) => d.forms.some((f) => f.departmentKey === key))
        : undefined;
    if (hit) return hit;
    if (this.query().trim() && all.length === 1) return all[0];
    return null;
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set('');
    if (this.needsPatient) {
      this.forms.set([]);
      this.drafts.set([]);
      return;
    }
    if (this.patientId && !this.patient())
      void this.patients
        .load(this.patientId)
        .then((p) => this.patient.set(p))
        .catch(() => undefined);
    try {
      const [forms, departments, drafts] = await Promise.all([
        this.api.listForms(),
        this.api.listDepartments().catch(() => []),
        this.api
          .listCases({ state: 'draft', pageSize: 4, ...(this.patientId ? { patientId: this.patientId } : {}) })
          .catch(() => null),
      ]);
      this.forms.set(orderByDepartments(forms, departments));
      this.drafts.set(drafts?.items ?? []);
    } catch {
      this.forms.set([]);
      this.drafts.set([]);
      this.error.set("Can't reach Prefrontal right now. Check the connection and try again.");
    }
  }

  protected pick(name: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { dept: name },
      replaceUrl: !name || !!this.deptParam(),
    });
  }

  protected onSearch(v: string): void {
    this.query.set(v);
  }

  /** Pin / unpin (legacy favourite star): pinned case sheets come first. Optimistic; put back if the API says no. */
  protected async togglePin(f: FormSummary): Promise<void> {
    const pinned = !f.pinned;
    const set = (v: boolean) => this.forms.update((all) => (all ?? []).map((x) => (x.id === f.id ? { ...x, pinned: v } : x)));
    set(pinned);
    try {
      await this.api.pinForm(f.id, pinned);
    } catch {
      set(!pinned);
    }
  }

  protected async start(f: FormSummary): Promise<void> {
    if (this.starting()) return;
    // public site (a personal space): every sheet belongs to one of MY patients — choose or add one first (plan §3.5)
    if (!this.nav.isLab) {
      this.error.set('');
      this.pickingFor.set(f);
      return;
    }
    this.starting.set(f.id);
    this.error.set('');
    try {
      let sheet;
      if (this.patientId) {
        // lab: the sheet belongs to the LMS patient; its patient block is the patient's snapshot (plan §3.5)
        const p = this.patient() ?? (await this.patients.load(this.patientId));
        this.patient.set(p);
        sheet = await this.api.createCase(f.id, p.snapshot, {
          patientId: this.patientId,
          contextKind: this.context.kind,
          contextId: this.context.id,
        });
      } else {
        sheet = await this.api.createCase(f.id);
      }
      await this.router.navigateByUrl(this.nav.sheet(sheet.id));
    } catch {
      this.error.set("Couldn't start a case sheet just now. Please try again.");
    } finally {
      this.starting.set(null);
    }
  }

  /** Public site: the patient step chose (or added) the patient → the sheet starts for them. */
  protected async startFor(patientId: string): Promise<void> {
    const f = this.pickingFor();
    if (!f || this.starting()) return;
    this.pickingFor.set(null);
    this.starting.set(f.id);
    this.error.set('');
    try {
      const sheet = await this.api.createCase(f.id, undefined, { patientId, contextKind: 'patient', contextId: null });
      await this.router.navigateByUrl(this.nav.sheet(sheet.id));
    } catch {
      this.error.set("Couldn't start a case sheet just now. Please try again.");
    } finally {
      this.starting.set(null);
    }
  }
}
