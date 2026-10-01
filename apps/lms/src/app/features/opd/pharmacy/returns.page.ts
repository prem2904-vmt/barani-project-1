import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AgGridAngular } from 'ag-grid-angular';
import { AllCommunityModule, ModuleRegistry, type ColDef } from 'ag-grid-community';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { NdDateComponent } from '../../../shared/components/nd-date/nd-date.component';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { labToday } from '../../../shared/utils/lab-clock';
import { AuthService } from '../../../core/auth/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { gridThemeDark, gridThemeLight } from '../../admin/tests/tests/grid-theme';
import {
  PharmacyApi, type BatchRow, type DispenseLineView, type DispenseSummary, type DispenseView, type MoveRow, type PharmacyDrugRow, type SupplierRow,
} from './pharmacy.api';
import { errText, expiryLabel, inr } from './pharmacy-math';
import { MOVE_WORDS } from './stock.page';
import { PharmacyDrugPickerComponent } from './drug-picker.component';
import { PharmacySectionsComponent } from './pharmacy-sections.component';

ModuleRegistry.registerModules([AllCommunityModule]);

/** Units a sold line can still take back. */
export function returnable(l: Pick<DispenseLineView, 'qty' | 'returnedQty'>): number { return Math.max(0, l.qty - l.returnedQty); }

/**
 * Returns (`/opd/pharmacy/returns`): the branch's returns ledger (AG-Grid) and
 * a side card for the two kinds — FROM A PATIENT (pick the sale, the line and
 * the quantity; the units go back into their batch and the refund due is
 * shown) and TO A SUPPLIER (pick the drug's batch and the quantity).
 */
@Component({
  selector: 'pf-pharmacy-returns',
  standalone: true,
  imports: [AgGridAngular, HeroBandComponent, NdDateComponent, SelectComponent, BusyDirective, PharmacyDrugPickerComponent, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true" [contextBar]="true">
        <div band-search class="nd-ctx ph-ctx"><span class="nd-ctx__primary">Returns</span><span class="nd-ctx__chip nd-num">{{ rows().length }} recent</span></div>
        <pf-pharmacy-sections band-tools active="returns"></pf-pharmacy-sections>
      </pf-hero-band>
      <div class="ph-body">
        <section class="nd-card" aria-labelledby="ph-rt-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg></span>
            <span class="nd-card__label" id="ph-rt-t">Returns ledger</span>
          </header>
          <div class="nd-card__body ph-card-body--flush">
            <ag-grid-angular class="ph-grid" style="height:100%" [theme]="gridTheme()" [rowData]="rows()" [columnDefs]="cols" [overlayNoRowsTemplate]="noRows"></ag-grid-angular>
          </div>
        </section>
        <aside class="nd-card" aria-labelledby="ph-rs-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></span>
            <span class="nd-card__label" id="ph-rs-t">New return</span>
            <span class="nd-card__spacer"></span>
            <div class="nd-seg" role="radiogroup" aria-label="Return kind">
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="kind() === 'patient'" (click)="kind.set('patient')">From patient</button>
              <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="kind() === 'supplier'" (click)="kind.set('supplier')">To supplier</button>
            </div>
          </header>
          <div class="nd-card__body">
            @if (kind() === 'patient') {
              <div class="nd-field"><span class="nd-field__lbl">Sale date</span><pf-nd-date label="Sale date" [value]="day()" [max]="today" (valueChange)="setDay($event)"></pf-nd-date></div>
              @if (!sale()) {
                @for (s of sales(); track s.id) {
                  <button type="button" class="ph-row press" (click)="openSale(s)">
                    <span class="ph-row__main"><span class="ph-row__name">{{ s.customerName || 'Customer' }}</span><span class="ph-row__meta nd-num">{{ s.number }} · {{ s.lines }} {{ s.lines === 1 ? 'item' : 'items' }}</span></span>
                    <span class="ph-row__end">
                      <span class="nd-num">{{ inr(s.total) }}</span>
                      <span class="ph-dot" [attr.data-tone]="s.paid >= s.total ? 'done' : 'warn'">{{ s.paid >= s.total ? 'Paid' : 'Due ' + inr(s.total - s.paid, false) }}</span>
                    </span>
                  </button>
                } @empty { <p class="ph-sub">No completed sales that day.</p> }
              } @else {
                <div class="ph-row" style="cursor:default"><span class="ph-row__main"><span class="ph-row__name">{{ sale()!.customerName || 'Customer' }}</span><span class="ph-row__meta nd-num">{{ sale()!.number }}</span></span>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="sale.set(null)">Change</button></div>
                <div class="nd-field"><span class="nd-field__lbl">Item</span><pf-select [options]="lineOpts()" [value]="lineId()" (valueChange)="lineId.set($event)" placeholder="Which item?"></pf-select></div>
                <div class="ph-fields">
                  <div class="nd-field"><label class="nd-field__lbl" for="ph-rpq">Quantity back</label><input id="ph-rpq" class="nd-input nd-num" type="number" min="1" [max]="maxBack()" [value]="qty() || ''" (input)="qty.set(+$any($event.target).value)" /></div>
                  <div class="nd-field"><label class="nd-field__lbl" for="ph-rpr">Reason</label><input id="ph-rpr" class="nd-input" [value]="reason()" (input)="reason.set($any($event.target).value)" placeholder="e.g. Dose changed" /></div>
                </div>
                <div class="nd-field"><span class="nd-field__lbl">Refund by</span>
                  @if (!billPaid()) {
                    <p class="ph-sub">Nothing was paid on this bill — the return just reduces it, no refund.</p>
                  } @else if (canRefund()) {
                    <div class="nd-seg" role="radiogroup" aria-label="Refund by">
                      @for (m of refundModes; track m.v) {
                        <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="refundMode() === m.v" [attr.aria-pressed]="refundMode() === m.v" (click)="refundMode.set(m.v)">{{ m.l }}</button>
                      }
                    </div>
                  } @else {
                    <p class="ph-sub">This sale was paid — ask someone with refund permission to record the return.</p>
                  }
                </div>
                @if (refund() != null) {
                  <div class="ph-note" role="status"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                    <span>Back in stock.@if (creditNote()) { Refunded {{ inr(refunded()) }} · credit note {{ creditNote() }}.} @else { Nothing was paid on this bill — it's reduced to {{ inr(sale()?.bill?.totalPayable ?? 0) }} instead of a refund.}</span></div>
                }
              }
            } @else {
              @if (sDrug(); as d) {
                <div class="ph-row" style="cursor:default"><span class="ph-row__main"><span class="ph-row__name">{{ d.name }}</span><span class="ph-row__meta">{{ d.generic }}</span></span>
                  <button type="button" class="nd-btn nd-btn--tertiary" (click)="sDrug.set(null)">Change</button></div>
                <div class="nd-field"><span class="nd-field__lbl">Batch</span><pf-select [options]="batchOpts()" [value]="batchId()" (valueChange)="batchId.set($event)" placeholder="Which batch?"></pf-select></div>
                <div class="ph-fields">
                  <div class="nd-field"><label class="nd-field__lbl" for="ph-rsq">Quantity</label><input id="ph-rsq" class="nd-input nd-num" type="number" min="1" [value]="qty() || ''" (input)="qty.set(+$any($event.target).value)" /></div>
                  <div class="nd-field"><span class="nd-field__lbl">Supplier</span><pf-select [options]="supplierOpts()" [value]="supplierId()" (valueChange)="supplierId.set($event)" placeholder="Batch supplier"></pf-select></div>
                  <div class="nd-field ph-span"><label class="nd-field__lbl" for="ph-rsr">Reason</label><input id="ph-rsr" class="nd-input" [value]="reason()" (input)="reason.set($any($event.target).value)" placeholder="e.g. Near expiry, damaged" /></div>
                </div>
              } @else {
                <pf-pharmacy-drug-picker [down]="true" placeholder="Which drug goes back?" (picked)="pickDrug($event)"></pf-pharmacy-drug-picker>
              }
            }
          </div>
          @if (kind() === 'patient' && refundBlocked()) {
            <p class="ph-sub" role="alert">You don't have permission to process a refund on this paid sale — ask someone who does.</p>
          }
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--secondary" (click)="clear()">Clear</button>
            <button type="button" class="nd-btn" [class.nd-btn--primary]="ready()" [class.nd-btn--secondary]="!ready()" [disabled]="!ready() || busy()" [pfBusy]="busy()" pfBusyLabel="Saving…" (click)="submit()">Record return</button>
          </div>
        </aside>
      </div>
    </section>
  `,
})
export class PharmacyReturnsPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly theme = inject(ThemeService);
  private readonly auth = inject(AuthService, { optional: true });
  protected readonly gridTheme = computed(() => (this.theme.isDark() ? gridThemeDark : gridThemeLight));
  protected readonly today = labToday();
  protected readonly inr = inr;
  protected readonly noRows = '<span class="ph-sub">No returns yet.</span>';

  protected readonly rows = signal<MoveRow[]>([]);
  protected readonly kind = signal<'patient' | 'supplier'>('patient');
  protected readonly day = signal<string | null>(this.today);
  protected readonly sales = signal<DispenseSummary[]>([]);
  protected readonly sale = signal<DispenseView | null>(null);
  protected readonly lineId = signal('');
  protected readonly qty = signal(0);
  protected readonly reason = signal('');
  protected readonly refund = signal<number | null>(null);
  /** Integrator: the money back is a credit note (opd_refunds). */
  protected readonly refunded = signal(0);
  protected readonly creditNote = signal<string | null>(null);
  protected readonly refundMode = signal<'cash' | 'upi' | 'card'>('cash');
  protected readonly refundModes: { v: 'cash' | 'upi' | 'card'; l: string }[] = [{ v: 'cash', l: 'Cash' }, { v: 'upi', l: 'UPI' }, { v: 'card', l: 'Card' }];
  protected readonly sDrug = signal<PharmacyDrugRow | null>(null);
  protected readonly batches = signal<BatchRow[]>([]);
  protected readonly batchId = signal('');
  protected readonly suppliers = signal<SupplierRow[]>([]);
  protected readonly supplierId = signal('');
  protected readonly busy = signal(false);

  protected readonly cols: ColDef<MoveRow>[] = [
    { field: 'at', headerName: 'When', width: 150, valueFormatter: p => new Date(p.value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) },
    { field: 'kind', headerName: 'Kind', width: 170, valueFormatter: p => MOVE_WORDS[p.value as MoveRow['kind']] ?? p.value },
    { field: 'drugName', headerName: 'Drug', flex: 2, minWidth: 160 },
    { field: 'batchNo', headerName: 'Batch', width: 120 },
    { field: 'qty', headerName: 'Qty', width: 90, type: 'rightAligned', valueFormatter: p => (p.value > 0 ? '+' : '') + p.value },
    { field: 'note', headerName: 'Reason', flex: 2, minWidth: 160, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
    { field: 'byName', headerName: 'By', flex: 1, minWidth: 130, wrapText: true, autoHeight: true, cellClass: 'ph-wrap' },
  ];

  protected readonly lineOpts = computed<PfSelectOption<string>[]>(() => (this.sale()?.lines ?? []).map(l => ({
    value: l.id, label: `${l.drugName} · ${l.batchNo}`, hint: `${returnable(l)} of ${l.qty} can come back`, disabled: returnable(l) <= 0,
  })));
  protected readonly maxBack = computed(() => { const l = this.sale()?.lines.find(x => x.id === this.lineId()); return l ? returnable(l) : 0; });
  protected readonly batchOpts = computed<PfSelectOption<string>[]>(() => this.batches().filter(b => b.qtyOnHand > 0).map(b => ({ value: b.id, label: `${b.batchNo} · exp ${expiryLabel(b.expiryDate)}`, hint: `${b.qtyOnHand} on hand` })));
  protected readonly supplierOpts = computed<PfSelectOption<string>[]>(() => [{ value: '', label: 'The batch supplier' }, ...this.suppliers().map(s => ({ value: s.id, label: s.name }))]);
  protected readonly ready = computed(() => this.kind() === 'patient'
    ? !!this.sale() && !!this.lineId() && this.qty() > 0 && this.qty() <= this.maxBack() && !this.refundBlocked()
    : !!this.batchId() && this.qty() > 0 && this.qty() <= (this.batches().find(b => b.id === this.batchId())?.qtyOnHand ?? 0));

  /// A patient-return REFUND needs process_refund (owner 2026-10-01), enforced
  /// server-side — this just hides/disables the action with a clear message so
  /// the desk isn't surprised by a 403. Any amount already paid on the sale
  /// means the return CAN produce a refund (full or part-paid alike); an
  /// unpaid bill never refunds, so it's never blocked here.
  protected readonly canRefund = computed(() => {
    try { return !!this.auth?.hasPermission('process_refund'); } catch { return false; }
  });
  protected readonly billPaid = computed(() => (this.sale()?.bill?.totalPaid ?? 0) > 0);
  protected readonly refundBlocked = computed(() => this.billPaid() && !this.canRefund());

  constructor() {
    this.load();
    this.loadSales();
    this.api.suppliers().subscribe({ next: s => this.suppliers.set(s), error: () => undefined });
  }
  private load() { this.api.returns().subscribe({ next: r => this.rows.set(r), error: e => this.toast.error(errText(e)) }); }
  private loadSales() { this.api.dispenses(this.day(), null, 'completed').subscribe({ next: s => this.sales.set(s), error: () => this.sales.set([]) }); }
  protected setDay(d: string | null) { this.day.set(d); this.sale.set(null); this.loadSales(); }
  protected openSale(s: DispenseSummary) {
    this.api.dispense(s.id).subscribe({ next: v => { this.sale.set(v); this.lineId.set(''); this.refund.set(null); }, error: e => this.toast.error(errText(e)) });
  }
  protected pickDrug(d: PharmacyDrugRow) {
    this.sDrug.set(d); this.batchId.set('');
    this.api.batches(d.id).subscribe({ next: b => this.batches.set(b), error: () => this.batches.set([]) });
  }
  protected clear() { this.sale.set(null); this.lineId.set(''); this.qty.set(0); this.reason.set(''); this.refund.set(null); this.sDrug.set(null); this.batchId.set(''); this.supplierId.set(''); }
  protected submit() {
    if (!this.ready()) return;
    this.busy.set(true);
    if (this.kind() === 'patient') {
      this.api.patientReturn(this.lineId(), this.qty(), this.reason() || null, this.refundMode()).subscribe({
        next: r => {
          this.busy.set(false); this.refund.set(r.refundDue); this.refunded.set(r.refunded ?? 0); this.creditNote.set(r.creditNoteNumber ?? null);
          this.toast.success(r.creditNoteNumber ? `Return recorded · ${inr(r.refunded ?? 0)} refunded` : 'Return recorded');
          this.load(); if (this.sale()) this.openSaleById(this.sale()!.id);
        },
        error: e => { this.busy.set(false); this.toast.error(errText(e)); },
      });
    } else {
      this.api.supplierReturn(this.batchId(), this.qty(), this.supplierId() || null, this.reason() || null).subscribe({
        next: () => { this.busy.set(false); this.toast.success('Returned to supplier'); this.clear(); this.load(); },
        error: e => { this.busy.set(false); this.toast.error(errText(e)); },
      });
    }
  }
  private openSaleById(id: string) { this.api.dispense(id).subscribe({ next: v => this.sale.set(v), error: () => undefined }); }
}
