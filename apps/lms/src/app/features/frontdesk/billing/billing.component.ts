import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, OnInit, Output, SimpleChanges, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/auth/auth.service';
import { BarcodeDisplayComponent } from '../../../shared/components/barcode-display/barcode-display.component';
import { BillingEventsService } from '../../../core/services/billing-events.service';
import { FrontdeskSettingsService } from '../../../core/services/frontdesk-settings.service';
import { ToastService } from '../../../core/services/toast.service';
import { PrinterService } from '../../../core/printer/printer.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { Test } from '../../../shared/models/test.model';
import { generateInvoicePdf, invoiceTemplateFieldsFrom, loadImageDataUrl } from './invoice-pdf';
import { environment } from '../../../../environments/environment';
import { waLink } from '../../../shared/utils/whatsapp';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { WalletOutstandingPipe } from '../../../shared/pipes/wallet-outstanding.pipe';
import { NumPadComponent } from '../../../shared/primitives/num-pad.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';

type PayMode = 'upi' | 'card' | 'cash' | 'wallet' | 'split' | 'later';

interface PayModeDef {
  id: PayMode;
  label: string;
  hint: string;
  iconPath: string;
}

/** Slim shape of /api/vendors used by the billing wallet picker. */
interface VendorWallet {
  id: string;
  name: string;
  code?: string;
  totalCredit: number;
  usedCredit: number;
  balance: number;
  outstanding: number;
  notifyThreshold?: number | null;
  isActive: boolean;
}

/** Slim shape of /api/billing/config used to read the
 *  FrontdeskCanSeeWalletBalance flag. */
interface BillingConfigSlice {
  frontdeskCanSeeWalletBalance: boolean;
}

const PAY_MODES: PayModeDef[] = [
  { id: 'upi',    label: 'UPI',       hint: 'Scan QR',        iconPath: 'M12 4v16M5 8h14M5 16h14' },
  { id: 'card',   label: 'Card',      hint: 'Tap / Insert',   iconPath: 'M3 7h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 11h18' },
  { id: 'cash',   label: 'Cash',      hint: 'Collect note',   iconPath: 'M3 6h18v12H3zM7 12a5 3 0 0 1 10 0 5 3 0 0 1-10 0Z' },
  { id: 'wallet', label: 'Credit Wallet', hint: 'Vendor credit', iconPath: 'M21 7H5a2 2 0 0 0 0 4h16v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14M17 14h.01' },
  { id: 'split',  label: 'Split',     hint: 'Mixed modes',    iconPath: 'M6 3v18M18 3v18M3 12h18' },
  // { id: 'later',  label: 'Pay later', hint: 'On report',      iconPath: 'M12 6v6l4 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z' },
];

const QUICK_ADD = [100, 200, 500, 1000, 2000, 5000];

@Component({
  selector: 'pf-billing',
  standalone: true,
  // Layout hook only: lets the non-scroll page rules target the standalone
  // page (:host:not(.pf-embedded)) without affecting the inline/embedded use
  // inside the order screen, which must keep flowing in normal document flow.
  host: { '[class.pf-embedded]': 'embedded' },
  imports: [
    CurrencyInrPipe, WalletOutstandingPipe,
    NumPadComponent,
    ScreenHeaderComponent,
    TileComponent,
    TouchButtonComponent,
    LoadingLogoComponent,
    BarcodeDisplayComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [class]="embedded ? 'pt-1 pb-2' : 'pf-bill-page px-4 md:px-8 lg:px-10 pt-6 pb-10'">
      @if (!embedded) {
      <pf-screen-header
        eyebrow="Frontdesk · Billing"
        title="Collect payment"
        [subtitle]="subtitle()">
        <!-- Admin toggle: when OFF, the Order tab stops auto-routing here
             after save and raises a billing request instead. Flag is
             persisted in localStorage via FrontdeskSettingsService. -->
        <label actions class="pf-collect-toggle"
               title="When ON, payment is collected at the front desk after each order. When OFF, a separate billing request is raised and the front desk skips this screen.">
          <input type="checkbox"
                 [checked]="collectsBilling()"
                 (change)="setCollectsBilling($any($event.target).checked)" />
          <span>Front desk collects payment</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
               class="pf-collect-toggle__hint" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/>
            <path d="M12 17h.01"/>
          </svg>
        </label>
        <button actions type="button" class="pf-toolbar-btn pf-no-print"
                (click)="saveDraft()" [disabled]="paid() || !bill()"
                title="Save as draft (resume later)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8"/>
          </svg>
          Save draft
        </button>
        @if (hasDraft()) {
          <button actions type="button" class="pf-toolbar-btn pf-toolbar-btn--ghost pf-no-print"
                  (click)="discardDraft()" title="Discard saved draft">Discard</button>
        }
        <button actions type="button" class="pf-toolbar-btn pf-toolbar-btn--ghost pf-no-print"
                (click)="cancel()" title="Leave without collecting payment">
          Cancel
        </button>
        <pf-touch-btn actions class="pf-bill-back-desktop" size="sm" variant="ghost" (pressed)="back()"
                      [title]="paid() ? 'Back' : 'Back to the order to add or remove tests'">
          <span icon-left aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m15 18-6-6 6-6"/>
            </svg>
          </span>
          Back
        </pf-touch-btn>
      </pf-screen-header>
      }

      @if (bill(); as b) {
        <div class="pf-bill-grid">

          <!-- LEFT: invoice preview -->
          <div class="pf-bill-col">
            <pf-tile tone="default" padding="lg" class="pf-bill-tile">
              <!-- Header: Invoice Number & Due Amount -->
              <div class="flex items-start justify-between mb-4">
                <div>
                  <p class="pf-eyebrow">Invoice</p>
                  <p class="pf-bill-no">{{ invoiceNumber() }}</p>
                </div>
                <div class="flex items-center gap-4">
                  <div class="text-right">
                    <p class="pf-eyebrow">Due</p>
                    <p class="pf-bill-total">{{ effectivePayable() | inr }}</p>
                  </div>
                  <button type="button" class="pf-bill-print-icon pf-no-print"
                          (click)="printInvoice()" aria-label="Print invoice" title="Print invoice (opens the print dialog)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>
                    </svg>
                  </button>
                </div>
              </div>

              <!-- Barcode & QR Code Section -->
              <div class="pf-invoice-badges mb-6">
                <!-- Invoice-number barcode (Code128) for counter scanning -->
                <div class="pf-scanner-tag">
                  <div class="pf-scanner-tag__code">
                    <pf-barcode-display [code]="invoiceNumber()" mode="barcode" [size]="36" [bare]="true" [showValue]="false"></pf-barcode-display>
                  </div>
                  <div class="pf-scanner-tag__meta">
                    <span class="pf-scanner-tag__label">Invoice Barcode</span>
                    <span class="pf-scanner-tag__action">Scan to search</span>
                  </div>
                </div>

                <!-- Result-tracking QR for the patient's phone -->
                @if (trackToken() && invoiceTpl()?.showTrackingQr !== false) {
                  <div class="pf-scanner-tag">
                    <div class="pf-scanner-tag__code">
                      <pf-barcode-display [code]="trackUrl()" mode="qr" [size]="36" [bare]="true" [showValue]="false"></pf-barcode-display>
                    </div>
                    <div class="pf-scanner-tag__meta">
                      <span class="pf-scanner-tag__label">Patient Portal QR</span>
                      <span class="pf-scanner-tag__action">Scan to track report</span>
                    </div>
                  </div>
                }
              </div>

              <ul class="pf-bill-items">
                @for (item of b.items; track item.id) {
                  <li class="pf-bill-row">
                    <div class="flex flex-col min-w-0">
                      <span class="pf-bill-name truncate" [title]="item.testName">{{ item.testName }}</span>
                      @if (item.hsnSacCode) {
                        <span class="pf-bill-code mt-0.5">{{ item.hsnSacCode }}</span>
                      }
                    </div>
                    <span class="pf-bill-amount">{{ item.total | inr }}</span>
                  </li>
                }
              </ul>

              <div class="pf-bill-totals">
                <div class="pf-bill-line">
                  <span>Subtotal</span>
                  <span class="tabular-nums">{{ b.subTotal | inr }}</span>
                </div>
                @if (b.totalTax > 0) {
                  <div class="pf-bill-line">
                    <span>GST</span>
                    <span class="tabular-nums">{{ b.totalTax | inr }}</span>
                  </div>
                }
                <div class="pf-bill-line pf-bill-line--discount">
                  <span>Discount @if (discountCapPct() < 100) { <span class="pf-discount__cap">(max {{ discountCapPct() }}%)</span> }</span>
                  <div class="pf-discount">
                    <div class="pf-discount__kind" role="tablist" aria-label="Discount unit">
                      <button type="button" role="tab"
                              [class.pf-discount__kind--on]="discountKind() === 'flat'"
                              (click)="setDiscountKind('flat')">₹</button>
                      <button type="button" role="tab"
                              [class.pf-discount__kind--on]="discountKind() === 'percent'"
                              (click)="setDiscountKind('percent')">%</button>
                    </div>
                    <input type="number"
                           inputmode="numeric"
                           min="0"
                           step="1"
                           [attr.max]="discountKind() === 'percent' ? 100 : (b.subTotal + b.totalTax)"
                           [class.pf-discount__input--err]="discountOverCap() || !!discountError()"
                           [value]="discount()"
                           (input)="setDiscount(asInput($event))"
                           (keydown)="blockDiscountChars($event)"
                           class="pf-discount__input"
                           placeholder="0"/>
                    @if (discountKind() === 'percent' && discountNum() > 0) {
                      <span class="pf-discount__resolved">−{{ discountNum() | inr }}</span>
                    }
                  </div>
                </div>
                @if (discountOverCap()) {
                  <p class="pf-discount__err">Discount {{ discountPct().toFixed(0) }}% exceeds your {{ discountCapPct() }}% limit — reduce it to confirm.</p>
                }
                @if (discountError()) {
                  <p class="pf-discount__err">{{ discountError() }}</p>
                }
                <div class="pf-bill-line pf-bill-line--total">
                  <span>Total</span>
                  <span class="tabular-nums">{{ fullTotal() | inr }}</span>
                </div>
                @if (alreadyPaid() > 0) {
                  <div class="pf-bill-line">
                    <span>Already paid</span>
                    <span class="tabular-nums">− {{ alreadyPaid() | inr }}</span>
                  </div>
                  <div class="pf-bill-line pf-bill-line--total">
                    <span>{{ refundDue() > 0 ? 'Refund due' : 'Balance due' }}</span>
                    <span class="tabular-nums">{{ (refundDue() > 0 ? refundDue() : effectivePayable()) | inr }}</span>
                  </div>
                }
              </div>

              @if (refundDue() > 0) {
                <div class="pf-refund">
                  <p class="pf-refund__title">Overpaid by {{ refundDue() | inr }} — record a refund</p>
                  <div class="pf-refund__modes">
                    @for (m of refundModeDefs; track m.key) {
                      <button type="button" class="pf-refund__chip" [class.pf-refund__chip--on]="refundMode() === m.key"
                              (click)="refundMode.set(m.key)">{{ m.label }}</button>
                    }
                  </div>
                  <button type="button" class="pf-refund__btn" [disabled]="refunding()" (click)="doRefund()">
                    {{ refunding() ? 'Refunding…' : ('Refund ' + (refundDue() | inr)) }}
                  </button>
                </div>
              }

              @if (tatLabel()) {
                <p class="pf-bill-tat-inline">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>
                  </svg>
                  {{ tatLabel() }}
                </p>
              }
            </pf-tile>
          </div>

          <!-- RIGHT: unified payment tile — mode picker on top, the
               per-mode panel below, and Confirm at the bottom. One
               box instead of three. Hidden when printing the invoice.
               Marked --noscroll so contents must fit; the per-mode
               panel uses flex / smaller controls to stay inside. -->
          <div class="pf-bill-col pf-no-print">
            <pf-tile tone="default" padding="lg" class="pf-bill-tile pf-bill-tile--noscroll">
              <div class="pf-pay-modes">
                <p class="pf-eyebrow mb-2">Payment mode</p>
                <div class="pf-pay-modes__grid">
                  @for (m of modes; track m.id) {
                    <button type="button"
                            (click)="setMode(m.id)"
                            class="pf-mode pf-mode--compact"
                            [class.pf-mode--on]="mode() === m.id">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                           stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path [attr.d]="m.iconPath"/>
                      </svg>
                      <span class="pf-mode__label">{{ m.label }}</span>
                    </button>
                  }
                </div>
              </div>
              <div class="pf-pay-divider"></div>
              <div class="pf-pay-body">
              @switch (mode()) {
                @case ('upi') {
                  <div class="flex flex-col items-center text-center py-1 gap-2">
                    <div class="flex flex-col items-center">
                      <p class="pf-eyebrow mb-0.5">Scan to pay</p>
                      <p class="pf-big-amount">{{ effectivePayable() | inr }}</p>
                    </div>
                    <div class="pf-qr">
                      <img class="pf-qr__img" [src]="upiQrUrl()"
                           alt="Scan to pay via UPI"/>
                    </div>
                    <div class="flex flex-col items-center gap-1">
                      <p class="pf-qr__hint">prefrontal&#64;upi · Chennai Main</p>
                      <div class="pf-live-badge">
                        <span class="pf-live__dot"></span>
                        <span>Listening for payment…</span>
                      </div>
                    </div>
                  </div>
                }
                @case ('card') {
                  <div class="flex flex-col items-center text-center py-2">
                    <p class="pf-eyebrow mb-1">Tap or insert card</p>
                    <p class="pf-big-amount mb-3">{{ effectivePayable() | inr }}</p>
                    <div class="pf-card-mock">
                      <span class="pf-card-chip"></span>
                      <span class="pf-card-wave"></span>
                      <p class="pf-card-pan">•••• •••• •••• 4242</p>
                      <p class="pf-card-foot">TAP TO PAY</p>
                    </div>
                    <div class="pf-live-badge mt-4" style="color: var(--color-primary); background: color-mix(in srgb, var(--color-primary, #7c3aed) 8%, transparent); border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 20%, transparent);">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" class="pf-spin mr-1">
                        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"/>
                      </svg>
                      Waiting for card…
                    </div>
                  </div>
                }
                @case ('cash') {
                  <div class="flex flex-col h-full min-h-0 gap-2">
                    <!-- Enter what the patient handed over; the change to return
                         is shown prominently. Quick chips: exact, or + a note. -->
                    <div class="pf-cash2__head">
                      <span class="pf-cash2__label">Cash received</span>
                      <span class="pf-cash2__amt" [class.pf-cash2__amt--empty]="cashAmountNum() === 0">{{ cashAmountNum() | inr }}</span>
                    </div>
                    <div class="pf-cash2__quick">
                      <button type="button" (click)="setExactCash()">Exact</button>
                      @for (n of cashNotes; track n) { <button type="button" (click)="addCash(n)">+{{ n }}</button> }
                    </div>
                    <div class="pf-cash2__change" [attr.data-kind]="cashAmountNum() === 0 ? 'idle' : (changeAmount() > 0 ? 'change' : (changeAmount() === 0 ? 'exact' : 'short'))">
                      @if (cashAmountNum() === 0) { <span>Enter the amount received · due {{ effectivePayable() | inr }}</span> }
                      @else if (changeAmount() > 0) { <span>Return to patient</span><strong>{{ changeAbs() | inr }}</strong> }
                      @else if (changeAmount() === 0) { <span>Exact — no change due</span> }
                      @else { <span>Short by</span><strong>{{ changeAbs() | inr }}</strong> }
                    </div>
                    <pf-num-pad
                      [value]="cashAmount()"
                      [allowDecimal]="false"
                      [compact]="true"
                      (valueChange)="setCash($event)"></pf-num-pad>
                  </div>
                }
                @case ('wallet') {
                  <div class="flex flex-col h-full min-h-0">
                    @if (selectedVendor(); as v) {
                      <!-- Selected-vendor card with balance + change link. -->
                      <div class="pf-wallet-selected">
                        <div class="min-w-0 flex-1">
                          <p class="pf-wallet-selected__name">{{ v.name }}</p>
                          @if (v.code) { <p class="pf-wallet-selected__code">{{ v.code }}</p> }
                        </div>
                        @if (showWalletBalance()) {
                          <div class="text-right">
                            <!-- Accruing tab: no cap, so we show what the partner
                                 will OWE after this charge, not a "remaining
                                 balance". Never blocks. -->
                            <p class="pf-eyebrow">Outstanding after</p>
                            <p class="pf-wallet-selected__bal">
                              {{ (v.outstanding + effectivePayable()) | walletOutstanding }}
                            </p>
                            @if (v.notifyThreshold && (v.outstanding + effectivePayable()) >= v.notifyThreshold) {
                              <p class="pf-wallet-selected__warn">Over the {{ v.notifyThreshold | inr }} alert threshold</p>
                            }
                          </div>
                        }
                        <button type="button" class="pf-wallet-change" (click)="clearVendor()">Change</button>
                      </div>
                    } @else {
                      <p class="pf-eyebrow mb-2">Choose vendor wallet</p>
                      <input type="text" class="pf-wallet-search"
                             [value]="vendorQuery()"
                             (input)="setVendorQuery(asInput($event))"
                             placeholder="Search vendor by name or code…"/>
                      @if (vendors() === null) {
                        <p class="pf-wallet-empty">
                          <pf-loading-logo size="xs" color="purple" [inline]="true"></pf-loading-logo>
                          Loading vendors…
                        </p>
                      } @else if (filteredVendors().length === 0) {
                        <p class="pf-wallet-empty">
                          @if (vendorQuery().trim()) { No vendors match "{{ vendorQuery() }}". }
                          @else { No active vendors. Add one in Admin → Vendor wallets. }
                        </p>
                      } @else {
                        <ul class="pf-wallet-list">
                          @for (v of filteredVendors(); track v.id) {
                            <li>
                              <button type="button" class="pf-wallet-row" (click)="selectVendor(v.id)">
                                <span class="pf-wallet-row__name">
                                  {{ v.name }}
                                  @if (v.code) { <span class="pf-wallet-row__code">{{ v.code }}</span> }
                                </span>
                                @if (showWalletBalance()) {
                                  <span class="pf-wallet-row__bal"
                                        [class.pf-wallet-row__bal--low]="v.outstanding > 0">
                                    {{ v.outstanding | walletOutstanding }}
                                  </span>
                                }
                              </button>
                            </li>
                          }
                        </ul>
                      }
                    }
                  </div>
                }
                @default {
                  <div class="flex flex-col items-center justify-center text-center py-16">
                    <div class="pf-placeholder-icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path [attr.d]="currentModeDef()?.iconPath"/>
                      </svg>
                    </div>
                    <p class="text-[22px] font-semibold" style="color: var(--text-primary);">{{ currentModeDef()?.label }}</p>
                    <p class="text-[13px] mt-2 max-w-[280px]" style="color: var(--text-tertiary);">
                      @switch (mode()) {
                        @case ('split')  { Collect each portion on the terminal, then confirm below. }
                        @case ('later')  { Mark as pending. The balance can be collected anytime before the report is delivered. }
                        @default { Follow on-screen prompts to complete the payment. }
                      }
                    </p>
                    @if (mode() === 'later') {
                      <!-- Advance payment (optional): collect a partial amount now;
                           the remainder stays outstanding and can be settled later. -->
                      <div class="pf-adv">
                        <div class="pf-adv__head">
                          <span class="pf-adv__title">Advance payment</span>
                          <span class="pf-adv__opt">optional</span>
                        </div>
                        <div class="pf-adv__row">
                          <span class="pf-adv__cur">₹</span>
                          <input type="number" inputmode="numeric" min="0" [attr.max]="effectivePayable()"
                                 class="pf-adv__input" [value]="advance()"
                                 (input)="setAdvance(asInput($event))" placeholder="0"/>
                        </div>
                        <div class="pf-adv__tenders">
                          @for (t of advanceModes; track t.id) {
                            <button type="button" class="pf-adv__tender"
                                    [class.pf-adv__tender--on]="advanceMode() === t.id"
                                    (click)="setAdvanceMode(t.id)">{{ t.label }}</button>
                          }
                        </div>
                        @if (advanceNum() > 0) {
                          <p class="pf-adv__hint">Collect <strong>{{ advanceNum() | inr }}</strong> now · <strong>{{ (effectivePayable() - advanceNum()) | inr }}</strong> stays outstanding</p>
                        } @else {
                          <p class="pf-adv__hint pf-adv__hint--muted">No advance — the full {{ effectivePayable() | inr }} is due on the report.</p>
                        }
                      </div>
                    }
                    @if (mode() === 'split') {
                      <label class="pf-ref-row mt-6">
                        <span>Reference no.</span>
                        <input type="text"
                               [value]="referenceNo()"
                               (input)="setReferenceNo(asInput($event))"
                               placeholder="UTR / transaction id"
                               class="pf-ref-input"/>
                      </label>
                    }
                  </div>
                }
              }
              </div>

              <pf-touch-btn size="md" variant="primary" [full]="true"
                            (pressed)="confirm()"
                            [disabled]="saving() || !canConfirm()"
                            class="mt-3 block pf-bill-confirm">
                <span icon-left>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m5 12 4 4L19 6"/>
                  </svg>
                </span>
                @if (paid()) { Payment received · {{ effectivePayable() | inr }} }
                @else if (mode() === 'later') {
                  @if (advanceNum() > 0) { Collect advance · {{ advanceNum() | inr }} }
                  @else { Mark as pay-later · {{ effectivePayable() | inr }} }
                }
                @else { Confirm payment · {{ effectivePayable() | inr }} }
              </pf-touch-btn>
            </pf-tile>
          </div>

        </div>
      } @else {
        <pf-tile tone="default" padding="xl" class="block">
          <div class="flex justify-center py-8">
            <pf-loading-logo size="xl" color="purple" [showDna]="true"
                             [showText]="true" text="Generating bill…"></pf-loading-logo>
          </div>
        </pf-tile>
      }
    </section>

    <!-- ── Post-payment options dialog ─────────────────────────
         Opens when payment is successfully collected. Reception picks
         what to do next: print the invoice, send it via WhatsApp, or
         finish (which routes to the post-payment / sample-collection
         flow). The pf-no-print class hides it during printing. -->
    @if (paymentDoneOpen()) {
      <div class="pf-pay-modal pf-no-print" [class.pf-pay-modal--inline]="embedded" role="dialog" aria-modal="true" aria-label="Payment collected">
        @if (!embedded) {
          <div class="pf-pay-modal__backdrop" (click)="closePaymentDoneDialog()"></div>
        }
        <div class="pf-pay-modal__shell">
          <div class="pf-pay-modal__icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12l5 5L20 7"/>
            </svg>
          </div>
          <h2>Payment received</h2>
          <p class="pf-pay-modal__sub">{{ invoiceNumber() }} · {{ effectivePayable() | inr }}</p>

          <div class="pf-pay-modal__actions">
            <button type="button" class="pf-pay-modal__btn" (click)="printInvoice()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>
              </svg>
              Print invoice
            </button>
            <button type="button" class="pf-pay-modal__btn" (click)="sendOnWhatsApp()">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.95.51 3.85 1.48 5.53L2 22l4.7-1.55a9.93 9.93 0 0 0 5.34 1.55h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.02A9.94 9.94 0 0 0 12.04 2zm5.43 13.99c-.23.65-1.34 1.24-1.86 1.32-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.64-.62-2.89-1.31-4.78-4.43-4.92-4.63-.14-.2-1.18-1.62-1.18-3.08 0-1.46.77-2.18 1.04-2.48.27-.3.59-.37.78-.37.2 0 .39.01.56.01.18 0 .42-.07.66.5.23.59.79 2.05.86 2.2.07.14.12.31.02.51-.1.2-.15.31-.29.49-.14.18-.3.4-.43.54-.14.14-.29.31-.13.6.16.3.72 1.18 1.55 1.92 1.07.95 1.97 1.25 2.27 1.4.3.14.47.12.65-.07.18-.2.74-.86.93-1.16.2-.3.39-.25.66-.15.27.1 1.74.82 2.04.97.3.14.5.22.57.34.07.13.07.74-.16 1.39z"/>
              </svg>
              Send on WhatsApp
            </button>
            <button type="button" class="pf-pay-modal__btn pf-pay-modal__btn--primary" (click)="finishAfterPayment()">
              Done
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12h14m-5-6 6 6-6 6"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Admin flag in the header: "Frontdesk collects" toggles whether the
     * Order tab routes here automatically after save. */
    .pf-collect-toggle {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 9999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      user-select: none;
    }
    .pf-collect-toggle:hover { background: var(--glass-bg-hover); }
    .pf-collect-toggle input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: #a855f7;
    }
    .pf-collect-toggle__hint {
      color: var(--text-muted);
      cursor: help;
    }
    .pf-collect-toggle:hover .pf-collect-toggle__hint { color: var(--text-secondary); }

    .pf-eyebrow {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }

    .pf-bill-no {
      margin: 2px 0 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .pf-bill-total {
      margin: 2px 0 0;
      font-size: 18px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }

    .pf-bill-items {
      list-style: none;
      padding: 0;
      margin: 0 0 16px;
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      scrollbar-width: thin;
      align-content: start;
    }

    /* Scanner tags in the Invoice header */
    .pf-invoice-badges {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pf-scanner-tag {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      flex: 1;
      min-width: 180px;
    }
    .pf-scanner-tag__code {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      padding: 4px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    .pf-scanner-tag__meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pf-scanner-tag__label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-primary);
      line-height: 1.25;
    }
    .pf-scanner-tag__action {
      font-size: 9px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      line-height: 1.2;
    }
    /* On wider viewports show two test rows side-by-side so the invoice
     * doesn't tower vertically when there are >5 tests. */
    @media (min-width: 1100px) {
      .pf-bill-items { grid-template-columns: 1fr 1fr; }
    }
    .pf-bill-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    .pf-bill-code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 500;
      color: var(--text-muted);
    }
    .pf-bill-name { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-bill-amount { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--color-primary, #7c3aed); }

    .pf-bill-totals {
      padding: 14px 16px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: auto;
    }
    :root.light .pf-bill-totals {
      background: rgba(0, 0, 0, 0.02);
    }
    .pf-bill-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-bill-line--discount span { color: var(--text-secondary); }
    .pf-bill-line--total {
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid var(--border-muted);
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .pf-discount {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .pf-discount__input {
      width: 100%;
      max-width: 140px;
      height: 40px;
      padding: 0 30px 0 12px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13.5px;
      font-variant-numeric: tabular-nums;
      text-align: right;
      outline: none;
    }
    .pf-discount__input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-discount__input--err, .pf-discount__input--err:focus { border-color: #f87171; box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18); }
    .pf-discount__cap { font-size: 10px; font-weight: 500; color: var(--text-muted); }
    .pf-discount__err { margin: 4px 0 0; font-size: 11.5px; font-weight: 600; color: var(--red-text); }
    .pf-discount__rupee {
      position: absolute;
      right: 10px;
      color: var(--text-muted);
      font-size: 12px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      pointer-events: none;
    }
    /* ₹ vs % switch */
    .pf-discount__kind {
      display: inline-flex;
      padding: 2px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 9px;
    }
    .pf-discount__kind button {
      width: 28px; height: 26px;
      background: transparent; border: 0;
      border-radius: 7px;
      color: var(--text-primary);
      font-size: 13px; font-weight: 800;
      cursor: pointer;
      opacity: 0.72;
      transition: opacity 0.15s, background 0.15s;
    }
    .pf-discount__kind button:not(.pf-discount__kind--on):hover { opacity: 1; background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, transparent); }
    .pf-discount__kind--on {
      background: var(--color-primary, #7c3aed);
      color: white !important;
      opacity: 1;
    }
    /* Resolved ₹ value next to a % discount input */
    .pf-discount__resolved {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12px; font-weight: 600;
      color: var(--success-text, #10b981);
      white-space: nowrap;
    }

    /* TAT — inline subtle line under the totals (was a chip). */
    .pf-bill-tat-inline {
      margin: 14px 0 0;
      display: inline-flex; align-items: center; gap: 5px;
      font-size: 11.5px; color: var(--text-tertiary);
      font-style: italic;
    }
    .pf-bill-tat-inline svg { color: var(--text-muted); }

    /* Print PDF icon button in invoice header */
    .pf-bill-print-icon {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 9px;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .pf-bill-print-icon:hover { background: var(--bg-hover); color: var(--text-primary); }

    /* Toolbar action pills (Save draft / Discard) */
    .pf-toolbar-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 9999px;
      color: var(--text-primary);
      font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .pf-toolbar-btn:hover:not([disabled]) { background: var(--bg-hover); }
    .pf-toolbar-btn[disabled] { opacity: 0.4; cursor: not-allowed; }
    .pf-toolbar-btn--ghost {
      background: transparent;
      color: var(--text-secondary);
    }

    /* Unified payment tile sections */
    .pf-pay-modes { display: flex; flex-direction: column; }
    .pf-pay-modes__grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    @media (min-width: 640px) {
      .pf-pay-modes__grid { /* auto-fit: the grid lives in a container that halves at >=768px, so a
           viewport-keyed 6-up crushed tiles to ~44px on iPad portrait. */
        grid-template-columns: repeat(auto-fit, minmax(72px, 1fr)); }
    }
    .pf-pay-divider {
      margin: 18px -20px;
      height: 1px;
      background: var(--glass-border);
    }

    /* Payment mode tiles */
    .pf-mode {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 14px 14px 14px 14px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.08s, box-shadow 0.25s;
    }
    .pf-mode:not(.pf-mode--on):hover {
      background: var(--glass-bg-hover);
      border-color: var(--glass-border-hover);
    }
    .pf-mode:active { transform: scale(0.98); }
    .pf-mode svg {
      color: var(--text-secondary);
      margin-bottom: 6px;
    }
    .pf-mode__label {
      font-size: 14px;
      font-weight: 600;
    }
    .pf-mode__hint {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      color: var(--text-tertiary);
    }
    .pf-mode--on {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 15%, transparent);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 45%, transparent);
      color: var(--text-primary);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary, #7c3aed) 45%, transparent);
    }
    .pf-mode--on svg { color: var(--color-primary, #7c3aed); }
    .pf-mode--on .pf-mode__hint { color: var(--text-secondary); }

    /* Compact variant — used inside the unified payment tile so the
     * mode picker reads as a horizontal strip instead of large stacked
     * cards. Centres icon + label, drops the hint to keep it tight. */
    .pf-mode--compact {
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 10px 6px;
      border-radius: 12px;
    }
    .pf-mode--compact svg { margin-bottom: 0; width: 18px; height: 18px; }
    .pf-mode--compact .pf-mode__label { font-size: 12px; }

    /* Big amount display */
    .pf-big-amount {
      font-size: 44px;
      line-height: 1;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--text-primary);
    }

    /* Cash panel chips */
    .pf-cash-chip {
      padding: 14px;
      border-radius: 18px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
    }
    /* Clearer cash flow: received → change to return. */
    .pf-cash2__head { display: flex; align-items: baseline; justify-content: space-between; }
    .pf-cash2__label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted); }
    .pf-cash2__amt { font-size: 22px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .pf-cash2__amt--empty { color: var(--text-muted); }
    .pf-cash2__quick { display: flex; gap: 6px; }
    .pf-cash2__quick button { flex: 1; padding: 8px 0; border-radius: 10px; font-size: 12.5px; font-weight: 700; cursor: pointer;
      border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-secondary); }
    .pf-cash2__quick button:hover { background: rgba(139,92,246,0.12); border-color: rgba(139,92,246,0.4); color: var(--text-primary); }
    .pf-cash2__change { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--glass-border); }
    .pf-cash2__change span { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
    .pf-cash2__change strong { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .pf-cash2__change[data-kind="change"] { background: rgba(52,211,153,0.1); border-color: rgba(52,211,153,0.4); }
    .pf-cash2__change[data-kind="change"] span, .pf-cash2__change[data-kind="change"] strong { color: var(--green-text); }
    .pf-cash2__change[data-kind="exact"] { background: rgba(52,211,153,0.06); border-color: rgba(52,211,153,0.25); }
    .pf-cash2__change[data-kind="exact"] span { color: var(--green-text); }
    .pf-cash2__change[data-kind="short"] { background: rgba(248,113,113,0.1); border-color: rgba(248,113,113,0.4); }
    .pf-cash2__change[data-kind="short"] span, .pf-cash2__change[data-kind="short"] strong { color: var(--red-text); }
    .pf-cash-chip__label {
      margin: 0;
      font-size: 10.5px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-cash-chip__value {
      margin: 4px 0 0;
      font-size: 22px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--text-primary);
    }
    .pf-cash-chip[data-kind='ok'] {
      background: rgba(16, 185, 129, 0.14);
      border-color: rgba(16, 185, 129, 0.3);
    }
    .pf-cash-chip[data-kind='ok'] .pf-cash-chip__value { color: var(--green-text); }
    .pf-cash-chip[data-kind='short'] {
      background: rgba(239, 68, 68, 0.14);
      border-color: rgba(239, 68, 68, 0.3);
    }
    .pf-cash-chip[data-kind='short'] .pf-cash-chip__value { color: var(--red-text); }

    .pf-cash-btn {
      height: 48px;
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 13px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      transition: background 0.15s, transform 80ms, filter 80ms;
    }
    .pf-cash-btn:hover { background: var(--glass-bg-hover); }
    .pf-cash-btn--accent {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 15%, transparent);
      border-color: color-mix(in srgb, var(--color-primary, #7c3aed) 35%, transparent);
      color: var(--color-primary, #7c3aed);
    }
    :root.light .pf-cash-btn--accent { color: var(--color-primary, #7c3aed); }

    /* UPI QR */
    .pf-qr {
      width: 100%;
      max-width: 180px;
      aspect-ratio: 1 / 1;
      padding: 16px;
      border-radius: 24px;
      background: #ffffff;
      border: 1px solid var(--border-primary);
      box-shadow: 0 12px 32px rgba(124, 58, 237, 0.08), 0 4px 12px rgba(0, 0, 0, 0.03);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pf-qr__img {
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
      border-radius: 8px;
    }
    .pf-qr__hint {
      margin: 0;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .pf-live-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: var(--green-text);
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 600;
    }
    :root.light .pf-live-badge {
      background: rgba(5, 150, 105, 0.08);
      border-color: rgba(5, 150, 105, 0.2);
      color: #059669;
    }
    .pf-live__dot {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      background: currentColor;
      animation: pf-live-pulse 1.6s ease-in-out infinite;
    }
    @keyframes pf-live-pulse {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50%      { opacity: 1;   transform: scale(1.25); box-shadow: 0 0 10px currentColor; }
    }
    .pf-spin {
      animation: pf-spin-key 1s linear infinite;
    }
    @keyframes pf-spin-key {
      from { transform: rotate(0deg); }
      to   { transform: rotate(360deg); }
    }

    /* Card mockup */
    .pf-card-mock {
      position: relative;
      width: 100%;
      max-width: 260px;
      aspect-ratio: 13 / 8;
      height: auto;
      border-radius: 20px;
      background: linear-gradient(135deg, #7c3aed, #ec4899);
      box-shadow: 0 16px 40px rgba(124, 58, 237, 0.25);
      padding: 20px;
      color: #ffffff;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .pf-card-chip {
      width: 36px;
      height: 26px;
      border-radius: 6px;
      background: linear-gradient(135deg, #fbbf24, #f59e0b);
      box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.25);
    }
    .pf-card-wave {
      position: absolute;
      top: 22px;
      right: 20px;
      width: 28px;
      height: 28px;
      border-radius: 9999px;
      background:
        radial-gradient(circle at 50% 50%, transparent 0 4px, rgba(255, 255, 255, 0.65) 4px 6px, transparent 6px 9px, rgba(255, 255, 255, 0.45) 9px 11px, transparent 11px 14px);
    }
    .pf-card-pan {
      margin: 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 15px;
      letter-spacing: 0.18em;
    }
    .pf-card-foot {
      margin: 4px 0 0;
      font-size: 10px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      opacity: 0.8;
    }

    /* Placeholder panel */
    .pf-placeholder-icon {
      width: 72px;
      height: 72px;
      border-radius: 24px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-secondary);
      margin-bottom: 14px;
    }

    /* Reference no. input */
    .pf-ref-row {
      display: inline-flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      text-align: left;
    }
    .pf-ref-row > span {
      font-size: 11px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-ref-input {
      width: 100%;
      max-width: 260px;
      height: 44px;
      padding: 0 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      color: var(--text-primary);
      font-size: 14px;
      outline: none;
    }
    .pf-ref-input:focus {
      background: var(--glass-bg-hover);
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }

    /* ── Advance payment (optional, inside Pay later) ──────── */
    .pf-adv {
      width: 100%; max-width: 320px; margin-top: 22px;
      display: flex; flex-direction: column; gap: 10px;
      padding: 14px; border-radius: 14px;
      background: var(--glass-bg); border: 1px solid var(--glass-border);
    }
    .pf-adv__head { display: flex; align-items: center; justify-content: space-between; }
    .pf-adv__title { font-size: 13px; font-weight: 700; color: var(--text-primary); }
    .pf-adv__opt {
      font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-tertiary); background: var(--bg-hover);
      padding: 2px 7px; border-radius: 9999px;
    }
    .pf-adv__row { display: flex; align-items: center; gap: 8px; }
    .pf-adv__cur { font-size: 16px; font-weight: 700; color: var(--text-secondary); }
    .pf-adv__input {
      flex: 1; min-width: 0; height: 44px; padding: 0 12px;
      border-radius: 12px; background: var(--bg-card-solid);
      border: 1px solid var(--glass-border); color: var(--text-primary);
      font-size: 16px; font-weight: 700; outline: none; text-align: right;
    }
    .pf-adv__input:focus {
      border-color: rgba(168, 85, 247, 0.55);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.18);
    }
    .pf-adv__max {
      flex-shrink: 0; height: 44px; padding: 0 12px; border-radius: 12px;
      background: transparent; border: 1px solid var(--glass-border);
      color: var(--text-secondary); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    .pf-adv__max:hover { color: var(--text-primary); border-color: rgba(168, 85, 247, 0.4); }
    .pf-adv__tenders { display: flex; gap: 6px; }
    .pf-adv__tender {
      flex: 1; height: 36px; border-radius: 10px;
      background: transparent; border: 1px solid var(--glass-border);
      color: var(--text-secondary); font-size: 12px; font-weight: 600; cursor: pointer;
      transition: background .12s ease, color .12s ease, border-color .12s ease;
    }
    .pf-adv__tender--on {
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 14%, transparent);
      border-color: rgba(168, 85, 247, 0.5); color: var(--text-primary);
    }
    .pf-adv__hint { margin: 0; font-size: 11.5px; color: var(--text-secondary); text-align: left; }
    .pf-adv__hint strong { color: var(--text-primary); font-weight: 700; }
    .pf-adv__hint--muted { color: var(--text-tertiary); }
    @media (pointer: coarse) { .pf-adv__input { font-size: 16px; } .pf-adv__tender { min-height: 40px; } }

    /* ── Save / discard draft buttons ──────────────────────── */
    .pf-bill-draftrow {
      margin-top: 10px;
      display: flex; gap: 8px;
    }
    .pf-bill-draft {
      flex: 1;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      padding: 8px 10px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      color: var(--text-primary);
      font-size: 12px; font-weight: 600;
      cursor: pointer;
    }
    .pf-bill-draft:hover:not([disabled]) { background: var(--bg-hover); }
    .pf-bill-draft[disabled] { opacity: 0.45; cursor: not-allowed; }
    .pf-bill-draft--ghost { flex: 0 0 auto; color: var(--text-secondary); }

    /* ── Post-payment dialog ────────────────────────────────── */
    .pf-pay-modal {
      position: fixed; inset: 0; z-index: 1100;
      display: flex; align-items: center; justify-content: center;
      padding: 5dvh 24px 24px;
    }
    /* Embedded in the order screen — render inline (no overlay/popup). */
    .pf-pay-modal--inline {
      position: static; inset: auto; z-index: auto;
      padding: 0; margin-top: 12px;
    }
    .pf-pay-modal--inline .pf-pay-modal__shell {
      max-width: none; box-shadow: none;
    }
    .pf-pay-modal__backdrop {
      position: absolute; inset: 0;
      background:
        radial-gradient(900px 600px at 50% 100%, rgba(124, 58, 237, 0.18), transparent 60%),
        rgba(5, 5, 15, 0.72);
      backdrop-filter: blur(12px) saturate(1.2);
    }
    .pf-pay-modal__shell {
      position: relative;
      width: 100%; max-width: 420px;
      padding: 28px 24px 22px;
      background: var(--bg-card-solid);
      border: 1px solid var(--glass-border);
      border-radius: 18px;
      box-shadow: 0 30px 70px rgba(0,0,0,0.55);
      text-align: center;
    }
    .pf-pay-modal__icon {
      width: 56px; height: 56px;
      margin: 0 auto 14px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981, #14b8a6);
      color: white;
      display: inline-flex; align-items: center; justify-content: center;
      box-shadow: 0 8px 24px rgba(16, 185, 129, 0.45);
    }
    .pf-pay-modal__shell h2 {
      margin: 0; font-size: 18px; font-weight: 700; color: var(--text-primary);
    }
    .pf-pay-modal__sub {
      margin: 4px 0 18px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 13px; color: var(--text-secondary);
    }
    .pf-pay-modal__actions {
      display: flex; flex-direction: column; gap: 8px;
    }
    .pf-pay-modal__btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      padding: 11px 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      color: var(--text-primary);
      font-size: 13px; font-weight: 600;
      cursor: pointer;
    }
    .pf-pay-modal__btn:hover { background: var(--bg-hover); }
    .pf-pay-modal__btn--primary {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      color: white; border-color: transparent;
      box-shadow: 0 8px 22px rgba(124, 58, 237, 0.40);
    }
    .pf-pay-modal__btn--primary:hover { filter: brightness(1.08); background: linear-gradient(135deg, #8b5cf6, #ec4899); }

    /* ── Equal-height balanced layout ────────────────────────
     * Two columns stay side-by-side from md (iPad portrait+); both
     * tiles fill the available height so the page itself never grows.
     * Anything that overflows scrolls inside its tile, not the page. */
    .pf-bill-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
      align-items: stretch;
    }
    @media (min-width: 768px) {
      .pf-bill-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    }
    .pf-bill-col {
      min-width: 0;          /* lets grid children honour width: 100% */
      display: flex;
    }

    /* ── Non-scroll WORK page (standalone only) ──────────────
     * Fill the shell's main area and never scroll the whole page;
     * the scroll lives inside each tile's body. The embedded use
     * (:host.pf-embedded, inside the order screen) is intentionally
     * excluded so it keeps flowing in normal document flow. */
    :host { display: block; }
    :host:not(.pf-embedded) { height: 100%; }
    .pf-bill-page {
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    /* Header / toolbar are fixed; they never scroll or shrink. */
    .pf-bill-page pf-screen-header { flex: 0 0 auto; }
    /* The grid is the content region: it takes the remaining height
     * and its columns/tiles scroll internally. On phone (single
     * column) the grid itself scrolls so both stacked tiles are
     * reachable; from md the two columns sit side-by-side and each
     * tile body scrolls. */
    .pf-bill-page .pf-bill-grid {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    @media (min-width: 768px) {
      .pf-bill-page .pf-bill-grid { overflow: hidden; }
      .pf-bill-page .pf-bill-col { min-height: 0; }
    }
    .pf-bill-tile {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;       /* the *contents* scroll; the box stays put */
      overscroll-behavior: contain;
    }
    /* Right-hand payment tile: never scroll. Tile is a flex column —
     * mode picker + divider + body fight for vertical space, Confirm
     * stays pinned at the bottom (auto-height, no margin collapse). */
    .pf-bill-tile--noscroll { overflow: hidden; }
    .pf-bill-tile--noscroll .pf-pay-body {
      flex: 1;
      min-height: 0;
      display: flex; flex-direction: column;
      gap: 8px;
    }
    .pf-bill-tile--noscroll .pf-pay-body > * { min-height: 0; }
    /* Compact the loud big-amount line on the right tile so cash /
     * UPI / card panels leave more room for their input controls. */
    .pf-bill-tile--noscroll .pf-big-amount { font-size: 26px; margin-bottom: 6px; }
    .pf-bill-tile--noscroll .pf-cash-chip { padding: 8px 10px; }
    .pf-bill-tile--noscroll .pf-cash-chip__value { font-size: 16px; }
    /* Numpad inside the no-scroll tile keeps its natural compact key
     * size (52px). Now that the +100/+200/Exact/Clear strip is gone,
     * the numpad has enough vertical room without stretching. */
    .pf-bill-tile--noscroll pf-num-pad { display: block; }
    /* Confirm button is the last flex child of the tile — never grows,
     * sits flush below the numpad. */
    .pf-bill-confirm {
      margin-top: 10px !important;
      flex: 0 0 auto;
    }

    /* ── Wallet vendor picker ──────────────────────────────── */
    .pf-wallet-search {
      width: 100%;
      padding: 9px 12px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
      margin-bottom: 8px;
    }
    .pf-wallet-search:focus {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }
    .pf-wallet-list {
      list-style: none; margin: 0; padding: 0;
      flex: 1; min-height: 0; overflow-y: auto;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 10px;
    }
    .pf-wallet-row {
      width: 100%;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px;
      background: transparent; border: 0; cursor: pointer;
      color: var(--text-primary);
      font-size: 13px; text-align: left;
      border-bottom: 1px solid var(--glass-border);
    }
    .pf-wallet-row:last-child { border-bottom: 0; }
    .pf-wallet-row:hover { background: color-mix(in srgb, var(--color-primary, #7c3aed) 10%, transparent); }
    .pf-wallet-row__name { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pf-wallet-row__code {
      margin-left: 6px;
      padding: 1px 7px;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 15%, transparent);
      color: var(--color-primary, #7c3aed);
      border-radius: 9999px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 10px; font-weight: 700;
    }
    .pf-wallet-row__bal {
      flex: 0 0 auto;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700; color: var(--green-text);
    }
    .pf-wallet-row__bal--low { color: var(--red-text); }
    .pf-wallet-empty {
      padding: 14px;
      text-align: center;
      color: var(--text-tertiary);
      font-size: 12.5px;
    }

    /* Selected vendor card */
    .pf-wallet-selected {
      display: flex; align-items: center; gap: 14px;
      padding: 14px;
      background: color-mix(in srgb, var(--color-primary, #7c3aed) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--color-primary, #7c3aed) 35%, transparent);
      border-radius: 12px;
    }
    .pf-wallet-selected__name {
      margin: 0;
      font-size: 15px; font-weight: 700; color: var(--text-primary);
    }
    .pf-wallet-selected__code {
      margin: 2px 0 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11px; color: var(--text-secondary);
      letter-spacing: 0.04em;
    }
    .pf-wallet-selected__bal {
      margin: 2px 0 0;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700; font-size: 16px; color: var(--green-text);
    }
    .pf-wallet-selected__bal--low { color: var(--red-text); }
    .pf-wallet-selected__warn {
      margin: 4px 0 0;
      font-size: 11px; color: var(--red-text);
    }
    .pf-wallet-change {
      flex: 0 0 auto;
      padding: 6px 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      border-radius: 9999px;
      color: var(--text-secondary);
      font-size: 11.5px; font-weight: 600;
      cursor: pointer;
    }
    .pf-wallet-change:hover { background: var(--bg-hover); color: var(--text-primary); }

    /* ── Refund panel (overpaid after a modify) ─────────────── */
    .pf-refund { margin-top: 14px; padding: 14px; border-radius: 12px;
      border: 1px solid rgba(245, 158, 11, 0.35); background: rgba(245, 158, 11, 0.08); }
    .pf-refund__title { margin: 0 0 10px; font-size: 13px; font-weight: 700; color: var(--amber-text); }
    .pf-refund__modes { display: flex; gap: 8px; margin-bottom: 10px; }
    .pf-refund__chip { flex: 1; padding: 8px 0; border-radius: 9px; font-weight: 700; font-size: 12.5px;
      border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); background: var(--glass-bg, rgba(255,255,255,0.03)); color: var(--text-secondary, rgba(255,255,255,0.72)); cursor: pointer; }
    .pf-refund__chip--on { background: linear-gradient(135deg, #f59e0b, #fbbf24); border-color: transparent; color: #1a1a1a; }
    .pf-refund__btn { width: 100%; padding: 11px; border-radius: 11px; border: 0; font-weight: 700;
      background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #1a1a1a; cursor: pointer; }
    .pf-refund__btn:disabled { opacity: 0.6; cursor: not-allowed; }

    /* ════════════════════════════════════════════════════════
     * CROSS-PLATFORM OVERRIDES (additive only).
     * Desktop-web >=1280px is intentionally untouched. Every rule
     * below is gated to a sub-desktop width, a touch pointer, or a
     * native platform class, so it can never affect the desktop
     * layout above.
     * ════════════════════════════════════════════════════════ */

    /* ── Phone (<=640): stop iOS zoom-on-focus on the inputs the
     * user types into (font-size must be >=16px). Scoped to this
     * page's own inputs — never the shared primitives. */
    /* The shared pf-screen-header now renders a leading back chevron at every
       width, so this page's own header Back pill is redundant — hide it on all
       widths (single back affordance: the chevron). */
    .pf-bill-back-desktop { display: none; }

    @media (max-width: 640px) {
      .pf-discount__input { font-size: 16px; }
      .pf-wallet-search { font-size: 16px; }
      .pf-ref-input { font-size: 16px; }

      /* Phone = single column. Rather than trap scroll inside two
       * viewport-tall boxes, let each tile size to its content and let
       * the GRID (the page's content region) scroll as one column. The
       * page root itself still never scrolls (non-scroll WORK layout).
       * pf-bill-items also stops being an inner scroller here so the
       * whole invoice grows naturally inside the single scroll context. */
      .pf-bill-col { flex: 0 0 auto; }
      .pf-bill-tile { flex: 0 0 auto; overflow-y: visible; }
      .pf-bill-items { overflow-y: visible; flex: 0 0 auto; }
      .pf-bill-tile--noscroll .pf-pay-body { flex: 0 0 auto; }
      .pf-wallet-list { overflow-y: visible; }

      /* The mode picker is a 3-col grid on phone (base) — give the
       * tap targets a comfortable touch height. */
      .pf-mode--compact { min-height: 56px; }

      /* Quick-cash chips and discount unit switch: enlarge to >=44px
       * touch targets. */
      .pf-cash2__quick button { min-height: 44px; }
      .pf-discount__kind button { width: 34px; height: 34px; }
      .pf-discount__input { height: 44px; }

      /* Wallet rows are tappable list items — give them room. */
      .pf-wallet-row { min-height: 48px; }

      /* Post-payment dialog becomes a full-width bottom sheet so it
       * sits in the thumb zone and clears the bottom-nav pill +
       * safe-area. Not applied when embedded (already inline). */
      .pf-pay-modal:not(.pf-pay-modal--inline) {
        align-items: flex-end;
        padding: 0;
      }
      .pf-pay-modal:not(.pf-pay-modal--inline) .pf-pay-modal__shell {
        max-width: none;
        border-radius: 20px 20px 0 0;
        /* Room above the title for the bottom-sheet grabber handle. */
        padding-top: 24px;
        /* --tab-nav-total-height already folds in env(safe-area-inset-bottom),
         * so do NOT add the inset again here. */
        padding-bottom: calc(22px + var(--tab-nav-total-height, 0px));
      }
      /* Bottom-sheet grabber (HIG): a small pill at the top edge so the
       * sheet reads as swipe-dismissible. Cosmetic, additive, phone-only. */
      .pf-pay-modal:not(.pf-pay-modal--inline) .pf-pay-modal__shell::before {
        content: '';
        position: absolute;
        top: 9px; left: 50%; transform: translateX(-50%);
        width: 40px; height: 4px;
        border-radius: 9999px;
        background: var(--glass-border);
      }
    }

    /* ── iPad (641–1279): the two-column grid already kicks in at
     * 768px; below that (small landscape phones / narrow split view)
     * keep a single column. Nothing extra needed for portrait iPad —
     * it already uses both columns. Just ensure the modal stays a
     * centred card (not a phone sheet) and clears safe-area. */
    @media (min-width: 641px) and (max-width: 1279px) {
      .pf-pay-modal:not(.pf-pay-modal--inline) .pf-pay-modal__shell {
        margin-bottom: env(safe-area-inset-bottom);
      }
    }

    /* ── Touch pointer (any size): the mode tiles use a hover-only
     * background change; that's fine, but ensure pressed feedback is
     * the primary affordance and tap targets are generous. */
    @media (pointer: coarse) {
      .pf-toolbar-btn,
      .pf-wallet-change,
      .pf-refund__chip,
      .pf-pay-modal__btn { min-height: 44px; }
      .pf-bill-print-icon { width: 40px; height: 40px; }
    }

    /* ── Hover-capable devices only: keep the existing hover styles.
     * On touch they were applying on tap-and-hold; neutralise the
     * sticky hover by gating the page's own hover rules. */
    @media (hover: none) {
      .pf-collect-toggle:hover,
      .pf-mode:not(.pf-mode--on):hover,
      .pf-toolbar-btn:hover:not([disabled]),
      .pf-bill-print-icon:hover,
      .pf-wallet-row:hover,
      .pf-wallet-change:hover,
      .pf-pay-modal__btn:hover,
      .pf-cash2__quick button:hover,
      .pf-cash-btn:hover { background: var(--glass-bg); }
    }

    /* ── Capacitor native: the post-payment dialog is this page's own
     * fixed full-bleed chrome. Add the notch/home-indicator insets so
     * it never collides with the status bar or home indicator. The
     * global safe-area is absorbed on body, but a position:fixed
     * overlay escapes that, so it needs its own insets. */
    :host-context(html.cap-native) .pf-pay-modal:not(.pf-pay-modal--inline) {
      padding-top: calc(5dvh + env(safe-area-inset-top));
    }
    :host-context(html.cap-native) .pf-pay-modal:not(.pf-pay-modal--inline) .pf-pay-modal__shell {
      padding-bottom: calc(22px + env(safe-area-inset-bottom));
    }

    /* ── Print stylesheet ────────────────────────────────────
     * Print invoice button calls window.print(). Hide non-invoice
     * UI so the patient's paper / PDF copy is just the invoice. */
    @media print {
      :host { display: block; background: white; }
      .pf-no-print, pf-screen-header, .pf-discount,
      .pf-bill-actions, .pf-collect-toggle { display: none !important; }
      .grid { display: block !important; }
    }
  `]
})
export class BillingComponent implements OnInit, OnChanges {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toasts = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly settings = inject(FrontdeskSettingsService);
  private readonly billingEvents = inject(BillingEventsService);
  private readonly printer = inject(PrinterService);

  /** Embedded mode: render inline (e.g. inside the order screen) without the
   *  page header. The orderId comes from {@link embeddedOrderId} instead of the
   *  route; Back/Cancel emit {@link closed}; a successful payment emits
   *  {@link paid} (the post-payment options dialog still appears for invoicing). */
  @Input() embedded = false;
  @Input() embeddedOrderId: string | null = null;
  @Input() embeddedDiscount: number | null = null;
  /** Bumped by the host (order screen) when the order's tests change → reload
   *  the bill so the embedded panel reflects the new total. */
  @Input() reloadTick = 0;
  @Output() closed = new EventEmitter<void>();
  @Output() paymentDone = new EventEmitter<void>();

  ngOnChanges(ch: SimpleChanges): void {
    if (ch['reloadTick'] && !ch['reloadTick'].firstChange && this.embedded) this.reloadBill();
  }

  /** Re-fetch the (server-rebuilt) bill after the order's tests changed. */
  private reloadBill(): void {
    const oid = this.embeddedOrderId ?? this._bill()?.orderId;
    if (!oid || this.paid()) return;
    this.api.post<Bill>('/api/billing/', { orderId: oid, discount: 0 }).subscribe({
      next: b => this._bill.set(b),
      error: () => { /* keep the current bill on a transient error */ }
    });
  }

  readonly collectsBilling = this.settings.collectsBilling;
  setCollectsBilling(v: boolean) { this.settings.setCollectsBilling(v); }

  readonly modes = PAY_MODES;
  readonly quickAdd = QUICK_ADD;
  // 144-cell pseudo-QR renders once from this array.
  readonly qrCells = Array.from({ length: 144 }, (_, i) => i);

  private readonly _order = signal<Order | null>(null);
  private readonly _bill = signal<Bill | null>(null);
  private readonly _saving = signal(false);
  private readonly _mode = signal<PayMode>('upi');
  private readonly _cash = signal<string>('');
  private readonly _discount = signal<string>('');
  /** Server-side discount failure (e.g. cap exceeded) surfaced inline on the
   *  discount input rather than as a toast. Cleared when the user edits it. */
  private readonly _discountError = signal<string | null>(null);
  /** 'flat' = ₹ amount, 'percent' = % of subtotal+tax. */
  private readonly _discountKind = signal<'flat' | 'percent'>('flat');
  private readonly _referenceNo = signal<string>('');
  /** Pay-later advance: an OPTIONAL partial amount collected up-front while the
   *  rest stays outstanding. Empty / 0 ⇒ pure pay-later. The remaining balance
   *  can be settled anytime later (before report delivery) by reopening billing
   *  for the order, which shows effectivePayable = the outstanding amount. */
  private readonly _advance = signal<string>('');
  private readonly _advanceMode = signal<'cash' | 'upi' | 'card'>('cash');
  /** Test catalogue — used to compute the report TAT estimate from
   *  bill-item testIds. Loaded once on mount. */
  private readonly _tests = signal<Test[]>([]);
  /** Vendor wallets — lazy-loaded the first time the user picks the
   *  Wallet payment mode. Cached for the rest of the session so the
   *  picker is instant on subsequent opens. */
  private readonly _vendors = signal<VendorWallet[] | null>(null);
  private readonly _vendorQuery = signal<string>('');
  private readonly _selectedVendorId = signal<string | null>(null);
  /** Tenant billing config slice — only the wallet-visibility flag is
   *  consumed here. Defaults to "show" so reception isn't blind during
   *  the initial render before /api/billing/config returns. */
  private readonly _showWalletBalance = signal<boolean>(true);
  /** Open state for the post-payment options dialog. Flips true after a
   *  successful payment so reception can pick what happens next
   *  (print, WhatsApp, or just done). */
  private readonly _paymentDoneOpen = signal<boolean>(false);
  readonly paymentDoneOpen = this._paymentDoneOpen.asReadonly();
  /** Locked-in flag: flips true the instant a payment is recorded
   *  server-side. Disables Confirm permanently so reception can't
   *  double-charge by clicking again after dismissing the post-payment
   *  dialog. Resetting only happens on a fresh navigation. */
  private readonly _paid = signal<boolean>(false);
  readonly paid = this._paid.asReadonly();

  /** localStorage prefix for in-progress billing screens. Key includes
   *  the orderId so each order has its own draft. */
  private readonly DRAFT_KEY_PREFIX = 'pf:billing-draft:';
  private readonly DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  private readonly _hasDraft = signal<boolean>(false);
  readonly hasDraft = this._hasDraft.asReadonly();

  readonly order = this._order.asReadonly();
  readonly bill = this._bill.asReadonly();
  readonly saving = this._saving.asReadonly();
  readonly mode = this._mode.asReadonly();
  readonly cashAmount = this._cash.asReadonly();
  readonly discount = this._discount.asReadonly();
  readonly discountError = this._discountError.asReadonly();
  readonly discountKind = this._discountKind.asReadonly();
  readonly referenceNo = this._referenceNo.asReadonly();
  readonly advance = this._advance.asReadonly();
  readonly advanceMode = this._advanceMode.asReadonly();
  readonly advanceModes = [
    { id: 'cash' as const, label: 'Cash' },
    { id: 'upi' as const, label: 'UPI' },
    { id: 'card' as const, label: 'Card' },
  ];
  /** Entered advance, clamped to [0, amount still due]. */
  readonly advanceNum = computed(() => {
    const n = Math.floor(Number(this._advance() || '0'));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, this.effectivePayable());
  });
  setAdvance(v: string) { this._advance.set(v); }
  setAdvanceMode(m: 'cash' | 'upi' | 'card') { this._advanceMode.set(m); }

  /** Resolved ₹ value of the discount: either the entered flat amount,
   *  or the entered percent applied to the bill's pre-discount total. */
  readonly discountNum = computed(() => {
    const raw = parseInt(this._discount() || '0', 10);
    if (Number.isNaN(raw) || raw <= 0) return 0;
    if (this._discountKind() === 'flat') return raw;
    const b = this._bill();
    if (!b) return 0;
    const base = b.subTotal + b.totalTax;
    return Math.max(0, Math.min(base, Math.round((base * raw) / 100)));
  });
  /** The full invoice total after the reception discount (no payments applied). */
  readonly fullTotal = computed(() => {
    const b = this._bill();
    if (!b) return 0;
    return Math.max(0, b.totalPayable - this.discountNum());
  });
  /** Amount already collected (payments − refunds), from the loaded bill. */
  readonly alreadyPaid = computed(() => this._bill()?.totalPaid ?? 0);
  /** Outstanding to collect — the difference after prior payments. */
  readonly effectivePayable = computed(() => Math.max(0, this.fullTotal() - this.alreadyPaid()));
  /** Overpayment to refund (e.g. a test was removed after the bill was paid). */
  readonly refundDue = computed(() => Math.max(0, this.alreadyPaid() - this.fullTotal()));

  readonly refundModeDefs = [{ key: 'cash', label: 'Cash' }, { key: 'upi', label: 'UPI' }, { key: 'card', label: 'Card' }];
  readonly refundMode = signal('cash');
  readonly refunding = signal(false);

  /** Route a failed discount mutation: a field-named backend error highlights
   *  the discount input inline; anything else falls back to a toast. Both carry
   *  the REAL backend message. */
  private showDiscountError(e: unknown) {
    const err = ApiError.from(e);
    if (err.field === 'discount' || err.field === 'amount') this._discountError.set(err.message);
    else this.toasts.error(err.message);
  }

  /** Record a refund for the overpaid amount against this bill. */
  doRefund() {
    const b = this._bill();
    const amt = this.refundDue();
    if (!b || amt <= 0 || this.refunding()) return;
    this.refunding.set(true);
    this.api.post<Bill>(`/api/billing/${b.id}/refund`, { amount: amt, mode: this.refundMode(), reason: 'order modified — test removed' })
      .subscribe({
        next: updated => {
          this.refunding.set(false);
          this._bill.set(updated);
          this.toasts.success(`Refunded ${amt}`);
        },
        error: e => { this.refunding.set(false); this.toasts.error(ApiError.from(e).message); }
      });
  }
  readonly cashAmountNum = computed(() => {
    const n = parseInt(this._cash() || '0', 10);
    return Number.isNaN(n) ? 0 : n;
  });
  readonly changeAmount = computed(() => this.cashAmountNum() - this.effectivePayable());
  readonly changeAbs = computed(() => Math.abs(this.changeAmount()));

  readonly currentModeDef = computed(() => this.modes.find(m => m.id === this._mode()) ?? null);

  readonly subtitle = computed(() => {
    const p = this._order()?.patient;
    if (!p) return 'Choose a payment mode and confirm the total.';
    return `${p.displayName} · ${p.phone ?? ''}`.trim();
  });

  /** Tenant invoice template (letterhead, GSTIN, document mode, QR toggle). */
  readonly invoiceTpl = signal<any>(null);
  /** Public result-tracking token for the invoice QR (minted on load). */
  readonly trackToken = signal<string | null>(null);
  readonly trackUrl = computed(() => {
    const t = this.trackToken();
    return t ? `${window.location.origin}/track/${t}` : '';
  });

  readonly invoiceNumber = computed(() => {
    const b = this._bill();
    if (!b) return '—';
    // Prefer the server-allocated number (from the tenant billing config's
    // prefix + running counter); fall back to a short-id for legacy bills.
    if (b.invoiceNumber) return b.invoiceNumber;
    const shortId = b.id.replace(/-/g, '').slice(-8).toUpperCase();
    return `INV-${shortId}`;
  });

  /** Estimated time-to-report = max(tatHours) across the bill items.
   *  Returns null until the test catalogue has loaded. Reception shows
   *  this on the invoice so patients know when results land. */
  readonly tatHoursEstimate = computed<number | null>(() => {
    const b = this._bill();
    const tests = this._tests();
    if (!b || tests.length === 0) return null;
    let maxH = 0;
    for (const item of b.items) {
      const t = tests.find(x => x.id === item.testId);
      if (t && Number.isFinite(t.tatHours) && t.tatHours > maxH) maxH = t.tatHours;
    }
    return maxH || null;
  });
  readonly tatLabel = computed<string>(() => {
    const h = this.tatHoursEstimate();
    if (h == null) return '';
    if (h < 24) return `≈ ${h}h to report`;
    const days = Math.round(h / 24);
    return `≈ ${days} day${days === 1 ? '' : 's'} to report`;
  });

  /** UPI deep-link encoded into a real QR (rendered via api.qrserver.com).
   *  Amount + invoice id are baked in so the patient's UPI app prefills
   *  everything. payee VPA + name are placeholder constants for now. */
  readonly upiQrUrl = computed<string>(() => {
    const amt = this.effectivePayable();
    const inv = this.invoiceNumber();
    const params = new URLSearchParams({
      pa: 'prefrontal@upi',
      pn: 'Prefrontal Lab',
      tn: inv,
      am: String(amt),
      cu: 'INR'
    });
    const upi = `upi://pay?${params.toString()}`;
    const enc = encodeURIComponent(upi);
    return `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=8&data=${enc}`;
  });

  // ── Per-role discount cap (notify rather than silently clamp) ──
  private readonly _maxDiscountPct = signal(100);
  private readonly _overrideDiscountPct = signal(100);
  /** Discount % this user may grant by permission tier. */
  readonly discountCapPct = computed(() =>
    this.auth.hasPermission('override_discount') ? this._overrideDiscountPct()
    : this.auth.hasPermission('give_discount') ? this._maxDiscountPct()
    : 0);
  /** Entered discount as a % of the bill's pre-discount total. */
  readonly discountPct = computed(() => {
    const b = this._bill();
    const base = b ? b.subTotal + b.totalTax : 0;
    return base > 0 ? (this.discountNum() / base) * 100 : 0;
  });
  /** True when the entered discount exceeds the user's cap → block + notify. */
  readonly discountOverCap = computed(() =>
    this.discountNum() > 0 && this.discountPct() > this.discountCapPct() + 0.01);

  readonly canConfirm = computed(() => {
    if (this._paid()) return false; // already paid — never let it re-fire
    if (this.discountOverCap()) return false; // discount above this user's limit
    const m = this._mode();
    if (m === 'cash') return this.cashAmountNum() >= this.effectivePayable();
    if (m === 'wallet') {
      // Need a selected vendor; if balances are visible, also enforce
      // sufficient balance up-front so reception doesn't fire a doomed
      // POST. (Backend re-checks regardless.)
      const v = this.selectedVendor();
      if (!v) return false;
      if (this._showWalletBalance() && v.balance < this.effectivePayable()) return false;
      return true;
    }
    return this.effectivePayable() >= 0;
  });

  readonly vendors = this._vendors.asReadonly();
  readonly vendorQuery = this._vendorQuery.asReadonly();
  readonly selectedVendorId = this._selectedVendorId.asReadonly();
  readonly showWalletBalance = this._showWalletBalance.asReadonly();
  /** Resolved vendor object for the currently-selected id. */
  readonly selectedVendor = computed<VendorWallet | null>(() => {
    const id = this._selectedVendorId();
    if (!id) return null;
    return (this._vendors() ?? []).find(v => v.id === id) ?? null;
  });
  /** Filter active vendors by name/code substring. */
  readonly filteredVendors = computed<VendorWallet[]>(() => {
    const all = (this._vendors() ?? []).filter(v => v.isActive);
    const q = this._vendorQuery().trim().toLowerCase();
    if (!q) return all.slice(0, 25);
    return all.filter(v =>
      v.name.toLowerCase().includes(q) ||
      (v.code ?? '').toLowerCase().includes(q)
    ).slice(0, 25);
  });

  ngOnInit() {
    const orderId = this.embeddedOrderId ?? this.route.snapshot.queryParamMap.get('orderId');
    if (!orderId) {
      if (this.embedded) { this.closed.emit(); return; }
      this.toasts.error('No order id'); this.router.navigateByUrl('/frontdesk'); return;
    }

    this.api.get<Order>(`/api/orders/${orderId}`).subscribe({ next: o => this._order.set(o) });
    // Mint (or fetch) the public tracking token so the invoice can show a QR
    // the patient scans to follow their report — best-effort, non-blocking.
    this.api.get<{ token: string }>(`/api/orders/${orderId}/track-token`).subscribe({
      next: r => { if (r?.token) this.trackToken.set(r.token); }, error: () => {}
    });
    this.api.get<any>('/api/config/invoice-template').subscribe({ next: t => this.invoiceTpl.set(t), error: () => {} });
    // Per-role discount caps (Level-1 give_discount / Level-2 override_discount).
    // Slim endpoint: the full config GET is admin-gated, so a receptionist's
    // fetch 403'd and the caps silently fell back to 100%.
    this.api.get<{ maxDiscountPct?: number; overrideDiscountPct?: number }>('/api/config/billing/visibility').subscribe({
      next: c => {
        if (typeof c?.maxDiscountPct === 'number') this._maxDiscountPct.set(c.maxDiscountPct);
        if (typeof c?.overrideDiscountPct === 'number') this._overrideDiscountPct.set(c.overrideDiscountPct);
      },
      error: () => { /* default 100% cap */ }
    });
    // A discount carried from the Build-an-order cart (resolved ₹) — via the
    // route in standalone mode, or the input in embedded mode.
    const carriedDiscount = this.embedded
      ? (this.embeddedDiscount != null ? String(this.embeddedDiscount) : null)
      : this.route.snapshot.queryParamMap.get('discount');
    this.api.post<Bill>('/api/billing/', { orderId, discount: 0 }).subscribe({
      next: b => {
        this._bill.set(b);
        // Restore any saved draft *after* the bill is loaded so the
        // discount cap clamping can use the real subTotal+totalTax.
        this.restoreDraftFor(orderId);
        // A discount passed from the order-build cart wins over an old draft.
        const d = parseInt(carriedDiscount ?? '', 10);
        if (Number.isFinite(d) && d > 0) {
          this.setDiscountKind('flat');
          this.setDiscount(String(d));
        }
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
    // Tests catalogue — used to derive the report TAT estimate.
    this.api.get<Test[]>('/api/tests/').subscribe({
      next: l => this._tests.set(l ?? []),
      error: () => { /* TAT is non-critical; silently skip if it fails */ }
    });
  }

  /** Save the in-progress billing inputs (mode, discount, cash entered,
   *  reference no) to localStorage so reception can step away and come
   *  back later without losing what they typed. Keyed by orderId. */
  saveDraft() {
    const b = this._bill();
    if (!b) return;
    if (this._paid()) { this.toasts.info('Already paid — nothing to save'); return; }
    try {
      localStorage.setItem(this.DRAFT_KEY_PREFIX + b.orderId, JSON.stringify({
        savedAt: Date.now(),
        mode: this._mode(),
        cash: this._cash(),
        discount: this._discount(),
        discountKind: this._discountKind(),
        referenceNo: this._referenceNo()
      }));
      this._hasDraft.set(true);
      this.toasts.success('Saved as draft');
    } catch {
      this.toasts.error('Could not save draft (storage full?)');
    }
  }

  discardDraft() {
    const b = this._bill();
    if (!b) return;
    try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + b.orderId); } catch { /* ignore */ }
    this._hasDraft.set(false);
    this.toasts.info('Draft discarded');
  }

  /** Internal version called after a successful payment / pay-later
   *  commit — clears storage but doesn't toast (the success toast is
   *  already firing from the caller). */
  private clearDraft() {
    const b = this._bill();
    if (!b) return;
    try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + b.orderId); } catch { /* ignore */ }
    this._hasDraft.set(false);
  }

  private restoreDraftFor(orderId: string) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(this.DRAFT_KEY_PREFIX + orderId); } catch { return; }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        savedAt?: number; mode?: PayMode; cash?: string;
        discount?: string; discountKind?: 'flat' | 'percent'; referenceNo?: string;
      };
      if (!parsed?.savedAt || Date.now() - parsed.savedAt > this.DRAFT_TTL_MS) {
        try { localStorage.removeItem(this.DRAFT_KEY_PREFIX + orderId); } catch { /* ignore */ }
        return;
      }
      if (parsed.discountKind) this._discountKind.set(parsed.discountKind);
      if (parsed.discount != null) this._discount.set(parsed.discount);
      if (parsed.mode) this._mode.set(parsed.mode);
      if (parsed.cash != null) this._cash.set(parsed.cash);
      if (parsed.referenceNo != null) this._referenceNo.set(parsed.referenceNo);
      this._hasDraft.set(true);
      this.toasts.info('Draft restored');
    } catch { /* ignore parse errors */ }
  }

  setMode(m: PayMode) {
    this._mode.set(m);
    // Lazy-load vendor wallets the first time the user opens the
    // Wallet panel. We also fetch the visibility flag so the picker
    // can hide the balance column for tenants that opted out.
    if (m === 'wallet' && this._vendors() === null) this.loadVendors();
  }
  setVendorQuery(q: string) { this._vendorQuery.set(q); }
  selectVendor(id: string) { this._selectedVendorId.set(id); }
  clearVendor() { this._selectedVendorId.set(null); }

  private loadVendors() {
    console.info('[wallet] loadVendors() fired');
    this.api.get<VendorWallet[]>('/api/vendors').subscribe({
      next: list => {
        console.info('[wallet] vendors next', { count: list?.length ?? 0, list });
        this._vendors.set(list ?? []);
      },
      error: err => {
        console.warn('[wallet] vendors error', err);
        this._vendors.set([]);
      }
    });
    this.api.get<BillingConfigSlice>('/api/config/billing/visibility').subscribe({
      next: cfg => this._showWalletBalance.set(cfg?.frontdeskCanSeeWalletBalance ?? true),
      error: () => { /* leave default true */ }
    });
  }
  setCash(v: string) { this._cash.set(v); }
  readonly cashNotes = [100, 500, 2000];
  setExactCash() { this._cash.set(String(this.effectivePayable())); }
  addCash(n: number) { this._cash.set(String(this.cashAmountNum() + n)); }
  setCashExact() { this._cash.set(String(this.effectivePayable())); }
  clearCash() { this._cash.set(''); }

  setDiscount(v: string) {
    this._discountError.set(null); // clear any inline server error on edit
    // Strip anything non-numeric. For 'flat' we cap at the bill's
    // pre-discount total so the discount can't exceed payable; for
    // 'percent' we cap at 100. Empty input clears.
    const digits = (v ?? '').replace(/[^\d]/g, '');
    if (digits === '') { this._discount.set(''); return; }
    const raw = parseInt(digits, 10);
    if (this._discountKind() === 'percent') {
      this._discount.set(String(Math.min(100, Math.max(0, raw))));
      return;
    }
    const b = this._bill();
    const cap = b ? b.subTotal + b.totalTax : Number.POSITIVE_INFINITY;
    const n = Math.min(raw, cap);
    this._discount.set(n === 0 ? '' : String(n));
  }
  setDiscountKind(k: 'flat' | 'percent') {
    if (k === this._discountKind()) return;
    this._discountError.set(null);
    this._discountKind.set(k);
    // Reset the entered value when toggling — different units, different
    // numbers; clearing avoids surprising clamps (e.g. ₹500 reinterpreted
    // as 500%).
    this._discount.set('');
  }
  /** Block obviously bad keystrokes at source — minus, plus, e/E exponent,
   *  and decimal point. Keeps Tab/Backspace/arrows/etc. flowing. */
  blockDiscountChars(ev: KeyboardEvent) {
    if (['-', '+', 'e', 'E', '.', ','].includes(ev.key)) {
      ev.preventDefault();
    }
  }
  setReferenceNo(v: string) { this._referenceNo.set(v); }
  asInput(ev: Event): string { return (ev.target as HTMLInputElement).value; }

  /** 144-cell pseudo-QR — same formula as the reference for visual parity. */
  qrFill(i: number): string {
    const on = (Math.sin(i * 7.13) + Math.cos(i * 3.71)) > 0.2;
    return on ? '#0f1827' : 'transparent';
  }

  confirm() {
    const b = this._bill();
    if (!b || this._saving()) return;
    if (!this.canConfirm()) {
      this.toasts.warning('Enter an amount at least equal to the total due.');
      return;
    }

    if (this._paid()) return; // hard guard against double-fire
    this._saving.set(true);
    // 'later' mode skips the payment POST entirely — the bill stays
    // open with balance == totalPayable, and the FD landing's
    // payments-due drawer surfaces it.
    if (this._mode() === 'later') {
      const adv = this.advanceNum();
      if (adv > 0) {
        // Collect the optional advance now; the remainder stays outstanding so
        // the order still flows as a pay-later (balance recorded, collectible
        // anytime before report delivery).
        const collectAdvance = (bill: Bill) => {
          this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
            amount: adv,
            mode: this._advanceMode(),
            referenceNo: this._referenceNo() || undefined
          }).subscribe({
            next: (updated) => {
              if (updated) this._bill.set(updated);
              this._saving.set(false);
              this._paid.set(true);
              this.clearDraft();
              const rest = Math.max(0, this.fullTotal() - (updated?.totalPaid ?? adv));
              this.toasts.success(rest > 0
                ? `Advance collected — ₹${rest} stays outstanding (Pay later)`
                : 'Payment collected in full');
              this.billingEvents.notifyPayLater();
              if (this.embedded) { this.paymentDone.emit(); }
              this._paymentDoneOpen.set(true);
            },
            error: e => { this._saving.set(false); this.toasts.error(ApiError.from(e).message); }
          });
        };
        const d = this.discountNum();
        if (d > 0) {
          this.api.post<Bill>(`/api/billing/${b.id}/discount`, { amount: d, reason: 'Reception discount' })
            .subscribe({
              next: updated => { this._bill.set(updated); collectAdvance(updated); },
              error: e => { this._saving.set(false); this.showDiscountError(e); }
            });
        } else {
          collectAdvance(b);
        }
        return;
      }
      this._saving.set(false);
      this._paid.set(true);
      this.clearDraft();
      this.toasts.warning('Marked as Pay later — outstanding balance recorded');
      this.billingEvents.notifyPayLater();
      this._paymentDoneOpen.set(true);
      return;
    }
    // 'wallet' mode charges the selected vendor's credit BEFORE
    // recording the payment. If the charge fails (insufficient
    // balance / inactive wallet), abort without recording payment so
    // reception can pick a different vendor or mode.
    if (this._mode() === 'wallet') {
      const vendor = this.selectedVendor();
      if (!vendor) { this._saving.set(false); this.toasts.warning('Pick a vendor first'); return; }
      const amount = this.effectivePayable();
      const applyAndPay = (currentBill: Bill) => {
        this.api.post<VendorWallet>(`/api/vendors/${vendor.id}/charge`, {
          amount, billId: currentBill.id,
          reason: `Bill #${currentBill.id.substring(0, 8)} — ${vendor.name}`
        }).subscribe({
          next: (updatedVendor) => {
            // The /charge endpoint returns the vendor with its NEW balance —
            // patch the cached list so every bound view (selected card, wallet
            // rows) reflects the raised outstanding immediately, no refetch.
            if (updatedVendor?.id) {
              this._vendors.update(list => (list ?? []).map(v => v.id === updatedVendor.id ? { ...v, ...updatedVendor } : v));
            }
            // Wallet charge succeeded → record the bill payment so the
            // bill is marked paid and the running totals on the FD
            // landing pick it up.
            this.api.post<Bill>(`/api/billing/${currentBill.id}/payment`, {
              amount, mode: 'wallet',
              referenceNo: this._referenceNo() || vendor.code || vendor.name
            }).subscribe({
              next: (updated) => {
                if (updated) this._bill.set(updated);
                this._saving.set(false);
                this._paid.set(true);
                this.clearDraft();
                this.toasts.success(`Charged ₹${amount} to ${vendor.name}`);
                this.billingEvents.notifyPaid();
                this._paymentDoneOpen.set(true);
              },
              error: e => { this._saving.set(false); this.toasts.error(ApiError.from(e).message); }
            });
          },
          error: e => {
            this._saving.set(false);
            this.toasts.error(ApiError.from(e).message);
          }
        });
      };
      const d = this.discountNum();
      if (d > 0) {
        this.api.post<Bill>(`/api/billing/${b.id}/discount`, { amount: d, reason: 'Reception discount' })
          .subscribe({
            next: updated => { this._bill.set(updated); applyAndPay(updated); },
            error: e => { this._saving.set(false); this.showDiscountError(e); }
          });
      } else {
        applyAndPay(b);
      }
      return;
    }
    const pay = (bill: Bill) => {
      // Collect the amount still OUTSTANDING, not the whole invoice again.
      // On the first payment this equals the full payable (nothing paid yet);
      // on a returning partially-paid bill it's the remaining balance, so
      // reopening billing for that patient collects only what's left instead
      // of double-charging (which would push the bill into an overpaid /
      // refund-owed state).
      const amountDue = this.alreadyPaid() > 0 ? this.effectivePayable() : bill.totalPayable;
      this.api.post<Bill>(`/api/billing/${bill.id}/payment`, {
        amount: amountDue,
        mode: this._mode(),
        referenceNo: this._referenceNo() || undefined
      }).subscribe({
        next: (updated) => {
          // Adopt the post-payment bill (balance→0, totalPaid set, payments[]
          // populated) so the printed invoice reads "Paid" with the real mode
          // of payment — not the stale pre-payment "Due" snapshot.
          if (updated) this._bill.set(updated);
          this._saving.set(false);
          this._paid.set(true); // lock — Confirm is now disabled forever
          this.clearDraft();
          this.toasts.success('Payment collected');
          this.billingEvents.notifyPaid();
          // Embedded (order screen): emit so the post-pay actions render INLINE.
          // Do NOT auto-print — printing is a deliberate click on the
          // "Print invoice" button (the auto-open print dialog was unwanted).
          if (this.embedded) { this.paymentDone.emit(); }
          this._paymentDoneOpen.set(true);
        },
        error: e => { this._saving.set(false); this.toasts.error(ApiError.from(e).message); }
      });
    };

    // If a flat discount was entered, apply it first and use the updated bill.
    const d = this.discountNum();
    if (d > 0) {
      this.api.post<Bill>(`/api/billing/${b.id}/discount`, {
        amount: d,
        reason: 'Reception discount'
      }).subscribe({
        next: updated => { this._bill.set(updated); pay(updated); },
        error: e => { this._saving.set(false); this.showDiscountError(e); }
      });
    } else {
      pay(b);
    }
  }

  /** Back honours the browser history first — typical entry to billing
   *  is from the order page, so Location.back() returns there. If
   *  history is empty (deep-linked tab), fall back to /frontdesk. */
  back() {
    if (this.embedded) { this.closed.emit(); return; }
    if (window.history.length > 1) this.location.back();
    else this.router.navigateByUrl('/frontdesk');
  }

  /** Leave the collect-payment screen without taking payment. The order itself
   *  is already saved; this just abandons billing and returns to the desk. */
  cancel() {
    if (this.embedded) { this.closed.emit(); return; }
    this.router.navigateByUrl('/frontdesk');
  }

  /** Generate a properly-formatted A4 invoice PDF (header, items table,
   *  totals, footer) and trigger a download. Built client-side with
   *  jsPDF so we don't need a server round-trip; the structured output
   *  is sharper and more usable than a window.print() screenshot. */
  async printInvoice() {
    const b = this._bill();
    if (!b) { this.toasts.warning('Bill is still loading'); return; }
    try {
      const tpl = this.invoiceTpl();
      // Render the result-tracking link as a QR (PNG) for the printed invoice.
      // Always attempt it — if the token wasn't minted yet at page-load (async
      // race), fetch it inline now rather than dropping the QR silently.
      let qrDataUrl: string | undefined;
      let token = this.trackToken();
      if (!token) {
        const oid = this._order()?.id ?? this.route.snapshot.queryParamMap.get('orderId');
        if (oid) {
          try {
            const r = await firstValueFrom(this.api.get<{ token: string }>(`/api/orders/${oid}/track-token`));
            if (r?.token) { token = r.token; this.trackToken.set(r.token); }
          } catch { /* fall through — handled below */ }
        }
      }
      let orderQrDataUrl: string | undefined;
      const oidForQr = this._order()?.id ?? this.route.snapshot.queryParamMap.get('orderId');
      try {
        const QRCode = (await import('qrcode')).default;
        if (token) qrDataUrl = await QRCode.toDataURL(`${window.location.origin}/track/${token}`, { margin: 1, width: 220 });
        else this.toasts.warning('Invoice ready, but the tracking QR could not be generated.');
        // Staff order QR.
        if (oidForQr) orderQrDataUrl = await QRCode.toDataURL(`${window.location.origin}/o/${oidForQr}`, { margin: 1, width: 220 });
      } catch { /* QR is best-effort */ }
      // Document title: explicit mode, else auto from whether the bill carries tax
      // (most diagnostic services are GST-exempt → Bill of Supply).
      const mode = tpl?.documentMode ?? 'auto';
      const docTitle = mode === 'bill_of_supply' ? 'BILL OF SUPPLY'
        : mode === 'tax_invoice' ? 'TAX INVOICE'
        : (b.totalTax > 0 ? 'TAX INVOICE' : 'BILL OF SUPPLY');
      const logoDataUrl = tpl?.showLogo === false ? undefined : await loadImageDataUrl(tpl?.logoUrl, environment.apiUrl);
      const input = {
        bill: b,
        order: this._order(),
        invoiceNumber: this.invoiceNumber(),
        effectivePayable: this.effectivePayable(),
        tatLabel: this.tatLabel(),
        qrDataUrl, orderQrDataUrl, logoDataUrl,
        cashierName: this.auth.user()?.displayName || undefined,
        cashierSignatureDataUrl: this.auth.user()?.signatureDataUrl || undefined,
        docTitle,
        ...invoiceTemplateFieldsFrom(tpl),
        practice: {
          name: ((tpl?.labName) || this.auth.user()?.tenantName) || undefined,
          address: tpl?.address || undefined,
          phone: tpl?.phone || undefined, email: tpl?.email || undefined,
          gstin: tpl?.showGstin === false ? undefined : (tpl?.gstin || undefined),
        },
      };
      if (this.isNativePlatform()) {
        // Capacitor WKWebView: the hidden-iframe window.print() is a no-op and
        // doc.save() can't download. Render to a blob and hand it to the native
        // iOS/Android share sheet (Print, Save to Files, AirDrop…) via the Web
        // Share API — same approach as the report queue, no plugin needed.
        const blobUrl = generateInvoicePdf({ ...input, action: 'blob' }) as unknown as string;
        const blob = await (await fetch(blobUrl)).blob();
        try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
        const file = new File([blob], `${this.invoiceNumber() || 'invoice'}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: 'Invoice', text: `Invoice ${this.invoiceNumber()}` });
          } catch (err) {
            if ((err as { name?: string })?.name !== 'AbortError') throw err;
          }
          return;
        }
        // No file-share support — fall back to opening the PDF so the user can
        // use the system viewer's own print/save controls.
        generateInvoicePdf({ ...input, action: 'view' });
        return;
      }
      // Desktop with a chosen invoice printer (Printing settings) → print the
      // PDF silently to it. Otherwise fall back to the browser print dialog.
      const blobUrl = generateInvoicePdf({ ...input, action: 'blob' }) as unknown as string;
      const bytes = new Uint8Array(await (await fetch(blobUrl)).arrayBuffer());
      try { URL.revokeObjectURL(blobUrl); } catch { /* noop */ }
      const routed = await this.printer.printInvoicePdf(bytes);
      if (routed.handled) {
        if (routed.ok) this.toasts.success('Invoice sent to printer');
        else this.toasts.error(routed.error || 'Invoice print failed');
      } else {
        generateInvoicePdf({ ...input, action: 'print' });
      }
    } catch (err) {
      console.error('[billing] invoice PDF failed', err);
      this.toasts.error('Could not generate invoice PDF');
    }
  }

  /** True inside the Capacitor native shell (iOS/Android), where web blob
   *  downloads and window.print() are no-ops. */
  private isNativePlatform(): boolean {
    return !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
      .Capacitor?.isNativePlatform?.();
  }

  /** Post-payment "Send via WhatsApp" — opens wa.me with a pre-filled
   *  message containing the invoice number, total, and TAT. If we have
   *  the patient's phone number we deep-link directly; otherwise we
   *  open the contact-picker variant so reception can paste a number. */
  sendOnWhatsApp() {
    const b = this._bill();
    const p = this._order()?.patient;
    if (!b) return;
    const lines = [
      `Hi ${p?.displayName ?? ''}, your invoice from ${this.auth.user()?.tenantName || 'our lab'}:`,
      `${this.invoiceNumber()} — Paid ₹${b.totalPayable}`,
    ];
    const tat = this.tatLabel();
    if (tat) lines.push(tat);
    lines.push('Thank you for choosing us.');
    window.open(waLink(p?.phone, lines.join('\n')), '_blank', 'noopener');
  }

  /** Close the dialog and return to the FD landing — payment is done,
   *  the queue takes over. */
  finishAfterPayment() {
    this._paymentDoneOpen.set(false);
    // Embedded in the order screen → hand control back to the host (it resets
    // for the next patient) instead of routing to the post-payment screen.
    if (this.embedded) { this.closed.emit(); return; }
    const b = this._bill();
    // if (b) this.router.navigate(['/frontdesk/post-payment'], { queryParams: { orderId: b.orderId } });
    // else this.router.navigateByUrl('/frontdesk');

    this.router.navigateByUrl('/frontdesk');
  }
  /** Backdrop / Esc close: payment is already done, so we still route
   *  forward to the post-payment screen instead of stranding the user
   *  on a paid-but-still-clickable billing page. */
  closePaymentDoneDialog() {
    this._paymentDoneOpen.set(false);
    if (this.embedded) { this.closed.emit(); return; }
    const b = this._bill();
    if (b) this.router.navigate(['/frontdesk/post-payment'], { queryParams: { orderId: b.orderId } });
    else this.router.navigateByUrl('/frontdesk');
  }
}
