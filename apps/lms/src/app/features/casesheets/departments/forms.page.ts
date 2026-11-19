import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent, ToggleComponent, TwoPanelComponent, TwoPanelGroup, injectTwoPanelCompact } from '@prefrontal/shared';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { NavBackService } from '../../../core/services/nav-back.service';
import { AuthService } from '../../../core/auth/auth.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { casesheetLinks } from '../casesheets.routes';
import { CASESHEET_FORMS_MANAGE } from '../shared/casesheet-permissions';
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
  /** The department's key when it is one of the lab's departments (absent for a form's free-text specialty). */
  key?: string;
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

const TAB_KEY = 'pf.prepare.tab';
function readTab(): 'sheets' | 'continue' {
  try { return localStorage.getItem(TAB_KEY) === 'continue' ? 'continue' : 'sheets'; } catch { return 'sheets'; }
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

/**
 * Prepare's department list: every active department of the lab (in its order, even with no case sheet yet), then any
 * other name the published forms sit under (a free-text specialty, or "General"). `forms` must already be named by
 * their department ({@link orderByDepartments}). A search keeps a department whose name matches (with all its case
 * sheets) or that has matching case sheets (just those); everything else drops out.
 */
export function buildDepartmentRows(
  forms: readonly FormSummary[],
  departments: readonly CaseSheetDepartment[],
  query = '',
): Department[] {
  const groups = groupDepartments(forms);
  const used = new Set<string>();
  const rows: Department[] = departments.map((d) => {
    used.add(d.name);
    return { key: d.key, name: d.name, forms: groups.find((g) => g.name === d.name)?.forms ?? [] };
  });
  for (const g of groups) if (!used.has(g.name)) rows.push({ name: g.name, forms: g.forms });
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows
    .map((r) => (r.name.toLowerCase().includes(q) ? r : { ...r, forms: r.forms.filter((f) => f.title.toLowerCase().includes(q)) }))
    .filter((r) => r.name.toLowerCase().includes(q) || r.forms.length > 0);
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
/**
 * Picking a department changes only `?dept=`: the other query params stay (merge) — in the lab `?patientId=` (and the
 * launcher's `ctx` / `deptKey`) must survive, or a reload / Back lands on "open this from a patient" (WP11 finding).
 */
export function deptNavigation(name: string | null, current: string | null): {
  queryParams: { dept: string | null };
  queryParamsHandling: 'merge';
  replaceUrl: boolean;
} {
  return { queryParams: { dept: name }, queryParamsHandling: 'merge', replaceUrl: !name || !!current };
}

@Component({
  selector: 'app-forms-page',
  standalone: true,
  imports: [PfIconComponent, SkeletonRowsComponent, SegmentedComponent, ToggleComponent, TwoPanelComponent, RouterLink, CsStylesComponent, CsPatientStepComponent, HeroBandComponent],
  providers: [...CASESHEETS_DATA_PROVIDERS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forms.page.html',
  styleUrls: ['../styles/_page.scss', './forms.page.scss'],
})
export class FormsPage {
  private readonly api = inject(CasesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly patients = inject(LabPatientService);
  private readonly auth = inject(AuthService);
  /** A case-sheet builder (adds departments, publishes forms): empty states offer the way forward instead of "ask someone". */
  protected readonly canManage = computed(() => this.auth.hasPermission(CASESHEET_FORMS_MANAGE));
  protected readonly links = casesheetLinks;
  /** Public site vs the lab (Prepare: /cases/:id). */
  protected readonly nav = inject(CasesheetNav);
  private readonly navBack = inject(NavBackService);
  /** Phone width: the Departments list first, then the department (the band's back climbs). */
  protected readonly compact = injectTwoPanelCompact();
  protected readonly icons = {
    dept: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  };

  protected readonly query = signal('');
  protected readonly forms = signal<FormSummary[] | null>(null);
  protected readonly deptList = signal<CaseSheetDepartment[]>([]);
  protected readonly drafts = signal<CaseSummary[] | null>(null);
  protected readonly error = signal('');
  /** The lists could not be read (a start that failed says so in `error`, beside the case sheets). */
  protected readonly loadError = signal('');
  protected readonly starting = signal<string | null>(null);
  /** The case sheet waiting for its patient (the patient step is open): the public site, and the lab's Prepare tab (no patient yet). */
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
  /** Lab's Prepare tab (no ?patientId=): Departments for any patient — the patient step asks whose sheet it is (owner 2026-11-11). */
  protected readonly fromPrepare = this.nav.isLab && !this.patientId;

  /** Every department with its case sheets (searched). */
  protected readonly departments = computed(() => buildDepartmentRows(this.forms() ?? [], this.deptList(), this.query()));
  /** Without the search: is there any department at all, and any case sheet at all? */
  private readonly allDepartments = computed(() => buildDepartmentRows(this.forms() ?? [], this.deptList()));
  protected readonly hasDepartments = computed(() => this.allDepartments().length > 0);
  protected readonly hasForms = computed(() => (this.forms() ?? []).length > 0);

  /** Wide screens show the list and the open department side by side; phones show one at a time. */
  private readonly wideQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)') : null;
  protected readonly wide = signal(this.wideQuery ? this.wideQuery.matches : true);

  /** The department the doctor chose (the URL), or the launcher's, or the only one left while searching. */
  protected readonly chosenDept = computed<Department | null>(() => {
    const all = this.departments();
    const want = this.deptParam();
    const key = this.deptKeyParam();
    const hit = want
      ? all.find((d) => d.name === want)
      : key
        ? all.find((d) => d.key === key || d.forms.some((f) => f.departmentKey === key))
        : undefined;
    if (hit) return hit;
    if (this.query().trim() && all.length === 1) return all[0];
    return null;
  });

  /** The open department: the chosen one; on a wide screen the first one, so the right side is never an empty placeholder. */
  protected readonly pickedDept = computed<Department | null>(
    () => this.chosenDept() ?? (this.wide() ? (this.departments()[0] ?? null) : null),
  );

  /** The shared two-panel's rows: the departments only (count on the right); saved drafts live in the main card's "Continue" tab. */
  protected readonly groups = computed<TwoPanelGroup[]>(() => [
    { key: 'departments', heading: '', items: this.departments().map((d) => ({ id: d.name, label: d.name, note: String(d.forms.length) })) },
  ]);

  /** The main card's tab: the department's case sheets, or the saved drafts to continue (remembered per user). */
  protected readonly tab = signal<'sheets' | 'continue'>(readTab());
  protected readonly draftQuery = signal('');
  protected readonly thisDeptOnly = signal(false);
  protected readonly tabOptions = computed<SegmentedOption[]>(() => [
    { value: 'sheets', label: 'Case sheets' },
    { value: 'continue', label: 'Continue', count: (this.drafts() ?? []).length },
  ]);
  protected setTab(v: unknown): void {
    const t = v === 'continue' ? 'continue' : 'sheets';
    this.tab.set(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* blocked */ }
  }
  /** Saved drafts as rows: patient, case sheet, department, saved — newest first, searched, optionally this department only. */
  protected readonly draftRows = computed(() => {
    const byForm = new Map((this.forms() ?? []).map((f) => [f.id, f.specialty?.trim() || NO_DEPARTMENT]));
    const q = this.draftQuery().trim().toLowerCase();
    const only = this.thisDeptOnly() ? this.pickedDept()?.name : null;
    return (this.drafts() ?? [])
      .map((d) => ({ id: d.id, patient: d.patientName || 'No name yet', sheet: d.formTitle, dept: byForm.get(d.formId) ?? '', saved: d.updatedAt }))
      .filter((r) => (!q || r.patient.toLowerCase().includes(q) || r.sheet.toLowerCase().includes(q)) && (!only || r.dept === only))
      .sort((a, b) => (a.saved < b.saved ? 1 : a.saved > b.saved ? -1 : 0));
  });

  /** The main card's head note: how many case sheets, then the quiet hint. */
  protected readonly panelNote = computed(() => {
    const d = this.pickedDept();
    if (!d) return null;
    if (this.tab() === 'continue') return `${this.draftRows().length} ${this.draftRows().length === 1 ? 'draft' : 'drafts'} · Select one to continue`;
    return d.forms.length ? `${d.forms.length} ${d.forms.length === 1 ? 'case sheet' : 'case sheets'} · Select one to begin` : 'No case sheets in this department yet';
  });

  protected onPick(id: string): void {
    this.pick(id);
  }

  /** Phone: the band's back (and the swipe / hardware back) goes from a department to the list. */
  private readonly backHandler = (): boolean => {
    if (!this.compact() || !this.chosenDept()) return false;
    this.pick(null);
    return true;
  };

  constructor() {
    effect(() => {
      if (this.compact() && this.chosenDept()) this.navBack.registerBackInterceptor(this.backHandler);
      else this.navBack.clearBackInterceptor(this.backHandler);
    });
    inject(DestroyRef).onDestroy(() => this.navBack.clearBackInterceptor(this.backHandler));
    const mq = this.wideQuery;
    if (mq && typeof mq.addEventListener === 'function') {
      const on = () => this.wide.set(mq.matches);
      mq.addEventListener('change', on);
      inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', on));
    }
    void this.load();
  }

  protected async load(): Promise<void> {
    this.error.set('');
    this.loadError.set('');
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
          .listCases({ state: 'draft', pageSize: 50, ...(this.patientId ? { patientId: this.patientId } : {}) })
          .catch(() => null),
      ]);
      this.deptList.set(departments);
      // a department the lab switched off is not offered: its forms stay in MyPrefrontal but doctors don't see them here
      const offered = departments.length ? forms.filter((f) => !f.departmentKey || departments.some((d) => d.key === f.departmentKey)) : forms;
      this.forms.set(orderByDepartments(offered, departments));
      this.drafts.set(drafts?.items ?? []);
    } catch {
      this.forms.set([]);
      this.drafts.set([]);
      this.loadError.set("Can't reach Prefrontal right now. Check the connection and try again.");
    }
  }

  protected pick(name: string | null): void {
    void this.router.navigate([], { relativeTo: this.route, ...deptNavigation(name, this.deptParam()) });
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
    // public site (a personal space), and the lab's Prepare tab: every sheet belongs to a patient — choose or add one first (plan §3.5)
    if (!this.nav.isLab || !this.patientId) {
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
        throw new Error('patient_required');
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
