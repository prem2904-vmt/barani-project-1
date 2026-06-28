import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ApiService } from '../../../core/services/api.service';
import { ReportLayoutService } from '../../../core/services/report-layout.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  COLUMN_TYPE_OPTIONS,
  DEFAULT_RESULT_COLUMNS,
  ReportColumn,
} from '../../../shared/models/report-layout.model';
import { Department } from '../../../shared/models/tenant.model';
import { PfSelectOption, SelectComponent } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

/** Emitted to the parent so the live preview reflects the columns being edited
 *  for the selected department before they're even saved. */
export interface ColumnsEditorState {
  departmentName: string;
  departmentCode: string;
  columns: ReportColumn[];
}

/**
 * Per-DEPARTMENT results-table column editor. Pick a department, edit its
 * columns, save (per-department, via /api/report-layout/department/:id). Each
 * department keeps its own layout, so different departments render with
 * different columns in the report.
 *
 * Two interactions drive the rendered report:
 *   • Drag the ⠿ handle to REORDER columns.
 *   • The 🔗 button LINKS a column with the one after it; consecutive linked
 *     columns MERGE into one report cell (Result + Unit → "11.4 g/dL") and the
 *     group keeps the first column's header. Both linked columns highlight.
 */
@Component({
  selector: 'pf-report-columns-editor',
  standalone: true,
  imports: [SelectComponent, TileComponent, TouchButtonComponent, LoadingLogoComponent, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-tile tone="default" padding="lg" class="block">

      <!-- Department picker + status pill -->
      <div class="flex items-center justify-between flex-wrap gap-3 mb-1">
        <div class="flex items-center gap-3 pf-dept-pick">
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
      <p class="text-[12px] mb-3" style="color: var(--text-tertiary);">
        Drag <span style="opacity:.7">⠿</span> to reorder · tap <span style="color:#c4b5fd">🔗</span> to
        merge a column with the next (e.g. Result + Unit → "11.4&nbsp;g/dL"). This layout applies to every
        test in <strong>{{ selectedDeptName() || 'this department' }}</strong>.
      </p>

      @if (loading()) {
        <div class="flex justify-center py-8">
          <pf-loading-logo size="md" color="purple" [showDna]="true" [showText]="true" text="Loading…"></pf-loading-logo>
        </div>
      } @else if (selectedDeptId()) {

        <div class="pf-cols-header">
          <span style="width: 22px"></span>
          <span class="grow">Column</span>
          <span style="width: 150px">Type</span>
          <span style="width: 70px; text-align: right;">Width %</span>
          <span style="width: 30px; text-align:center">Link</span>
          <span style="width: 26px"></span>
          <span style="width: 26px"></span>
        </div>

        <ul class="pf-cols-list" cdkDropList (cdkDropListDropped)="drop($event)">
          @for (c of columns(); track c.id; let i = $index; let last = $last; let first = $first) {
            <li class="pf-col-row" cdkDrag
                [class.pf-col-row--linked]="c.linkedNext || (!first && columns()[i - 1]?.linkedNext)">
              <button type="button" class="pf-drag-handle" cdkDragHandle aria-label="Drag to reorder" title="Drag to reorder">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>
                  <circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>
                  <circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>
                </svg>
              </button>

              <div class="grow grid gap-1">
                <input type="text" class="pf-input pf-input--compact"
                       [value]="c.label"
                       (input)="onLabelInput(i, $any($event.target).value)"
                       placeholder="Label (Investigation, Result, …)" />
                <input type="text" class="pf-input pf-input--mono"
                       [value]="c.name"
                       (input)="patchCol(i, { name: slugifyName($any($event.target).value) })"
                       placeholder="machine_name" />
              </div>

              <pf-select style="width: 150px" size="sm"
                [options]="typeOptions" [value]="c.type"
                (valueChange)="patchCol(i, { type: $any($event) })">
              </pf-select>

              <input type="number" class="pf-input pf-input--compact pf-input--num" style="width: 70px"
                     [value]="c.width" min="1" max="99"
                     (input)="patchCol(i, { width: clampWidth($any($event.target).value) })" />

              <button type="button" class="pf-icon-btn" [class.pf-icon-btn--on]="c.linkedNext"
                      [disabled]="last"
                      (click)="patchCol(i, { linkedNext: !c.linkedNext })"
                      [attr.aria-label]="c.linkedNext ? 'Unlink from next column' : 'Merge with next column'"
                      [title]="last ? 'Nothing after to link' : (c.linkedNext ? 'Linked — merged with the next column' : 'Merge this column with the next')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>
                </svg>
              </button>

              <button type="button" class="pf-icon-btn" [class.pf-icon-btn--on]="c.locked"
                      (click)="patchCol(i, { locked: !c.locked })"
                      [attr.aria-label]="c.locked ? 'Unlock column' : 'Lock column'"
                      [title]="c.locked ? 'Locked — uses fixed value' : 'Lock to a fixed value for all rows'">
                @if (c.locked) {
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>
                  </svg>
                } @else {
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0"/>
                  </svg>
                }
              </button>

              <button type="button" class="pf-icon-btn pf-icon-btn--danger"
                      (click)="removeCol(i)" aria-label="Delete column" [disabled]="columns().length <= 1">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </button>

              @if (c.linkedNext && !last) {
                <div class="pf-col-row__merge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#c4b5fd">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>
                  </svg>
                  Merged into one cell with <strong>{{ columns()[i + 1]?.label || 'next column' }}</strong>
                </div>
              }

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

        <div class="flex items-center justify-between gap-3 mt-4 flex-wrap">
          <button type="button" class="pf-link-btn" (click)="addColumn()">+ Add column</button>
          <div class="flex items-center gap-3">
            <span class="text-[12px]" [style.color]="totalOk() ? '#10b981' : '#f87171'">
              Total: <strong>{{ totalWidth() }}%</strong>@if (!totalOk()) { · must be 100 }
            </span>
            <pf-touch-btn size="sm" variant="secondary" (pressed)="resetToDefaults()">Reset</pf-touch-btn>
            <pf-touch-btn size="sm" variant="secondary"
                          [disabled]="!totalOk() || applyingAll()" (pressed)="applyToAll()">
              @if (applyingAll()) { Applying… } @else { Apply to all departments }
            </pf-touch-btn>
            <pf-touch-btn size="sm" variant="primary" [disabled]="!totalOk() || saving()" (pressed)="save()">
              @if (saving()) { Saving… } @else { Save columns }
            </pf-touch-btn>
          </div>
        </div>
      } @else {
        <p class="text-center py-6 text-[13px]" style="color: var(--text-tertiary);">Select a department to start.</p>
      }
    </pf-tile>
  `,
  styles: [`
    .pf-input--compact { padding: 6px 10px; font-size: 12.5px; }
    .pf-input--mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11px; }
    .pf-input--num { text-align: right; font-family: 'JetBrains Mono', ui-monospace, monospace; }

    .pf-status-pill { display: inline-flex; align-items: center; padding: 4px 10px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; border-radius: 9999px; border: 1px solid var(--glass-border); }
    .pf-status-pill--ok { background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.4); color: #34d399; }
    .pf-status-pill--default { background: rgba(245, 158, 11, 0.10); border-color: rgba(245, 158, 11, 0.32); color: #fbbf24; }

    .pf-cols-header { display: flex; align-items: center; gap: 10px; padding: 0 8px 8px; font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px dashed var(--glass-border); margin-bottom: 8px; }
    .pf-cols-header > .grow { flex: 1; }

    .pf-cols-list { display: flex; flex-direction: column; gap: 8px; list-style: none; padding: 0; margin: 0; }
    .pf-col-row { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 10px 8px; background: var(--glass-bg); border: 1px solid var(--glass-border); border-radius: 12px; }
    .pf-col-row--linked { border-color: rgba(168, 85, 247, 0.55); background: rgba(168, 85, 247, 0.06); }
    .pf-col-row > .grow { flex: 1; min-width: 200px; }
    .pf-col-row__lockval, .pf-col-row__merge { flex-basis: 100%; display: flex; align-items: center; gap: 8px; }
    .pf-col-row__lockval { padding-top: 8px; border-top: 1px dashed var(--glass-border); }
    .pf-col-row__lockval > .grow { flex: 1; }
    .pf-col-row__merge { font-size: 11.5px; color: var(--text-tertiary); padding-top: 4px; }
    .pf-col-row__merge strong { color: #c4b5fd; font-weight: 600; }

    .cdk-drag-preview { box-shadow: 0 10px 30px rgba(0,0,0,0.45); border-radius: 12px; background: var(--bg-elevated, #1a1a24); }
    .cdk-drag-placeholder { opacity: 0.4; }
    .cdk-drag-animating { transition: transform 180ms cubic-bezier(0,0,0.2,1); }
    .pf-cols-list.cdk-drop-list-dragging .pf-col-row:not(.cdk-drag-placeholder) { transition: transform 180ms cubic-bezier(0,0,0.2,1); }
    .pf-drag-handle { width: 22px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 0; color: var(--text-muted); cursor: grab; }
    .pf-drag-handle:active { cursor: grabbing; }

    .pf-icon-btn { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--glass-border); border-radius: 8px; color: var(--text-muted); cursor: pointer; transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease; }
    .pf-icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); border-color: rgba(168, 85, 247, 0.4); }
    .pf-icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }
    .pf-icon-btn--on { background: rgba(168, 85, 247, 0.16); color: #c4b5fd; border-color: rgba(168, 85, 247, 0.5); }
    .pf-icon-btn--danger:hover:not(:disabled) { color: #f87171; border-color: rgba(244, 63, 94, 0.5); }
    .pf-link-btn { background: transparent; border: 0; padding: 6px 10px; font-size: 12.5px; font-weight: 600; color: #c4b5fd; cursor: pointer; border-radius: 8px; }

    @media (hover: hover) { .pf-link-btn:hover { background: rgba(168, 85, 247, 0.1); } }
    @media (pointer: coarse) {
      .pf-icon-btn { width: 36px; height: 36px; min-width: 44px; min-height: 44px; }
      .pf-drag-handle { width: 44px; height: 44px; }
      .pf-link-btn { min-height: 44px; display: inline-flex; align-items: center; }
    }
    @media (max-width: 640px) {
      .pf-cols-header { display: none; }
      :host ::ng-deep .pf-col-row pf-select { width: 100% !important; }
      :host ::ng-deep .pf-dept-pick pf-select { width: 100% !important; }
      .pf-dept-pick { flex: 1 1 100%; }
    }
  `]
})
export class ReportColumnsEditorComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly layout = inject(ReportLayoutService);
  private readonly toasts = inject(ToastService);

  /** Emits the live columns + which department they belong to, so the parent's
   *  preview can apply them to that department's sample tests immediately. */
  readonly stateChange = output<ColumnsEditorState>();

  protected readonly typeOptions = COLUMN_TYPE_OPTIONS;
  protected readonly departments = signal<Department[]>([]);
  protected readonly selectedDeptId = signal<string>('');
  protected readonly columns = signal<ReportColumn[]>([]);
  protected readonly configured = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly applyingAll = signal(false);

  protected readonly totalWidth = computed(() =>
    this.columns().reduce((s, c) => s + (Number(c.width) || 0), 0)
  );
  protected readonly totalOk = computed(() => Math.abs(this.totalWidth() - 100) < 0.5);

  private selectedDept?: Department;
  selectedDeptName(): string { return this.selectedDept?.name ?? ''; }

  ngOnInit() {
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: list => {
        const depts = this.dedupeByCode(list ?? []);
        this.departments.set(depts);
        if (depts.length > 0 && !this.selectedDeptId()) this.selectDepartment(depts[0].id);
      },
      error: () => this.toasts.error('Failed to load departments')
    });
  }

  /** Departments come one-per-branch; collapse to one entry per code. */
  private dedupeByCode(list: Department[]): Department[] {
    const byKey = new Map<string, Department>();
    for (const d of list) {
      const key = (d.code?.trim() || d.name?.trim() || d.id).toUpperCase();
      const existing = byKey.get(key);
      if (!existing) { byKey.set(key, d); continue; }
      if (existing.branchId && !d.branchId) byKey.set(key, d);
    }
    return [...byKey.values()];
  }

  deptOptions(): PfSelectOption[] {
    return this.departments().map(d => ({ value: d.id, label: d.name + (d.code ? ' · ' + d.code : '') }));
  }

  selectDepartment(deptId: string) {
    if (!deptId) { this.selectedDeptId.set(''); return; }
    this.selectedDeptId.set(deptId);
    this.selectedDept = this.departments().find(d => d.id === deptId);
    this.loading.set(true);
    this.layout.getDeptColumns(deptId).then(res => {
      const sorted = [...res.columns]
        .sort((a, b) => a.order - b.order)
        .map(c => ({ ...c, label: c.label ?? '', name: c.name && c.name.trim() ? c.name : this.slugifyName(c.label ?? '') }));
      this.columns.set(this.applyDefaultResultUnitLink(this.ensureNameColumn(sorted)));
      this.configured.set(res.configured);
      this.loading.set(false);
      this.emitState();
    }).catch(() => {
      this.columns.set(DEFAULT_RESULT_COLUMNS.map(c => ({ ...c })));
      this.configured.set(false);
      this.loading.set(false);
      this.toasts.error('Failed to load columns; showing defaults');
      this.emitState();
    });
  }

  /** When a loaded config has NO merges yet, merge an adjacent Result→Unit by
   *  default so every department shows the unit beside the value ("11.4 g/dL").
   *  Once any link exists the admin's exact choices are kept. */
  private applyDefaultResultUnitLink(cols: ReportColumn[]): ReportColumn[] {
    if (cols.some(c => c.linkedNext)) return cols;
    const ri = cols.findIndex(c => c.type === 'result');
    if (ri >= 0 && cols[ri + 1]?.type === 'unit') {
      return cols.map((c, i) => (i === ri ? { ...c, linkedNext: true } : c));
    }
    return cols;
  }

  /** Guarantee an Investigation (parameter-name) column so the param name shows.
   *  If a loaded config lacks one, prepend it and rescale widths back to 100. */
  private ensureNameColumn(cols: ReportColumn[]): ReportColumn[] {
    if (cols.some(c => c.type === 'name')) return this.normalizeTo100(cols);
    const nameCol: ReportColumn = { id: 'rc-name', name: 'name', label: 'Investigation', order: 0, width: 30, type: 'name', locked: false };
    return this.normalizeTo100([nameCol, ...cols]);
  }

  /** Scale widths so they sum to 100 (backend requires it on save). */
  private normalizeTo100(cols: ReportColumn[]): ReportColumn[] {
    if (cols.length === 0) return cols;
    const sum = cols.reduce((s, c) => s + (Number(c.width) || 0), 0);
    const scaled = cols.map(c => ({ ...c, width: sum > 0 ? Math.round((Number(c.width) || 0) / sum * 100) : Math.round(100 / cols.length) }));
    const diff = 100 - scaled.reduce((s, c) => s + c.width, 0);
    if (diff !== 0) scaled[scaled.length - 1].width += diff;
    return scaled;
  }

  private setCols(cols: ReportColumn[]) {
    const reindexed = cols.map((c, i) => ({ ...c, order: i + 1 }));
    this.columns.set(reindexed);
    this.emitState();
  }

  private emitState() {
    this.stateChange.emit({
      departmentName: this.selectedDept?.name ?? '',
      departmentCode: this.selectedDept?.code ?? '',
      columns: this.columns(),
    });
  }

  patchCol(i: number, patch: Partial<ReportColumn>) {
    this.setCols(this.columns().map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  onLabelInput(i: number, label: string) {
    const cur = this.columns()[i];
    const prevDerived = this.slugifyName(cur.label ?? '');
    const patch: Partial<ReportColumn> = { label };
    if (!cur.name || cur.name === prevDerived) patch.name = this.slugifyName(label);
    this.patchCol(i, patch);
  }

  slugifyName(raw: string): string {
    if (!raw) return '';
    return raw.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  clampWidth(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(1, Math.min(99, Math.round(n)));
  }

  drop(event: CdkDragDrop<ReportColumn[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const next = this.columns().slice();
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.setCols(next);
  }

  addColumn() {
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : `c-${Date.now()}`;
    const existing = new Set(this.columns().map(c => c.name));
    let name = 'new_column';
    let suffix = 2;
    while (existing.has(name)) name = `new_column_${suffix++}`;
    const newCol: ReportColumn = { id, name, label: 'New column', order: this.columns().length + 1, width: 10, type: 'text', locked: false, lockedValue: null };
    this.setCols(this.normalizeTo100([...this.columns(), newCol]));
  }

  removeCol(i: number) {
    if (this.columns().length <= 1) return;
    this.setCols(this.normalizeTo100(this.columns().filter((_, idx) => idx !== i)));
  }

  resetToDefaults() {
    this.setCols(DEFAULT_RESULT_COLUMNS.map(c => ({ ...c })));
  }

  /** Save the current column layout to EVERY department, so the same mapping
   *  (e.g. Result + Unit merged) is present across all departments. */
  async applyToAll() {
    if (!this.totalOk()) { this.toasts.error(`Column widths must sum to 100 (got ${this.totalWidth()})`); return; }
    const depts = this.departments();
    if (depts.length === 0) return;
    this.applyingAll.set(true);
    const cols = this.columns().map((c, i) => ({ ...c, order: i + 1 }));
    let ok = 0;
    for (const d of depts) {
      try { await this.layout.saveDeptColumns(d.id, cols); ok++; } catch { /* keep going */ }
    }
    this.applyingAll.set(false);
    if (ok === depts.length) this.toasts.success(`Applied to all ${ok} departments`);
    else this.toasts.error(`Applied to ${ok} of ${depts.length} departments`);
    this.configured.set(true);
  }

  async save() {
    const deptId = this.selectedDeptId();
    if (!deptId) return;
    if (!this.totalOk()) { this.toasts.error(`Column widths must sum to 100 (got ${this.totalWidth()})`); return; }
    this.saving.set(true);
    try {
      await this.layout.saveDeptColumns(deptId, this.columns().map((c, i) => ({ ...c, order: i + 1 })));
      this.configured.set(true);
      this.toasts.success('Column structure saved');
    } catch (e: unknown) {
      this.toasts.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      this.saving.set(false);
    }
  }
}
