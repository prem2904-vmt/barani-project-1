import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SegmentedComponent, SegmentedOption, SkeletonRowsComponent } from '@prefrontal/shared';
import { AuthService } from '../../../core/auth/auth.service';
import { DialogService } from '../../../core/services/dialog.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { CASESHEET_FILL } from '../shared/casesheet-permissions';
import { CaseState, CaseSummary } from '../data/cases/case-models';
import { CasesApi } from '../data/cases/cases-api';
import { CasesheetNav } from '../data/casesheet-nav';
import { LabPatient, LabPatientService } from '../data/lab-patient';
import { humanKey, whenText } from '../data/when';
import { CsStylesComponent } from '../styles/cs-styles.component';
import { CASESHEETS_DATA_PROVIDERS } from '../data/casesheets-data.providers';

type CaseFilter = 'drafts' | 'finished';
const PAGE_SIZE = 30;

/**
 * Cases — drafts to continue, finished ones with their PDF. Search by patient name. Ported from prefrontal-prepare-ui
 * `features/cases` @ bca8282, adapted (plan §1.1):
 *  - public site (`/cases`): the doctor's own case sheets, as Prepare;
 *  - lab (`/casesheets/patient/:patientId`, from the patient profile): ONE patient's sheets, tenant-wide for
 *    casesheet_view (branch-filtered by the API, §11 Q2), with "New case sheet" for casesheet_fill. A lab never deletes
 *    a finished sheet (plan §3.1: Amend = a new version).
 */
import { CasesheetGateService } from '../shared/casesheet-gate.service';
@Component({
  selector: 'app-cases-page',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent, SegmentedComponent, SkeletonRowsComponent, RouterLink, CsStylesComponent],
  providers: [...CASESHEETS_DATA_PROVIDERS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cases.page.html',
  styleUrls: ['../styles/_page.scss', './cases.page.scss'],
})
export class CasesPage {
  private readonly api = inject(CasesApi);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly patients = inject(LabPatientService);
  protected readonly nav = inject(CasesheetNav);

  /** Lab route param (`casesheets/patient/:patientId`); absent on the public site. */
  readonly patientId = input<string | undefined>(undefined);
  protected readonly patient = signal<LabPatient | null>(null);
  private readonly gate = inject(CasesheetGateService);
  /** May start a sheet: the permission AND Prepare switched on (Settings → IPD; always on for a personal space). */
  protected readonly canFill = computed(() => this.gate.prepareOn() && this.auth.hasAnyPermission([CASESHEET_FILL]));
  protected readonly query = signal('');
  protected readonly filter = signal<CaseFilter>('drafts');
  protected readonly filters: SegmentedOption<CaseFilter>[] = [
    { value: 'drafts', label: 'Drafts' },
    { value: 'finished', label: 'Finished' },
  ];
  protected readonly items = signal<CaseSummary[] | null>(null);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly error = signal('');
  protected readonly busyId = signal<string | null>(null);
  protected readonly when = whenText;
  protected readonly human = humanKey;
  protected readonly more = computed(() => (this.items()?.length ?? 0) < this.total());

  protected readonly empty = computed(() => {
    if (this.query().trim())
      return { title: `No case sheet matches “${this.query().trim()}”`, body: 'Search looks at the patient name.' };
    return this.filter() === 'drafts'
      ? {
          title: 'No drafts',
          body: this.patientId()
            ? 'Start one with New case sheet. Every change is saved as you go, so a sheet you leave waits here.'
            : 'Start a case sheet from Departments. Every change is saved as you go, so a sheet you leave waits here.',
        }
      : { title: 'No finished case sheets', body: 'When you tap Finish on a case sheet, it moves here with its PDF.' };
  });

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const state: CaseState = this.filter() === 'drafts' ? 'draft' : 'final';
      const q = this.query().trim();
      this.patientId();
      untracked(() => {
        if (this.searchTimer) clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.load(state, q, 1), q ? 250 : 0);
      });
    });
    inject(DestroyRef).onDestroy(() => this.searchTimer && clearTimeout(this.searchTimer));
    // lab: the band names the patient whose sheets these are
    effect(() => {
      const id = this.patientId();
      untracked(() => {
        this.patient.set(null);
        if (id) void this.patients.load(id).then((p) => this.patientId() === id && this.patient.set(p)).catch(() => undefined);
      });
    });
  }

  /** Lab: a new sheet for this patient (Departments for the patient; never a patient picker). */
  protected startNew(): void {
    const to = this.nav.departments(this.patientId() ?? null);
    void this.router.navigate([to.path], { queryParams: to.queryParams });
  }

  /** Delete is offered for drafts everywhere, and for finished sheets only on the public site (plan §3.1). */
  protected canDelete(c: CaseSummary): boolean {
    return c.state === 'draft' || !this.nav.isLab;
  }

  private seq = 0;
  private async load(state: CaseState, search: string, page: number): Promise<void> {
    const mine = ++this.seq;
    if (page === 1) this.items.set(null);
    this.error.set('');
    try {
      const patientId = this.patientId();
      const r = await this.api.listCases({
        state,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
        ...(patientId ? { patientId } : {}),
      });
      if (mine !== this.seq) return;
      this.items.set(page === 1 ? r.items : [...(this.items() ?? []), ...r.items]);
      this.total.set(r.total);
      this.page.set(page);
    } catch {
      if (mine !== this.seq) return;
      this.items.set([]);
      this.error.set("Can't reach Prefrontal right now. Check the connection and try again.");
    }
  }

  protected reload(): void {
    void this.load(this.filter() === 'drafts' ? 'draft' : 'final', this.query().trim(), 1);
  }

  protected loadMore(): void {
    void this.load(this.filter() === 'drafts' ? 'draft' : 'final', this.query().trim(), this.page() + 1);
  }

  protected async remove(c: CaseSummary): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'Delete this case sheet?',
      message: `${c.patientName || 'This case sheet'} (${c.formTitle}) disappears from your cases.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    this.busyId.set(c.id);
    try {
      await this.api.deleteCase(c.id);
      this.items.update((xs) => (xs ?? []).filter((x) => x.id !== c.id));
      this.total.update((t) => Math.max(0, t - 1));
    } catch {
      this.error.set("Couldn't delete it just now. Please try again.");
    } finally {
      this.busyId.set(null);
    }
  }

  protected async amend(c: CaseSummary): Promise<void> {
    this.busyId.set(c.id);
    try {
      const d = await this.api.amendCase(c.id);
      await this.router.navigateByUrl(this.nav.sheet(d.id));
    } catch {
      this.error.set("Couldn't start the amendment just now. Please try again.");
    } finally {
      this.busyId.set(null);
    }
  }
}
