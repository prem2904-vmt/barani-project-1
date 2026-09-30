import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { PatientSearchComponent } from '../../../shared/components/patient-search/patient-search.component';
import type { Patient } from '../../../shared/models/patient.model';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { labToday } from '../../../shared/utils/lab-clock';
import { waLink } from '../../../shared/utils/whatsapp';
import type { PharmacyConfig } from '../shared/opd.models';
import { DEFAULT_PHARMACY_CONFIG } from '../shared/opd.models';
import {
  PharmacyApi, type CounterBody, type DispenseSummary, type DispenseView, type PayMode, type PharmacyDrugRow, type PickBatch,
} from './pharmacy.api';
import { cartTotals, errText, expiryLabel, inr, needsPrescription, needsRegister, scheduleLabel, unitWords } from './pharmacy-math';
import { previewFefo, type Take } from './dispense.page';
import { printPharmacySheet } from './pharmacy-print';
import { PharmacyDrugPickerComponent } from './drug-picker.component';
import { PharmacySectionsComponent } from './pharmacy-sections.component';
import { phoneSignal } from './phone';

export interface CounterItem { drug: PharmacyDrugRow; qty: number; batchId: string | null; batches: PickBatch[] }

/** The cart's schedule gate (mirror of PharmacyDispenseService.EnforceSchedules):
 *  null = OK, else what is missing. */
export function counterGate(items: Pick<CounterItem, 'drug'>[], prescriber: string, buyer: string, enforce: boolean): string | null {
  const restricted = items.filter(i => needsPrescription(i.drug.schedule));
  if (!restricted.length) return null;
  if (enforce && !prescriber.trim())
    return `${restricted.map(i => i.drug.name).join(', ')} ${restricted.length === 1 ? 'is' : 'are'} prescription-only — enter the prescription to sell.`;
  if (items.some(i => needsRegister(i.drug.schedule))) {
    if (!buyer.trim()) return 'Schedule H1 / X sales go in the register — enter the customer’s name.';
    if (!prescriber.trim()) return 'Schedule H1 / X sales go in the register — enter the prescribing doctor.';
  }
  return null;
}

/**
 * Walk-in counter (`/opd/pharmacy/counter`) — sell without an OPD visit:
 * search drugs, a cart, a retail GST invoice (optionally linked to a
 * patient). The bill stays EDITABLE until it is paid (Pharmacy settings);
 * "Save bill" parks it as an open bill. OTC sells freely; Schedule H / H1 / X
 * need an entered prescription (prescriber + reg. no.); H1 / X also the
 * buyer's name for the register.
 */
@Component({
  selector: 'pf-pharmacy-walk-in-counter',
  standalone: true,
  imports: [HeroBandComponent, SelectComponent, BusyDirective, PatientSearchComponent, PharmacyDrugPickerComponent, PharmacySectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true" [contextBar]="true">
        <div band-search class="nd-ctx ph-ctx">
          <span class="nd-ctx__primary">{{ patient()?.name || name() || 'Walk-in customer' }}</span>
          <span class="nd-ctx__chip">{{ editingId() ? (editable() ? 'Open bill' : 'Bill') : 'New sale' }}</span>
          @if (prescriber()) { <span class="nd-ctx__chip">Rx · {{ prescriber() }}</span> } @else { <span class="nd-ctx__chip">No prescription</span> }
        </div>
        <pf-pharmacy-sections band-tools active="counter"></pf-pharmacy-sections>
      </pf-hero-band>

      <div class="ph-body">
        <section class="nd-card" aria-labelledby="ph-c-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6"/></svg></span>
            <span class="nd-card__label" id="ph-c-t">Counter</span>
            <span class="nd-card__note">Walk-in bills stay editable until paid · Batch pick: {{ cfg().batchPick === 'pharmacist' ? 'pharmacist picks' : 'earliest expiry' }}</span>
          </header>
          <div class="nd-card__body">
            @if (paid()) {
              <div class="nd-empty">
                <span class="nd-empty__icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>
                <p class="nd-empty__title">{{ inr(paid()!.bill?.totalPaid ?? 0, false) }} received</p>
                <p class="nd-empty__body nd-num">{{ paid()!.customerName || 'Walk-in customer' }} · {{ paid()!.bill?.invoiceNumber }}</p>
              </div>
            } @else {
              <div class="ph-fields">
                <div class="nd-field">
                  <label class="nd-field__lbl" for="ph-wn">Customer name <span class="ph-muted">· optional for OTC</span></label>
                  <input id="ph-wn" class="nd-input" [value]="name()" (input)="name.set($any($event.target).value)" placeholder="e.g. Mr. Anand" [disabled]="locked()" />
                </div>
                <div class="nd-field">
                  <label class="nd-field__lbl" for="ph-wp">Mobile <span class="ph-muted">· for the WhatsApp bill</span></label>
                  <input id="ph-wp" class="nd-input nd-num" inputmode="tel" [value]="phone()" (input)="phone.set($any($event.target).value)" placeholder="10-digit mobile" [disabled]="locked()" />
                </div>
                <div class="nd-field ph-span">
                  <span class="nd-field__lbl">Link to a patient <span class="ph-muted">· optional</span></span>
                  @if (patient(); as p) {
                    <div class="ph-row" style="cursor:default"><span class="ph-row__main"><span class="ph-row__name">{{ p.name }}</span><span class="ph-row__meta nd-num">{{ p.meta }}</span></span>
                      @if (!locked()) { <button type="button" class="nd-btn nd-btn--tertiary" (click)="patient.set(null)">Unlink</button> }</div>
                  } @else if (!locked()) {
                    <pf-patient-search placeholder="Search patient by name, MRN or phone" (picked)="linkPatient($event)"></pf-patient-search>
                  }
                </div>
              </div>

              @if (rxNeeded() || prescriber() || regNo()) {
                <div class="ph-fields">
                  <div class="nd-field">
                    <label class="nd-field__lbl" for="ph-pr">Prescribing doctor <span class="nd-dot-unpriced" aria-hidden="true"></span></label>
                    <input id="ph-pr" class="nd-input" [value]="prescriber()" (input)="prescriber.set($any($event.target).value)" placeholder="Dr. name on the prescription" [disabled]="locked()" />
                  </div>
                  <div class="nd-field">
                    <label class="nd-field__lbl" for="ph-rg">Registration no.</label>
                    <input id="ph-rg" class="nd-input nd-num" [value]="regNo()" (input)="regNo.set($any($event.target).value)" placeholder="e.g. TNMC 12345" [disabled]="locked()" />
                  </div>
                  <p class="nd-field__hint ph-span">Check the original prescription before selling a Schedule H / H1 / X drug. It is recorded on the bill{{ h1() ? ' and in the H1 register' : '' }}.</p>
                </div>
              }

              <div class="ph-tablewrap">
                <table class="ph-table">
                  <thead><tr><th scope="col">Drug</th><th scope="col">Batch</th><th scope="col" class="r">Qty</th><th scope="col" class="r">Left after</th><th scope="col" class="r">MRP</th><th scope="col" class="r">Amount</th><th scope="col"><span class="sr-only">Remove</span></th></tr></thead>
                  <tbody>
                    @for (it of items(); track it.drug.id; let i = $index) {
                      <tr>
                        <td style="min-width:200px">
                          <div class="ph-row__name" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">{{ it.drug.name }} <span class="ph-sch" [attr.data-rx]="isRx(it.drug.schedule)">{{ schLabel(it.drug.schedule) }}</span></div>
                          <div class="ph-sub">{{ it.drug.generic }}{{ it.drug.strength ? ' · ' + it.drug.strength : '' }}</div>
                        </td>
                        <td class="nd-num" data-l="Batch">
                          @if (cfg().batchPick === 'pharmacist') {
                            <pf-select size="sm" [options]="batchOpts(it)" [value]="it.batchId ?? ''" (valueChange)="setBatch(i, $event)" placeholder="Pick a batch" [disabled]="locked()"></pf-select>
                          } @else {
                            @for (t of takes(it); track t.batchId) { <div>{{ t.batchNo }} <span class="ph-sub">exp {{ exp(t.expiryDate) }}{{ $first ? ' · earliest' : '' }}</span></div> }
                            @if (!takes(it).length) { <span class="ph-low">Not enough stock</span> }
                          }
                        </td>
                        <td class="r" data-l="Qty">
                          <span class="ph-qty">
                            <button type="button" (click)="bump(i, -1)" [disabled]="it.qty <= 1 || locked()" [attr.aria-label]="'Less ' + it.drug.name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
                            <input type="number" inputmode="numeric" [value]="it.qty" [attr.aria-label]="'Quantity of ' + it.drug.name" (change)="setQty(i, $any($event.target).value)" [disabled]="locked()" />
                            <button type="button" (click)="bump(i, 1)" [disabled]="locked()" [attr.aria-label]="'More ' + it.drug.name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
                          </span>
                        </td>
                        <td class="r" data-l="Left after" [class.ph-low]="left(it) < 0">{{ units(left(it), it.drug) }}</td>
                        <td class="r" data-l="MRP">{{ inr(mrpOf(it)) }}</td>
                        <td class="r" data-l="Amount">{{ inr(amount(it)) }}</td>
                        <td class="ph-td-act">@if (!locked()) { <button type="button" class="nd-btn nd-btn--icon" (click)="remove(i)" [attr.aria-label]="'Remove ' + it.drug.name"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button> }</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="7" class="ph-muted" style="text-align:center;padding:24px">Cart is empty — add a drug below.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (!locked()) { <pf-pharmacy-drug-picker (picked)="add($event)"></pf-pharmacy-drug-picker> }
            }
          </div>
        </section>

        <aside class="nd-card" aria-labelledby="ph-cb-t">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
            <span class="nd-card__label" id="ph-cb-t">Billing</span>
            <span class="nd-card__spacer"></span>
            <span class="ph-sub nd-num">{{ items().length }} {{ items().length === 1 ? 'item' : 'items' }}</span>
          </header>
          <div class="nd-card__body">
            @if (paid()) {
              <p class="ph-title">WhatsApp bill{{ phone() ? ' to ' + phone() : '' }}</p>
              <div class="ph-wa">{{ receiptText() }}</div>
            } @else {
              @for (it of items(); track it.drug.id) {
                <div style="display:flex;justify-content:space-between;gap:10px;font-size:13.5px"><span>{{ it.drug.name }} <span class="ph-muted nd-num">× {{ it.qty }}</span></span><span class="nd-num">{{ inr(amount(it)) }}</span></div>
              }
              <div class="nd-field">
                <label class="nd-field__lbl" for="ph-cd">Discount (₹, before GST)</label>
                <input id="ph-cd" class="nd-input nd-num" type="number" min="0" inputmode="decimal" [value]="discount() || ''" (input)="setDiscount($any($event.target).value)" placeholder="0" [disabled]="locked()" />
              </div>
              <div class="nd-field">
                <span class="nd-field__lbl" id="ph-cpay">Payment</span>
                <div class="nd-seg" role="radiogroup" aria-labelledby="ph-cpay" style="width:100%">
                  @for (m of modes; track m.v) { <button type="button" class="nd-seg__item" style="flex:1" role="radio" [attr.aria-checked]="mode() === m.v" (click)="mode.set(m.v)">{{ m.l }}</button> }
                </div>
              </div>
              @if (gate(); as g) {
                <div class="ph-note" data-tone="bad" role="alert"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v4M12 16h.01"/></svg><span>{{ g }}</span></div>
              } @else if (rxNeeded()) {
                <div class="ph-note" role="note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg><span>Prescription-only drugs covered by {{ prescriber() || 'the prescription' }}.</span></div>
              }
              @if (openBills().length) {
                <p class="ph-title" style="margin-top:6px">Open bills</p>
                @for (b of openBills(); track b.id) {
                  <button type="button" class="ph-row press" [attr.aria-current]="b.id === editingId()" (click)="openBill(b)">
                    <span class="ph-row__main"><span class="ph-row__name">{{ b.customerName || 'Walk-in customer' }}</span><span class="ph-row__meta nd-num">{{ b.lines }} {{ b.lines === 1 ? 'item' : 'items' }} · {{ time(b.createdAt) }}</span></span>
                    <span class="ph-row__end nd-num">{{ inr(b.total) }}</span>
                  </button>
                }
              }
            }
          </div>
          <div class="nd-card__foot">
            @if (paid()) {
              <button type="button" class="nd-btn nd-btn--secondary" (click)="print()">Print receipt</button>
              <a class="nd-btn nd-btn--secondary" [href]="receiptHref()" target="_blank" rel="noopener">WhatsApp bill</a>
              <button type="button" class="nd-btn nd-btn--primary nd-span" (click)="reset()">New sale</button>
            } @else {
              <div class="ph-sum">
                <span>Taxable value</span><span>{{ inr(totals().taxable) }}</span>
                @if (totals().discount > 0) { <span>Discount</span><span>−{{ inr(totals().discount) }}</span> }
                <span>GST (CGST + SGST)</span><span>{{ inr(totals().tax) }}</span>
                <span>Round-off</span><span>{{ totals().roundOff >= 0 ? '+' : '−' }}{{ inr(abs(totals().roundOff)) }}</span>
              </div>
              <div class="ph-total"><span>Total</span><strong>{{ inr(totals().payable) }}</strong></div>
              @if (editingId() && !locked()) {
                <button type="button" class="nd-btn nd-btn--danger" [disabled]="saving()" (click)="cancelBill()">Cancel bill</button>
              }
              <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!ready() || saving() || locked()" (click)="save()">Save bill</button>
              @if (!isPhone()) {
                <button type="button" class="nd-btn nd-span" [class.nd-btn--primary]="ready()" [class.nd-btn--secondary]="!ready()"
                        [disabled]="!ready() || saving()" [pfBusy]="saving()" pfBusyLabel="Taking payment…" (click)="pay()">Take payment {{ inr(totals().payable, false) }}</button>
              }
            }
          </div>
        </aside>
        @if (isPhone() && !paid()) {
          <div class="nd-bottombar" role="region" aria-label="Payment">
            <span class="nd-bottombar__info nd-num">{{ inr(totals().payable, false) }} · {{ items().length }} {{ items().length === 1 ? 'item' : 'items' }}</span>
            <button type="button" class="nd-btn" [class.nd-btn--primary]="ready()" [class.nd-btn--secondary]="!ready()"
                    [disabled]="!ready() || saving()" [pfBusy]="saving()" pfBusyLabel="Taking payment…" (click)="pay()">Take payment</button>
          </div>
        }
      </div>
    </section>
  `,
  styles: [`.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`],
})
export class PharmacyWalkInCounterPage {
  private readonly api = inject(PharmacyApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantStateService);

  protected readonly isPhone = phoneSignal();
  protected readonly cfg = signal<PharmacyConfig>(DEFAULT_PHARMACY_CONFIG);
  protected readonly items = signal<CounterItem[]>([]);
  protected readonly name = signal('');
  protected readonly phone = signal('');
  protected readonly prescriber = signal('');
  protected readonly regNo = signal('');
  protected readonly patient = signal<{ id: string; name: string; meta: string } | null>(null);
  protected readonly discount = signal(0);
  protected readonly mode = signal<PayMode>('upi');
  protected readonly saving = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly editable = signal(true);
  protected readonly paid = signal<DispenseView | null>(null);
  protected readonly openBills = signal<DispenseSummary[]>([]);
  private readonly today = labToday();
  protected readonly modes: { v: PayMode; l: string }[] = [{ v: 'cash', l: 'Cash' }, { v: 'upi', l: 'UPI' }, { v: 'card', l: 'Card' }];
  protected readonly inr = inr;
  protected readonly abs = Math.abs;

  constructor() {
    this.api.settings().subscribe({ next: s => this.cfg.set(s), error: () => undefined });
    this.loadOpen();
  }

  private loadOpen() {
    this.api.dispenses(null, 'walk_in', 'draft').subscribe({ next: d => this.openBills.set(d), error: () => this.openBills.set([]) });
  }

  protected readonly locked = computed(() => !!this.editingId() && !this.editable());
  protected readonly rxNeeded = computed(() => this.items().some(i => needsPrescription(i.drug.schedule)));
  protected readonly h1 = computed(() => this.items().some(i => needsRegister(i.drug.schedule)));
  protected readonly gate = computed(() => counterGate(this.items(), this.prescriber(), this.name() || this.patient()?.name || '', this.cfg().enforceSchedules));
  protected readonly totals = computed(() => cartTotals(this.items().flatMap(it =>
    this.takes(it).map(t => ({ qty: t.qty, mrp: t.mrp, taxSlab: it.drug.taxSlab }))), this.discount()));
  protected readonly ready = computed(() => this.items().length > 0 && !this.gate()
    && this.items().every(it => this.takes(it).reduce((a, t) => a + t.qty, 0) === it.qty));

  protected takes(it: CounterItem): Take[] {
    if (this.cfg().batchPick === 'pharmacist') {
      const b = it.batches.find(x => x.id === it.batchId);
      return b && b.qtyOnHand >= it.qty ? [{ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: it.qty, mrp: b.mrp }] : [];
    }
    const t = previewFefo(it.batches, it.qty, this.today);
    return t.reduce((a, x) => a + x.qty, 0) === it.qty ? t : [];
  }
  protected mrpOf(it: CounterItem) { return this.takes(it)[0]?.mrp ?? it.batches[0]?.mrp ?? it.drug.defaultMrp ?? 0; }
  protected amount(it: CounterItem) { return this.takes(it).reduce((a, t) => a + t.qty * t.mrp, 0) || it.qty * this.mrpOf(it); }
  protected left(it: CounterItem) { return it.batches.reduce((a, b) => a + b.qtyOnHand, 0) - it.qty; }
  protected units(n: number, d: PharmacyDrugRow) { return unitWords(n, d.unit, d.form); }
  protected exp(iso: string) { return expiryLabel(iso); }
  protected isRx(s: string) { return needsPrescription(s); }
  protected schLabel(s: string) { return scheduleLabel(s); }
  protected time(iso: string) { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  protected batchOpts(it: CounterItem): PfSelectOption<string>[] {
    return it.batches.map((b, i) => ({ value: b.id, label: `${b.batchNo} · exp ${expiryLabel(b.expiryDate)}${i === 0 ? ' · earliest' : ''}`, hint: `${b.qtyOnHand} left · ${inr(b.mrp)}` }));
  }

  // ── Cart ──────────────────────────────────────────────────────────────────
  protected add(d: PharmacyDrugRow): void {
    const at = this.items().findIndex(i => i.drug.id === d.id);
    if (at >= 0) { this.bump(at, 1); return; }
    const qty = d.form === 'tab' || d.form === 'sachet' ? 10 : 1;
    this.items.update(a => [...a, { drug: d, qty, batchId: null, batches: [] }]);
    this.fetchBatches(d.id);
  }
  private fetchBatches(drugId: string, then?: () => void): void {
    this.api.batches(drugId).subscribe({
      next: rows => {
        const b = rows.filter(r => !r.expired).map(r => ({ id: r.id, batchNo: r.batchNo, expiryDate: r.expiryDate, mrp: r.mrp, qtyOnHand: r.qtyOnHand }));
        this.items.update(a => a.map(i => i.drug.id === drugId ? { ...i, batches: b } : i));
        then?.();
      },
      error: () => undefined,
    });
  }
  protected bump(i: number, d: number) { this.setQty(i, String((this.items()[i]?.qty ?? 0) + d)); }
  protected setQty(i: number, v: string) {
    const n = Math.floor(Number(v));
    if (!Number.isFinite(n) || n < 1) return;
    this.items.update(a => a.map((x, k) => (k === i ? { ...x, qty: n } : x)));
  }
  protected setBatch(i: number, id: string) { this.items.update(a => a.map((x, k) => (k === i ? { ...x, batchId: id } : x))); }
  protected remove(i: number) { this.items.update(a => a.filter((_, k) => k !== i)); }
  protected setDiscount(v: string) { const n = Number(v); this.discount.set(Number.isFinite(n) && n > 0 ? n : 0); }
  protected linkPatient(p: Patient) {
    const name = [p.title, p.firstName, p.fathersName].filter(Boolean).join(' ');
    this.patient.set({ id: p.id, name, meta: [p.mrn, p.phone].filter(Boolean).join(' · ') });
    if (!this.name()) this.name.set(name);
    if (!this.phone() && p.phone) this.phone.set(p.phone);
  }

  private body(): CounterBody {
    return {
      patientId: this.patient()?.id ?? null, walkInName: this.name().trim() || null, walkInPhone: this.phone().trim() || null,
      prescriberName: this.prescriber().trim() || null, prescriberRegNo: this.regNo().trim() || null, discount: this.discount(),
      lines: this.items().map(it => ({ drugId: it.drug.id, qty: it.qty, batchId: this.cfg().batchPick === 'pharmacist' ? it.batchId : null })),
    };
  }

  /** Create or update the open bill (drafts move no stock). */
  private upsert() {
    const id = this.editingId();
    if (id && this.locked()) return this.api.dispense(id);
    return id ? this.api.counterUpdate(id, this.body()) : this.api.counterCreate(this.body());
  }

  protected save(): void {
    if (!this.ready()) return;
    this.saving.set(true);
    this.upsert().subscribe({
      next: v => { this.saving.set(false); this.toast.success(`Bill saved · ${inr(v.bill?.totalPayable ?? 0, false)} — open it again to take payment`); this.reset(); this.loadOpen(); },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }

  protected pay(): void {
    if (!this.ready()) return;
    this.saving.set(true);
    this.upsert().subscribe({
      next: draft => {
        const amount = draft.bill?.totalPayable ?? 0;
        this.api.counterPay(draft.id, { mode: this.mode(), amount }).subscribe({
          next: v => { this.saving.set(false); this.paid.set(v); this.editingId.set(null); this.toast.success(`${inr(amount, false)} received`); this.loadOpen(); },
          error: e => { this.saving.set(false); this.editingId.set(draft.id); this.editable.set(draft.editable); this.toast.error(errText(e)); },
        });
      },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }

  protected openBill(b: DispenseSummary): void {
    this.api.dispense(b.id).subscribe({
      next: v => {
        this.paid.set(null);
        this.editingId.set(v.id);
        this.editable.set(v.editable);
        this.name.set(v.customerName ?? '');
        this.phone.set(v.customerPhone ?? '');
        this.prescriber.set(v.prescriberName ?? '');
        this.regNo.set(v.prescriberRegNo ?? '');
        this.patient.set(v.patientId ? { id: v.patientId, name: v.customerName ?? 'Patient', meta: '' } : null);
        this.discount.set(v.bill?.discount ?? 0);
        const merged = new Map<string, CounterItem>();
        for (const l of v.lines) {
          const cur = merged.get(l.drugId);
          if (cur) { cur.qty += l.qty; continue; }
          merged.set(l.drugId, {
            drug: { id: l.drugId, rowId: l.drugId, catalogKey: '', origin: 'master', isMaster: true, name: l.drugName, generic: l.generic, form: l.form, unit: l.unit, schedule: l.schedule, taxSlab: 0, aliases: [], isActive: true },
            qty: l.qty, batchId: l.batchId, batches: [],
          });
        }
        this.items.set([...merged.values()]);
        // Tax slab + live batches from the catalogue.
        for (const it of this.items()) {
          this.api.searchDrugs(it.drug.name, 5).subscribe(r => {
            const d = r.find(x => x.id === it.drug.id);
            if (d) this.items.update(a => a.map(x => x.drug.id === d.id ? { ...x, drug: d } : x));
          });
          this.fetchBatches(it.drug.id);
        }
      },
      error: e => this.toast.error(errText(e)),
    });
  }

  protected async cancelBill(): Promise<void> {
    const id = this.editingId();
    if (!id) return;
    const ok = await this.dialog.confirm({ title: 'Cancel this bill?', message: 'The open bill is cancelled. Nothing was taken from stock.', confirmLabel: 'Cancel bill', cancelLabel: 'Keep it', tone: 'danger' });
    if (!ok) return;
    this.api.counterCancel(id).subscribe({
      next: () => { this.toast.success('Bill cancelled'); this.reset(); this.loadOpen(); },
      error: e => this.toast.error(errText(e)),
    });
  }

  protected reset(): void {
    this.items.set([]); this.name.set(''); this.phone.set(''); this.prescriber.set(''); this.regNo.set('');
    this.patient.set(null); this.discount.set(0); this.editingId.set(null); this.editable.set(true); this.paid.set(null);
  }

  // ── Receipt ───────────────────────────────────────────────────────────────
  private readonly clinic = computed(() => this.tenant.tenant()?.brandingName?.trim() || this.tenant.tenant()?.name || this.auth.user()?.tenantName || 'the pharmacy');
  protected readonly receiptText = computed(() => {
    const v = this.paid();
    if (!v) return '';
    const lines = v.lines.map((l, i) => `${i + 1}. ${l.drugName} × ${l.qty} — ${inr(l.total)}`).join('\n');
    return `Hello${v.customerName ? ' ' + v.customerName.split(' ')[0] : ''}, thank you for your purchase at ${this.clinic()}.\n\n${lines}\n\nTotal paid: ${inr(v.bill?.totalPaid ?? 0)} (invoice ${v.bill?.invoiceNumber ?? ''}, MRP includes GST).`;
  });
  protected readonly receiptHref = computed(() => waLink(this.phone() || null, this.receiptText()));
  protected print(): void {
    const v = this.paid();
    if (!v) return;
    printPharmacySheet({
      clinic: this.clinic(), title: 'Pharmacy receipt', patientName: v.customerName || 'Walk-in customer', doctor: v.prescriberName,
      doctorRegNo: v.prescriberRegNo, number: v.bill?.invoiceNumber ?? v.number, instructions: [], lines: v.lines, bill: v.bill,
    });
  }
  protected goQueue(): void { void this.router.navigateByUrl('/opd/pharmacy'); }
}
