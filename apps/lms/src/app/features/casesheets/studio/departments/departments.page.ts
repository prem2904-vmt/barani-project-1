import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PfIconComponent } from '@prefrontal/forms-engine';
import { SkeletonRowsComponent, ToggleComponent } from '@prefrontal/shared';
import { DialogService } from '../../../../core/services/dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { HeroBandComponent } from '../../../../shared/components/hero-band/hero-band.component';
import { StudioApi } from '../data/studio-api';
import { DepartmentRow, StudioError, plainError } from '../data/studio-models';
import { DepartmentAddComponent } from '../shared/department-add.component';

/** The one-click starter set (Settings > IPD > Departments, empty list). */
export const STARTER_DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'General Surgery',
  'Paediatrics',
  'Obstetrics & Gynaecology',
  'Orthopaedics',
  'ENT',
  'Ophthalmology',
  'Dermatology',
  'Psychiatry',
  'Emergency Medicine',
];

/** The row's order key: sort order, then name (stable, same as the API clients). */
const byOrder = (a: DepartmentRow, b: DepartmentRow): number => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Settings > IPD > Departments (`casesheet_forms_manage`): the IPD departments the lab's case sheet forms are filed
 * under. Prefrontal's own departments are listed read-only; the lab adds, renames, reorders, hides and removes its own.
 * Hidden = doctors do not see it on Prepare (its forms stay).
 */
@Component({
  selector: 'app-departments-page',
  standalone: true,
  imports: [HeroBandComponent, PfIconComponent, SkeletonRowsComponent, ToggleComponent, DepartmentAddComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './departments.page.html',
  styleUrls: ['../shared/page.scss', './departments.page.scss'],
})
export class DepartmentsPage {
  private readonly api = inject(StudioApi);
  private readonly dialog = inject(DialogService);
  private readonly toasts = inject(ToastService);

  protected readonly query = signal('');
  protected readonly rows = signal<DepartmentRow[] | null>(null);
  protected readonly error = signal('');
  /** The department being renamed, with the text in the box. */
  protected readonly editing = signal<string | null>(null);
  protected readonly editText = signal('');
  /** The key of the row (or 'starter') a call is running for. */
  protected readonly busy = signal<string | null>(null);
  /** Bumped when a switch change fails, so the switch is re-created in its old position (pf-toggle flips itself). */
  protected readonly rev = signal(0);

  protected readonly sorted = computed(() => [...(this.rows() ?? [])].sort(byOrder));
  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.sorted().filter((d) => !q || d.name.toLowerCase().includes(q));
  });
  protected readonly count = computed(() => this.sorted().length);
  private readonly ownSorted = computed(() => this.sorted().filter((d) => d.own));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set('');
    try {
      this.rows.set(await this.api.departments({ includeInactive: true }));
    } catch (e) {
      this.rows.set(this.rows() ?? []);
      this.error.set(plainError(e, "Can't load the departments right now."));
    }
  }

  protected active(d: DepartmentRow): boolean {
    return d.isActive !== false;
  }

  /** Add one (the box at the top); Enter adds too. */
  protected async added(row: DepartmentRow): Promise<void> {
    this.toasts.success(`Added ${row.name}`);
    await this.load();
  }

  /** "Add common departments": one POST each, names that already exist are skipped, one toast at the end. */
  protected async addStarter(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('starter');
    const have = new Set((this.rows() ?? []).map((d) => d.name.trim().toLowerCase()));
    let made = 0;
    let failed = 0;
    for (const name of STARTER_DEPARTMENTS) {
      if (have.has(name.toLowerCase())) continue;
      try {
        await this.api.createDepartment({ name });
        made++;
      } catch (e) {
        if (!(e instanceof StudioError && e.code === 'name_taken')) failed++;
      }
    }
    await this.load();
    this.busy.set(null);
    if (failed) this.toasts.warning(`Added ${made}, but ${failed} could not be added. Try again for the rest.`);
    else if (made) this.toasts.success(`Added ${made} ${made === 1 ? 'department' : 'departments'}`);
    else this.toasts.info('All the common departments are already there');
  }

  protected startEdit(d: DepartmentRow): void {
    if (!d.own) return;
    this.editing.set(d.key);
    this.editText.set(d.name);
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  protected async saveEdit(d: DepartmentRow): Promise<void> {
    if (this.editing() !== d.key) return;
    const name = this.editText().trim();
    this.editing.set(null);
    if (!name || name === d.name) return;
    await this.change(d, { name }, `Renamed to ${name}`);
  }

  /** Move up (-1) / down (+1) among the lab's own departments: the pair swaps places (PUT sortOrder). */
  protected async move(d: DepartmentRow, step: -1 | 1): Promise<void> {
    const own = this.ownSorted();
    const at = own.findIndex((x) => x.key === d.key);
    const other = own[at + step];
    if (at < 0 || !other) return;
    // two rows can share a sort order; then the moved row steps just past its neighbour
    const mine = d.sortOrder === other.sortOrder ? other.sortOrder + step : other.sortOrder;
    const theirs = d.sortOrder === other.sortOrder ? other.sortOrder : d.sortOrder;
    this.busy.set(d.key);
    try {
      await this.api.updateDepartment(d.key, { sortOrder: mine });
      if (theirs !== other.sortOrder) await this.api.updateDepartment(other.key, { sortOrder: theirs });
      await this.load();
    } catch (e) {
      this.toasts.error(plainError(e, "Couldn't move it just now. Please try again."));
      await this.load();
    } finally {
      this.busy.set(null);
    }
  }

  protected canMove(d: DepartmentRow, step: -1 | 1): boolean {
    const own = this.ownSorted();
    const at = own.findIndex((x) => x.key === d.key);
    return at >= 0 && !!own[at + step] && !this.busy();
  }

  protected async setActive(d: DepartmentRow, on: boolean): Promise<void> {
    await this.change(d, { isActive: on }, on ? `${d.name} is shown to doctors` : `${d.name} is hidden from doctors`);
  }

  private async change(d: DepartmentRow, patch: { name?: string; isActive?: boolean }, done: string): Promise<void> {
    this.busy.set(d.key);
    try {
      await this.api.updateDepartment(d.key, patch);
      this.toasts.success(done);
    } catch (e) {
      this.toasts.error(plainError(e, "Couldn't save that just now. Please try again."));
      this.rev.update((n) => n + 1);
    } finally {
      this.busy.set(null);
    }
    await this.load();
  }

  protected async remove(d: DepartmentRow): Promise<void> {
    const ok = await this.dialog.confirm({
      title: `Remove ${d.name}?`,
      message: 'Doctors will no longer see this department. If forms still use it, switch it off instead.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
      tone: 'danger',
    });
    if (!ok) return;
    this.busy.set(d.key);
    try {
      await this.api.removeDepartment(d.key);
      this.toasts.success(`Removed ${d.name}`);
    } catch (e) {
      if (e instanceof StudioError && e.code === 'department_in_use') {
        this.toasts.error(`${e.message} Use the switch to hide ${d.name} from doctors.`);
      } else this.toasts.error(plainError(e, "Couldn't remove it just now. Please try again."));
    } finally {
      this.busy.set(null);
    }
    await this.load();
  }
}
