import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SelectComponent, type PfSelectOption } from '../../../shared/primitives/select.component';
import { SkeletonDetailComponent } from '../../../shared/primitives/skeleton-kit.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { heldFlag } from '../../../shared/utils/min-duration';
import { waLink } from '../../../shared/utils/whatsapp';
import { ToastService } from '../../../core/services/toast.service';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/auth/auth.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { labToday } from '../../../shared/utils/lab-clock';
import { shortSched } from '../shared/rx-schedule';
import {
  PharmacyApi, type BatchRow, type DispenseLineInput, type DispenseView, type DrugBrief, type PayMode, type PickBatch,
  type PharmacyDrugRow, type PharmacyInvoiceHeader, type RxDetail, type RxLineView,
} from './pharmacy.api';
import { cartTotals, errText, expiryBand, expiryChip, expiryLabel, inr, needsPrescription, needsRegister, scheduleLabel, unitWords, type CartLine } from './pharmacy-math';
import { instructionFor, whatsAppText, type InstructionLine } from './pharmacy-instructions';
import { printPharmacySheet } from './pharmacy-print';
import { PharmacyDrugPickerComponent } from './drug-picker.component';
import { phoneSignal } from './phone';

interface LineState { drugId: string | null; qty: number; batchId: string | null; skip: boolean; overrideReason: string }

export interface Take { batchId: string; batchNo: string; expiryDate: string; qty: number; mrp: number }

/** Sane ceiling for a corrected quantity (critic #4): 5× the Rx quantity —
 *  mirror of the server's OverrideCeilingMultiplier. Stock is the OTHER,
 *  tighter cap, applied separately (never more than what's on the shelf). */
export function overrideCeiling(rxQuantity: number): number {
  return Math.max(1, Math.ceil(rxQuantity * 5));
}

/** A reason is required only once the dispensed qty passes what's left on
 *  the prescription (mirror of the server's over_prescribed / OverrideReason gate). */
export function needsOverrideReason(qty: number, remaining: number): boolean {
  return qty > remaining;
}

/** Earliest-expiry split of `qty` over sellable batches (mirror of
 *  PharmacyRules.PickFefo for the PREVIEW; the server picks for real). */
export function previewFefo(batches: PickBatch[], qty: number, todayIso: string): Take[] {
  const out: Take[] = [];
  let left = qty;
  for (const b of [...batches].filter(b => b.qtyOnHand > 0 && b.expiryDate.slice(0, 10) >= todayIso)
    .sort((a, c) => a.expiryDate.localeCompare(c.expiryDate))) {
    if (left <= 0) break;
    const t = Math.min(left, b.qtyOnHand);
    out.push({ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: t, mrp: b.mrp });
    left -= t;
  }
  return out;
}

/**
 * Dispense a prescription (`/opd/pharmacy/dispense/:visitId`) — the mockup's
 * Counter · From prescription: each Rx line arrives with its calculated
 * quantity (server RxScheduleMath = rx-schedule rxQty) and the earliest-
 * expiring batch (or the pharmacist picks, per Pharmacy settings); a same-
 * generic substitute can be given; lines can be given in part or skipped.
 * BILLING (side card) mirrors the server bill (BillMath: discount before GST,
 * rupee round-off). After payment the side card becomes the patient's
 * INSTRUCTIONS: the plain-language lines, the 14-day strip for non-daily
 * schedules, Print and a WhatsApp-ready message.
 */
@Component({
  selector: 'pf-pharmacy-dispense',
  standalone: true,
  imports: [HeroBandComponent, SelectComponent, SkeletonDetailComponent, BusyDirective, PharmacyDrugPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./pharmacy.scss'],
  template: `
    <section class="pf-band-page ph">
      <pf-hero-band [back]="true" backTo="/opd/pharmacy" [customSearch]="true" [contextBar]="true">
        <div band-search class="nd-ctx ph-ctx">
          @if (rx(); as d) {
            <span class="nd-ctx__primary">{{ d.patient.name }}</span>
            @if (d.patient.meta) { <span class="nd-ctx__chip nd-num">{{ d.patient.meta }}</span> }
            @if (d.visitNumber) { <span class="nd-ctx__chip nd-num">{{ d.visitNumber }}</span> }
            <span class="nd-ctx__chip">Rx · {{ d.lines.length }} {{ d.lines.length === 1 ? 'medicine' : 'medicines' }}</span>
          } @else {
            <span class="nd-ctx__primary">Prescription</span>
          }
        </div>
      </pf-hero-band>

      @if (showSkeleton()) {
        <div class="ph-body"><pf-skeleton-detail></pf-skeleton-detail><div></div></div>
      } @else if (error()) {
        <div class="ph-body ph-body--one"><div class="nd-card"><div class="nd-empty"><p class="nd-empty__title">Couldn't open this prescription</p><p class="nd-empty__body">{{ error() }}</p></div></div></div>
      } @else if (rx(); as d) {
        <div class="ph-body">
          <section class="nd-card" aria-labelledby="ph-d-t">
            <header class="nd-card__head">
              <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7Z"/><path d="m8.5 8.5 7 7"/></svg></span>
              <span class="nd-card__label" id="ph-d-t">Counter</span>
              <span class="nd-card__note">Rx from {{ d.doctor.name }}{{ d.completedAt ? ' · ' + time(d.completedAt) : '' }} · Batch pick: {{ pharmacistPick() ? 'pharmacist picks' : 'earliest expiry' }}</span>
            </header>
            <div class="nd-card__body">
              @if (d.consultStatus !== 'completed') {
                <div class="ph-note" data-tone="bad" role="status"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg><span>The doctor hasn't completed this consult yet — medicines can be given once it is completed.</span></div>
              }
              <div class="ph-tablewrap">
                <table class="ph-table">
                  <thead><tr><th scope="col">Drug</th><th scope="col">Batch</th><th scope="col" class="r">Qty</th><th scope="col" class="r">Left after</th><th scope="col" class="r">MRP</th><th scope="col" class="r">Amount</th><th scope="col"><span class="sr-only">Give or skip</span></th></tr></thead>
                  <tbody>
                    @for (l of d.lines; track l.rxLineId) {
                      @let s = st(l);
                      @let drug = given(l);
                      <tr [attr.data-skip]="s.skip || l.remaining <= 0">
                        <td style="min-width:220px">
                          <div class="ph-row__name" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">{{ drug?.generic || drug?.name || l.drugName }}
                            @if (drug) { <span class="ph-sch" [attr.data-rx]="isRx(drug.schedule)">{{ schLabel(drug.schedule) }}</span> }
                            @if (pregChip(drug); as pc) { <span class="ph-preg" [attr.data-tone]="pc.tone">{{ pc.label }}</span> }
                          </div>
                          <div class="ph-sub">{{ brandLine(drug) }}{{ brandLine(drug) ? ' · ' : '' }}{{ sched(l) }}</div>
                          @if (drug && drug.id !== l.drug?.id) { <div class="ph-sub">Substituted for {{ l.drugName }}</div> }
                          @if (l.remaining <= 0) { <div class="ph-sub">{{ l.dispenseStatus === 'not_dispensed' ? 'Not given' : 'Already given' }}</div> }
                          @else if (d.consultStatus !== 'completed') {
                            <div class="ph-sub">{{ l.quantity }} {{ l.form }} prescribed — waiting on the doctor</div>
                          }
                          @else if (subOptions(l).length > 1 && !s.skip) {
                            <div style="margin-top:6px;max-width:280px">
                              <pf-select size="sm" [options]="subOptions(l)" [value]="s.drugId ?? ''" (valueChange)="setDrug(l, $event)" placeholder="Give…"></pf-select>
                            </div>
                          }
                          @if (d.consultStatus === 'completed' && !l.drug && !drug && l.remaining > 0) {
                            <div style="margin-top:6px"><pf-pharmacy-drug-picker [down]="true" placeholder="Not in the drug master — pick the drug to give" (picked)="pickFree(l, $event)"></pf-pharmacy-drug-picker></div>
                          }
                        </td>
                        <td class="nd-num" data-l="Batch">
                          @if (d.consultStatus !== 'completed' || !drug || s.skip || l.remaining <= 0) { <span class="ph-muted">—</span> }
                          @else if (pharmacistPick()) {
                            <pf-select size="sm" [options]="batchOptions(l)" [value]="s.batchId ?? ''" (valueChange)="setBatch(l, $event)" placeholder="Pick a batch"></pf-select>
                          } @else {
                            @for (t of takes(l); track t.batchId) { <div>{{ t.batchNo }} <span class="ph-sub" [class]="expChip(t.expiryDate).cls">exp {{ expChip(t.expiryDate).label }}{{ $first ? ' · earliest' : '' }}{{ takes(l).length > 1 ? ' · ' + t.qty : '' }}</span></div> }
                            @if (!takes(l).length) { <span class="ph-low">No stock</span> }
                          }
                        </td>
                        <td class="r" data-l="Qty">
                          @if (d.consultStatus === 'completed' && l.remaining > 0 && !s.skip) {
                            <span class="ph-qty">
                              <button type="button" (click)="bump(l, -1)" [disabled]="s.qty <= 1" [attr.aria-label]="'Less ' + l.drugName"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
                              <input type="number" inputmode="numeric" [value]="s.qty" [attr.aria-label]="'Quantity of ' + l.drugName" (change)="setQty(l, $any($event.target).value)" />
                              <button type="button" (click)="bump(l, 1)" [disabled]="s.qty >= maxQty(l)" [attr.aria-label]="'More ' + l.drugName"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
                            </span>
                            @if (s.qty < l.remaining) { <div class="ph-sub">{{ l.remaining - s.qty }} later</div> }
                            @else if (s.qty > l.remaining) {
                              <div class="ph-sub pf-exp-amber">{{ s.qty - l.remaining }} more than prescribed ({{ l.quantity }})</div>
                              <input class="nd-input" type="text" style="font-size:12.5px;padding:4px 8px;margin-top:4px;width:180px" placeholder="Reason (required)" [value]="s.overrideReason" [attr.aria-label]="'Reason for giving more of ' + l.drugName" (input)="setOverrideReason(l, $any($event.target).value)" />
                            }
                          } @else { <span class="ph-muted nd-num">{{ l.remaining <= 0 ? l.dispensed : (d.consultStatus === 'completed' ? 0 : l.quantity) }}</span> }
                        </td>
                        <td class="r" data-l="Left after" [class.ph-low]="leftAfter(l) < 0">{{ d.consultStatus === 'completed' && drug && !s.skip && l.remaining > 0 ? units(leftAfter(l), drug) : '' }}</td>
                        <td class="r" data-l="MRP">{{ d.consultStatus === 'completed' && drug && !s.skip && l.remaining > 0 ? inr(unitMrp(l)) : '' }}</td>
                        <td class="r" data-l="Amount">{{ d.consultStatus === 'completed' && drug && !s.skip && l.remaining > 0 ? inr(lineAmount(l)) : '' }}</td>
                        <td class="ph-td-act">
                          @if (d.consultStatus === 'completed' && l.remaining > 0) {
                            <button type="button" class="nd-btn nd-btn--tertiary" (click)="toggleSkip(l)" [attr.aria-label]="(s.skip ? 'Give ' : 'Skip ') + l.drugName">{{ s.skip ? 'Give' : 'Skip' }}</button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              @if (d.dispenses.length) {
                <p class="ph-sub">Given earlier: @for (x of d.dispenses; track x.id) { <span class="nd-num">{{ x.number }} ({{ inr(x.total, false) }}){{ $last ? '' : ', ' }}</span> }</p>
              }
            </div>
          </section>

          @if (!done() && d.consultStatus !== 'completed') {
            <aside class="nd-card" aria-labelledby="ph-w-t">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg></span>
                <span class="nd-card__label" id="ph-w-t">Waiting on the doctor</span>
              </header>
              <div class="nd-card__body">
                <p class="ph-sub">The doctor hasn't completed this prescription yet — there's nothing to give or bill until the consult is marked complete.</p>
              </div>
            </aside>
          } @else if (!done()) {
            <aside class="nd-card" aria-labelledby="ph-b-t">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg></span>
                <span class="nd-card__label" id="ph-b-t">Billing</span>
                <span class="nd-card__spacer"></span>
                <span class="ph-sub nd-num">{{ giveCount() }} {{ giveCount() === 1 ? 'item' : 'items' }}</span>
              </header>
              <div class="nd-card__body">
                @for (l of giving(); track l.rxLineId) {
                  <div style="display:flex;justify-content:space-between;gap:10px;font-size:13.5px"><span>{{ given(l)?.name }} <span class="ph-muted nd-num">× {{ st(l).qty }}</span></span><span class="nd-num">{{ inr(lineAmount(l)) }}</span></div>
                }
                <div class="nd-field">
                  <label class="nd-field__lbl" for="ph-disc">Discount (₹, before GST)</label>
                  <input id="ph-disc" class="nd-input nd-num" type="number" min="0" inputmode="decimal" [value]="discount() || ''" (input)="setDiscount($any($event.target).value)" placeholder="0" />
                </div>
                <div class="nd-field">
                  <span class="nd-field__lbl" id="ph-pay-l">Payment</span>
                  <div class="nd-seg" role="radiogroup" aria-labelledby="ph-pay-l" style="width:100%">
                    @for (m of modes; track m.v) {
                      <button type="button" class="nd-seg__item" style="flex:1" role="radio" [attr.aria-checked]="mode() === m.v" (click)="mode.set(m.v)">{{ m.l }}</button>
                    }
                  </div>
                </div>
                @if (rxOnly() > 0) {
                  <div class="ph-note" role="note"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
                    <span>{{ rxOnly() }} prescription-only (Schedule H / H1 / X) — covered by this prescription.{{ h1Count() ? ' ' + h1Count() + ' will be entered in the H1 register.' : '' }}</span></div>
                }
                @if (h1Count() > 0) {
                  <div class="nd-field">
                    <label class="nd-field__lbl" for="ph-h1-addr">Patient's address (Schedule H1 / X register — required)</label>
                    <input id="ph-h1-addr" class="nd-input" type="text" [value]="patientAddress()" (input)="patientAddress.set($any($event.target).value)" placeholder="House no., street, city" />
                  </div>
                }
              </div>
              <div class="nd-card__foot">
                <div class="ph-sum">
                  <span>Taxable value</span><span>{{ inr(totals().taxable) }}</span>
                  @if (totals().discount > 0) { <span>Discount</span><span>−{{ inr(totals().discount) }}</span> }
                  <span>GST (CGST + SGST)</span><span>{{ inr(totals().tax) }}</span>
                  <span>Round-off</span><span>{{ totals().roundOff >= 0 ? '+' : '−' }}{{ inr(abs(totals().roundOff)) }}</span>
                </div>
                <div class="ph-total"><span>Total</span><strong>{{ inr(totals().payable) }}</strong></div>
                <button type="button" class="nd-btn nd-btn--secondary" [disabled]="!canGive() || saving()" (click)="give(false)">Give, bill later</button>
                @if (!isPhone()) {
                  <button type="button" class="nd-btn" [class.nd-btn--primary]="canGive()" [class.nd-btn--secondary]="!canGive()"
                          [disabled]="!canGive() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="give(true)">Take payment {{ inr(totals().payable, false) }}</button>
                }
              </div>
            </aside>
            @if (isPhone()) {
              <div class="nd-bottombar" role="region" aria-label="Payment">
                <span class="nd-bottombar__info nd-num">{{ inr(totals().payable, false) }} · {{ giveCount() }} {{ giveCount() === 1 ? 'item' : 'items' }}</span>
                <button type="button" class="nd-btn" [class.nd-btn--primary]="canGive()" [class.nd-btn--secondary]="!canGive()"
                        [disabled]="!canGive() || saving()" [pfBusy]="saving()" pfBusyLabel="Saving…" (click)="give(true)">Take payment</button>
              </div>
            }
          } @else {
            <aside class="nd-card" aria-labelledby="ph-i-t">
              <header class="nd-card__head">
                <span class="nd-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg></span>
                <span class="nd-card__label" id="ph-i-t">Instructions</span>
                <span class="nd-card__spacer"></span>
                <span class="nd-chip nd-chip--static nd-num">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--violet-text, #7c3aed)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  {{ doneLabel() }}
                </span>
              </header>
              <div class="nd-card__body">
                @if (dueNow(); as due) {
                  <div class="ph-note" data-tone="warn" role="status">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>
                    <span>Billed later — {{ inr(due, false) }} still due.</span>
                  </div>
                  <div class="nd-field">
                    <span class="nd-field__lbl" id="ph-cp-l">Collect payment</span>
                    <div class="nd-seg" role="radiogroup" aria-labelledby="ph-cp-l" style="width:100%">
                      @for (m of modes; track m.v) {
                        <button type="button" class="nd-seg__item" style="flex:1" role="radio" [attr.aria-checked]="mode() === m.v" (click)="mode.set(m.v)">{{ m.l }}</button>
                      }
                    </div>
                  </div>
                  <button type="button" class="nd-btn nd-btn--primary" style="width:100%" [disabled]="collecting()" [pfBusy]="collecting()" pfBusyLabel="Collecting…" (click)="collectPayment()">Collect {{ inr(due, false) }}</button>
                }
                @for (i of instructions(); track $index) {
                  <div class="ph-instr">
                    <div class="ph-instr__t"><b>{{ i.name }}</b>{{ i.say }}</div>
                    @if (i.strip; as cells) {
                      <div class="ph-strip" role="img" [attr.aria-label]="'Next 14 days for ' + i.name">
                        @for (c of cells; track $index) {
                          <span class="ph-strip__d"><span class="ph-strip__c" [attr.data-on]="!!c.day && c.day.n > 0 && !c.day.sos" [attr.data-sos]="!!c.day && c.day.sos" [attr.data-done]="!c.day">{{ c.day ? (c.day.n || '–') : '' }}</span>{{ wd(c.weekday) }}</span>
                        }
                      </div>
                    }
                  </div>
                }
                <p class="ph-title">WhatsApp to {{ rx()?.patient?.phone || 'the patient' }}</p>
                <div class="ph-wa">{{ waText() }}</div>
              </div>
              <div class="nd-card__foot">
                <button type="button" class="nd-btn nd-btn--secondary" (click)="print()">Print</button>
                <a class="nd-btn nd-btn--primary" [href]="waHref()" target="_blank" rel="noopener" (click)="afterSend()">Send on WhatsApp</a>
                <button type="button" class="nd-btn nd-btn--tertiary nd-span" (click)="back()">Back to prescriptions</button>
              </div>
            </aside>
          }
        </div>
      }
    </section>
  `,
  styles: [`.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`],
})
export class PharmacyDispensePage {
  private readonly api = inject(PharmacyApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);
  private readonly tenant = inject(TenantStateService);

  protected readonly rx = signal<RxDetail | null>(null);
  private readonly loading = signal(true);
  protected readonly showSkeleton = heldFlag(this.loading);
  protected readonly error = signal<string | null>(null);
  protected readonly state = signal<Record<string, LineState>>({});
  /** Batches of substitutes / free-text picks (fetched on demand). */
  private readonly extraBatches = signal<Record<string, PickBatch[]>>({});
  private readonly extraDrugs = signal<Record<string, DrugBrief>>({});
  protected readonly discount = signal(0);
  /** Schedule H1 / X register (critic #1) — asked only when such a line is on the cart. */
  protected readonly patientAddress = signal('');
  protected readonly mode = signal<PayMode>('upi');
  protected readonly saving = signal(false);
  protected readonly done = signal<DispenseView | null>(null);
  /** Pay later (P0 money gap): a "Give, bill later" sale still carries a
   *  balance on its bill — collect it from the same instructions screen. */
  protected readonly collecting = signal(false);
  private readonly today = labToday();
  protected readonly modes: { v: PayMode; l: string }[] = [{ v: 'cash', l: 'Cash' }, { v: 'upi', l: 'UPI' }, { v: 'card', l: 'Card' }];
  protected readonly inr = inr;
  protected readonly abs = Math.abs;

  protected readonly isPhone = phoneSignal();
  protected readonly pharmacistPick = computed(() => this.rx()?.settings.batchPick === 'pharmacist');

  constructor() {
    const id = this.route.snapshot.paramMap.get('visitId') ?? '';
    this.api.rx(id).subscribe({
      next: d => {
        this.rx.set(d);
        this.resetState(d);
        this.loading.set(false);
      },
      error: e => { this.error.set(errText(e)); this.loading.set(false); },
    });
  }

  private resetState(d: RxDetail) {
    const s: Record<string, LineState> = {};
    for (const l of d.lines) s[l.rxLineId] = { drugId: l.drug?.id ?? null, qty: Math.max(0, Math.ceil(l.remaining)), batchId: null, skip: l.remaining <= 0, overrideReason: '' };
    this.state.set(s);
  }

  // ── Per line ──────────────────────────────────────────────────────────────
  protected st(l: RxLineView): LineState { return this.state()[l.rxLineId] ?? { drugId: null, qty: 0, batchId: null, skip: true, overrideReason: '' }; }
  private patch(l: RxLineView, p: Partial<LineState>) { this.state.update(s => ({ ...s, [l.rxLineId]: { ...this.st(l), ...p } })); }

  protected given(l: RxLineView): DrugBrief | null {
    const id = this.st(l).drugId;
    if (!id) return null;
    if (l.drug?.id === id) return l.drug;
    return l.substitutes.find(x => x.id === id) ?? this.extraDrugs()[id] ?? null;
  }
  protected batchesOf(l: RxLineView): PickBatch[] {
    const d = this.given(l);
    if (!d) return [];
    return d.id === l.drug?.id ? l.batches : this.extraBatches()[d.id] ?? [];
  }
  protected takes(l: RxLineView): Take[] {
    const s = this.st(l);
    if (s.skip || !this.given(l) || s.qty <= 0) return [];
    if (this.pharmacistPick()) {
      const b = this.batchesOf(l).find(x => x.id === s.batchId);
      return b ? [{ batchId: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, qty: s.qty, mrp: b.mrp }] : [];
    }
    return previewFefo(this.batchesOf(l), s.qty, this.today);
  }
  protected unitMrp(l: RxLineView): number { return this.takes(l)[0]?.mrp ?? this.given(l)?.defaultMrp ?? 0; }
  protected lineAmount(l: RxLineView): number { return this.takes(l).reduce((a, t) => a + t.qty * t.mrp, 0); }
  protected leftAfter(l: RxLineView): number { return (this.given(l)?.onHand ?? 0) - this.st(l).qty; }
  protected units(n: number, d: DrugBrief) { return unitWords(n, d.unit, d.form); }
  protected sched(l: RxLineView) { try { return shortSched(l.schedule); } catch { return ''; } }
  protected exp(iso: string) { return expiryLabel(iso); }
  protected expChip(iso: string) { return expiryChip(iso, this.today); }
  /** Secondary line under the generic-first drug name (critic #8): the brand + strength, when there's a generic to lead with. */
  protected brandLine(drug: DrugBrief | null): string {
    if (!drug?.generic) return '';
    return drug.name + (drug.strength ? ' ' + drug.strength : '');
  }
  /** Ceiling for a corrected quantity (critic #4): 5× the Rx quantity, never
   *  more than the sellable stock. */
  protected maxQty(l: RxLineView): number {
    const ceiling = overrideCeiling(l.quantity);
    if (this.pharmacistPick()) {
      const b = this.batchesOf(l).find(x => x.id === this.st(l).batchId);
      return Math.min(ceiling, b?.qtyOnHand || l.remaining || ceiling);
    }
    const stock = this.batchesOf(l).filter(b => b.qtyOnHand > 0 && b.expiryDate.slice(0, 10) >= this.today).reduce((a, b) => a + b.qtyOnHand, 0);
    return Math.min(ceiling, stock || l.remaining || ceiling);
  }
  protected isRx(s: string) { return needsPrescription(s); }
  /** Pregnancy-safety guard chip (night/safety, critic P0 #1d) — only shown
   *  when the patient is pregnant; avoid/contraindicated = red, caution = amber. */
  protected pregChip(drug: DrugBrief | null): { label: string; tone: 'avoid' | 'caution' } | null {
    if (this.rx()?.pregnancy?.status !== 'pregnant' || !drug?.pregnancyRisk) return null;
    if (drug.pregnancyRisk === 'avoid') return { label: 'Avoid — pregnancy', tone: 'avoid' };
    if (drug.pregnancyRisk === 'contraindicated') return { label: 'Contraindicated', tone: 'avoid' };
    if (drug.pregnancyRisk === 'caution') return { label: 'Caution — pregnancy', tone: 'caution' };
    return null;
  }
  protected schLabel(s: string) { return scheduleLabel(s); }
  protected time(iso: string) { return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  protected wd(i: number) { return 'SMTWTFS'[i]; }

  protected subOptions(l: RxLineView): PfSelectOption<string>[] {
    const all = [...(l.drug ? [l.drug] : []), ...l.substitutes];
    return all.map(d => ({ value: d.id, label: d.name + (d.id === l.drug?.id ? ' (prescribed)' : ''), hint: d.onHand ? unitWords(d.onHand, d.unit, d.form) + ' in stock' : 'No stock' }));
  }
  protected batchOptions(l: RxLineView): PfSelectOption<string>[] {
    return this.batchesOf(l).map((b, i) => {
      const band = expiryBand(b.expiryDate, this.today);
      const warn = band === 'expired' ? ' · EXPIRED' : band === 'soon30' ? ' · expires <30d' : band === 'soon90' ? ' · expires <90d' : '';
      return { value: b.id, label: `${b.batchNo} · exp ${expiryLabel(b.expiryDate)}${i === 0 ? ' · earliest' : ''}${warn}`, hint: `${b.qtyOnHand} left · ${inr(b.mrp)}` };
    });
  }

  protected setDrug(l: RxLineView, id: string) {
    this.patch(l, { drugId: id, batchId: null });
    if (id !== l.drug?.id && !this.extraBatches()[id]) this.loadBatches(id);
  }
  protected pickFree(l: RxLineView, d: PharmacyDrugRow) {
    this.extraDrugs.update(m => ({ ...m, [d.id]: { id: d.id, name: d.name, generic: d.generic, strength: d.strength, form: d.form, unit: d.unit, schedule: d.schedule, hsnCode: d.hsnCode, taxSlab: d.taxSlab, defaultMrp: d.defaultMrp, onHand: d.onHand ?? 0 } }));
    this.setDrug(l, d.id);
  }
  private loadBatches(drugId: string) {
    this.api.batches(drugId).subscribe({
      next: (rows: BatchRow[]) => this.extraBatches.update(m => ({ ...m, [drugId]: rows.filter(b => !b.expired).map(b => ({ id: b.id, batchNo: b.batchNo, expiryDate: b.expiryDate, mrp: b.mrp, qtyOnHand: b.qtyOnHand })) })),
      error: () => this.extraBatches.update(m => ({ ...m, [drugId]: [] })),
    });
  }
  protected setBatch(l: RxLineView, id: string) { this.patch(l, { batchId: id }); }
  protected bump(l: RxLineView, d: number) { this.setQty(l, String(this.st(l).qty + d)); }
  protected setQty(l: RxLineView, v: string) {
    const n = Math.floor(Number(v));
    const max = this.maxQty(l);
    const qty = Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : this.st(l).qty;
    this.patch(l, { qty, overrideReason: needsOverrideReason(qty, l.remaining) ? this.st(l).overrideReason : '' });
  }
  protected setOverrideReason(l: RxLineView, v: string) { this.patch(l, { overrideReason: v }); }
  protected toggleSkip(l: RxLineView) { this.patch(l, { skip: !this.st(l).skip }); }
  protected setDiscount(v: string) { const n = Number(v); this.discount.set(Number.isFinite(n) && n > 0 ? n : 0); }

  // ── Totals ────────────────────────────────────────────────────────────────
  protected readonly giving = computed(() => (this.rx()?.lines ?? []).filter(l => {
    const s = this.state()[l.rxLineId];
    return !!s && !s.skip && l.remaining > 0 && s.qty > 0 && !!this.given(l);
  }));
  protected readonly giveCount = computed(() => this.giving().length);
  protected readonly cart = computed<CartLine[]>(() => this.giving().flatMap(l => {
    const d = this.given(l)!;
    return this.takes(l).map(t => ({ qty: t.qty, mrp: t.mrp, taxSlab: d.taxSlab }));
  }));
  protected readonly totals = computed(() => cartTotals(this.cart(), this.discount()));
  protected readonly rxOnly = computed(() => this.giving().filter(l => needsPrescription(this.given(l)?.schedule)).length);
  protected readonly h1Count = computed(() => this.giving().filter(l => needsRegister(this.given(l)?.schedule)).length);
  protected readonly canGive = computed(() => {
    const d = this.rx();
    if (!d || d.consultStatus !== 'completed') return false;
    const g = this.giving();
    if (!g.length) return false;
    if (this.h1Count() > 0 && !this.patientAddress().trim()) return false;
    return g.every(l => {
      const t = this.takes(l);
      const s = this.st(l);
      if (t.length === 0 || t.reduce((a, x) => a + x.qty, 0) !== s.qty) return false;
      if (needsOverrideReason(s.qty, l.remaining) && !s.overrideReason.trim()) return false;
      return true;
    });
  });

  // ── Give ──────────────────────────────────────────────────────────────────
  protected async give(pay: boolean): Promise<void> {
    const d = this.rx();
    if (!d || !this.canGive()) return;
    // Pregnancy-safety guard (night/safety, critic P0 #1d): dispensing a
    // CONTRAINDICATED drug to a pregnant patient needs the pharmacist's
    // explicit confirmation — UI-only gate, never silently allowed.
    if (d.pregnancy?.status === 'pregnant') {
      const risky = this.giving().filter(l => this.given(l)?.pregnancyRisk === 'contraindicated');
      if (risky.length) {
        const names = risky.map(l => this.given(l)?.name).filter(Boolean).join(', ');
        const ok = await this.dialog.confirm({
          title: 'Contraindicated in pregnancy',
          message: `${names} ${risky.length === 1 ? 'is' : 'are'} contraindicated in pregnancy. Dispense anyway?`,
          confirmLabel: 'Dispense anyway', tone: 'danger',
        });
        if (!ok) return;
      }
    }
    const lines: DispenseLineInput[] = [];
    for (const l of d.lines) {
      if (l.remaining <= 0) continue;
      const s = this.st(l);
      if (s.skip) { lines.push({ rxLineId: l.rxLineId, qty: 0, skip: true }); continue; }
      if (!this.given(l)) continue;
      lines.push({
        rxLineId: l.rxLineId, drugId: s.drugId, qty: s.qty, batchId: this.pharmacistPick() ? s.batchId : null,
        overrideReason: needsOverrideReason(s.qty, l.remaining) ? s.overrideReason.trim() : null,
      });
    }
    const payable = this.totals().payable;
    this.saving.set(true);
    this.api.dispenseRx(d.visitId, {
      lines, discount: this.discount(),
      payment: pay && payable > 0 ? { mode: this.mode(), amount: payable } : null,
      patientAddress: this.h1Count() > 0 ? this.patientAddress().trim() : null,
    }).subscribe({
      next: v => {
        this.saving.set(false);
        if (!v) { this.toast.success('Saved — nothing was given.'); this.back(); return; }
        this.done.set(v);
        this.patientAddress.set('');
        this.api.rx(d.visitId).subscribe({ next: fresh => { this.rx.set(fresh); this.resetState(fresh); }, error: () => undefined });
        this.toast.success(pay ? `${inr(v.bill?.totalPaid ?? 0, false)} received · instructions ready` : 'Given · bill saved');
      },
      error: e => { this.saving.set(false); this.toast.error(errText(e)); },
    });
  }

  // ── After ─────────────────────────────────────────────────────────────────
  protected readonly instructions = computed<InstructionLine[]>(() => {
    const v = this.done(), d = this.rx();
    if (!v || !d) return [];
    const byRx = new Map<string, string>();
    for (const x of v.lines) if (x.rxLineId && !byRx.has(x.rxLineId)) byRx.set(x.rxLineId, x.drugName);
    return d.lines.filter(l => byRx.has(l.rxLineId)).map(l => instructionFor(l, byRx.get(l.rxLineId)));
  });
  private readonly clinic = computed(() => this.tenant.tenant()?.brandingName?.trim() || this.tenant.tenant()?.name || this.auth.user()?.tenantName || 'the clinic');
  protected readonly waText = computed(() => whatsAppText({
    patientFirstName: this.rx()?.patient.name.split(' ')[0] ?? null, clinic: this.clinic(), doctor: this.rx()?.doctor.name ?? null, lines: this.instructions(),
  }));
  protected readonly waHref = computed(() => waLink(this.rx()?.patient.phone ?? null, this.waText()));
  protected readonly doneLabel = computed(() => {
    const b = this.done()?.bill;
    if (!b) return 'Given';
    return b.balance <= 0 ? 'Paid ' + inr(b.totalPaid, false) : 'Due ' + inr(b.balance, false);
  });
  /** Balance still owed on the just-given sale (null once it's fully paid). */
  protected readonly dueNow = computed(() => {
    const b = this.done()?.bill;
    return b && b.balance > 0 ? b.balance : null;
  });

  protected collectPayment(): void {
    const v = this.done();
    const due = this.dueNow();
    if (!v || !due || this.collecting()) return;
    this.collecting.set(true);
    this.api.payDispense(v.id, { mode: this.mode(), amount: due }).subscribe({
      next: updated => { this.collecting.set(false); this.done.set(updated); this.toast.success(`${inr(due, false)} collected`); },
      error: e => { this.collecting.set(false); this.toast.error(errText(e)); },
    });
  }

  /** The GST tax-invoice letterhead (critic item #4) — fetched once, on the
   *  first print, and reused after (branch GSTIN doesn't change mid-session). */
  private readonly practice = signal<PharmacyInvoiceHeader | null>(null);

  protected print(): void {
    if (this.practice()) { this.printNow(); return; }
    this.api.invoiceHeader().subscribe({
      next: h => { this.practice.set(h); this.printNow(); },
      error: () => this.printNow(), // print still works without the letterhead
    });
  }

  private printNow(): void {
    const v = this.done(), d = this.rx();
    if (!v || !d) return;
    printPharmacySheet({
      clinic: this.clinic(), patientName: d.patient.name, patientMeta: d.patient.meta, doctor: d.doctor.name, doctorRegNo: d.doctorRegNo,
      number: v.bill?.invoiceNumber ?? v.number, instructions: this.instructions(), lines: v.lines, bill: v.bill,
      practice: this.practice(),
    });
  }

  protected afterSend(): void { this.toast.success('WhatsApp opened with the instructions'); }
  protected back(): void { void this.router.navigateByUrl('/opd/pharmacy'); }
}
