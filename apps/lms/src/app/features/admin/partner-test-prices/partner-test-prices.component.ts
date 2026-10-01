import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, CellValueChangedEvent, ColDef, ICellRendererParams, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz } from 'ag-grid-community';
import { ApiService } from '../../../core/services/api.service';
import { DialogService } from '../../../core/services/dialog.service';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridThemeLight = themeQuartz.withPart(colorSchemeLight).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#7c3aed',
});
const gridThemeDark = themeQuartz.withPart(colorSchemeDark).withParams({
  fontFamily: 'inherit', fontSize: 13, rowHeight: 44, headerHeight: 40, borderRadius: 12, accentColor: '#a855f7',
});

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
  imports: [HeroBandComponent, SelectComponent, SkeletonTableComponent, AgGridAngular],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="nd-page px-4 md:px-8 pt-6">
      <pf-hero-band [back]="true">
        <ng-container band-tools>
          <pf-select class="ptp-filter" size="sm" [options]="labOptions()" [value]="referralLabId()"
                     [searchable]="true" (valueChange)="onLabChange($event)"></pf-select>
        </ng-container>
      </pf-hero-band>

      <div class="nd-body">
        <div class="nd-card">
          <div class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3M9 3h6M7.5 14h9"/>
              </svg>
            </span>
            <span class="nd-card__label">Partner prices{{ activeLabName() ? ' — ' + activeLabName() : '' }}</span>
            <span class="nd-card__spacer"></span>
            @if (!referralLabId()) {
              <span class="nd-card__note">Pick a referral lab above</span>
            } @else {
              <button type="button" class="nd-btn nd-btn--tertiary" (click)="addRow()">+ Add price</button>
              <button type="button" class="nd-btn nd-btn--primary" [disabled]="!dirty() || saving()" (click)="save()">
                {{ saving() ? 'Saving…' : 'Save changes' }}
              </button>
            }
          </div>
          <div class="nd-card__body">
            @if (!referralLabId()) {
              <p style="padding: 16px; color: var(--text-secondary);">
                Select a referral lab to view or edit what it charges per test. This cost is what Analytics'
                Outsourcing and Profitability tabs resolve the outsourcing margin from — a test with no price on
                record here shows revenue only, never a guessed cost.
              </p>
            } @else if (loading()) {
              <pf-skeleton-table [rows]="6" [cols]="4"></pf-skeleton-table>
            } @else {
              <ag-grid-angular style="width: 100%; height: 480px;"
                [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="colDefs" [defaultColDef]="defaultColDef"
                [singleClickEdit]="true" (cellValueChanged)="onCellChanged($event)"></ag-grid-angular>
              <p class="ptp-note">Test catalogue key must match the Test Master's CatalogKey (see the test's detail page) — name is a label only, never matched by.</p>
            }
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .ptp-filter { min-width: 220px; }
    .ptp-note { font-size: 12px; color: var(--text-tertiary); padding: 10px 2px 0; }
  `],
})
export class PartnerTestPricesComponent {
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

  readonly gridTheme = computed(() => this.theme.isDark() ? gridThemeDark : gridThemeLight);
  readonly defaultColDef: ColDef = { sortable: true, resizable: true, flex: 1, minWidth: 110 };

  private deleteRenderer = (params: ICellRendererParams<PriceRow>): HTMLElement => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nd-btn nd-btn--tertiary';
    btn.style.padding = '4px 10px';
    btn.textContent = 'Delete';
    btn.addEventListener('click', () => void this.deleteRow(params.data!));
    return btn;
  };

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
    {
      headerName: '', colId: 'actions', editable: false, sortable: false, filter: false, resizable: false,
      maxWidth: 90, pinned: 'right', cellRenderer: this.deleteRenderer,
    },
  ];

  constructor() {
    this.api.get<ReferralLabOption[]>('/api/referral-labs').subscribe({ next: d => this.labs.set(d ?? []) });
  }

  onLabChange(labId: string): void {
    this.referralLabId.set(labId);
    this.rows.set([]);
    if (!labId) return;
    this.loading.set(true);
    this.api.get<PriceRow[]>(`/api/partner-test-prices?referralLabId=${labId}`).subscribe({
      next: d => { this.rows.set(d ?? []); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  addRow(): void {
    const today = new Date().toISOString().slice(0, 10);
    this.rows.set([...this.rows(), {
      id: null, referralLabId: this.referralLabId(), testCatalogKey: '', testName: null, cost: 0, effectiveFrom: today, _dirty: true,
    }]);
  }

  onCellChanged(ev: CellValueChangedEvent<PriceRow>): void {
    if (!ev.data) return;
    ev.data._dirty = true;
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

  save(): void {
    const toSave = this.rows().filter(r => r._dirty && r.testCatalogKey.trim());
    if (toSave.length === 0) return;
    this.saving.set(true);
    const payload = {
      rows: toSave.map(r => ({
        id: r.id, referralLabId: r.referralLabId, testCatalogKey: r.testCatalogKey.trim(),
        testName: r.testName, cost: r.cost, effectiveFrom: r.effectiveFrom,
      })),
    };
    this.api.post('/api/partner-test-prices/batch', payload).subscribe({
      next: () => { this.saving.set(false); this.onLabChange(this.referralLabId()); },
      error: () => this.saving.set(false),
    });
  }
}
