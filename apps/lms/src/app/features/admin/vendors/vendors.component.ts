import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { WalletOutstandingPipe } from '../../../shared/pipes/wallet-outstanding.pipe';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { LoadingLogoComponent } from '../../../shared/components/loading-logo/loading-logo.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';

type VendorStatus = 'all' | 'active' | 'inactive';

interface VendorRow {
  id: string;
  name: string;
  code?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  gstin?: string;
  address?: string;
  totalCredit: number;
  usedCredit: number;
  balance: number;
  /** What the partner OWES (usedCredit − totalCredit). Headline in the
   *  accruing-tab model. */
  outstanding: number;
  /** Optional outstanding alert threshold; crossing it fires a bell. */
  notifyThreshold?: number | null;
  isActive: boolean;
  createdAt: string;
}

interface VendorTxn {
  id: string;
  vendorId: string;
  type: 'topup' | 'charge' | 'refund' | 'adjustment' | 'payment' | string;
  amount: number;
  billId?: string | null;
  reason?: string | null;
  paidAt?: string | null;
  attachmentUrl?: string | null;
  createdAt: string;
}

interface NewVendorDraft {
  name: string;
  code: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  gstin: string;
  address: string;
  openingCredit: string;
  notifyThreshold: string;
}

const EMPTY_DRAFT: NewVendorDraft = {
  name: '', code: '', contactName: '', contactPhone: '', contactEmail: '',
  gstin: '', address: '', openingCredit: '', notifyThreshold: ''
};

@Component({
  selector: 'pf-vendors',
  standalone: true,
  imports: [
    FormsModule, CurrencyInrPipe, WalletOutstandingPipe,
    ScreenHeaderComponent, TouchButtonComponent,
    LoadingLogoComponent, HeroBandComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band pill (owner): vendor search + status filter; "Add vendor"
             rides the band's actions. -->
        <pf-hero-band [back]="true" placeholder="Search vendors — name, code, contact, GSTIN…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-tools>
            <span class="nd-seg pf-vn-seg" role="radiogroup" aria-label="Vendor status">
              @for (o of statusOptions(); track o.value) {
                <button type="button" class="nd-seg__item" role="radio" [attr.aria-checked]="status() === o.value"
                        (click)="status.set(o.value)">{{ o.label }} <span class="nd-num pf-vn-seg__n">{{ o.count }}</span></button>
              }
            </span>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn press" [class.pf-hb-btn--primary]="!newVendorOpen()"
                    [class.pf-hb-btn--ghost]="newVendorOpen()" (click)="toggleNewVendor()"
                    [attr.aria-label]="newVendorOpen() ? 'Cancel new vendor' : 'Add vendor'">
              @if (newVendorOpen()) {
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
              } @else {
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              }
              {{ newVendorOpen() ? 'Cancel' : 'Add vendor' }}
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Vendor Credit Wallets"
        subtitle="Pre-loaded credit accounts for partner hospitals & aggregators. Reception charges bills against these wallets from the billing screen.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleNewVendor()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          {{ newVendorOpen() ? 'Cancel' : 'Add vendor' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      @if (newVendorOpen()) {
        <section class="nd-card nd-anim-in pf-vn-new" aria-label="New vendor">
          <div class="nd-card__head">
            <span class="nd-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01"/></svg></span>
            <h3 class="nd-card__label">New vendor</h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pf-vn-new__body">
            <div><label class="nd-field__lbl pf-vn-lbl">Name *</label>
              <input type="text" class="nd-input" [class.nd-input--error]="nameError()" [ngModel]="draft().name" (ngModelChange)="patchDraft({ name: $event })" placeholder="Apollo Hospital"/>
              @if (nameError()) { <p class="pf-field-err">{{ nameError() }}</p> }</div>
            <div><label class="nd-field__lbl pf-vn-lbl">Code</label>
              <input type="text" class="nd-input nd-num uppercase" [class.nd-input--error]="codeError()" [ngModel]="draft().code" (ngModelChange)="patchDraft({ code: $event.toUpperCase() })" placeholder="APOLLO"/>
              @if (codeError()) { <p class="pf-field-err">{{ codeError() }}</p> }</div>
            <div><label class="nd-field__lbl pf-vn-lbl">Contact name</label>
              <input type="text" class="nd-input" [ngModel]="draft().contactName" (ngModelChange)="patchDraft({ contactName: $event })"/></div>
            <div><label class="nd-field__lbl pf-vn-lbl">Contact phone</label>
              <input type="tel" class="nd-input" [ngModel]="draft().contactPhone" (ngModelChange)="patchDraft({ contactPhone: $event })"/></div>
            <div><label class="nd-field__lbl pf-vn-lbl">Contact email</label>
              <input type="email" class="nd-input" [ngModel]="draft().contactEmail" (ngModelChange)="patchDraft({ contactEmail: $event })"/></div>
            <div><label class="nd-field__lbl pf-vn-lbl">GSTIN</label>
              <input type="text" class="nd-input" [ngModel]="draft().gstin" (ngModelChange)="patchDraft({ gstin: $event })"/></div>
            <div class="sm:col-span-2"><label class="nd-field__lbl pf-vn-lbl">Address</label>
              <input type="text" class="nd-input" [ngModel]="draft().address" (ngModelChange)="patchDraft({ address: $event })"/></div>
            <div>
              <label class="nd-field__lbl pf-vn-lbl">Opening settlement (₹)</label>
              <input type="number" min="0" step="1" class="nd-input"
                     [ngModel]="draft().openingCredit"
                     (ngModelChange)="patchDraft({ openingCredit: $event })"
                     placeholder="0"/>
              <p class="nd-field__hint pf-vn-hint">Optional — a prepayment that offsets the tab.</p>
            </div>
            <div>
              <label class="nd-field__lbl pf-vn-lbl">Alert threshold (₹)</label>
              <input type="number" min="0" step="1" class="nd-input"
                     [ngModel]="draft().notifyThreshold"
                     (ngModelChange)="patchDraft({ notifyThreshold: $event })"
                     placeholder="No limit"/>
              <p class="nd-field__hint pf-vn-hint">Notify when the outstanding crosses this. Blank = unlimited.</p>
            </div>
          </div>
          <div class="nd-card__foot">
            <button type="button" class="nd-btn nd-btn--tertiary press" (click)="toggleNewVendor()">Cancel</button>
            <button type="button" class="nd-btn nd-btn--primary press" (click)="createVendor()" [disabled]="!draft().name.trim() || saving()">
              {{ saving() ? 'Creating…' : 'Create vendor' }}
            </button>
          </div>
        </section>
      }

      @if (loading()) {
        <div class="flex justify-center py-6">
          <pf-loading-logo size="lg" color="purple" [showDna]="true"
                           [showText]="true" text="Loading vendors…"></pf-loading-logo>
        </div>
      } @else if (vendors().length === 0) {
        <p class="pf-band-empty">No vendors yet. Add your first partner hospital or aggregator to start tracking B2B credit.</p>
      } @else if (visibleVendors().length === 0) {
        <p class="pf-band-empty">No vendors match{{ q() ? ' "' + q() + '"' : ' this filter' }}.</p>
      } @else {
        <div class="space-y-3">
          @for (v of visibleVendors(); track v.id) {
            <div class="nd-card pf-vn-card">
              <div class="flex items-start justify-between gap-4 flex-wrap">
                <div class="min-w-0 flex-1">
                  <div class="pf-vendor__name-row flex items-center gap-2 mb-1">
                    <h3 class="pf-vendor__name">{{ v.name }}</h3>
                    @if (v.code) { <span class="nd-chip nd-chip--static nd-num pf-vendor__code">{{ v.code }}</span> }
                    @if (!v.isActive) { <span class="nd-chip nd-chip--static pf-vendor__code">Inactive</span> }
                  </div>
                  @if (v.contactName || v.contactPhone) {
                    <p class="pf-vendor__meta">
                      {{ v.contactName || '—' }} · {{ v.contactPhone || 'no phone' }}
                    </p>
                  }
                  @if (v.gstin) {
                    <p class="pf-vendor__meta">GSTIN <span class="nd-num">{{ v.gstin }}</span></p>
                  }
                </div>

                <div class="pf-vendor__balance">
                  <p class="pf-eyebrow">Outstanding</p>
                  <p class="pf-vendor__bal-amt" [class.pf-vendor__bal-amt--low]="v.outstanding > 0"
                     [class.pf-vendor__bal-amt--over]="overThreshold(v)"
                     [class.pf-vendor__bal-amt--credit]="v.outstanding < 0">
                    {{ v.outstanding | walletOutstanding }}
                  </p>
                  <p class="pf-vendor__meta">
                    {{ v.usedCredit | inr }} charged · {{ v.totalCredit | inr }} settled
                  </p>
                  @if (v.notifyThreshold) {
                    <p class="pf-vendor__meta" [class.pf-vendor__meta--over]="overThreshold(v)">
                      Alert at {{ v.notifyThreshold | inr }}{{ overThreshold(v) ? ' · exceeded' : '' }}
                    </p>
                    <div class="pf-vendor__bar">
                      <span [style.width.%]="thresholdPct(v)"></span>
                    </div>
                  }
                </div>
              </div>

              <div class="pf-vendor__actions">
                <!-- Row actions: text on web, icons on touch (never a gradient). -->
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="openTopUp(v)" aria-label="Top up" title="Top up"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span class="nd-rowact__t">Top up</span></button>
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="openPayment(v)" aria-label="Record payment" title="Record payment"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg><span class="nd-rowact__t">Record payment</span></button>
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="emailStatement(v)" [disabled]="emailingId() === v.id"
                        [attr.aria-label]="emailingId() === v.id ? 'Sending statement' : 'Email statement'" title="Email statement"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg><span class="nd-rowact__t">{{ emailingId() === v.id ? 'Sending…' : 'Email statement' }}</span></button>
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="toggleTransactions(v.id)" [attr.aria-expanded]="openTxnsId() === v.id"
                        [attr.aria-label]="openTxnsId() === v.id ? 'Hide history' : 'View history'" [title]="openTxnsId() === v.id ? 'Hide history' : 'View history'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/></svg><span class="nd-rowact__t">{{ openTxnsId() === v.id ? 'Hide history' : 'View history' }}</span></button>
                <button type="button" class="nd-rowact" [class.nd-rowact--icon]="!web()" (click)="toggleActive(v)"
                        [attr.aria-label]="v.isActive ? 'Deactivate' : 'Reactivate'" [title]="v.isActive ? 'Deactivate' : 'Reactivate'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/></svg><span class="nd-rowact__t">{{ v.isActive ? 'Deactivate' : 'Reactivate' }}</span></button>
              </div>

              @if (topUpVendorId() === v.id) {
                <div class="pf-topup">
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div><label class="nd-field__lbl pf-vn-lbl">Amount (₹)</label>
                      <input type="number" min="1" step="1" class="nd-input"
                             [ngModel]="topUpAmount()" (ngModelChange)="topUpAmount.set($event)"
                             placeholder="50000"/></div>
                    <div class="sm:col-span-2"><label class="nd-field__lbl pf-vn-lbl">Reason / reference</label>
                      <input type="text" class="nd-input"
                             [ngModel]="topUpReason()" (ngModelChange)="topUpReason.set($event)"
                             placeholder="UPI from accounts dept · ref XYZ"/></div>
                  </div>
                  <div class="mt-3 flex gap-2 justify-end">
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="closeTopUp()">Cancel</pf-touch-btn>
                    <pf-touch-btn size="sm" variant="secondary" (pressed)="confirmTopUp(v)" [disabled]="!topUpAmountValid() || saving()">
                      Add ₹{{ topUpAmount() || '0' }}
                    </pf-touch-btn>
                  </div>
                </div>
              }

              @if (paymentVendorId() === v.id) {
                <div class="pf-topup">
                  <p class="nd-field__hint pf-vn-hint">
                    Record a payment received from this org (or credit granted by them). Adds to the wallet's available credit.
                  </p>
                  <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <div><label class="nd-field__lbl pf-vn-lbl">Amount (₹)</label>
                      <input type="number" min="1" step="1" class="nd-input"
                             [ngModel]="paymentAmount()" (ngModelChange)="paymentAmount.set($event)"
                             placeholder="50000"/></div>
                    <div><label class="nd-field__lbl pf-vn-lbl">Payment date</label>
                      <input type="date" class="nd-input"
                             [ngModel]="paymentDate()" (ngModelChange)="paymentDate.set($event)"/></div>
                    <div><label class="nd-field__lbl pf-vn-lbl">Note / reference</label>
                      <input type="text" class="nd-input"
                             [ngModel]="paymentNote()" (ngModelChange)="paymentNote.set($event)"
                             placeholder="NEFT ref · UTR number"/></div>
                  </div>
                  <div class="mt-3 flex flex-wrap items-center gap-2">
                    <label class="pf-file-btn">
                      {{ paymentFileName() || 'Attach payment copy' }}
                      <input type="file" class="hidden" accept="image/*,application/pdf"
                             (change)="onPaymentFilePick($event)"/>
                    </label>
                    @if (paymentFileName()) {
                      <button type="button" class="pf-file-clear" (click)="clearPaymentFile()">Remove</button>
                    }
                  </div>
                  <div class="mt-3 flex gap-2 justify-end">
                    <pf-touch-btn size="sm" variant="ghost" (pressed)="closePayment()">Cancel</pf-touch-btn>
                    <pf-touch-btn size="sm" variant="secondary" (pressed)="confirmPayment(v)" [disabled]="!paymentAmountValid() || saving()">
                      {{ saving() ? 'Saving…' : 'Record ₹' + (paymentAmount() || '0') }}
                    </pf-touch-btn>
                  </div>
                </div>
              }

              @if (openTxnsId() === v.id) {
                <div class="pf-txns">
                  @if (loadingTxns()) {
                    <div class="flex justify-center py-3">
                      <pf-loading-logo size="sm" color="purple"
                                       [showText]="true" text="Loading…"></pf-loading-logo>
                    </div>
                  } @else if ((txns()[v.id] ?? []).length === 0) {
                    <p class="pf-band-empty">No transactions yet.</p>
                  } @else {
                    <ul class="pf-txns__list">
                      @for (t of txns()[v.id]; track t.id) {
                        <li class="pf-txn">
                          <span class="pf-txn__type" [attr.data-kind]="t.type">{{ t.type }}</span>
                          <span class="pf-txn__reason">
                            {{ t.reason || '—' }}
                            @if (t.attachmentUrl) {
                              <a class="pf-txn__proof" [href]="t.attachmentUrl" target="_blank" rel="noopener">proof</a>
                            }
                          </span>
                          <span class="pf-txn__amt" [class.pf-txn__amt--neg]="t.amount < 0">
                            {{ t.amount < 0 ? '−' : '+' }}{{ absMoney(t.amount) | inr }}
                          </span>
                          <span class="pf-txn__when nd-num">{{ formatDate(t.paidAt || t.createdAt) }}</span>
                        </li>
                      }
                    </ul>
                  }
                </div>
              }
            </div>
          }
        </div>
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-section-title {
      font-size: 11px; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .pf-label {
      display: block;
      font-size: 11px; font-weight: 600; letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--text-tertiary);
      margin-bottom: 4px;
    }
    .pf-input {
      width: 100%;
      padding: 8px 12px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--input-text);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
    }
    .pf-input:focus {
      border-color: var(--input-border-focus);
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.18);
    }
    .pf-input--error { border-color: #f43f5e; }
    .pf-input--error:focus { box-shadow: 0 0 0 3px rgba(244, 63, 94, 0.18); }
    .pf-field-err { margin: 4px 0 0; font-size: 11.5px; color: var(--red-text); }

    /* Vendor row */
    .pf-vendor__name {
      margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary);
      letter-spacing: -0.01em;
    }
    .pf-vendor__code { height: 24px; font-size: 12px; font-weight: 600; color: var(--text-secondary); }
    .pf-vendor__meta {
      margin: 2px 0 0;
      font-size: 12px; color: var(--text-secondary);
    }

    .pf-vendor__balance {
      flex: 0 0 auto; min-width: 200px;
      text-align: right;
    }
    .pf-vendor__bal-amt {
      margin: 4px 0;
      font-size: 22px; font-weight: 600;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
    }
    /* Palette only (ND-PATTERN §2): owed = normal text, in credit = violet,
       over the alert threshold = red (a real warning — the one exception). */
    .pf-vendor__bal-amt--low { color: var(--text-primary); }
    .pf-vendor__bal-amt--over { color: var(--red-text); }
    .pf-vendor__bal-amt--credit { color: var(--violet-text, #6d28d9); }
    .pf-vendor__meta--over { color: var(--red-text); }
    .pf-vendor__bar {
      margin-top: 6px; height: 4px;
      background: var(--glass-border); border-radius: 9999px; overflow: hidden;
    }
    .pf-vendor__bar > span {
      display: block; height: 100%;
      background: var(--color-violet-500, #8b5cf6);   /* palette only */
      transition: width 0.25s ease;
    }

    .pf-vendor__actions {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--nd-line);
      display: flex; gap: 8px; flex-wrap: wrap;
    }
    /* ── ND audit ── */
    .pf-vn-seg { flex: none; }
    .pf-vn-seg .nd-seg__item { height: 32px; }
    .pf-vn-seg__n { color: var(--text-tertiary); font-weight: 500; margin-left: 2px; }
    .pf-vn-new { margin-bottom: 16px; }
    .pf-vn-new__body { padding: 16px 18px; }
    .pf-vn-card { padding: 16px 18px; overflow: visible; }
    .pf-vn-lbl { display: block; margin-bottom: 6px; }
    .pf-vn-hint { margin-top: 4px; }

    /* Inline top-up panel */
    .pf-topup {
      margin-top: 14px;
      padding: 14px;
      background: var(--nd-chip-bg);
      border: 1px solid var(--nd-line);
      border-radius: var(--nd-radius);
    }

    /* File attach button on the record-payment panel */
    .pf-file-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px; cursor: pointer;
      font-size: 12px; font-weight: 600;
      background: var(--nd-card-bg);
      border: 1px solid var(--nd-line);
      color: var(--text-secondary);
      max-width: 100%; overflow-wrap: anywhere;
    }
    .pf-file-btn:hover { border-color: var(--nd-sel-border); }
    .pf-file-clear {
      background: none; border: none; cursor: pointer;
      font-size: 11.5px; color: var(--red-text); text-decoration: underline;
    }
    .pf-txn__proof {
      margin-left: 6px; font-size: 11px; font-weight: 700;
      color: var(--violet-text, #6d28d9); text-decoration: underline;
    }

    /* Transactions list */
    .pf-txns {
      margin-top: 14px;
      padding: 12px;
      background: var(--nd-chip-bg);
      border: 1px solid var(--nd-line);
      border-radius: var(--nd-radius);
    }
    .pf-txns__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-txn {
      display: grid;
      grid-template-columns: 90px minmax(0, 1fr) 110px 130px;
      gap: 10px; align-items: center;
      padding: 8px 10px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      font-size: 12px;
    }
    .pf-txn__type {
      /* Neutral chip — the signed amount carries the direction. */
      background: var(--nd-card-bg); border: 1px solid var(--nd-line); color: var(--text-secondary);
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; text-align: center;
    }
    .pf-txn__reason { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-txn__amt {
      font-variant-numeric: tabular-nums;
      font-weight: 600; text-align: right; color: var(--text-primary);
    }
    .pf-txn__amt--neg { color: var(--text-secondary); }
    .pf-txn__when {
      font-size: 11px; color: var(--text-tertiary); text-align: right;
      font-variant-numeric: tabular-nums;
    }

    /* ============================================================
       RESPONSIVE OVERRIDES — additive only, never affect >=1280px
       ============================================================ */

    /* Phone (<=640): stop iOS zoom on focus, full-width balance,
       and collapse the fixed 4-col transaction grid to a stacked card. */
    @media (max-width: 640px) {
      :host .pf-input {
        font-size: 16px;
        padding: 10px 12px;
      }

      /* Balance block: don't force a 200px min on a narrow screen —
         let it sit full-width under the vendor name, left-aligned. */
      :host .pf-vendor__balance {
        min-width: 0;
        width: 100%;
        text-align: left;
      }

      /* Long vendor names must truncate rather than shove the code chip /
         inactive badge off-screen. The name row is a flex; give the name
         a shrinkable box with ellipsis and keep the chip/badge intact. */
      :host .pf-vendor__name-row { min-width: 0; }
      :host .pf-vendor__name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      :host .pf-vendor__code { flex: 0 0 auto; }

      /* Transaction row: the 90px/1fr/110px/130px grid (~340px) overflows
         phones. Restack into label-amount header + reason + date. */
      :host .pf-txn {
        grid-template-columns: auto 1fr;
        grid-template-areas:
          "type amt"
          "reason reason"
          "when when";
        row-gap: 4px;
        column-gap: 10px;
        padding: 10px 12px;
      }
      :host .pf-txn__type   { grid-area: type; justify-self: start; }
      :host .pf-txn__amt    { grid-area: amt;  text-align: right; }
      :host .pf-txn__reason { grid-area: reason; white-space: normal; }
      :host .pf-txn__when   { grid-area: when; text-align: left; }
    }

    /* Touch devices: ensure transaction rows that are tappable feel
       comfortable; no hover-only affordances exist on this page. */
    @media (pointer: coarse) {
      :host .pf-input { min-height: 44px; }
    }

    /* Capacitor / Electron native: this page has no fixed/sticky chrome
       of its own (the section scrolls inside the shell), so the global
       safe-area handling on body already covers it — no per-page insets
       needed here. */
  `]
})
export class VendorsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  protected readonly vendors = signal<VendorRow[]>([]);
  protected readonly theme = inject(ThemeService);
  /** Row actions: text on web, icon on touch (ND-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill: free-text search + Active / Inactive status filter. */
  readonly q = signal('');
  readonly status = signal<VendorStatus>('all');
  readonly statusOptions = computed<SegmentedOption<VendorStatus>[]>(() => {
    const all = this.vendors();
    const active = all.filter(v => v.isActive).length;
    return [
      { value: 'all', label: 'All', count: all.length },
      { value: 'active', label: 'Active', count: active },
      { value: 'inactive', label: 'Inactive', count: all.length - active },
    ];
  });
  readonly visibleVendors = computed(() => {
    const st = this.status();
    const rows = this.vendors().filter(v => st === 'all' || (st === 'active' ? v.isActive : !v.isActive));
    return bandFilter(rows, this.q(), v => [v.name, v.code, v.contactName, v.contactPhone, v.contactEmail, v.gstin, v.address]);
  });
  protected readonly loading = signal<boolean>(true);
  protected readonly saving = signal<boolean>(false);
  protected readonly newVendorOpen = signal<boolean>(false);
  protected readonly draft = signal<NewVendorDraft>({ ...EMPTY_DRAFT });
  protected readonly nameError = signal<string | null>(null);
  protected readonly codeError = signal<string | null>(null);

  protected readonly topUpVendorId = signal<string | null>(null);
  protected readonly topUpAmount = signal<string>('');
  protected readonly topUpReason = signal<string>('');

  protected readonly openTxnsId = signal<string | null>(null);
  protected readonly txns = signal<Record<string, VendorTxn[] | undefined>>({});
  protected readonly loadingTxns = signal<boolean>(false);

  // Record-payment panel state
  protected readonly paymentVendorId = signal<string | null>(null);
  protected readonly paymentAmount = signal<string>('');
  protected readonly paymentDate = signal<string>('');
  protected readonly paymentNote = signal<string>('');
  protected readonly paymentFile = signal<File | null>(null);
  protected readonly paymentFileName = signal<string>('');
  protected readonly emailingId = signal<string | null>(null);

  protected readonly topUpAmountValid = computed(() => {
    const n = parseInt(this.topUpAmount() || '0', 10);
    return Number.isFinite(n) && n > 0;
  });

  protected readonly paymentAmountValid = computed(() => {
    const n = parseInt(this.paymentAmount() || '0', 10);
    return Number.isFinite(n) && n > 0;
  });

  ngOnInit() { this.refresh(); }

  refresh() {
    this.loading.set(true);
    this.api.get<VendorRow[]>('/api/vendors?includeInactive=true').subscribe({
      next: list => { this.vendors.set(list ?? []); this.loading.set(false); },
      error: e => { this.loading.set(false); this.toasts.error(e?.message ?? 'Could not load vendors'); }
    });
  }

  toggleNewVendor() {
    this.newVendorOpen.update(v => !v);
    if (!this.newVendorOpen()) { this.draft.set({ ...EMPTY_DRAFT }); this.clearFieldErrors(); }
  }
  patchDraft(patch: Partial<NewVendorDraft>) {
    if ('name' in patch) this.nameError.set(null);
    if ('code' in patch) this.codeError.set(null);
    this.draft.update(d => ({ ...d, ...patch }));
  }
  private clearFieldErrors() { this.nameError.set(null); this.codeError.set(null); }

  createVendor() {
    const d = this.draft();
    if (!d.name.trim()) return;
    this.clearFieldErrors();
    this.saving.set(true);
    const opening = parseInt(d.openingCredit || '0', 10);
    const threshold = parseInt(d.notifyThreshold || '0', 10);
    this.api.post<VendorRow>('/api/vendors', {
      name: d.name.trim(),
      code: d.code.trim() || null,
      contactName: d.contactName.trim() || null,
      contactPhone: d.contactPhone.trim() || null,
      contactEmail: d.contactEmail.trim() || null,
      gstin: d.gstin.trim() || null,
      address: d.address.trim() || null,
      openingCredit: Number.isFinite(opening) && opening > 0 ? opening : null,
      notifyThreshold: Number.isFinite(threshold) && threshold > 0 ? threshold : null
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success('Vendor created');
        this.newVendorOpen.set(false);
        this.draft.set({ ...EMPTY_DRAFT });
        this.refresh();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        if (err.field === 'name') this.nameError.set(err.message);
        else if (err.field === 'code') this.codeError.set(err.message);
        else this.toasts.error(err.message);
      }
    });
  }

  openTopUp(v: VendorRow) {
    this.topUpVendorId.set(v.id);
    this.topUpAmount.set('');
    this.topUpReason.set('');
  }
  closeTopUp() { this.topUpVendorId.set(null); }
  confirmTopUp(v: VendorRow) {
    const amount = parseInt(this.topUpAmount() || '0', 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.saving.set(true);
    this.api.post<VendorRow>(`/api/vendors/${v.id}/topup`, {
      amount, reason: this.topUpReason().trim() || null
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success(`Topped up ₹${amount}`);
        this.closeTopUp();
        this.refresh();
        // If this vendor's history is open, refresh it too.
        if (this.openTxnsId() === v.id) this.loadTxns(v.id);
      },
      error: e => { this.saving.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  // ── Record payment received (144/146) ───────────────────────────
  openPayment(v: VendorRow) {
    this.paymentVendorId.set(v.id);
    this.paymentAmount.set('');
    this.paymentDate.set('');
    this.paymentNote.set('');
    this.clearPaymentFile();
    // Close the inline top-up panel if it was open on the same card.
    if (this.topUpVendorId() === v.id) this.topUpVendorId.set(null);
  }
  closePayment() { this.paymentVendorId.set(null); this.clearPaymentFile(); }
  clearPaymentFile() { this.paymentFile.set(null); this.paymentFileName.set(''); }

  onPaymentFilePick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0] ?? null;
    this.paymentFile.set(f);
    this.paymentFileName.set(f ? f.name : '');
  }

  async confirmPayment(v: VendorRow) {
    const amount = parseInt(this.paymentAmount() || '0', 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.saving.set(true);
    try {
      // Multipart (optional file) — bypass ApiService, which is JSON-only.
      // The auth interceptor still attaches the token to raw HttpClient calls.
      const fd = new FormData();
      fd.append('amount', String(amount));
      if (this.paymentDate().trim()) fd.append('paidAt', this.paymentDate().trim());
      if (this.paymentNote().trim()) fd.append('note', this.paymentNote().trim());
      const f = this.paymentFile();
      if (f) fd.append('file', f);
      const url = `${this.platform.getApiUrl()}/api/vendors/${v.id}/payment`;
      const r: any = await firstValueFrom(this.http.post(url, fd));
      if (r?.success) {
        this.toasts.success(`Payment of ₹${amount} recorded`);
        this.closePayment();
        this.refresh();
        if (this.openTxnsId() === v.id) this.loadTxns(v.id);
      } else {
        this.toasts.error(r?.error?.message ?? r?.message ?? 'Could not record payment');
      }
    } catch (e) {
      this.toasts.error(ApiError.from(e).message);
    } finally {
      this.saving.set(false);
    }
  }

  // ── Email account statement (143) ───────────────────────────────
  emailStatement(v: VendorRow) {
    this.emailingId.set(v.id);
    this.api.post<any>(`/api/vendors/${v.id}/email-statement`, {}).subscribe({
      next: res => {
        this.emailingId.set(null);
        // Delivery is stubbed server-side (no mail provider yet) — surface the
        // server's message so the admin knows whether anything was sent.
        if (res?.delivered) this.toasts.success(res?.message ?? 'Statement emailed');
        else this.toasts.info(res?.message ?? 'Statement assembled; email delivery is not configured.');
      },
      error: e => { this.emailingId.set(null); this.toasts.error(ApiError.from(e).message); }
    });
  }

  toggleActive(v: VendorRow) {
    this.api.put<VendorRow>(`/api/vendors/${v.id}`, {
      name: v.name, code: v.code ?? null,
      contactName: v.contactName ?? null, contactPhone: v.contactPhone ?? null,
      contactEmail: v.contactEmail ?? null, gstin: v.gstin ?? null,
      address: v.address ?? null,
      isActive: !v.isActive
    }).subscribe({
      next: () => { this.toasts.success(v.isActive ? 'Vendor deactivated' : 'Vendor reactivated'); this.refresh(); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  toggleTransactions(id: string) {
    if (this.openTxnsId() === id) { this.openTxnsId.set(null); return; }
    this.openTxnsId.set(id);
    if (!this.txns()[id]) this.loadTxns(id);
  }

  private loadTxns(id: string) {
    this.loadingTxns.set(true);
    this.api.get<VendorTxn[]>(`/api/vendors/${id}/transactions?limit=100`).subscribe({
      next: list => {
        this.txns.update(map => ({ ...map, [id]: list ?? [] }));
        this.loadingTxns.set(false);
      },
      error: () => { this.loadingTxns.set(false); }
    });
  }

  /** Is the outstanding at/over the alert threshold? */
  protected overThreshold(v: VendorRow): boolean {
    return !!v.notifyThreshold && v.outstanding >= v.notifyThreshold;
  }
  /** Outstanding as a % of the alert threshold (bar fill). 0 when no threshold. */
  protected thresholdPct(v: VendorRow): number {
    if (!v.notifyThreshold || v.notifyThreshold <= 0) return 0;
    return Math.min(100, Math.round((v.outstanding / v.notifyThreshold) * 100));
  }

  protected absMoney(n: number): number { return Math.abs(n); }
  protected formatDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm} ${hh}:${min}`;
  }
}
