import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import {
  AllCommunityModule, ModuleRegistry, type CellClickedEvent, type CellValueChangedEvent, type ColDef, type GridApi, type GridReadyEvent,
} from 'ag-grid-community';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { heldFlag } from '../../../shared/utils/min-duration';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { FORMS } from '../shared/rx-schedule';
import type { DrugForm, DrugSchedule } from '../shared/opd.models';
import { PharmacyApi, type DrugEdit, type PharmacyDrugRow } from './pharmacy.api';
import { errText, inr, scheduleLabel } from './pharmacy-math';

ModuleRegistry.registerModules([AllCommunityModule]);

export const SCHEDULES: DrugSchedule[] = ['none', 'G', 'H', 'H1', 'X'];
export const GST_SLABS = [0, 5, 12, 18, 28];
const EDITABLE: (keyof DrugEdit)[] = ['name', 'generic', 'strength', 'form', 'unit', 'packSize', 'schedule', 'hsnCode', 'taxSlab', 'defaultMrp', 'isActive'];

/** Grid row: a drug plus a client key (new rows have no server id yet). */
export interface DrugGridRow extends PharmacyDrugRow { key: string; isNew?: boolean }

/** The batch-save payload for the dirty rows: only the changed fields; new rows
 *  carry no id (a tenant-local drug); a master row's edit becomes the tenant's
 *  override on the server (copy-on-write). */
export function buildDrugEdits(dirty: Map<string, Partial<DrugGridRow>>, rows: DrugGridRow[]): DrugEdit[] {
  const out: DrugEdit[] = [];
  for (const [key, changes] of dirty) {
    const row = rows.find(r => r.key === key);
    if (!row) continue;
    const e: DrugEdit = { id: row.isNew ? null : row.id };
    for (const f of EDITABLE) if (f in changes) (e as Record<string, unknown>)[f] = (changes as Record<string, unknown>)[f];
    if (row.isNew) { e.name = row.name; e.generic = row.generic ?? undefined; e.form = row.form; e.schedule = row.schedule; e.taxSlab = row.taxSlab; }
    out.push(e);
  }
  return out;
}

export function originWord(o: PharmacyDrugRow['origin'] | undefined, isNew?: boolean): string {
  return isNew ? 'New' : o === 'override' ? 'Changed here' : o === 'local' ? 'Your drug' : 'Master';
}

/**
 * The drug master grid (copy-on-write over the Prefrontal master) — AG-Grid
 * like the Test Master: double-click to edit, edits collect and save
 * together, "Revert" drops this lab's change to a master drug, "Add drug"
 * creates a lab-only drug. Rows are never deleted (stock, bills and the H1
 * register point at them): switch a drug off instead.
 *
 * Embeddable: the host owns the band (Save = the ONE primary) and calls
 * `save()` / `discard()`; `dirtyCount()` drives it. With `[inlineActions]`
 * the card header carries its own (secondary) Save / Discard instead.
 */
@Component({
  selector: 'pf-pharmacy-drug-master',
  standalone: true,
  imports: [AgGridAngular, SkeletonTableComponent, BusyDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="nd-card" style="height:100%" aria-labelledby="ph-dm-t">
      <header class="nd-card__head">
        <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg></span>
        <span class="nd-card__label" id="ph-dm-t">Drug master</span>
        <label class="ph-add__box" style="height:36px;flex:1 1 220px;max-width:340px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ph-muted"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="search" placeholder="Search — generic, brand, HSN" aria-label="Search drugs" [value]="q()" (input)="q.set($any($event.target).value)" />
        </label>
        <span style="display:inline-flex;align-items:center;gap:8px">
          <span class="ph-sub" id="ph-dm-inact">Show off</span>
          <button type="button" class="nd-toggle" role="switch" [attr.aria-checked]="showInactive()" aria-labelledby="ph-dm-inact" (click)="showInactive.set(!showInactive())"><span class="nd-toggle__track"><span class="nd-toggle__knob"></span></span></button>
        </span>
        <span class="nd-card__spacer"></span>
        <span class="ph-sub nd-num">{{ rows().length }} drugs · double-click a cell to edit</span>
        <button type="button" class="nd-btn nd-btn--secondary" style="height:36px" (click)="addDrug()">Add drug</button>
        @if (inlineActions() && dirtyCount()) {
          <button type="button" class="nd-btn nd-btn--tertiary" (click)="discard()">Discard</button>
          <button type="button" class="nd-btn nd-btn--secondary" style="height:36px" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="save()">Save ({{ dirtyCount() }})</button>
        }
      </header>
      <div class="nd-card__body ph-card-body--flush" style="position:relative">
        @if (showSkeleton()) { <pf-skeleton-table [rows]="10" [cols]="8"></pf-skeleton-table> }
        <ag-grid-angular class="ph-grid" style="height:100%" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="cols"
                         [getRowId]="rowId" [stopEditingWhenCellsLoseFocus]="true" [animateRows]="true"
                         (gridReady)="ready($event)" (cellValueChanged)="edited($event)" (cellClicked)="clicked($event)"></ag-grid-angular>
      </div>
      <p class="ph-sub" style="margin:0;padding:8px 14px;border-top:1px solid var(--nd-line)">One shared Prefrontal drug master, referenced by every clinic — a change here is kept as this lab's own version; the master is never copied. MRP includes GST.</p>
    </section>
  `,
})
export class PharmacyDrugMasterComponent {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly theme = inject(ThemeService);

  /** Render Save / Discard in the card header (when the host has no band). */
  readonly inlineActions = input(false);

  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly q = signal('');
  protected readonly showInactive = signal(false);
  private readonly all = signal<DrugGridRow[]>([]);
  private readonly loading = signal(true);
  protected readonly showSkeleton = heldFlag(this.loading);
  private readonly dirty = signal<Map<string, Partial<DrugGridRow>>>(new Map());
  readonly dirtyCount = computed(() => this.dirty().size);
  readonly saving = signal(false);
  private grid: GridApi<DrugGridRow> | null = null;
  private seq = 0;

  protected readonly rows = computed(() => {
    const t = this.q().trim().toLowerCase();
    return this.all().filter(r => (this.showInactive() || r.isActive || r.isNew)
      && (!t || r.isNew || [r.name, r.generic, r.strength, r.hsnCode, ...(r.aliases ?? [])].filter(Boolean).join(' ').toLowerCase().includes(t)));
  });
  protected readonly rowId = (p: { data: DrugGridRow }) => p.data.key;

  protected readonly cols: ColDef<DrugGridRow>[] = [
    { field: 'generic', headerName: 'Generic', flex: 2, minWidth: 220, editable: true, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'name', headerName: 'Brand', flex: 1.4, minWidth: 160, editable: true, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'strength', headerName: 'Strength', width: 100, editable: true },
    { field: 'form', headerName: 'Form', width: 110, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: Object.keys(FORMS) } },
    { field: 'schedule', headerName: 'Schedule', width: 110, editable: true, cellEditor: 'agSelectCellEditor', cellEditorParams: { values: SCHEDULES }, valueFormatter: p => scheduleLabel(p.value) },
    { field: 'hsnCode', headerName: 'HSN', width: 84, editable: true },
    { field: 'taxSlab', headerName: 'GST', width: 85, editable: true, type: 'rightAligned', cellEditor: 'agSelectCellEditor', cellEditorParams: { values: GST_SLABS }, valueFormatter: p => `${p.value ?? 0}%` },
    { field: 'defaultMrp', headerName: 'MRP', width: 100, editable: true, type: 'rightAligned', cellEditor: 'agNumberCellEditor', cellEditorParams: { min: 0, precision: 2 }, valueFormatter: p => (p.value == null ? '' : inr(p.value)) },
    { field: 'unit', headerName: 'Per', width: 85, editable: true },
    { field: 'onHand', headerName: 'In stock', width: 100, type: 'rightAligned', valueFormatter: p => (p.value ? String(p.value) : '') },
    { field: 'isActive', headerName: 'On', width: 75, editable: true, cellEditor: 'agCheckboxCellEditor', cellRenderer: 'agCheckboxCellRenderer' },
    {
      colId: 'origin', headerName: 'Source', width: 190, sortable: false,
      valueGetter: p => originWord(p.data?.origin, p.data?.isNew),
      cellRenderer: (p: { data?: DrugGridRow; value: string }) =>
        p.data?.origin === 'override' && !p.data.isNew
          ? `<span style="color:var(--text-tertiary);font-size:12px">${p.value}</span> <button type="button" class="nd-btn nd-btn--tertiary" data-act="revert" style="height:28px">Revert</button>`
          : `<span style="color:var(--text-tertiary);font-size:12px">${p.value}</span>`,
    },
  ];

  constructor() { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.drugMaster().subscribe({
      next: r => { this.all.set(r.map(d => ({ ...d, key: d.id }))); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toast.error(errText(e)); },
    });
  }
  protected ready(e: GridReadyEvent<DrugGridRow>) { this.grid = e.api; }

  protected edited(e: CellValueChangedEvent<DrugGridRow>) {
    const key = e.data?.key, field = e.colDef.field as keyof DrugGridRow | undefined;
    if (!key || !field) return;
    this.all.update(a => a.map(r => (r.key === key ? { ...r, [field]: e.newValue } : r)));
    this.dirty.update(m => new Map(m).set(key, { ...(m.get(key) ?? {}), [field]: e.newValue }));
  }

  protected async clicked(e: CellClickedEvent<DrugGridRow>) {
    const target = e.event?.target as HTMLElement | null;
    if (e.column.getColId() !== 'origin' || target?.getAttribute('data-act') !== 'revert' || !e.data) return;
    const d = e.data;
    const ok = await this.dialog.confirm({ title: `Revert ${d.name}?`, message: 'This lab’s changes to this drug are dropped and the Prefrontal master shows again. Stock is kept.', confirmLabel: 'Revert', tone: 'danger' });
    if (!ok) return;
    this.api.saveDrugMaster([{ id: d.id, revert: true }]).subscribe({
      next: () => { this.toast.success(`${d.name} reverted to the master`); this.dirty.update(m => { const n = new Map(m); n.delete(d.key); return n; }); this.load(); },
      error: err => this.toast.error(errText(err)),
    });
  }

  addDrug(): void {
    const key = `new-${++this.seq}`;
    const row: DrugGridRow = {
      key, isNew: true, id: key, rowId: key, catalogKey: '', origin: 'local', isMaster: false, name: 'New drug', generic: '', strength: '',
      form: 'tab' as DrugForm, unit: 'tab', schedule: 'none', hsnCode: '3004', taxSlab: 12, defaultMrp: 0, aliases: [], isActive: true, onHand: 0,
    };
    this.all.update(a => [row, ...a]);
    this.dirty.update(m => new Map(m).set(key, { name: row.name, generic: '', form: row.form, schedule: row.schedule, taxSlab: 12, hsnCode: '3004', unit: 'tab', defaultMrp: 0 }));
    setTimeout(() => this.grid?.startEditingCell({ rowIndex: 0, colKey: 'generic' }), 50);
  }

  save(): void {
    const edits = buildDrugEdits(this.dirty(), this.all());
    if (!edits.length) return;
    if (edits.some(e => e.id == null && !(e.name ?? '').trim())) { this.toast.error('A new drug needs a brand name.'); return; }
    this.saving.set(true);
    this.api.saveDrugMaster(edits).subscribe({
      next: () => { this.saving.set(false); this.dirty.set(new Map()); this.toast.success(`${edits.length} ${edits.length === 1 ? 'drug' : 'drugs'} saved`); this.load(); },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }

  discard(): void { this.dirty.set(new Map()); this.load(); }
}
