import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
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

/** The one table being edited: a deep-copied draft of rows + name,
 *  dirty-tracked against the saved original. */
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
 * (Result Option Master). ONE table shows at a time: an autocomplete
 * dropdown picks which (type to filter by name/code), and a New button
 * creates one — no page scroll through dozens of cards. Every test
 * parameter that references a table by code renders its result-entry
 * dropdown from here: edit a table once and all its tests update.
 * Linked from the Test Master department rows and from each dropdown
 * parameter in the test editor (#t-CODE deep links select the table).
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
        <span style="color: var(--text-muted);">{{ tablesForDept().length }} table(s)</span>
      </div>

      <!-- ── Picker row: autocomplete + New ─────────────────────── -->
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <div class="relative grow max-w-xl">
          <input class="pf-input w-full" type="text"
                 [ngModel]="query()"
                 (ngModelChange)="onQuery($event)"
                 (focus)="pickerOpen.set(true)"
                 (blur)="closePickerSoon()"
                 [placeholder]="active() ? active()!.name : 'Search a table by name or code…'"
                 autocapitalize="off" autocorrect="off" spellcheck="false" />
          @if (pickerOpen()) {
            <div class="pf-dp-menu">
              @for (t of filteredTables(); track t.id) {
                <button type="button" class="pf-dp-item" [class.pf-dp-item--active]="t.id === activeId()"
                        (mousedown)="$event.preventDefault(); pick(t)">
                  <span class="font-bold">{{ t.name }}</span>
                  <span class="pf-dp-code">{{ t.code }}</span>
                  <span class="pf-dp-count">{{ usage(t.code) }} test(s)</span>
                </button>
              }
              @if (filteredTables().length === 0) {
                <div class="pf-dp-empty">No table matches "{{ query() }}"</div>
              }
            </div>
          }
        </div>
        <button type="button" class="px-4 py-2 rounded-xl text-sm font-bold text-white"
                style="background: var(--violet-600, #7c3aed);"
                (click)="startNew()">+ New table</button>
      </div>

      @if (loading()) {
        <p class="text-sm" style="color: var(--text-muted);">Loading tables…</p>
      }

      <!-- ── Create form (only when New was clicked) ─────────────── -->
      @if (creatingNew()) {
        <pf-tile tone="default" padding="lg" class="block mb-5">
          <h3 class="pf-ls__title">New option table</h3>
          <p class="pf-ls__hint">A reusable list of dropdown values (e.g. Negative, Trace, 1+…4+). Tests point at it from the test editor.</p>
          <div class="flex flex-wrap items-end gap-3 mt-3">
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Name</span>
              <input class="pf-input mt-1" maxlength="200" [ngModel]="newName()" (ngModelChange)="onNewName($event)" placeholder="e.g. Stool Colour" />
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
            <button type="button" class="px-3 py-2 rounded-xl text-sm font-bold"
                    style="color: var(--text-muted);" (click)="creatingNew.set(false)">Cancel</button>
          </div>
        </pf-tile>
      }

      <!-- ── The ONE selected table ──────────────────────────────── -->
      @if (draft(); as d) {
        <pf-tile tone="default" padding="lg" class="block mb-5" [attr.id]="'t-' + d.code">
          <div class="flex flex-wrap items-center gap-3">
            <input class="pf-input font-bold grow max-w-sm" maxlength="200"
                   [ngModel]="d.name" (ngModelChange)="patch({ name: $event })" />
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
                    (click)="save()">
              {{ d.saving ? 'Saving…' : 'Save' }}
            </button>
            <button type="button" class="px-3 py-2 rounded-xl text-sm font-bold"
                    style="color: var(--red-600, #dc2626);"
                    [disabled]="d.saving"
                    (click)="remove()">Delete</button>
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
                       (ngModelChange)="patchRow(i, { value: $event })" placeholder="Option value" />
                <input type="checkbox" class="pf-check" [ngModel]="row.normal === true"
                       (ngModelChange)="patchRow(i, { normal: $event })"
                       title="Normal (expected) — anything else flags abnormal" />
                <input type="checkbox" class="pf-check" [ngModel]="row.active !== false"
                       (ngModelChange)="patchRow(i, { active: $event })"
                       title="Inactive rows are hidden from dropdowns" />
                <span class="flex">
                  <button type="button" class="px-1 text-sm" [disabled]="i === 0"
                          (click)="move(i, -1)" title="Move up">↑</button>
                  <button type="button" class="px-1 text-sm" [disabled]="i === d.rows.length - 1"
                          (click)="move(i, 1)" title="Move down">↓</button>
                </span>
                <button type="button" class="px-2 text-sm font-bold" style="color: var(--red-600, #dc2626);"
                        (click)="removeRow(i)" title="Remove option">✕</button>
              </div>
            }
            <div>
              <button type="button" class="mt-1 px-3 py-1.5 rounded-lg text-sm font-bold"
                      style="background: var(--surface-2, #f1f5f9); color: var(--violet-700, #6d28d9);"
                      (click)="addRow()">+ Add option</button>
            </div>
          </div>
        </pf-tile>
      } @else if (!loading() && !creatingNew()) {
        <pf-tile tone="default" padding="lg" class="block">
          <p class="text-sm" style="color: var(--text-muted);">
            @if (tablesForDept().length === 0) {
              This department has no option tables yet — click <strong>+ New table</strong>, or restore the default catalog to adopt the shipped set.
            } @else {
              Pick a table above to view and edit it.
            }
          </p>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-dp-menu { position: absolute; z-index: 40; top: calc(100% + 4px); left: 0; right: 0;
      max-height: 320px; overflow-y: auto; border-radius: 14px; padding: 6px;
      background: var(--surface-1, #fff); border: 1px solid var(--border, rgba(127,127,127,.25));
      box-shadow: 0 12px 32px rgba(0,0,0,.25); }
    .pf-dp-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
      padding: 8px 10px; border-radius: 10px; font-size: 13px; color: var(--text, inherit); }
    .pf-dp-item:hover, .pf-dp-item--active { background: var(--surface-2, #f1f5f9); }
    .pf-dp-code { font-family: ui-monospace, monospace; font-size: 10px; color: var(--text-muted);
      padding: 1px 6px; border-radius: 6px; background: var(--surface-2, #f1f5f9); }
    .pf-dp-count { margin-left: auto; font-size: 10px; font-weight: 700; color: var(--text-muted); }
    .pf-dp-empty { padding: 10px 12px; font-size: 12px; color: var(--text-muted); }
  `],
})
export class DepartmentPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly svc = inject(OptionTablesService);
  private readonly toasts = inject(ToastService);
  private readonly dialog = inject(DialogService);

  readonly dept = signal<Department | null>(null);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly creatingNew = signal(false);
  readonly newName = signal('');
  readonly newCode = signal('');

  /** Autocomplete state: free-typed filter + which table is being edited. */
  readonly query = signal('');
  readonly pickerOpen = signal(false);
  readonly activeId = signal<string | null>(null);
  readonly draft = signal<TableDraft | null>(null);

  /** table code (upper) → number of tests referencing it, for the chips. */
  private readonly usageByCode = signal<Record<string, number>>({});
  private deptId = '';

  readonly tablesForDept = computed(() =>
    this.svc.tables()
      .filter(t => t.departmentId === this.deptId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)));

  readonly active = computed(() =>
    this.tablesForDept().find(t => t.id === this.activeId()) ?? null);

  readonly filteredTables = computed(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.tablesForDept();
    if (!q) return all;
    return all.filter(t =>
      t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q));
  });

  async ngOnInit() {
    this.deptId = this.route.snapshot.paramMap.get('id') ?? '';
    try {
      const [depts, tests] = await Promise.all([
        this.api.get<Department[]>('/api/tenants/departments').toPromise(),
        this.api.get<Test[]>('/api/tests').toPromise(),
        this.svc.refresh(),
      ]);
      this.dept.set((depts ?? []).find(d => d.id === this.deptId) ?? null);
      const usage: Record<string, number> = {};
      for (const t of tests ?? []) {
        // Parameters arrives as the raw JSON STRING; re-stringifying it
        // escaped every quote and the regex never matched — plus seeded
        // blobs carry a space after the colon. Scan the raw text,
        // whitespace-tolerant, and count each table once per test.
        const params = (t as unknown as { parameters?: unknown }).parameters;
        const raw = typeof params === 'string' ? params : JSON.stringify(params ?? '');
        const seen = new Set<string>();
        for (const m of raw.matchAll(/"optionTable"\s*:\s*"([^"]+)"/g)) seen.add(m[1].toUpperCase());
        for (const code of seen) usage[code] = (usage[code] ?? 0) + 1;
      }
      this.usageByCode.set(usage);
      // #t-CODE deep link from the test editor selects that table directly;
      // otherwise start on the first table so the page is never empty.
      const frag = (this.route.snapshot.fragment ?? '').replace(/^t-/, '').toUpperCase();
      const initial = this.tablesForDept().find(t => t.code.toUpperCase() === frag)
        ?? this.tablesForDept()[0] ?? null;
      if (initial) this.select(initial);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Picker ──────────────────────────────────────────────

  onQuery(q: string) {
    this.query.set(q);
    this.pickerOpen.set(true);
  }

  /** Blur fires before the option's mousedown without the delay-close. */
  closePickerSoon() {
    setTimeout(() => this.pickerOpen.set(false), 120);
  }

  pick(t: OptionTable) {
    if (this.draft() && this.isDirty(this.draft()!) && t.id !== this.activeId()) {
      void this.confirmDiscardThen(() => this.select(t));
      return;
    }
    this.select(t);
  }

  private async confirmDiscardThen(next: () => void) {
    const ok = await this.dialog.confirm({
      title: 'Discard unsaved changes?',
      message: 'The table you were editing has unsaved edits.',
      tone: 'danger',
    });
    if (ok) next();
    else this.pickerOpen.set(false);
  }

  private select(t: OptionTable) {
    this.activeId.set(t.id);
    this.draft.set(this.toDraft(t));
    this.query.set('');
    this.pickerOpen.set(false);
    this.creatingNew.set(false);
  }

  startNew() {
    this.creatingNew.set(true);
    this.newName.set('');
    this.newCode.set('');
  }

  /** Typing a name proposes the UPPER_SNAKE code automatically. */
  onNewName(name: string) {
    this.newName.set(name);
    this.newCode.set(name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
  }

  // ── Draft editing ───────────────────────────────────────

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

  patch(change: Partial<TableDraft>) {
    this.draft.update(d => (d ? { ...d, ...change } : d));
  }

  patchRow(i: number, change: Partial<OptionRow>) {
    this.draft.update(d => d
      ? { ...d, rows: d.rows.map((r, ix) => (ix === i ? { ...r, ...change } : r)) }
      : d);
  }

  addRow() {
    this.draft.update(d => d ? { ...d, rows: [...d.rows, { value: '', normal: false, active: true }] } : d);
  }

  removeRow(i: number) {
    this.draft.update(d => d ? { ...d, rows: d.rows.filter((_, ix) => ix !== i) } : d);
  }

  move(i: number, delta: -1 | 1) {
    this.draft.update(d => {
      if (!d) return d;
      const rows = d.rows.slice();
      const j = i + delta;
      if (j < 0 || j >= rows.length) return d;
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...d, rows };
    });
  }

  async save() {
    const d = this.draft();
    if (!d || !this.validRows(d)) return;
    this.patch({ saving: true });
    try {
      const saved = await this.svc.update(d.id, { name: d.name.trim(), options: d.rows });
      this.patch({ saving: false, name: saved.name, original: this.fingerprint(saved.name, d.rows) });
      await this.svc.refresh();
      this.toasts.success(`Saved "${saved.name}" — dropdowns update everywhere it's used.`);
    } catch (e) {
      this.patch({ saving: false });
      this.toasts.error((e as ApiError)?.message || 'Could not save the table.');
    }
  }

  async remove() {
    const d = this.draft();
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
      await this.svc.delete(d.id);
      await this.svc.refresh();
      const next = this.tablesForDept()[0] ?? null;
      if (next) this.select(next);
      else { this.activeId.set(null); this.draft.set(null); }
      this.toasts.success('Table deleted.');
    } catch (e) {
      this.toasts.error((e as ApiError)?.message || 'Could not delete the table.');
    }
  }

  async createTable() {
    this.creating.set(true);
    try {
      const created = await this.svc.create({
        code: this.newCode().trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        name: this.newName().trim(),
        departmentId: this.deptId,
        options: [{ value: 'Normal', normal: true, active: true }],
      });
      await this.svc.refresh();
      this.creatingNew.set(false);
      this.select(created);
      this.toasts.success(`Table "${created.name}" added — edit its options below.`);
    } catch (e) {
      this.toasts.error((e as ApiError)?.message || 'Could not create the table.');
    } finally {
      this.creating.set(false);
    }
  }
}
