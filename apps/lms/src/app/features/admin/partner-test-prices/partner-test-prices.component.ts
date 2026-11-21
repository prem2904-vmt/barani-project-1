import { ViewStateService } from '../../../shared/services/view-state.service';
import { stableJson } from '../../../shared/utils/dirty-snapshot';
import { ChangeDetectionStrategy, Component, TemplateRef, computed, inject, signal, viewChild } from '@angular/core';
import { CellValueChangedEvent, ColDef, ICellRendererParams } from 'ag-grid-community';
import { NgTemplateOutlet } from '@angular/common';
import { DataGridComponent } from '../../../shared/components/data-grid/data-grid.component';
import { SettingsSavebarComponent } from '../../../shared/components/setting-row/settings-savebar.component';
import { SG_ICON, sgActions, sgActionsCol, sgBare } from '../../../shared/settings-grid/settings-grid';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { HasUnsavedChanges, confirmLeaveUnsaved, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { bandFilter } from '../../../shared/utils/band-search';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SettingsSiblingsComponent } from '../settings/settings-siblings.component';

interface ReferralLabOption { id: string; name: string; }

/** One partner price row. `id === null` marks a row the grid added locally
 *  that hasn't been saved yet (never sent in a batch under its own identity —
 *  the batch upsert treats a null id as "create"). `_dirty` is UI-only (never
 *  sent to the server) so "Save" only needs to fire when something changed. */
interface PriceRow {
  id: string | null;
  referralLabId: string;
  testCatalogKey: string;
  testName: string | null;
  cost: number;
  effectiveFrom: string; // yyyy-MM-dd
  _dirty?: boolean;
}

/**
 * Outsourcing partner price list — what each referral lab charges per test,
 * effective-dated. Edited as an AG-Grid batch-save, the SAME convention as
 * Test Master's own grid (never a row-by-row PUT). This is the single source
 * Analytics' Outsourcing / Profitability tabs resolve cost from (see
 * `PartnerTestPriceEntity` / `AnalyticsService.ResolveCost`) — a price here
 * only affects margin computed AFTER its effective date, never restates
 * history.
 */
@Component({
  selector: 'pf-partner-test-prices',
  standalone: true,
  imports: [SettingsSiblingsComponent, HeroBandComponent, SelectComponent, DataGridComponent, NgTemplateOutlet, SettingsSavebarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      <pf-hero-band [back]="true" placeholder="Search prices — test, catalogue key…" [value]="q()" (valueChange)="q.set($event)">
        <ng-container band-tools><pf-settings-siblings></pf-settings-siblings></ng-container>
        
      </pf-hero-band>

      <div class="pf-band-body pf-band-body--fill">
        <section class="pf-card pf-sg-main ptp-main" [class.pf-sg-main--bare]="bare" aria-label="Partner prices">
          <header class="pf-card__head pf-sg-main__head">
            <span class="pf-card__icon" aria-hidden="true">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9"/></svg>
            </span>
            <span class="pf-card__label">Partner prices{{ activeLabName() ? ' — ' + activeLabName() : '' }}</span>
            <span class="pf-card__note pf-sg-hint">The catalogue key must match the Test Master's CatalogKey — the name is a label only</span>
            <span class="pf-card__spacer"></span>
            <ng-container *ngTemplateOutlet="headToolsTpl"></ng-container>
          </header>
          <div class="pf-sg-main__body">
            <pf-data-grid viewStateKey="admin.partner-prices.g1" [rowData]="visibleRows()" [columnDefs]="colDefs" [defaultColDef]="defaultColDef" [singleClickEdit]="true"
                          [suppressCellFocus]="false" [loading]="loading()" loadingLabel="Loading prices…"
                          [emptyTitle]="referralLabId() ? (q() ? 'No prices match your search.' : 'No prices yet — Add price.') : 'Pick a referral lab'"
                          [emptyBody]="referralLabId() ? '' : 'What it charges per test is the cost Analytics resolves the outsourcing margin from.'"
                          (cellValueChanged)="onCellChanged($event)"></pf-data-grid>
          </div>
          <pf-settings-savebar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discardEdits()"></pf-settings-savebar>
        </section>
      </div>
    </section>

    <!-- Head tools: count · the referral-lab filter (dynamic). -->
    <ng-template #headToolsTpl>
      @if (referralLabId()) { <span class="pf-sg-count pf-num">{{ visibleRows().length }} {{ visibleRows().length === 1 ? 'price' : 'prices' }}</span> }
      <pf-select class="ptp-filter" size="sm" [options]="labOptions()" [value]="referralLabId()"
                 [searchable]="true" (valueChange)="pickLab($event)" aria-label="Referral lab"></pf-select>
      @if (referralLabId()) {
        <button type="button" class="pf-btn pf-btn--secondary pf-sg-act press" (click)="addRow()" aria-label="Add price">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          Add price
        </button>
      }
    </ng-template>
  `,
  styles: [`
    .ptp-filter { flex: 0 1 240px; min-width: 200px; }
  `],
})
export class PartnerTestPricesComponent implements HasUnsavedChanges {
  protected readonly bare = sgBare();
  private readonly web = webPointerSignal();
  readonly q = signal('');
  private readonly headToolsTpl = viewChild<TemplateRef<unknown>>('headToolsTpl');
  readonly headTools = computed(() => this.headToolsTpl());
  readonly visibleRows = computed(() => bandFilter(this.rows(), this.q(), r => [r.testName, r.testCatalogKey]));
  // ── Unsaved changes ──
  readonly unsavedLabel = 'the partner prices';
  hasUnsavedChanges(): boolean { return this.dirty() && !this.saving(); }
  saveChanges(): Promise<boolean> { return this.persist(); }
  private readonly unloadGuard = guardUnsavedOnUnload(this);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(DialogService);
  protected readonly theme = inject(ThemeService);

  readonly labs = signal<ReferralLabOption[]>([]);
  readonly labOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: 'Select a referral lab…' },
    ...this.labs().map(l => ({ value: l.id, label: l.name })),
  ]);
  readonly referralLabId = signal<string>('');
  readonly activeLabName = computed(() => this.labs().find(l => l.id === this.referralLabId())?.name ?? '');

  readonly rows = signal<PriceRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly dirty = computed(() => this.rows().some(r => r._dirty));

  readonly defaultColDef: ColDef = { sortable: true, resizable: true, flex: 1, minWidth: 110 };

  private deleteRenderer = (params: ICellRendererParams<PriceRow>): HTMLElement => (params.data
    ? sgActions(this.web(), [{ label: 'Delete', aria: `Delete ${params.data.testName || params.data.testCatalogKey || 'price'}`, icon: true, danger: true,
        path: SG_ICON.trash, run: () => { void this.deleteRow(params.data!); } }])
    : document.createElement('span'));

  readonly colDefs: ColDef<PriceRow>[] = [
    { field: 'testCatalogKey', headerName: 'Test catalogue key', editable: true, minWidth: 180 },
    { field: 'testName', headerName: 'Test name (label)', editable: true, minWidth: 180 },
    {
      field: 'cost', headerName: 'Partner cost (₹)', editable: true, minWidth: 140, type: 'numericColumn',
      valueParser: p => Number(p.newValue) || 0,
      valueFormatter: p => p.value != null ? '₹' + Number(p.value).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '',
    },
    {
      field: 'effectiveFrom', headerName: 'Effective from', editable: true, minWidth: 140,
      valueParser: p => /^\d{4}-\d{2}-\d{2}$/.test(p.newValue) ? p.newValue : p.oldValue,
    },
    sgActionsCol<PriceRow>(true, [], 1, p => this.deleteRenderer(p), false),
  ];

  constructor() {
    this.api.get<ReferralLabOption[]>('/api/referral-labs').subscribe({ next: d => this.labs.set(d ?? []) });
  }

  /** Switching lab drops unsaved edits: "Save your changes?" first. */
  async pickLab(labId: string): Promise<void> {
    if (labId === this.referralLabId()) return;
    if (!(await confirmLeaveUnsaved(this.dialog, this))) return;
    this.onLabChange(labId);
  }

  onLabChange(labId: string): void {
    this.referralLabId.set(labId);
    this.rows.set([]);
    if (!labId) return;
    this.loading.set(true);
    this.api.get<PriceRow[]>(`/api/partner-test-prices?referralLabId=${labId}`).subscribe({
      next: d => { this.rows.set(this.remember(d ?? [])); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  addRow(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.rows.set([...this.rows(), {
      id: null, referralLabId: this.referralLabId(), testCatalogKey: '', testName: null, cost: 0, effectiveFrom: today, _dirty: true,
    }]);
  }

  /** The editable fields of each row as loaded / saved — an edit back to them is no longer a change (owner 2026-11-19). */
  private readonly loaded = new WeakMap<PriceRow, string>();
  private snapOf(r: PriceRow): string { return stableJson({ k: r.testCatalogKey, n: r.testName ?? null, c: Number(r.cost) || 0, f: r.effectiveFrom }); }
  private remember(list: PriceRow[]): PriceRow[] { for (const r of list) if (r.id !== null) { this.loaded.set(r, this.snapOf(r)); r._dirty = false; } return list; }

  onCellChanged(ev: CellValueChangedEvent<PriceRow>): void {
    if (!ev.data) return;
    const was = this.loaded.get(ev.data);
    ev.data._dirty = ev.data.id === null || was === undefined || was !== this.snapOf(ev.data);
    this.rows.set([...this.rows()]); // bump dirty() / template
  }

  async deleteRow(row: PriceRow): Promise<void> {
    if (row.id === null) {
      // Never saved — just drop it locally, no server round-trip.
      this.rows.set(this.rows().filter(r => r !== row));
      return;
    }
    const ok = await this.dialog.confirm({
      title: 'Delete this price?', tone: 'danger',
      message: `${row.testName || row.testCatalogKey} · effective ${row.effectiveFrom} will no longer price new outsourcing cost calculations.`,
    });
    if (!ok) return;
    this.api.delete(`/api/partner-test-prices/${row.id}`).subscribe({
      next: () => this.rows.set(this.rows().filter(r => r !== row)),
    });
  }

  save(): void { void this.persist(); }
  /** The Save bar's Discard: back to the saved prices for this lab. */
  discardEdits(): void { this.onLabChange(this.referralLabId()); }

  private persist(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
    const toSave = this.rows().filter(r => r._dirty && r.testCatalogKey.trim());
    if (toSave.length === 0) { resolve(true); return; }
    this.saving.set(true);
    const payload = {
      rows: toSave.map(r => ({
        id: r.id, referralLabId: r.referralLabId, testCatalogKey: r.testCatalogKey.trim(),
        testName: r.testName, cost: r.cost, effectiveFrom: r.effectiveFrom,
      })),
    };
    this.api.post('/api/partner-test-prices/batch', payload).subscribe({
      next: () => { this.saving.set(false); this.onLabChange(this.referralLabId()); resolve(true); },
      error: () => { this.saving.set(false); resolve(false); },
    });
    });
  }

  // Screen view state (owner 2026-11-21): filters / tab / search come back as left after in-app navigation;
  // fresh on reload, sign-out and branch switch.
  private readonly _viewState = inject(ViewStateService).bind('admin.partner-prices', { q: this.q });
}
