import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ViewStateService } from '../../../shared/services/view-state.service';
import { GridViewStateDirective } from '../../../shared/services/grid-view-state';
import { NgTemplateOutlet } from '@angular/common';
import { AgGridAngular } from 'ag-grid-angular';
import { Router, RouterLink } from '@angular/router';
import { emptyDefinition } from '@prefrontal/forms-engine';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SegmentedComponent, SegmentedOption, SkeletonRowsComponent } from '@prefrontal/shared';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { DeptRailRow, SheetFilters, SheetGridContext, SheetOriginFilter, SheetStatusFilter, filterSheets, railRows, sheetColumns, sheetRowClass, sheetRowId } from './list/case-sheet-grid';
import { DialogService } from '../../../core/services/dialog.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { casesheetLinks } from '../casesheets.routes';
import { StudioApi } from './data/studio-api';
import { DepartmentRow, FormRow, plainError } from './data/studio-models';
import { CortexImportDialog } from './cortex-import/cortex-import.dialog';
import { CortexImportService } from './cortex-import/cortex-import.service';
import { cortexImportOn } from '../shared/cortex-import-gate';
import { whenText } from './shared/when';
import { PhoneNoteComponent } from './shared/phone-note.component';
import { PendingCountService } from './approvals/pending-count.service';
import { BuilderDrawerComponent } from './builder/builder-drawer.component';
import { BuilderStatusService } from './builder/builder-status.service';
import { ChatStore } from './builder/chat.store';
import { waitingWords } from './approvals/approvals-models';

/** The group a case sheet with no (known) department is filed under. */
export const OTHER_DEPARTMENT = 'other';

export interface DepartmentGroup {
  key: string;
  name: string;
  forms: FormRow[];
}

/**
 * Group forms by master department (departments come from the platform; a lab cannot create one). A form whose
 * department is missing or unknown goes under "Other", last. Empty departments are left out; inside a group,
 * masters and the lab's own forms are sorted by title.
 */
export function groupByDepartment(forms: FormRow[], departments: DepartmentRow[]): DepartmentGroup[] {
  const byKey = new Map<string, DepartmentGroup>();
  for (const d of departments) byKey.set(d.key.toLowerCase(), { key: d.key, name: d.name, forms: [] });
  const other: DepartmentGroup = { key: OTHER_DEPARTMENT, name: 'Other', forms: [] };
  for (const f of forms) (byKey.get((f.departmentKey ?? '').toLowerCase()) ?? other).forms.push(f);
  const out = [...byKey.values(), other].filter((g) => g.forms.length);
  for (const g of out) g.forms.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * MyPrefrontal home (Admin > IPD > MyPrefrontal, `casesheet_forms_manage`): every form this lab can use, grouped by
 * department. Master case sheets are read-only; Edit makes this lab's own copy (a fork). The lab's own forms show where
 * they stand (live version, open draft). New case sheet sits in the band.
 */
@Component({
  selector: 'app-studio-page',
  standalone: true,
  imports: [GridViewStateDirective, HeroBandComponent, PfIconComponent, SkeletonRowsComponent, RouterLink, PhoneNoteComponent, CortexImportDialog, BuilderDrawerComponent, AgGridAngular, NgTemplateOutlet, SegmentedComponent],
  // the "New case sheet with Cortex" chat (no case sheet open: Cortex may suggest a new one, which waits for approval)
  providers: [ChatStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './studio.page.html',
  // the list wears Test Master's stylesheet (pf-tm-*), so it is the same screen across the app
  styleUrls: ['./shared/page.scss', '../../admin/tests/tests/tests.component.scss', './studio.page.scss'],
})
export class StudioPage {
  private readonly api = inject(StudioApi);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  protected readonly cortex = inject(CortexImportService);
  /** "Start from a paper case sheet" (Cortex, dev beta): the console switch is on and the server hasn't said no. */
  protected readonly cortexOn = computed(() => cortexImportOn() && !this.cortex.unavailable());
  protected readonly cortexFormOpen = signal(false);
  protected readonly cortexDialogOpen = computed(() => this.cortexFormOpen() || this.cortex.viewing());

  protected readonly links = casesheetLinks;
  /** What waits for approval (suggestions + updates from Prefrontal): the band button's badge and the row tags. */
  protected readonly pending = inject(PendingCountService);
  protected readonly pendingWords = computed(() => waitingWords(this.pending.total()));
  /** The Cortex builder (dev beta pf.cortexBuilder() + the server's status). */
  protected readonly builder = inject(BuilderStatusService);
  protected readonly chatOpen = signal(false);
  protected readonly query = signal('');
  protected readonly forms = signal<FormRow[] | null>(null);
  protected readonly departments = signal<DepartmentRow[]>([]);
  protected readonly error = signal('');
  protected readonly showArchived = signal(false);
  protected readonly busy = signal<string | null>(null);

  constructor() {
    void this.load();
    void this.pending.refresh();
    void this.builder.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      const [forms, departments] = await Promise.all([this.api.listForms('all'), this.api.departments().catch(() => [] as DepartmentRow[])]);
      this.forms.set(forms);
      this.departments.set(departments);
    } catch (e) {
      this.forms.set(this.forms() ?? []);
      this.error.set(plainError(e, "Can't load the case sheets right now."));
    }
  }

  private readonly toasts = inject(ToastService);
  protected readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  // ---- Test Master's anatomy: DEPARTMENTS rail (left), case sheets in AG-Grid (right) ----
  /** The department picked in the rail (null = All). */
  protected readonly dept = signal<string | null>(null);
  protected readonly statusFilter = signal<SheetStatusFilter>('all');
  protected readonly originFilter = signal<SheetOriginFilter>('all');
  /** Band tabs: the grid, or the archived case sheets (Pending / From Prefrontal open the approvals page). */
  protected readonly view = signal<'sheets' | 'archived'>('sheets');
  protected readonly sideCollapsed = signal(false);
  protected readonly deptSheetOpen = signal(false);
  protected readonly narrow = signal(this.watch('(max-width: 900px)', (m) => this.narrow.set(m)));
  protected readonly isPhone = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
  protected readonly web = webPointerSignal();
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly defaultColDef = { filter: true, sortable: true, resizable: true, flex: 1, minWidth: 110 };
  protected readonly rowId = sheetRowId;
  protected readonly rowClass = sheetRowClass;

  private watch(query: string, on: (m: boolean) => void): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    const m = window.matchMedia(query);
    const h = (e: MediaQueryListEvent) => on(e.matches);
    m.addEventListener?.('change', h);
    this.destroyRef.onDestroy(() => m.removeEventListener?.('change', h));
    return m.matches;
  }

  protected readonly gridContext: SheetGridContext = {
    open: (f) => void this.router.navigate([casesheetLinks.adminForm(f.id)]),
    edit: (f) => void this.edit(f),
    menu: (f) => void this.menu(f),
    pendingOf: (f) => this.pending.byForm().get(f.id) ?? 0,
    web: true,
  };

  /** Everything the view shows before the department / status / origin filters. */
  private readonly inView = computed(() => (this.forms() ?? []).filter((f) => f.status === (this.view() === 'archived' ? 'archived' : 'active')));
  private filters(over: Partial<SheetFilters> = {}): SheetFilters {
    return { query: this.query(), dept: this.dept(), status: this.statusFilter(), origin: this.originFilter(), ...over };
  }
  protected readonly rows = computed(() => filterSheets(this.inView(), this.departments(), this.filters()));
  protected readonly shownCount = computed(() => this.rows().length);
  /** The rail counts what the other filters leave, so All = the sum. */
  protected readonly rail = computed<DeptRailRow[]>(() => railRows(filterSheets(this.inView(), this.departments(), this.filters({ dept: null })), this.departments()));
  protected readonly railTotal = computed(() => filterSheets(this.inView(), this.departments(), this.filters({ dept: null })).length);
  protected readonly colDefs = computed(() => sheetColumns(this.web(), this.isPhone));
  protected readonly archivedCount = computed(() => (this.forms() ?? []).filter((f) => f.status === 'archived').length);
  protected readonly fromPrefrontalCount = computed(() => this.pending.offerForms().size);

  protected readonly viewOptions = computed<SegmentedOption<string>[]>(() => [
    { value: 'sheets', label: 'Case sheets', count: (this.forms() ?? []).filter((f) => f.status === 'active').length },
    { value: 'pending', label: 'Pending', count: this.pending.total() },
    { value: 'offers', label: 'From Prefrontal', count: this.fromPrefrontalCount() },
    { value: 'archived', label: 'Archived', count: this.archivedCount() },
  ]);
  protected readonly statusOptions = computed<SegmentedOption<SheetStatusFilter>[]>(() => {
    const base = filterSheets(this.inView(), this.departments(), this.filters({ status: 'all' }));
    const pub = base.filter((f) => !!f.published).length;
    return [
      { value: 'all', label: 'All', count: base.length },
      { value: 'published', label: 'Published', count: pub },
      { value: 'draft', label: 'Draft', count: base.length - pub },
    ];
  });
  protected readonly originOptions = computed<SegmentedOption<SheetOriginFilter>[]>(() => {
    const base = filterSheets(this.inView(), this.departments(), this.filters({ origin: 'all' }));
    const n = (o: string) => base.filter((f) => (o === 'master' ? f.origin === 'master' : o === 'copy' ? f.origin === 'override' : f.origin === 'local')).length;
    return [
      { value: 'all', label: 'All', count: base.length },
      { value: 'master', label: 'Master', count: n('master') },
      { value: 'copy', label: 'Lab copy', count: n('copy') },
      { value: 'local', label: 'Local', count: n('local') },
    ];
  });
  protected readonly deptName = computed(() => this.rail().find((d) => d.key === this.dept())?.name ?? null);

  protected setView(v: string): void {
    if (v === 'pending' || v === 'offers') {
      void this.router.navigate([casesheetLinks.adminPending()]);
      return;
    }
    this.view.set(v === 'archived' ? 'archived' : 'sheets');
  }
  protected pickDept(key: string | null): void {
    this.dept.set(key);
    this.deptSheetOpen.set(false);
  }
  protected toggleSide(): void {
    this.sideCollapsed.set(!this.sideCollapsed());
  }

  /**
   * The rail's switch: the department is shown to doctors on Prepare (same call as Settings > IPD > Departments).
   * A master department is Prefrontal's: the server answers `master_department` until it has a per-lab switch
   * (gaps file, "For data agent"); the switch then snaps back and says why.
   */
  protected async toggleDept(d: DeptRailRow): Promise<void> {
    try {
      await this.api.updateDepartment(d.key, { isActive: !d.isActive });
      this.toasts.success(d.isActive ? `${d.name} is hidden from doctors` : `${d.name} is shown to doctors`);
    } catch (e) {
      this.toasts.error(plainError(e, "Couldn't change that department just now."));
    }
    await this.load();
  }

  protected where(f: FormRow): string {
    // the "Master" badge beside the title already says it; the nbsp keeps "read-only" from breaking at its hyphen
    if (f.origin === 'master') return f.published ? `Live version ${f.published.versionNo} · read\u2011only` : 'Not published · read\u2011only';
    const bits: string[] = [];
    if (f.published) bits.push(`Live · version ${f.published.versionNo}`);
    if (f.draft) {
      const what = f.draft.state === 'in_review' ? 'In review' : f.published ? 'Changes in a draft' : 'Draft, not published yet';
      bits.push(`${what} · saved ${whenText(f.draft.updatedAt)}`);
    }
    return bits.join(' · ') || 'No version yet';
  }

  protected async newForm(): Promise<void> {
    const title = await this.dialog.prompt({
      title: 'New case sheet',
      message: 'Give it the name doctors will see, for example “ENT case sheet”.',
      placeholder: 'Case sheet name',
      confirmLabel: 'Create',
      required: true,
    });
    if (!title?.trim()) return;
    const departments = this.departments();
    let specialty: string | undefined;
    if (!departments.length) {
      // No departments yet: say so, and offer the way out here instead of filing the case sheet under nothing.
      const what = await this.dialog.choose({
        title: 'Which department?',
        message: 'There are no departments yet. Add one now, or manage them in Settings → IPD.',
        choices: [
          { value: 'add', label: 'Add a department', hint: 'Type a name and use it for this case sheet' },
          { value: 'manage', label: 'Manage departments', hint: 'Open Settings → IPD → Departments' },
          { value: 'skip', label: 'Skip for now', hint: 'Make the case sheet without a department' },
        ],
        confirmLabel: 'Continue',
        cancelLabel: 'Cancel',
      });
      if (!what) return;
      if (what === 'manage') {
        await this.router.navigate([casesheetLinks.adminDepartments()]);
        return;
      }
      if (what === 'add') {
        const name = await this.dialog.prompt({ title: 'Add a department', placeholder: 'Department name, for example Cardiology', confirmLabel: 'Add', required: true });
        if (!name?.trim()) return;
        try {
          const row = await this.api.createDepartment({ name: name.trim() });
          this.departments.set(await this.api.departments().catch(() => [row]));
          specialty = row.key;
        } catch (e) {
          this.error.set(plainError(e, "Couldn't add the department."));
          return;
        }
      }
    } else {
      const pick = await this.dialog.choose({
        title: 'Which department?',
        choices: [...departments.map((d) => ({ value: d.key, label: d.name })), { value: OTHER_DEPARTMENT, label: 'Other', hint: 'Not one of the listed departments' }],
        confirmLabel: 'Use this',
        cancelLabel: 'Skip',
      });
      if (pick && pick !== OTHER_DEPARTMENT) specialty = pick;
    }
    this.busy.set('new');
    try {
      const r = await this.api.createForm(title.trim(), emptyDefinition(title.trim()), specialty);
      await this.router.navigate([casesheetLinks.adminForm(r.id)]);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't create the case sheet."));
    } finally {
      this.busy.set(null);
    }
  }

  /** "Edit" on a master: this lab's own copy (a fork) with an open draft, then straight into it. */
  protected async edit(f: FormRow): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Make your lab's copy of ${f.title}?`,
      message: "You edit and publish your lab's copy. The master stays as it is, and your copy is the one your doctors use.",
      confirmLabel: 'Make my copy',
      cancelLabel: 'Not now',
    });
    if (!ok) return;
    this.busy.set(f.id);
    try {
      const r = await this.api.fork(f.id);
      await this.router.navigate([casesheetLinks.adminForm(r.id)]);
    } catch (e) {
      this.error.set(plainError(e, "Couldn't make your copy just now."));
    } finally {
      this.busy.set(null);
    }
  }

  protected async menu(f: FormRow): Promise<void> {
    const pick = await this.dialog.choose({
      title: f.title,
      choices: [
        { value: 'open', label: 'Open' },
        { value: 'history', label: 'Version history' },
        { value: 'dup', label: 'Make a copy' },
        f.status === 'archived'
          ? { value: 'unarchive', label: 'Bring back', hint: 'Doctors can start case sheets with it again' }
          : { value: 'archive', label: 'Archive', hint: 'Hidden from doctors; finished case sheets stay' },
      ],
      confirmLabel: 'Do it',
      cancelLabel: 'Close',
    });
    try {
      if (pick === 'open') await this.router.navigate([casesheetLinks.adminForm(f.id)]);
      else if (pick === 'history') await this.router.navigate([casesheetLinks.adminFormHistory(f.id)]);
      else if (pick === 'dup') {
        const name = await this.dialog.prompt({ title: 'Make a copy', initialValue: `Copy of ${f.title}`, confirmLabel: 'Make the copy', required: true });
        if (!name?.trim()) return;
        const r = await this.api.duplicate(f.id, name.trim());
        await this.router.navigate([casesheetLinks.adminForm(r.id)]);
      } else if (pick === 'archive' || pick === 'unarchive') {
        await this.api.archive(f.id, pick === 'archive');
        await this.load();
      }
    } catch (e) {
      this.error.set(plainError(e));
    }
  }

  // Screen view state (owner 2026-11-21): department, status / origin filters, tab and search come back as left.
  private readonly _viewState = inject(ViewStateService).bind('casesheets.studio', {
    dept: this.dept, status: this.statusFilter, origin: this.originFilter, view: this.view, query: this.query,
  });
}
