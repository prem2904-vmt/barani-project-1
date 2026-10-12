import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { labToday } from '../../../shared/utils/lab-clock';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { PharmacyApi, type GrnLine, type PharmacyDrugRow, type PoRow, type PoStatus, type PoView, type SupplierRow } from './pharmacy.api';
import { errText, inr } from './pharmacy-math';
import { PharmacyDrugPickerComponent } from './drug-picker.component';
import { PharmacySectionsComponent } from './pharmacy-sections.component';

interface DraftLine { drugId: string; name: string; strength?: string | null; qty: number; unitCost: number; taxSlab: number }
interface GrnRow { poLineId: string; name: string; ordered: number; received: number; qty: number; batchNo: string; expiry: string | null; mrp: number }

/** Draft line total incl. GST (mirror of PharmacyPurchaseService.WriteLines). */
export function poLineTotal(l: Pick<DraftLine, 'qty' | 'unitCost' | 'taxSlab'>): number {
  return Math.round(l.qty * l.unitCost * (1 + l.taxSlab / 100) * 100) / 100;
}

export const PO_WORDS: Record<PoStatus, string> = { draft: 'Draft', sent: 'Sent', partial: 'Part received', received: 'Received', cancelled: 'Cancelled' };

/**
 * Purchase orders (`/opd/pharmacy/purchase-orders`): the orders list on the
 * LEFT (filter / navigation companion), the order on the right — a draft is
 * edited (supplier, lines, cost) and sent; a sent order takes a goods-received
 * note (batch no., expiry, MRP, qty per line) that creates the batches.
 */
@Component({
  selector: 'pf-pharmacy-purchase-orders',
  standalone: true,
  imports: [HeroBandComponent, PfDateComponent, SelectComponent, BusyDirective, PharmacyDrugPickerComponent, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true" [contextBar]="true">
        <div band-search class="pf-ctx ph-ctx">
          <span class="pf-ctx__primary">{{ po()?.poNumber || (po() ? 'Draft order' : editing() ? 'New order' : 'Purchase orders') }}</span>
          @if (po(); as p) { <span class="pf-ctx__chip">{{ words[p.status] }}</span><span class="pf-ctx__chip">{{ p.supplierName }}</span> }
        </div>
        <pf-pharmacy-sections band-tools active="purchases"></pf-pharmacy-sections>
        <ng-container band-actions>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost press" (click)="startNew()">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            New order
          </button>
        </ng-container>
      </pf-hero-band>

      <div class="ph-body ph-body--left">
        <aside class="pf-card" aria-labelledby="ph-pol-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01"/></svg></span>
            <span class="pf-card__label" id="ph-pol-t">Orders</span>
            <span class="pf-card__spacer"></span>
            <div class="pf-seg" role="radiogroup" aria-label="Show">
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="open()" (click)="open.set(true)">Open</button>
              <button type="button" class="pf-seg__item" role="radio" [attr.aria-checked]="!open()" (click)="open.set(false)">All</button>
            </div>
          </header>
          <div class="pf-card__body">
            @for (r of list(); track r.id) {
              <button type="button" class="ph-row press" [attr.aria-current]="r.id === po()?.id" (click)="openPo(r.id)">
                <span class="ph-row__main"><span class="ph-row__name">{{ r.supplierName }}</span>
                  <span class="ph-row__meta pf-num">{{ r.poNumber || 'Draft' }} · {{ r.lines }} {{ r.lines === 1 ? 'line' : 'lines' }}</span></span>
                <span class="ph-row__end"><span class="pf-num">{{ inr(r.total, false) }}</span>
                  <span class="ph-dot" [attr.data-tone]="r.status === 'received' ? 'done' : r.status === 'cancelled' ? 'bad' : r.status === 'draft' ? null : 'warn'">{{ words[r.status] }}</span></span>
              </button>
            } @empty { <p class="ph-sub ph-empty-pad">No {{ open() ? 'open ' : '' }}purchase orders.</p> }
          </div>
        </aside>

        <section class="pf-card" aria-labelledby="ph-po-t">
          <header class="pf-card__head">
            <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h6"/></svg></span>
            <span class="pf-card__label" id="ph-po-t">{{ receiving() ? 'Goods received' : 'Order' }}</span>
            <span class="pf-card__note">{{ receiving() ? 'Enter the batch no., expiry and MRP printed on each carton.' : 'Cost is per unit before GST.' }}</span>
          </header>
          @if (!editing() && !po()) {
            <div class="pf-card__body"><div class="pf-empty"><p class="pf-empty__title">Pick an order or start a new one</p><p class="pf-empty__body">Draft → send to the supplier → receive the goods; received goods become batches in stock.</p>
              <button type="button" class="pf-btn pf-btn--secondary pf-empty__action" (click)="startNew()">New order</button></div></div>
          } @else if (receiving()) {
            <div class="pf-card__body">
              <div class="ph-tablewrap"><table class="ph-table">
                <thead><tr><th>Drug</th><th class="r">Ordered</th><th class="r">Got</th><th class="r">Now</th><th>Batch no.</th><th>Expiry</th><th class="r">MRP ₹</th></tr></thead>
                <tbody>
                  @for (g of grn(); track g.poLineId; let i = $index) {
                    <tr>
                      <td>{{ g.name }}</td><td class="r">{{ g.ordered }}</td><td class="r">{{ g.received }}</td>
                      <td class="r"><input class="pf-input pf-num" style="width:80px" type="number" min="0" [value]="g.qty" (input)="setGrn(i, 'qty', +$any($event.target).value)" [attr.aria-label]="'Receive now ' + g.name" /></td>
                      <td><input class="pf-input pf-num" style="width:120px" [value]="g.batchNo" (input)="setGrn(i, 'batchNo', $any($event.target).value)" [attr.aria-label]="'Batch ' + g.name" /></td>
                      <td style="min-width:160px"><pf-date [label]="'Expiry ' + g.name" [value]="g.expiry" [min]="today" (valueChange)="setGrn(i, 'expiry', $event)"></pf-date></td>
                      <td class="r"><input class="pf-input pf-num" style="width:90px" type="number" min="0" step="0.01" [value]="g.mrp || ''" (input)="setGrn(i, 'mrp', +$any($event.target).value)" [attr.aria-label]="'MRP ' + g.name" /></td>
                    </tr>
                  }
                </tbody>
              </table></div>
            </div>
            <div class="pf-card__foot">
              <button type="button" class="pf-btn pf-btn--danger" (click)="cancelPo()" [disabled]="po()?.status !== 'sent'">Cancel order</button>
              <button type="button" class="pf-btn" [class.pf-btn--primary]="grnReady()" [class.pf-btn--secondary]="!grnReady()" [disabled]="!grnReady() || busy()" [pfBusy]="busy()" pfBusyLabel="Receiving…" (click)="receive()">Receive goods</button>
            </div>
          } @else if (editing()) {
            <div class="pf-card__body">
              <div class="ph-fields">
                <div class="pf-field"><span class="pf-field__lbl">Supplier</span><pf-select [options]="supplierOpts()" [value]="supplierId()" (valueChange)="supplierId.set($event)" placeholder="Pick a supplier" [searchable]="true"></pf-select></div>
                <div class="pf-field"><span class="pf-field__lbl">Expected on</span><pf-date label="Expected on" [value]="expected()" [min]="today" (valueChange)="expected.set($event)"></pf-date></div>
                <div class="pf-field ph-span"><label class="pf-field__lbl" for="ph-pon">Notes</label><input id="ph-pon" class="pf-input" [value]="notes()" (input)="notes.set($any($event.target).value)" /></div>
              </div>
              <div class="ph-tablewrap"><table class="ph-table">
                <thead><tr><th>Drug</th><th class="r">Qty</th><th class="r">Cost ₹</th><th class="r">GST</th><th class="r">Total</th><th><span class="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  @for (l of lines(); track l.drugId; let i = $index) {
                    <tr>
                      <td>{{ l.name }} <span class="ph-sub">{{ l.strength }}</span></td>
                      <td class="r"><input class="pf-input pf-num" style="width:90px;margin-left:auto;text-align:right" type="number" min="1" [value]="l.qty" (input)="setLine(i, 'qty', +$any($event.target).value)" [attr.aria-label]="'Quantity ' + l.name" /></td>
                      <td class="r"><input class="pf-input pf-num" style="width:90px;margin-left:auto;text-align:right" type="number" min="0" step="0.01" [value]="l.unitCost || ''" (input)="setLine(i, 'unitCost', +$any($event.target).value)" [attr.aria-label]="'Cost ' + l.name" /></td>
                      <td class="r">{{ l.taxSlab }}%</td>
                      <td class="r">{{ inr(total(l)) }}</td>
                      <td><button type="button" class="pf-btn pf-btn--icon" (click)="removeLine(i)" [attr.aria-label]="'Remove ' + l.name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td>
                    </tr>
                  } @empty { <tr><td colspan="6" class="ph-muted" style="text-align:center;padding:20px">Add the drugs to order below.</td></tr> }
                </tbody>
              </table></div>
              <pf-pharmacy-drug-picker (picked)="addLine($event)"></pf-pharmacy-drug-picker>
              <p class="ph-sub ph-right pf-num">Order total {{ inr(grand()) }}</p>
            </div>
            <div class="pf-card__foot">
              @if (po()?.status === 'draft') { <button type="button" class="pf-btn pf-btn--danger" (click)="cancelPo()">Cancel order</button> }
              <button type="button" class="pf-btn pf-btn--secondary" [disabled]="!valid() || busy()" (click)="saveDraft(false)">Save draft</button>
              <button type="button" class="pf-btn pf-span" [class.pf-btn--primary]="valid()" [class.pf-btn--secondary]="!valid()" [disabled]="!valid() || busy()" [pfBusy]="busy()" pfBusyLabel="Sending…" (click)="saveDraft(true)">Send to supplier</button>
            </div>
          } @else if (po(); as p) {
            <div class="pf-card__body">
              <div class="ph-tablewrap"><table class="ph-table">
                <thead><tr><th>Drug</th><th class="r">Ordered</th><th class="r">Received</th><th class="r">Cost ₹</th></tr></thead>
                <tbody>@for (l of p.lines; track l.id) { <tr><td>{{ l.drugName }}</td><td class="r">{{ l.qty }}</td><td class="r">{{ l.receivedQty }}</td><td class="r">{{ inr(l.unitCost) }}</td></tr> }</tbody>
              </table></div>
              <p class="ph-sub">{{ words[p.status] }}{{ p.orderedAt ? ' · sent ' + day(p.orderedAt) : '' }} · total {{ inr(p.total) }}</p>
            </div>
          }
        </section>
      </div>
    </section>
  `,
  styles: [`.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`],
})
export class PharmacyPurchaseOrdersPage {
  private readonly api = inject(PharmacyApi);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  protected readonly today = labToday();
  protected readonly words = PO_WORDS;
  protected readonly inr = inr;
  protected readonly total = poLineTotal;

  protected readonly open = signal(true);
  private readonly all = signal<PoRow[]>([]);
  protected readonly suppliers = signal<SupplierRow[]>([]);
  protected readonly po = signal<PoView | null>(null);
  protected readonly editing = signal(false);
  protected readonly supplierId = signal('');
  protected readonly expected = signal<string | null>(null);
  protected readonly notes = signal('');
  protected readonly lines = signal<DraftLine[]>([]);
  protected readonly grn = signal<GrnRow[]>([]);
  protected readonly busy = signal(false);

  protected readonly list = computed(() => this.open() ? this.all().filter(r => r.status === 'draft' || r.status === 'sent' || r.status === 'partial') : this.all());
  protected readonly supplierOpts = computed<PfSelectOption<string>[]>(() => this.suppliers().filter(s => s.isActive).map(s => ({ value: s.id, label: s.name, hint: s.gstin ?? undefined })));
  protected readonly valid = computed(() => !!this.supplierId() && this.lines().length > 0 && this.lines().every(l => l.qty > 0 && l.unitCost >= 0));
  protected readonly grand = computed(() => this.lines().reduce((a, l) => a + poLineTotal(l), 0));
  protected readonly receiving = computed(() => { const s = this.po()?.status; return s === 'sent' || s === 'partial'; });
  protected readonly grnReady = computed(() => {
    const now = this.grn().filter(g => g.qty > 0);
    return now.length > 0 && now.every(g => !!g.batchNo.trim() && !!g.expiry && g.mrp >= 0);
  });

  constructor() {
    this.load();
    this.api.suppliers().subscribe({ next: s => this.suppliers.set(s), error: () => undefined });
  }
  private load() { this.api.purchaseOrders().subscribe({ next: r => this.all.set(r), error: e => this.toast.error(errText(e)) }); }
  protected day(iso: string) { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }

  protected startNew() {
    this.po.set(null); this.editing.set(true); this.supplierId.set(''); this.expected.set(null); this.notes.set(''); this.lines.set([]);
  }
  protected openPo(id: string) {
    this.api.purchaseOrder(id).subscribe({
      next: p => this.show(p),
      error: e => this.toast.error(errText(e)),
    });
  }
  private show(p: PoView) {
    this.po.set(p);
    this.editing.set(p.status === 'draft');
    this.supplierId.set(p.supplierId); this.expected.set(p.expectedOn ?? null); this.notes.set(p.notes ?? '');
    this.lines.set(p.lines.map(l => ({ drugId: l.drugId, name: l.drugName, strength: l.strength, qty: l.qty, unitCost: l.unitCost, taxSlab: l.taxSlab })));
    this.grn.set(p.lines.map(l => ({ poLineId: l.id, name: l.drugName, ordered: l.qty, received: l.receivedQty, qty: Math.max(0, l.qty - l.receivedQty), batchNo: '', expiry: null, mrp: l.defaultMrp ?? 0 })));
  }
  protected addLine(d: PharmacyDrugRow) {
    if (this.lines().some(l => l.drugId === d.id)) return;
    this.lines.update(a => [...a, { drugId: d.id, name: d.name, strength: d.strength, qty: d.form === 'tab' ? 100 : 10, unitCost: Math.round((d.defaultMrp ?? 0) * 0.7 * 100) / 100, taxSlab: d.taxSlab }]);
  }
  protected setLine(i: number, k: 'qty' | 'unitCost', v: number) { this.lines.update(a => a.map((l, j) => (j === i ? { ...l, [k]: Number.isFinite(v) ? v : 0 } : l))); }
  protected removeLine(i: number) { this.lines.update(a => a.filter((_, j) => j !== i)); }
  protected setGrn<K extends keyof GrnRow>(i: number, k: K, v: GrnRow[K]) { this.grn.update(a => a.map((g, j) => (j === i ? { ...g, [k]: v } : g))); }

  protected saveDraft(send: boolean) {
    if (!this.valid()) return;
    const body = { supplierId: this.supplierId(), expectedOn: this.expected(), notes: this.notes() || null, lines: this.lines().map(l => ({ drugId: l.drugId, qty: l.qty, unitCost: l.unitCost })) };
    const id = this.po()?.id;
    this.busy.set(true);
    (id ? this.api.updatePo(id, body) : this.api.createPo(body)).subscribe({
      next: p => {
        if (!send) { this.busy.set(false); this.show(p); this.toast.success('Draft saved'); this.load(); return; }
        this.api.sendPo(p.id).subscribe({
          next: s => { this.busy.set(false); this.show(s); this.toast.success(`${s.poNumber} sent to ${s.supplierName}`); this.load(); },
          error: e => { this.busy.set(false); this.show(p); this.toast.error(errText(e)); },
        });
      },
      error: e => { this.busy.set(false); this.toast.error(errText(e)); },
    });
  }
  protected receive() {
    const p = this.po();
    if (!p || !this.grnReady()) return;
    const lines: GrnLine[] = this.grn().filter(g => g.qty > 0).map(g => ({ poLineId: g.poLineId, batchNo: g.batchNo.trim(), expiryDate: g.expiry!, mrp: g.mrp, qty: g.qty }));
    this.busy.set(true);
    this.api.receivePo(p.id, lines).subscribe({
      next: r => { this.busy.set(false); this.show(r); this.toast.success(r.status === 'received' ? 'All goods received — batches are in stock' : 'Received — the rest is still due'); this.load(); },
      error: e => { this.busy.set(false); this.toast.error(errText(e)); },
    });
  }
  protected async cancelPo() {
    const p = this.po();
    if (!p) return;
    const ok = await this.dialog.confirm({ title: 'Cancel this order?', message: 'The supplier should be told separately. Nothing has been received on it.', confirmLabel: 'Cancel order', cancelLabel: 'Keep it', tone: 'danger' });
    if (!ok) return;
    this.api.cancelPo(p.id).subscribe({ next: c => { this.show(c); this.toast.success('Order cancelled'); this.load(); }, error: e => this.toast.error(errText(e)) });
  }
}
