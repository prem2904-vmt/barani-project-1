import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  COLUMN_TYPE_OPTIONS,
  DEFAULT_REPORT_COLUMNS,
  ReportColumn,
  ReportColumnType,
} from '../../../shared/models/report-layout.model';
import { Department } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { ToggleComponent } from '../../../shared/primitives/toggle.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

/**
 * Per-department column structure editor. Lives inside the Report Template
 * tile as a new "Columns" tab. Admin picks a department, edits the column
 * row (label / type / width / lock), reorders via up-down chevrons, saves.
 *
 * Width auto-redistribution: when a column is added or removed, weights are
 * normalized so the total stays at 100. The save button is disabled until
 * total === 100 to match the backend's validation.
 */
@Component({
  selector: 'pf-report-columns-editor',
  standalone: true,
  imports: [SelectComponent, TileComponent, ToggleComponent, TouchButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-tile tone="default" padding="lg" class="block">

      <!-- Department picker + status pill -->
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="flex items-center gap-3">
          <label class="text-[11px] font-mono uppercase tracking-[0.16em]"
                 style="color: var(--text-muted);">Department</label>
          <pf-select
            style="width: 220px"
            [options]="deptOptions()"
            [value]="selectedDeptId()"
            [placeholder]="departments().length === 0 ? 'Loading…' : 'Select department'"
            (valueChange)="selectDepartment($event)">
          </pf-select>
        </div>

        @if (configured()) {
          <span class="pf-status-pill pf-status-pill--ok">Configured</span>
        } @else {
          <span class="pf-status-pill pf-status-pill--default">Defaults — not yet saved</span>
        }
      </div>

      @if (loading()) {
        <p class="text-center py-8 text-[13px]" style="color: var(--text-tertiary);">Loading…</p>
      } @else if (selectedDeptId()) {
        <!-- Column rows -->
        <div class="pf-cols-header">
          <span style="width: 26px"></span>
          <span class="grow">Column</span>
          <span style="width: 150px">Type</span>
          <span style="width: 80px; text-align: right;">Width %</span>
          <span style="width: 28px"></span>
          <span style="width: 28px"></span>
        </div>

        <ul class="pf-cols-list">
          @for (c of columns(); track c.id; let i = $index) {
            <li class="pf-col-row">
              <!-- Reorder chevrons -->
              <div class="pf-col-row__reorder">
                <button type="button" class="pf-icon-btn"
                        [disabled]="i === 0"
                        (click)="moveUp(i)" aria-label="Move up">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m18 15-6-6-6 6"/>
                  </svg>
                </button>
                <button type="button" class="pf-icon-btn"
                        [disabled]="i === columns().length - 1"
                        (click)="moveDown(i)" aria-label="Move down">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m6 9 6 6 6-6"/>
                  </svg>
                </button>
              </div>

              <!-- Label + machine name. Both inputs coerce to '' so a column
                   with an undefined name (e.g. loaded from a legacy / corrupted
                   row) doesn't render the literal string "undefined". When
                   admin types in the label and the machine name is empty, we
                   auto-derive a sensible default (lowercase + underscores). -->
              <div class="grow grid gap-1">
                <input type="text" class="pf-input pf-input--compact"
                       [value]="c.label ?? ''"
                       (input)="onLabelInput(i, $any($event.target).value)"
                       placeholder="Label (Specimen, Result, …)" />
                <input type="text" class="pf-input pf-input--mono"
                       [value]="c.name ?? ''"
                       (input)="patchCol(i, { name: slugifyName($any($event.target).value) })"
                       placeholder="machine_name" />
              </div>

              <!-- Type -->
              <pf-select
                style="width: 150px"
                size="sm"
                [options]="typeOptions"
                [value]="c.type"
                (valueChange)="patchCol(i, { type: $any($event) })">
              </pf-select>

              <!-- Width -->
              <input type="number" class="pf-input pf-input--compact pf-input--num" style="width: 80px"
                     [value]="c.width" min="1" max="99"
                     (input)="patchCol(i, { width: clampWidth($any($event.target).value) })" />

              <!-- Lock toggle -->
              <button type="button" class="pf-icon-btn"
                      [class.pf-icon-btn--on]="c.locked"
                      (click)="patchCol(i, { locked: !c.locked })"
                      [attr.aria-label]="c.locked ? 'Unlock column' : 'Lock column'"
                      [title]="c.locked ? 'Locked — uses fixed value' : 'Lock to a fixed value for all rows'">
                @if (c.locked) {
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2"/>
                    <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                  </svg>
                } @else {
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2"/>
                    <path d="M8 11V7a4 4 0 0 1 8 0"/>
                  </svg>
                }
              </button>

              <!-- Delete -->
              <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                      (click)="removeCol(i)" aria-label="Delete column"
                      [disabled]="columns().length <= 1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>

              <!-- Locked-value row (only when locked) -->
              @if (c.locked) {
                <div class="pf-col-row__lockval">
                  <span class="text-[10.5px] font-mono uppercase tracking-[0.16em]"
                        style="color: var(--text-muted);">Locked value</span>
                  <input type="text" class="pf-input pf-input--compact grow"
                         [value]="c.lockedValue ?? ''"
                         (input)="patchCol(i, { lockedValue: $any($event.target).value })"
                         placeholder="e.g. Blood - EDTA" />
                </div>
              }
            </li>
          }
        </ul>

        <!-- Footer: total + add + save -->
        <div class="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <button type="button" class="pf-link-btn" (click)="addColumn()">
            + Add column
          </button>

          <div class="flex items-center gap-3">
            <span class="text-[12px]" [style.color]="totalOk() ? '#10b981' : '#f87171'">
              Total: <strong>{{ totalWidth() }}%</strong>
              @if (!totalOk()) { · must be 100 }
            </span>
            <pf-touch-btn size="sm" variant="secondary" (pressed)="resetToDefaults()">
              Reset
            </pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary"
                          [disabled]="!totalOk() || saving()"
                          (pressed)="save()">
              @if (saving()) { Saving… } @else { Save columns }
            </pf-touch-btn>
          </div>
        </div>
      } @else {
        <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">
          Select a department to start.
        </p>
      }

    </pf-tile>
  `,
  styles: [`
    /* Re-use the global .pf-input from styles.scss but tighten when needed. */
    .pf-input--inline { width: 240px; }
    .pf-input--compact { padding: 6px 10px; font-size: 12.5px; }
    .pf-input--mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
    .pf-input--num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; }

    .pf-status-pill {
      display: inline-flex; align-items: center;
      padding: 4px 10px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.14em; text-transform: uppercase;
      border-radius: 9999px;
      border: 1px solid var(--glass-border);
    }
    .pf-status-pill--ok {
      background: rgba(16, 185, 129, 0.14);
      border-color: rgba(16, 185, 129, 0.4);
      color: #34d399;
    }
    .pf-status-pill--default {
      background: rgba(245, 158, 11, 0.10);
      border-color: rgba(245, 158, 11, 0.32);
      color: #fbbf24;
    }

    .pf-cols-header {
      display: flex; align-items: center; gap: 10px;
      padding: 0 8px 8px;
      font-size: 10.5px; font-weight: 700;
      letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--text-muted);
      border-bottom: 1px dashed var(--glass-border);
      margin-bottom: 8px;
    }
    .pf-cols-header > .grow { flex: 1; }

    .pf-cols-list {
      display: flex; flex-direction: column; gap: 8px;
      list-style: none; padding: 0; margin: 0;
    }
    .pf-col-row {
      display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px;
      padding: 10px 8px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
    }
    .pf-col-row > .grow { flex: 1; min-width: 200px; }
    .pf-col-row__reorder { display: inline-flex; flex-direction: column; gap: 2px; }
    .pf-col-row__lockval {
      flex-basis: 100%;
      display: flex; align-items: center; gap: 10px;
      padding-top: 8px;
      border-top: 1px dashed var(--glass-border);
    }
    .pf-col-row__lockval > .grow { flex: 1; }

    .pf-icon-btn {
      width: 26px; height: 26px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent;
      border: 1px solid var(--glass-border);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }
    .pf-icon-btn:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: rgba(168, 85, 247, 0.4);
    }
    .pf-icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .pf-icon-btn--on {
      background: rgba(168, 85, 247, 0.16);
      color: #c4b5fd;
      border-color: rgba(168, 85, 247, 0.5);
    }
    .pf-icon-btn--danger:hover:not(:disabled) {
      color: #f87171;
      border-color: rgba(244, 63, 94, 0.5);
    }
    .pf-link-btn {
      background: transparent;
      border: 0;
      padding: 6px 10px;
      font-size: 12.5px; font-weight: 600;
      color: #c4b5fd;
      cursor: pointer;
      border-radius: 8px;
    }
    .pf-link-btn:hover { background: rgba(168, 85, 247, 0.1); }
  `]
})
export class ReportColumnsEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  protected readonly typeOptions = COLUMN_TYPE_OPTIONS;

  deptOptions(): PfSelectOption[] {
    return this.departments().map(d => ({
      value: d.id,
      label: d.name + (d.code ? ' · ' + d.code : '')
    }));
  }

  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptId = signal<string>('');
  protected readonly columns = signal<ReportColumn[]>([]);
  protected readonly configured = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);

  protected readonly totalWidth = computed(() =>
    this.columns().reduce((s, c) => s + (Number(c.width) || 0), 0)
  );
  protected readonly totalOk = computed(() => Math.abs(this.totalWidth() - 100) < 0.5);

  // Public read-only accessor so the parent template ref (e.g. `#colsEditor`)
  // can drive its right-side preview panel from the columns being edited.
  readonly columnsSnapshot = this.columns.asReadonly();

  ngOnInit() {
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => {
        const depts = list ?? [];
        this.departments.set(depts);
        if (depts.length > 0 && !this.selectedDeptId()) {
          this.selectDepartment(depts[0].id);
        }
      },
      error: () => this.toasts.error('Failed to load departments')
    });
  }

  selectDepartment(deptId: string) {
    if (!deptId) { this.selectedDeptId.set(''); return; }
    this.selectedDeptId.set(deptId);
    this.loading.set(true);
    this.layout.getDeptColumns(deptId).then(res => {
      // Rescue legacy / partially-populated rows: if a column came back
      // missing `name` or `label`, derive sensible defaults so the UI never
      // renders the literal string "undefined" or saves nullish names.
      const sorted = [...res.columns]
        .sort((a, b) => a.order - b.order)
        .map(c => ({
          ...c,
          label: c.label ?? '',
          name: c.name && c.name.trim() !== '' ? c.name : this.slugifyName(c.label ?? '')
        }));
      this.columns.set(sorted);
      this.configured.set(res.configured);
      this.loading.set(false);
    }).catch(() => {
      this.columns.set([...DEFAULT_REPORT_COLUMNS]);
      this.configured.set(false);
      this.loading.set(false);
      this.toasts.error('Failed to load columns; showing defaults');
    });
  }

  patchCol(i: number, patch: Partial<ReportColumn>) {
    this.columns.update(cols => {
      const next = [...cols];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  /** Label input handler: also auto-derives the machine name when it's empty
   *  or matches the previously-derived form, so admins don't have to fill in
   *  the second box for the common case. Once they hand-type a custom name
   *  it sticks (we detect this by storing the previous derived label hash). */
  onLabelInput(i: number, label: string) {
    const cols = this.columns();
    const cur = cols[i];
    const prevDerived = this.slugifyName(cur.label ?? '');
    const patch: Partial<ReportColumn> = { label };
    if (!cur.name || cur.name === prevDerived) {
      patch.name = this.slugifyName(label);
    }
    this.patchCol(i, patch);
  }

  /** Lowercase + collapse non-alnum to underscore, trim leading/trailing _.
   *  Empty input becomes ''. Used both as the auto-derive and as a sanitiser
   *  on the machine-name input itself. */
  slugifyName(raw: string): string {
    if (!raw) return '';
    return raw.toString().trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  clampWidth(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(1, Math.min(99, Math.round(n)));
  }

  moveUp(i: number) {
    if (i === 0) return;
    this.columns.update(cols => {
      const next = [...cols];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return this.reindex(next);
    });
  }
  moveDown(i: number) {
    this.columns.update(cols => {
      if (i === cols.length - 1) return cols;
      const next = [...cols];
      [next[i], next[i + 1]] = [next[i + 1], next[i]];
      return this.reindex(next);
    });
  }

  addColumn() {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID() : `c-${Date.now()}`;
    // Build a name that's guaranteed unique against the existing
    // columns. Cells are keyed by `name`, so a duplicate would
    // collapse multiple cells onto the same entry — typing in one
    // cell would propagate to the others. (See test-layout-editor.)
    const existing = new Set(this.columns().map(c => c.name));
    let name = 'new_column';
    let suffix = 2;
    while (existing.has(name)) {
      name = `new_column_${suffix++}`;
    }
    const newCol: ReportColumn = {
      id, name, label: 'New column',
      order: this.columns().length + 1, width: 10,
      type: 'text', locked: false, lockedValue: null
    };
    this.columns.update(cols => this.redistribute([...cols, newCol]));
  }

  removeCol(i: number) {
    if (this.columns().length <= 1) return;
    this.columns.update(cols => this.redistribute(cols.filter((_, idx) => idx !== i)));
  }

  resetToDefaults() {
    this.columns.set(DEFAULT_REPORT_COLUMNS.map((c, i) => ({ ...c, order: i + 1 })));
  }

  async save() {
    const deptId = this.selectedDeptId();
    if (!deptId) return;
    if (!this.totalOk()) {
      this.toasts.error(`Column widths must sum to 100 (got ${this.totalWidth()})`);
      return;
    }
    this.saving.set(true);
    try {
      const payload = this.reindex(this.columns());
      await this.layout.saveDeptColumns(deptId, payload);
      this.configured.set(true);
      this.toasts.success('Column structure saved');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      this.toasts.error(msg);
    } finally {
      this.saving.set(false);
    }
  }

  private reindex(cols: ReportColumn[]): ReportColumn[] {
    return cols.map((c, i) => ({ ...c, order: i + 1 }));
  }

  /** Even-redistribute to keep total at 100 after add/remove. Rounds to ints
   *  and stuffs the rounding error into the last column. */
  private redistribute(cols: ReportColumn[]): ReportColumn[] {
    if (cols.length === 0) return cols;
    const reindexed = this.reindex(cols);
    const each = Math.floor(100 / reindexed.length);
    const remainder = 100 - each * reindexed.length;
    return reindexed.map((c, i) => ({
      ...c,
      width: i === reindexed.length - 1 ? each + remainder : each
    }));
  }
}
