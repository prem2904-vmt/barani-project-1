import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { OptionTablesService } from '../../../core/services/option-tables.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { OptionRow, OptionTable } from '../../../shared/models/option-table.model';
import { Test } from '../../../shared/models/test.model';
import { Department } from '../../../shared/models/tenant.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';

/** A table being edited: a deep-copied draft of rows + name, dirty-tracked
 *  against the saved original so each card gets its own Save. */
interface TableDraft {
  id: string;
  code: string;
  name: string;
  rows: OptionRow[];
  saving: boolean;
  original: string; // JSON fingerprint of {name, rows} at load/save time
}

/**
 * The DEPARTMENT PAGE — home of a department's shared dropdown tables
 * (Result Option Master). Every test parameter that references a table by
 * code renders its result-entry dropdown from here: edit a table once and
 * all its tests update. Linked from the Test Master department tabs and
 * from each dropdown parameter in the test editor (#t-CODE anchors).
 */
@Component({
  selector: 'pf-department-page',
  standalone: true,
  imports: [FormsModule, RouterLink, ScreenHeaderComponent, TileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Test Master"
        [title]="dept()?.name || 'Department'"
        [subtitle]="'Shared dropdown tables — edit a table once, every test using it updates.'">
      </pf-screen-header>

      <div class="mb-4 flex items-center gap-3 text-sm">
        <a routerLink="/admin/tests" class="font-bold" style="color: var(--violet-600, #7c3aed);">← Test Master</a>
        <span style="color: var(--text-muted);">{{ drafts().length }} table(s)</span>
      </div>

      <!-- New table -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Add option table</h3>
        <p class="pf-ls__hint">A table is a reusable list of dropdown values (e.g. Negative, Trace, 1+…4+). Tests point at it from the test editor.</p>
        <div class="flex flex-wrap items-end gap-3 mt-3">
          <label class="block">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Name</span>
            <input class="pf-input mt-1" maxlength="200" [ngModel]="newName()" (ngModelChange)="newName.set($event)" placeholder="e.g. Stool Colour" />
          </label>
          <label class="block">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Code</span>
            <input class="pf-input mt-1" maxlength="64" [ngModel]="newCode()" (ngModelChange)="newCode.set($event)"
                   placeholder="e.g. STOOL_COLOUR" autocapitalize="characters" spellcheck="false" />
          </label>
          <button type="button" class="px-4 py-2 rounded-xl text-sm font-bold text-white"
                  style="background: var(--violet-600, #7c3aed);"
                  [disabled]="creating() || !newName().trim() || !newCode().trim()"
                  (click)="createTable()">
            {{ creating() ? 'Adding…' : 'Add table' }}
          </button>
        </div>
      </pf-tile>

      @if (loading()) {
        <p class="text-sm" style="color: var(--text-muted);">Loading tables…</p>
      } @else if (drafts().length === 0) {
        <pf-tile tone="default" padding="lg" class="block">
          <p class="text-sm" style="color: var(--text-muted);">
            This department has no option tables yet. Add one above, or restore the default catalog to adopt the shipped set.
          </p>
        </pf-tile>
      }

      @for (d of drafts(); track d.id) {
        <pf-tile tone="default" padding="lg" class="block mb-5" [attr.id]="'t-' + d.code">
          <div class="flex flex-wrap items-center gap-3">
            <input class="pf-input font-bold grow max-w-sm" maxlength="200"
                   [ngModel]="d.name" (ngModelChange)="patch(d.id, { name: $event })" />
            <span class="text-[11px] font-mono px-2 py-1 rounded-lg"
                  style="background: var(--surface-2, #f1f5f9); color: var(--text-muted);">{{ d.code }}</span>
            <span class="text-[11px] font-bold px-2 py-1 rounded-lg"
                  [style.background]="usage(d.code) ? 'var(--violet-100, #ede9fe)' : 'var(--surface-2, #f1f5f9)'"
                  [style.color]="usage(d.code) ? 'var(--violet-700, #6d28d9)' : 'var(--text-muted)'">
              Used by {{ usage(d.code) }} test(s)
            </span>
            <span class="grow"></span>
            <button type="button" class="px-4 py-2 rounded-xl text-sm font-bold text-white"
                    style="background: var(--violet-600, #7c3aed);"
                    [disabled]="d.saving || !isDirty(d) || !validRows(d)"
                    (click)="save(d.id)">
              {{ d.saving ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="px-3 py-2 rounded-xl text-sm font-bold"
                    style="color: var(--red-600, #dc2626);"
                    [disabled]="d.saving"
                    (click)="remove(d.id)">Delete</button>
          </div>

          <div class="mt-4 grid gap-2">
            <div class="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2 text-[11px] font-bold uppercase tracking-wider"
                 style="color: var(--text-muted);">
              <span class="w-8">#</span><span>Value</span><span>Normal</span><span>Active</span><span></span><span></span>
            </div>
            @for (row of d.rows; track $index; let i = $index) {
              <div class="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-2">
                <span class="w-8 text-xs" style="color: var(--text-muted);">{{ i + 1 }}</span>
                <input class="pf-input pf-input--compact" [ngModel]="row.value"
                       (ngModelChange)="patchRow(d.id, i, { value: $event })" placeholder="Option value" />
                <input type="checkbox" class="pf-check" [ngModel]="row.normal === true"
                       (ngModelChange)="patchRow(d.id, i, { normal: $event })"
                       title="Normal (expected) — anything else flags abnormal" />
                <input type="checkbox" class="pf-check" [ngModel]="row.active !== false"
                       (ngModelChange)="patchRow(d.id, i, { active: $event })"
                       title="Inactive rows are hidden from dropdowns" />
                <span class="flex">
                  <button type="button" class="px-1 text-sm" [disabled]="i === 0"
                          (click)="move(d.id, i, -1)" title="Move up">↑</button>
                  <button type="button" class="px-1 text-sm" [disabled]="i === d.rows.length - 1"
                          (click)="move(d.id, i, 1)" title="Move down">↓</button>
                </span>
                <button type="button" class="px-2 text-sm font-bold" style="color: var(--red-600, #dc2626);"
                        (click)="removeRow(d.id, i)" title="Remove option">✕</button>
              </div>
            }
            <div>
              <button type="button" class="mt-1 px-3 py-1.5 rounded-lg text-sm font-bold"
                      style="background: var(--surface-2, #f1f5f9); color: var(--violet-700, #6d28d9);"
                      (click)="addRow(d.id)">+ Add option</button>
            </div>
          </div>
        </pf-tile>
      }
    </section>
  `,
})
export class DepartmentPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ApiService);
  private readonly svc = inject(OptionTablesService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly dept = signal<Department | null>(null);
  readonly drafts = signal<TableDraft[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly newName = signal('');
  readonly newCode = signal('');
  /** table code (upper) → number of tests referencing it, for the chips. */
  private readonly usageByCode = signal<Record<string, number>>({});

  async ngOnInit() {
    const deptId = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const [depts, tests] = await Promise.all([
        this.api.get<Department[]>('/api/tenants/departments').toPromise(),
        this.api.get<Test[]>('/api/tests').toPromise(),
        this.svc.refresh(),
      ]);
      this.dept.set((depts ?? []).find(d => d.id === deptId) ?? null);
      const usage: Record<string, number> = {};
      for (const t of tests ?? []) {
        const raw = JSON.stringify((t as unknown as { parameters?: unknown }).parameters ?? '');
        for (const m of raw.matchAll(/"optionTable":"([^"]+)"/g)) {
          const code = m[1].toUpperCase();
          usage[code] = (usage[code] ?? 0) + 1;
        }
      }
      this.usageByCode.set(usage);
      this.rebuildDrafts(deptId);
      // #t-CODE deep link from the test editor: scroll after render.
      const frag = this.route.snapshot.fragment;
      if (frag) setTimeout(() => document.getElementById(frag)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } finally {
      this.loading.set(false);
    }
  }

  private rebuildDrafts(deptId: string) {
    const mine = this.svc.tables().filter(t => t.departmentId === deptId || (!t.departmentId && !!this.dept()));
    // Tables without a department only show on the page they were opened from
    // via a test-editor link; keep the listing scoped to this department.
    const scoped = mine.filter(t => t.departmentId === deptId);
    this.drafts.set(scoped
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => this.toDraft(t)));
  }

  private toDraft(t: OptionTable): TableDraft {
    const rows = (t.options ?? []).map(o => ({ ...o }));
    return { id: t.id, code: t.code, name: t.name, rows, saving: false, original: this.fingerprint(t.name, rows) };
  }

  private fingerprint(name: string, rows: OptionRow[]): string {
    return JSON.stringify({ name, rows: rows.map(r => ({ value: r.value, normal: r.normal === true, active: r.active !== false })) });
  }

  usage(code: string): number { return this.usageByCode()[code.toUpperCase()] ?? 0; }
  isDirty(d: TableDraft): boolean { return this.fingerprint(d.name, d.rows) !== d.original; }
  validRows(d: TableDraft): boolean { return d.rows.length > 0 && d.rows.every(r => (r.value ?? '').trim().length > 0); }

  patch(id: string, change: Partial<TableDraft>) {
    this.drafts.update(ds => ds.map(d => (d.id === id ? { ...d, ...change } : d)));
  }

  patchRow(id: string, i: number, change: Partial<OptionRow>) {
    this.drafts.update(ds => ds.map(d => d.id === id
      ? { ...d, rows: d.rows.map((r, ix) => (ix === i ? { ...r, ...change } : r)) }
      : d));
  }

  addRow(id: string) {
    this.drafts.update(ds => ds.map(d => d.id === id
      ? { ...d, rows: [...d.rows, { value: '', normal: false, active: true }] }
      : d));
  }

  removeRow(id: string, i: number) {
    this.drafts.update(ds => ds.map(d => d.id === id
      ? { ...d, rows: d.rows.filter((_, ix) => ix !== i) }
      : d));
  }

  move(id: string, i: number, delta: -1 | 1) {
    this.drafts.update(ds => ds.map(d => {
      if (d.id !== id) return d;
      const rows = d.rows.slice();
      const j = i + delta;
      if (j < 0 || j >= rows.length) return d;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...d, rows };
    }));
  }

  async save(id: string) {
    const d = this.drafts().find(x => x.id === id);
    if (!d || !this.validRows(d)) return;
    this.patch(id, { saving: true });
    try {
      const saved = await this.svc.update(id, { name: d.name.trim(), options: d.rows });
      this.patch(id, { saving: false, name: saved.name, original: this.fingerprint(saved.name, d.rows) });
      await this.svc.refresh();
      this.toasts.success(`Saved "${saved.name}" — dropdowns update everywhere it's used.`);
    } catch (e) {
      this.patch(id, { saving: false });
      this.toasts.error((e as ApiError)?.message || 'Could not save the table.');
    }
  }

  async remove(id: string) {
    const d = this.drafts().find(x => x.id === id);
    if (!d) return;
    if (this.usage(d.code) > 0) {
      this.toasts.error(`"${d.name}" is used by ${this.usage(d.code)} test(s) — point those tests at another table first.`);
      return;
    }
    const ok = await this.dialog.confirm({
      title: `Delete option table "${d.name}"?`,
      message: 'Tests are not affected — only unused tables can be deleted.',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.svc.delete(id);
      this.drafts.update(ds => ds.filter(x => x.id !== id));
      await this.svc.refresh();
      this.toasts.success('Table deleted.');
    } catch (e) {
      this.toasts.error((e as ApiError)?.message || 'Could not delete the table.');
    }
  }

  async createTable() {
    const deptId = this.route.snapshot.paramMap.get('id');
    this.creating.set(true);
    try {
      const created = await this.svc.create({
        code: this.newCode().trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        name: this.newName().trim(),
        departmentId: deptId,
        options: [{ value: 'Normal', normal: true, active: true }],
      });
      this.newName.set('');
      this.newCode.set('');
      await this.svc.refresh();
      this.drafts.update(ds => [this.toDraft(created), ...ds]);
      this.toasts.success(`Table "${created.name}" added — edit its options below.`);
    } catch (e) {
      this.toasts.error((e as ApiError)?.message || 'Could not create the table.');
    } finally {
      this.creating.set(false);
    }
  }
}
