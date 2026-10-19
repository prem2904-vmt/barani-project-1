import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type CellValueChangedEvent, type ColDef, type RowClickedEvent } from 'ag-grid-community';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';
import { SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { heldFlag } from '../../../shared/utils/min-duration';
import { labToday } from '../../../shared/utils/lab-clock';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import { PharmacyApi, type BatchRow, type MoveRow, type PharmacyDrugRow, type StockRow, type SupplierRow } from './pharmacy.api';
import { errText, expiryBand, expiryChip, expiryLabel, inr, monthsToExpiry, needsPrescription, scheduleLabel, unitWords } from './pharmacy-math';
import { PharmacyDrugPickerComponent } from './drug-picker.component';
import { PharmacySectionsComponent } from './pharmacy-sections.component';

ModuleRegistry.registerModules([AllCommunityModule]);

type StockFilter = 'all' | 'low' | 'expiring' | 'expired';

export const MOVE_WORDS: Record<MoveRow['kind'], string> = {
  receive: 'Received', dispense: 'Dispensed (Rx)', sale: 'Sold (counter)', return_in: 'Returned by patient',
  return_out: 'Returned to supplier', adjust: 'Adjusted', expire: 'Written off (expired)',
};

/** Rows for a filter: low = at or under the reorder level; expiring = nearest
 *  sellable expiry within 3 months; expired = expired stock still on the shelf. */
export function filterStock(rows: StockRow[], f: StockFilter, todayIso: string): StockRow[] {
  switch (f) {
    case 'low': return rows.filter(r => r.low);
    case 'expiring': return rows.filter(r => !!r.nearestExpiry && monthsToExpiry(r.nearestExpiry, todayIso) < 3);
    case 'expired': return rows.filter(r => r.expiredQty > 0);
    default: return rows;
  }
}

/**
 * Pharmacy stock at this branch (`/opd/pharmacy/stock`): one AG-Grid row per
 * drug (on hand, expired on the shelf, nearest expiry, reorder level — the
 * levels are edited in the grid and saved together), the reorder / expiring /
 * expired views, and a side card for the picked drug: its batches (earliest
 * expiry first), receive stock, adjust, return to supplier, write off expired,
 * and the stock ledger.
 */
@Component({
  selector: 'pf-pharmacy-stock',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, PfDateComponent, SelectComponent, SkeletonTableComponent, BusyDirective, PharmacyDrugPickerComponent, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true">
        <label band-search class="ph-search">
          <svg class="ph-search__glass" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="ph-search__input" type="search" placeholder="Search stock — brand or generic" aria-label="Search stock" [value]="q()" (input)="q.set($any($event.target).value)" />
        </label>
        <pf-pharmacy-sections band-tools active="stock"></pf-pharmacy-sections>
        <ng-container band-actions>
          @if (dirty().size) {
            <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="discard()" [disabled]="saving()">Discard</button>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="saveLevels()" [disabled]="saving()" [pfBusy]="saving()" pfBusyLabel="Saving…">Save levels ({{ dirty().size }})</button>
          } @else if (side() !== 'receive') {
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="side.set('receive')" aria-label="Receive stock">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              Receive stock
            </button>
          }
        </ng-container>
      </pf-hero-band>

      <div class="ph-body">
        <section class="pf-card" aria-labelledby="ph-s-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg></span>
            <span class="pf-card__label" id="ph-s-t">Stock</span>
            <div class="pf-seg" role="radiogroup" aria-label="Show">
              @for (f of filters; track f.v) {
                <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="filter() === f.v" (click)="filter.set(f.v)">{{ f.l }} <span class="ph-muted pf-num">{{ count(f.v) }}</span></button>
              }
            </div>
            <span class="pf-card__spacer"></span>
            <span class="ph-sub">Double-click a level to edit</span>
          </header>
          <div class="pf-card__body ph-card-body--flush" style="position:relative">
            @if (showSkeleton()) { <pf-skeleton-table [rows]="8" [cols]="6"></pf-skeleton-table> }
            <ag-grid-angular class="ph-grid" style="height:100%" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="cols"
                             [getRowId]="rowId" [stopEditingWhenCellsLoseFocus]="true" [animateRows]="true"
                             (rowClicked)="pick($event)" (cellValueChanged)="edited($event)"
                             [overlayNoRowsTemplate]="noRows"></ag-grid-angular>
          </div>
        </section>

        <aside class="pf-card" aria-labelledby="ph-sd-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg></span>
            <span class="pf-card__label" id="ph-sd-t">{{ side() === 'receive' ? 'Receive stock' : 'Batches' }}</span>
            <span class="pf-card__spacer"></span>
            <div class="pf-seg" role="radiogroup" aria-label="Side card">
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="side() === 'batches'" (click)="side.set('batches')">Batches</button>
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="side() === 'receive'" (click)="side.set('receive')">Receive</button>
            </div>
          </header>
          @if (side() === 'receive') {
            <div class="pf-card__body">
              @if (rDrug(); as d) {
                <div class="ph-row" style="cursor:default"><span class="ph-row__main"><span class="ph-row__name">{{ d.name }}</span><span class="ph-row__meta">{{ d.generic }}</span></span>
                  <button type="button" class="pf-btn pf-btn--tertiary" (click)="rDrug.set(null)">Change</button></div>
              } @else {
                <pf-pharmacy-drug-picker [down]="true" placeholder="Which drug? — generic or brand" (picked)="pickReceive($event)"></pf-pharmacy-drug-picker>
              }
              <div class="ph-fields">
                <div class="pf-field"><label class="pf-field__lbl" for="ph-rb">Batch no.</label><input id="ph-rb" class="pf-input pf-num" [value]="rBatch()" (input)="rBatch.set($any($event.target).value)" /></div>
                <div class="pf-field"><span class="pf-field__lbl">Expiry</span><pf-date label="Expiry" [value]="rExpiry()" [min]="today" (valueChange)="rExpiry.set($event)"></pf-date></div>
                <div class="pf-field"><label class="pf-field__lbl" for="ph-rq">Quantity (units)</label><input id="ph-rq" class="pf-input pf-num" type="number" min="1" inputmode="numeric" [value]="rQty() || ''" (input)="rQty.set(+$any($event.target).value)" /></div>
                <div class="pf-field"><label class="pf-field__lbl" for="ph-rm">MRP per unit (₹)</label><input id="ph-rm" class="pf-input pf-num" type="number" min="0" step="0.01" inputmode="decimal" [value]="rMrp() || ''" (input)="rMrp.set(+$any($event.target).value)" /></div>
                <div class="pf-field"><label class="pf-field__lbl" for="ph-rc">Cost per unit (₹)</label><input id="ph-rc" class="pf-input pf-num" type="number" min="0" step="0.01" inputmode="decimal" [value]="rCost() || ''" (input)="rCost.set(+$any($event.target).value)" /></div>
                <div class="pf-field"><span class="pf-field__lbl">Supplier</span><pf-select [options]="supplierOpts()" [value]="rSupplier()" (valueChange)="rSupplier.set($event)" placeholder="Optional" [searchable]="true"></pf-select></div>
              </div>
              <p class="pf-field__hint">For opening stock or a delivery without a purchase order. Orders are received from Purchases.</p>
            </div>
            <div class="pf-card__foot">
              <button type="button" class="pf-btn pf-btn--secondary" (click)="clearReceive()">Clear</button>
              <button type="button" class="pf-btn" [class.pf-btn--primary]="canReceive() && !dirty().size" [class.pf-btn--secondary]="!canReceive() || dirty().size" [disabled]="!canReceive() || busy()" [pfBusy]="busy()" pfBusyLabel="Receiving…" (click)="receive()">Receive {{ rQty() || '' }}</button>
            </div>
          } @else {
            <div class="pf-card__body">
              @if (sel(); as s) {
                <div>
                  <div class="ph-row__name" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">{{ s.name }} <span class="ph-sch" [attr.data-rx]="isRx(s.schedule)">{{ schLabel(s.schedule) }}</span></div>
                  <div class="ph-sub">{{ s.generic }} · {{ units(s.onHand, s) }} sellable{{ s.minQty != null ? ' · reorder at ' + s.minQty : '' }}</div>
                </div>
                <p class="ph-title">Batches · earliest expiry first</p>
                @for (b of batches(); track b.id; let i = $index) {
                  <div class="ph-row" style="cursor:default;align-items:flex-start">
                    <span class="ph-row__main">
                      <span class="ph-row__name pf-num">{{ b.batchNo }}</span>
                      <span class="ph-row__meta pf-num">exp <span [class]="expChip(b.expiryDate).cls">{{ expChip(b.expiryDate).label }}</span> · {{ inr(b.mrp) }} MRP{{ i === 0 && !b.expired ? ' · sold first' : '' }}</span>
                      <span style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">
                        <button type="button" class="pf-btn pf-btn--tertiary" (click)="adjust(b)">Adjust</button>
                        <button type="button" class="pf-btn pf-btn--tertiary" (click)="toSupplier(b)" [disabled]="b.qtyOnHand <= 0">Return to supplier</button>
                        @if (b.expired && b.qtyOnHand > 0) { <button type="button" class="pf-btn pf-btn--tertiary" (click)="writeOff(b)">Write off</button> }
                      </span>
                    </span>
                    <span class="ph-row__end"><span class="pf-num ph-strong">{{ b.qtyOnHand }}</span>
                      <span class="ph-dot" [attr.data-tone]="dotTone(b)">{{ b.expired ? 'Expired' : band(b) !== 'ok' ? 'Expires ' + exp(b.expiryDate) : 'In date' }}</span></span>
                  </div>
                } @empty { <p class="ph-sub">No batches in stock.</p> }
                <p class="ph-title">Ledger</p>
                @for (m of moves(); track m.id) {
                  <div style="display:flex;justify-content:space-between;gap:8px;font-size:12.5px">
                    <span><span class="ph-strong" style="margin-right:6px">{{ moveWord(m) }}</span><span class="ph-muted pf-num">{{ m.batchNo }} · {{ when(m.at) }}{{ m.byName ? ' · ' + m.byName : '' }}</span>@if (m.note) { <br><span class="ph-muted">{{ m.note }}</span> }</span>
                    <span class="pf-num" [class.ph-strong]="m.qty > 0">{{ m.qty > 0 ? '+' : '' }}{{ m.qty }}</span>
                  </div>
                } @empty { <p class="ph-sub">No movements yet.</p> }
              } @else {
                <div class="pf-empty pf-empty--compact"><p class="pf-empty__title">Pick a drug</p><p class="pf-empty__body">Its batches, actions and stock ledger show here.</p></div>
              }
            </div>
            @if (sel() && sel()!.expiredQty > 0) {
              <div class="pf-card__foot"><button type="button" class="pf-btn pf-btn--danger pf-span" (click)="writeOffAll()">Write off all expired stock</button></div>
            }
          }
        </aside>
      </div>
    </section>
  `,
})
export class PharmacyStockPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly theme = inject(ThemeService);

  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly today = labToday();
  protected readonly q = signal('');
  protected readonly filter = signal<StockFilter>('all');
  protected readonly filters: { v: StockFilter; l: string }[] = [{ v: 'all', l: 'All' }, { v: 'low', l: 'Reorder' }, { v: 'expiring', l: 'Expiring' }, { v: 'expired', l: 'Expired' }];
  private readonly all = signal<StockRow[]>([]);
  private readonly loading = signal(true);
  protected readonly showSkeleton = heldFlag(this.loading);
  protected readonly side = signal<'batches' | 'receive'>('batches');
  protected readonly selId = signal<string | null>(null);
  protected readonly batches = signal<BatchRow[]>([]);
  protected readonly moves = signal<MoveRow[]>([]);
  protected readonly suppliers = signal<SupplierRow[]>([]);
  protected readonly dirty = signal<Map<string, StockRow>>(new Map());
  protected readonly saving = signal(false);
  protected readonly busy = signal(false);
  protected readonly inr = inr;
  protected readonly noRows = '<span class="ph-sub">No stock yet — receive stock or a purchase order.</span>';

  // Receive form
  protected readonly rDrug = signal<PharmacyDrugRow | null>(null);
  protected readonly rBatch = signal('');
  protected readonly rExpiry = signal<string | null>(null);
  protected readonly rQty = signal(0);
  protected readonly rMrp = signal(0);
  protected readonly rCost = signal(0);
  protected readonly rSupplier = signal<string>('');

  protected readonly rows = computed(() => {
    const t = this.q().trim().toLowerCase();
    const base = filterStock(this.all(), this.filter(), this.today);
    return !t ? base : base.filter(r => (r.name + ' ' + (r.generic ?? '') + ' ' + (r.strength ?? '')).toLowerCase().includes(t));
  });
  protected readonly sel = computed(() => this.all().find(r => r.drugId === this.selId()) ?? null);
  protected readonly supplierOpts = computed<PfSelectOption<string>[]>(() => [{ value: '', label: 'No supplier' }, ...this.suppliers().map(s => ({ value: s.id, label: s.name }))]);
  protected readonly canReceive = computed(() => !!this.rDrug() && !!this.rBatch().trim() && !!this.rExpiry() && this.rQty() > 0 && this.rMrp() >= 0);

  protected readonly rowId = (p: { data: StockRow }) => p.data.drugId;
  protected readonly cols: ColDef<StockRow>[] = [
    { field: 'name', headerName: 'Drug', flex: 1.5, minWidth: 140, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'generic', headerName: 'Generic', flex: 2, minWidth: 150, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'schedule', headerName: 'Sch', width: 76, valueFormatter: p => scheduleLabel(p.value) },
    { field: 'onHand', headerName: 'On hand', width: 104, type: 'rightAligned', valueFormatter: p => unitWords(p.value, p.data?.unit, p.data?.form) },
    { field: 'nearestExpiry', headerName: 'Next expiry', width: 106, valueFormatter: p => expiryLabel(p.value),
      cellClass: p => p.value ? expiryChip(p.value, labToday()).cls : '' },
    { field: 'expiredQty', headerName: 'Expired', width: 86, type: 'rightAligned', valueFormatter: p => (p.value ? String(p.value) : '') },
    { field: 'minQty', headerName: 'Reorder at', width: 100, type: 'rightAligned', editable: true, valueParser: p => Math.max(0, Number(p.newValue) || 0) },
    { field: 'reorderQty', headerName: 'Order qty', width: 94, type: 'rightAligned', editable: true, valueParser: p => Math.max(0, Number(p.newValue) || 0) },
    { colId: 'low', headerName: '', width: 84, cellDataType: 'text', valueGetter: p => (p.data?.low ? 'Reorder' : ''), cellStyle: { color: 'var(--red-text, #dc2626)' } },
  ];

  constructor() {
    this.load();
    this.api.suppliers().subscribe({ next: s => this.suppliers.set(s), error: () => undefined });
  }

  load(): void {
    this.api.stock().subscribe({
      next: r => { this.all.set(r); this.loading.set(false); if (this.selId()) this.loadDrug(this.selId()!); },
      error: e => { this.loading.set(false); this.toast.error(errText(e)); },
    });
  }
  protected count(f: StockFilter) { return filterStock(this.all(), f, this.today).length; }
  protected pick(e: RowClickedEvent<StockRow>) {
    if (!e.data) return;
    this.selId.set(e.data.drugId);
    this.side.set('batches');
    this.loadDrug(e.data.drugId);
  }
  private loadDrug(id: string) {
    this.api.batches(id, true).subscribe({ next: b => this.batches.set(b.filter(x => x.qtyOnHand > 0 || x.expired)), error: () => this.batches.set([]) });
    this.api.moves(id, 50).subscribe({ next: m => this.moves.set(m), error: () => this.moves.set([]) });
  }
  protected edited(e: CellValueChangedEvent<StockRow>) {
    if (!e.data) return;
    this.dirty.update(m => new Map(m).set(e.data!.drugId, { ...e.data! }));
  }
  protected discard() { this.dirty.set(new Map()); this.load(); }
  protected saveLevels() {
    const rows = [...this.dirty().values()];
    this.saving.set(true);
    let left = rows.length, failed = 0;
    for (const r of rows) {
      this.api.setReorder(r.drugId, r.minQty ?? 0, r.reorderQty ?? 0).subscribe({
        next: () => { if (--left === 0) this.afterLevels(failed); },
        error: e => { failed++; this.toast.error(errText(e)); if (--left === 0) this.afterLevels(failed); },
      });
    }
  }
  private afterLevels(failed: number) {
    this.saving.set(false);
    if (!failed) { this.toast.success('Reorder levels saved'); this.dirty.set(new Map()); }
    this.load();
  }

  protected isRx(s: string) { return needsPrescription(s); }
  protected schLabel(s: string) { return scheduleLabel(s); }
  protected units(n: number, r: StockRow) { return unitWords(n, r.unit, r.form); }
  protected exp(iso: string) { return expiryLabel(iso); }
  protected expChip(iso: string) { return expiryChip(iso, this.today); }
  /** Chip band (critic #10) — expired / <30d / <90d / ok, mirror of the server's IsExpired. */
  protected band(b: BatchRow) { return expiryBand(b.expiryDate, this.today); }
  protected dotTone(b: BatchRow): 'bad' | 'warn' | null {
    if (b.expired || this.band(b) === 'expired' || this.band(b) === 'soon30') return 'bad';
    return this.band(b) === 'soon90' ? 'warn' : null;
  }
  protected moveWord(m: MoveRow) { return MOVE_WORDS[m.kind] ?? m.kind; }
  protected when(iso: string) { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }

  // ── Receive ───────────────────────────────────────────────────────────────
  protected pickReceive(d: PharmacyDrugRow) { this.rDrug.set(d); if (!this.rMrp() && d.defaultMrp) this.rMrp.set(d.defaultMrp); }
  protected clearReceive() { this.rDrug.set(null); this.rBatch.set(''); this.rExpiry.set(null); this.rQty.set(0); this.rMrp.set(0); this.rCost.set(0); this.rSupplier.set(''); }
  protected receive() {
    const d = this.rDrug();
    if (!d || !this.canReceive()) return;
    this.busy.set(true);
    this.api.receive({ drugId: d.id, batchNo: this.rBatch().trim(), expiryDate: this.rExpiry()!, qty: this.rQty(), mrp: this.rMrp(), purchasePrice: this.rCost(), supplierId: this.rSupplier() || null }).subscribe({
      next: b => { this.busy.set(false); this.toast.success(`Received ${this.rQty()} into batch ${b.batchNo}`); this.clearReceive(); this.selId.set(b.drugId); this.side.set('batches'); this.load(); },
      error: e => { this.busy.set(false); this.toast.error(errText(e)); },
    });
  }

  // ── Batch actions (DialogService — never window.confirm) ───────────────────
  protected async adjust(b: BatchRow) {
    const v = await this.dialog.prompt({ title: `Adjust batch ${b.batchNo}`, message: `On hand: ${b.qtyOnHand}. Enter the change (e.g. -2 for a damaged strip, 5 for a recount).`, inputType: 'number', required: true, confirmLabel: 'Next' });
    const delta = Number(v);
    if (v == null || !Number.isFinite(delta) || delta === 0) return;
    const reason = await this.dialog.prompt({ title: 'Why?', message: 'The reason is kept in the stock ledger.', placeholder: 'e.g. Damaged strip, recount', required: true, confirmLabel: 'Adjust' });
    if (!reason) return;
    this.api.adjust(b.id, delta, reason).subscribe({ next: () => { this.toast.success('Stock adjusted'); this.load(); }, error: e => this.toast.error(errText(e)) });
  }
  protected async toSupplier(b: BatchRow) {
    const v = await this.dialog.prompt({ title: `Return batch ${b.batchNo} to the supplier`, message: `On hand: ${b.qtyOnHand}. How many go back?`, inputType: 'number', required: true, confirmLabel: 'Next' });
    const qty = Number(v);
    if (v == null || !Number.isFinite(qty) || qty <= 0) return;
    const reason = await this.dialog.prompt({ title: 'Reason', placeholder: 'e.g. Near expiry, damaged in transit', confirmLabel: 'Return' });
    if (reason == null) return;
    this.api.supplierReturn(b.id, qty, b.supplierId ?? null, reason).subscribe({ next: () => { this.toast.success('Returned to supplier'); this.load(); }, error: e => this.toast.error(errText(e)) });
  }
  protected async writeOff(b: BatchRow) {
    const ok = await this.dialog.confirm({ title: `Write off batch ${b.batchNo}?`, message: `${b.qtyOnHand} expired units leave stock. This is kept in the ledger.`, confirmLabel: 'Write off', tone: 'danger' });
    if (!ok) return;
    this.api.expire(b.id).subscribe({ next: () => { this.toast.success('Expired stock written off'); this.load(); }, error: e => this.toast.error(errText(e)) });
  }
  protected async writeOffAll() {
    const ok = await this.dialog.confirm({ title: 'Write off all expired stock?', message: 'Every expired batch at this branch leaves stock. This is kept in the ledger.', confirmLabel: 'Write off all', tone: 'danger' });
    if (!ok) return;
    this.api.expire(null).subscribe({ next: r => { this.toast.success(`${r.batches} ${r.batches === 1 ? 'batch' : 'batches'} written off`); this.load(); }, error: e => this.toast.error(errText(e)) });
  }
}
