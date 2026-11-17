import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal, TemplateRef, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { PlatformService } from '../../../core/services/platform.service';
import { ToastService } from '../../../core/services/toast.service';
import { vendorErrors } from '../../../shared/forms/contact-validate';
import { ApiError } from '../../../shared/models/api-response.model';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { WalletOutstandingPipe } from '../../../shared/pipes/wallet-outstanding.pipe';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { ThemeService } from '../../../core/services/theme.service';
import { bandFilter } from '../../../shared/utils/band-search';
import { webPointerSignal } from '../../../shared/utils/pointer-mode';
import { SkeletonRowsComponent, SkeletonTableComponent } from '../../../shared/primitives/skeleton-kit.component';
import { heldFlag } from '../../../shared/utils/min-duration';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { PfDateComponent } from '../../../shared/components/pf-date/pf-date.component';
import { NgTemplateOutlet } from '@angular/common';
import { AllCommunityModule, ColDef, GetRowIdParams, ICellRendererParams, ModuleRegistry } from 'ag-grid-community';
import { AgGridAngular } from 'ag-grid-angular';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import {
  SG_ICON, SG_NARROW_MQ, SG_PHONE_MQ, SgAction, sgActions, sgActionsCol, sgByStatus, sgCell, sgGridTheme, sgInr, sgMedia,
  sgPillCol, sgRowOff, sgStatusOptions, sgBare } from '../../../shared/settings-grid/settings-grid';

ModuleRegistry.registerModules([AllCommunityModule]);

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
  /** Set when editing an existing account (PUT); absent = create (POST). */
  id?: string;
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
  imports: [BusyDirective, SkeletonRowsComponent, SkeletonTableComponent,
    FormsModule, CurrencyInrPipe, WalletOutstandingPipe,
    ScreenHeaderComponent, TouchButtonComponent,
    HeroBandComponent, PfDateComponent, NgTemplateOutlet, AgGridAngular, SegmentedComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../../../shared/settings-grid/settings-grid.scss'],
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Test Master frame: the band pill searches the accounts; "Add
             vendor" is the ONE primary (a quiet Cancel while its form is open). -->
        <pf-hero-band [back]="true" placeholder="Search credit accounts — name, code, contact, GSTIN…"
                      [value]="q()" (valueChange)="q.set($event)">
          <ng-container band-actions>
            @if (showSetup()) {
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
            }
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Vendor Credit Wallets"
        subtitle="Pre-loaded credit accounts for partner hospitals & aggregators. Reception charges bills against these wallets from the billing screen.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="toggleNewVendor()" [style.display]="showSetup() ? null : 'none'">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
          {{ newVendorOpen() ? 'Cancel' : 'Add vendor' }}
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body pf-band-body--fill">
        <div class="pf-sg-panels pf-vn-panels" [class.pf-sg-panels--single]="!panel()" [class.pf-sg-panels--narrow]="narrow()">
          <!-- SIDE card (LEFT): the open form / money panel for one account. -->
          @if (panel(); as pn) {
            @if (narrow()) { <div class="pf-sheet-backdrop" (click)="closePanel()"></div> }
            <aside class="pf-card pf-sg-side pf-vn-side" [class.pf-sg-side--sheet]="narrow()" [attr.role]="narrow() ? 'dialog' : null"
                   [attr.aria-modal]="narrow() ? 'true' : null" [attr.aria-label]="panelTitle()" (keydown.escape)="closePanel()">
              @if (narrow()) { <span class="pf-sg-sheet-handle" aria-hidden="true"></span> }
              @switch (pn) {
                @case ('form') { <ng-container *ngTemplateOutlet="vendorForm"></ng-container> }
                @default { <ng-container *ngTemplateOutlet="moneyPanel"></ng-container> }
              }
            </aside>
          }

          <!-- MAIN card: the credit accounts grid. -->
          <section class="pf-card pf-sg-main pf-vn-main" [class.pf-sg-main--bare]="bare" aria-label="Credit accounts">
            <header class="pf-card__head pf-sg-main__head">
              <span class="pf-card__icon" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01"/></svg></span>
              <span class="pf-card__label">Credit accounts</span>
              <span class="pf-card__note pf-sg-hint">{{ showMoney() ? 'Top up, record a payment or email a statement from a row' : 'Partner hospitals and aggregators billed on credit' }}</span>
              <ng-container *ngTemplateOutlet="headTools"></ng-container>
            </header>
            <div class="pf-sg-main__body">
              @if (loadingShown()) {
                <pf-skeleton-table class="pf-sg-skel" [rows]="6" [cols]="6" label="Loading vendors…"></pf-skeleton-table>
              }
              <ag-grid-angular class="pf-sg-grid pf-vn-grid" [theme]="gridTheme()" [rowData]="visibleVendors()" [columnDefs]="colDefs()"
                               [defaultColDef]="defaultColDef" [getRowId]="getRowId" [getRowClass]="rowClass" [animateRows]="true"
                               [suppressNoRowsOverlay]="true" [suppressCellFocus]="true"></ag-grid-angular>
              @if (!loading() && visibleVendors().length === 0) {
                <div class="pf-sg-empty pf-band-empty">
                  @if (vendors().length === 0) {
                    <p class="pf-sg-empty__title">No credit accounts yet</p>
                    <p class="pf-sg-empty__body">Add your first partner hospital or aggregator to start tracking B2B credit.</p>
                  } @else {
                    <p class="pf-sg-empty__title">No vendors match{{ q() ? ' "' + q() + '"' : ' this filter' }}.</p>
                  }
                </div>
              }
            </div>
          </section>
        </div>
      </div>
    </section>

    <!-- New / edit vendor (setup). -->
    <ng-template #vendorForm>
      <div class="pf-card__head">
        <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7H5a2 2 0 0 1-2-2ZM17 14h.01"/></svg></span>
        <h3 class="pf-card__label">{{ draft().id ? 'Edit vendor' : 'New vendor' }}</h3>
        <span class="pf-card__spacer"></span>
        <button type="button" class="pf-btn pf-btn--icon" (click)="closePanel()" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="pf-card__body pf-vn-new">
        <div><label class="pf-field__lbl pf-vn-lbl">Name *</label>
          <input type="text" class="pf-input" [class.pf-input--error]="nameError()" [ngModel]="draft().name" (ngModelChange)="patchDraft({ name: $event })" placeholder="Apollo Hospital"/>
          @if (nameError()) { <p class="pf-field-err">{{ nameError() }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">Code</label>
          <input type="text" class="pf-input pf-num uppercase" [class.pf-input--error]="codeError()" [ngModel]="draft().code" (ngModelChange)="patchDraft({ code: $event.toUpperCase() })" placeholder="APOLLO"/>
          @if (codeError()) { <p class="pf-field-err">{{ codeError() }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">Contact name</label>
          <input type="text" class="pf-input" [class.pf-input--error]="fieldErr()['contactName']" [ngModel]="draft().contactName" (ngModelChange)="patchDraft({ contactName: $event })"/>
          @if (fieldErr()['contactName']) { <p class="pf-field-err">{{ fieldErr()['contactName'] }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">Contact phone</label>
          <input type="tel" class="pf-input" [class.pf-input--error]="fieldErr()['contactPhone']" [ngModel]="draft().contactPhone" (ngModelChange)="patchDraft({ contactPhone: $event })"/>
          @if (fieldErr()['contactPhone']) { <p class="pf-field-err">{{ fieldErr()['contactPhone'] }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">Contact email</label>
          <input type="email" class="pf-input" [class.pf-input--error]="fieldErr()['contactEmail']" [ngModel]="draft().contactEmail" (ngModelChange)="patchDraft({ contactEmail: $event })"/>
          @if (fieldErr()['contactEmail']) { <p class="pf-field-err">{{ fieldErr()['contactEmail'] }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">GSTIN</label>
          <input type="text" class="pf-input" [class.pf-input--error]="fieldErr()['gstin']" [ngModel]="draft().gstin" (ngModelChange)="patchDraft({ gstin: $event })"/>
          @if (fieldErr()['gstin']) { <p class="pf-field-err">{{ fieldErr()['gstin'] }}</p> }</div>
        <div><label class="pf-field__lbl pf-vn-lbl">Address</label>
          <input type="text" class="pf-input" [class.pf-input--error]="fieldErr()['address']" [ngModel]="draft().address" (ngModelChange)="patchDraft({ address: $event })"/>
          @if (fieldErr()['address']) { <p class="pf-field-err">{{ fieldErr()['address'] }}</p> }</div>
        @if (!draft().id) {
          <div>
            <label class="pf-field__lbl pf-vn-lbl">Opening settlement (₹)</label>
            <input type="number" min="0" step="1" class="pf-input"
                   [ngModel]="draft().openingCredit"
                   (ngModelChange)="patchDraft({ openingCredit: $event })"
                   placeholder="0"/>
            <p class="pf-field__hint pf-vn-hint">Optional — a prepayment that offsets the tab.</p>
          </div>
          <div>
            <label class="pf-field__lbl pf-vn-lbl">Alert threshold (₹)</label>
            <input type="number" min="0" step="1" class="pf-input"
                   [ngModel]="draft().notifyThreshold"
                   (ngModelChange)="patchDraft({ notifyThreshold: $event })"
                   placeholder="No limit"/>
            <p class="pf-field__hint pf-vn-hint">Notify when the outstanding crosses this. Blank = unlimited.</p>
          </div>
        }
      </div>
      <div class="pf-card__foot pf-vn-foot">
        <button type="button" class="pf-btn pf-btn--tertiary press" (click)="closePanel()">Cancel</button>
        <button type="button" class="pf-btn pf-btn--primary press" (click)="draft().id ? saveVendor() : createVendor()" [disabled]="!draft().name.trim() || saving()" [pfBusy]="saving()" [pfBusyLabel]="draft().id ? 'Saving…' : 'Creating…'">
          {{ saving() ? (draft().id ? 'Saving…' : 'Creating…') : (draft().id ? 'Save changes' : 'Create vendor') }}
        </button>
      </div>
    </ng-template>

    <!-- Money panel (top up / record payment / history) for ONE account. -->
    <ng-template #moneyPanel>
      @if (panelVendor(); as v) {
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></span>
          <h3 class="pf-card__label">{{ panelTitle() }}</h3>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-btn pf-btn--icon" (click)="closePanel()" aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="pf-card__body">
          <div class="pf-vn-acct">
            <span class="pf-vn-acct__name">{{ v.name }}</span>
            <span class="pf-vn-acct__meta">{{ [v.code, v.contactName].filter(isText).join(' · ') }}</span>
            <span class="pf-vn-acct__bal pf-num" [class.pf-vendor__bal-amt--over]="overThreshold(v)" [class.pf-vendor__bal-amt--credit]="v.outstanding < 0">{{ v.outstanding | walletOutstanding }}</span>
          </div>
          @if (topUpVendorId() === v.id) {
            <div class="pf-topup">
              <div><label class="pf-field__lbl pf-vn-lbl">Amount (₹)</label>
                <input type="number" min="1" step="1" class="pf-input"
                       [ngModel]="topUpAmount()" (ngModelChange)="topUpAmount.set($event)"
                       placeholder="50000"/></div>
              <div><label class="pf-field__lbl pf-vn-lbl">Reason / reference</label>
                <input type="text" class="pf-input"
                       [ngModel]="topUpReason()" (ngModelChange)="topUpReason.set($event)"
                       placeholder="UPI from accounts dept · ref XYZ"/></div>
              <div class="pf-vn-row-end">
                <pf-touch-btn size="sm" variant="ghost" (pressed)="closeTopUp()">Cancel</pf-touch-btn>
                <pf-touch-btn size="sm" variant="secondary" (pressed)="confirmTopUp(v)" [disabled]="!topUpAmountValid() || saving()" [busy]="saving()" busyLabel="Saving…">
                  Add ₹{{ topUpAmount() || '0' }}
                </pf-touch-btn>
              </div>
            </div>
          }
          @if (paymentVendorId() === v.id) {
            <div class="pf-topup">
              <p class="pf-field__hint pf-vn-hint">
                Record a payment received from this org (or credit granted by them). Adds to the wallet's available credit.
              </p>
              <div><label class="pf-field__lbl pf-vn-lbl">Amount (₹)</label>
                <input type="number" min="1" step="1" class="pf-input"
                       [ngModel]="paymentAmount()" (ngModelChange)="paymentAmount.set($event)"
                       placeholder="50000"/></div>
              <div><label class="pf-field__lbl pf-vn-lbl" for="pf-vn-payment-date">Payment date</label>
                <pf-date label="Payment date" inputId="pf-vn-payment-date"
                            [value]="paymentDate() || null"
                            (valueChange)="paymentDate.set($event ?? '')"></pf-date></div>
              <div><label class="pf-field__lbl pf-vn-lbl">Note / reference</label>
                <input type="text" class="pf-input"
                       [ngModel]="paymentNote()" (ngModelChange)="paymentNote.set($event)"
                       placeholder="NEFT ref · UTR number"/></div>
              <div class="flex flex-wrap items-center gap-2">
                <label class="pf-file-btn">
                  {{ paymentFileName() || 'Attach payment copy' }}
                  <input type="file" class="hidden" accept="image/*,application/pdf"
                         (change)="onPaymentFilePick($event)"/>
                </label>
                @if (paymentFileName()) {
                  <button type="button" class="pf-file-clear" (click)="clearPaymentFile()">Remove</button>
                }
              </div>
              <div class="pf-vn-row-end">
                <pf-touch-btn size="sm" variant="ghost" (pressed)="closePayment()">Cancel</pf-touch-btn>
                <pf-touch-btn size="sm" variant="secondary" (pressed)="confirmPayment(v)" [disabled]="!paymentAmountValid() || saving()" [busy]="saving()" busyLabel="Saving…">
                  {{ saving() ? 'Saving…' : 'Record ₹' + (paymentAmount() || '0') }}
                </pf-touch-btn>
              </div>
            </div>
          }
          @if (openTxnsId() === v.id) {
            <div class="pf-txns">
              <h4 class="pf-sg-side__sec">History</h4>
              @if (loadingTxnsShown()) {
                <pf-skeleton-table [rows]="3" [cols]="3" [header]="false" label="Loading transactions…"></pf-skeleton-table>
              } @else if ((txns()[v.id] ?? []).length === 0) {
                <p class="pf-band-empty">No transactions yet.</p>
              } @else {
                <ul class="pf-txns__list">
                  @for (t of txns()[v.id]; track t.id) {
                    <li class="pf-txn">
                      <span class="pf-txn__type" [attr.data-kind]="t.type">{{ t.type }}</span>
                      <span class="pf-txn__amt" [class.pf-txn__amt--neg]="t.amount < 0">
                        {{ t.amount < 0 ? '−' : '+' }}{{ absMoney(t.amount) | inr }}
                      </span>
                      <span class="pf-txn__reason">
                        {{ t.reason || '—' }}
                        @if (t.attachmentUrl) {
                          <a class="pf-txn__proof" [href]="t.attachmentUrl" target="_blank" rel="noopener">proof</a>
                        }
                      </span>
                      <span class="pf-txn__when pf-num">{{ formatDate(t.paidAt || t.createdAt) }}</span>
                    </li>
                  }
                </ul>
              }
            </div>
          }
        </div>
      }
    </ng-template>

    <!-- The grid card's head tools (count + status filter): exposed so a host can project them into its own head. -->
    <ng-template #headTools>
              <span class="pf-sg-count pf-num">{{ visibleVendors().length }} {{ visibleVendors().length === 1 ? 'account' : 'accounts' }}</span>
              <pf-segmented class="pf-sg-status-filter pf-vn-seg" size="sm" [options]="statusOptions()" [value]="status()"
                            (valueChange)="status.set($event)" aria-label="Filter by status"></pf-segmented>
    </ng-template>
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

    /* Side card account header (money panel) */
    .pf-vn-acct { display: flex; flex-direction: column; gap: 2px; padding-bottom: 10px; border-bottom: 1px solid var(--pf-line); }
    .pf-vn-acct__name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-vn-acct__meta { font-size: 12px; color: var(--text-tertiary); }
    .pf-vn-acct__bal { margin-top: 4px; font-size: 18px; font-weight: 600; color: var(--text-primary); font-variant-numeric: tabular-nums; }
    /* Palette only (PF-PATTERN §2): over the alert threshold = red, in credit = violet. */
    .pf-vendor__bal-amt--over { color: var(--red-text); }
    .pf-vendor__bal-amt--credit { color: var(--violet-text, #6d28d9); }
    .pf-vn-panels { grid-template-columns: 380px minmax(0, 1fr); }
    .pf-vn-panels.pf-sg-panels--single, .pf-vn-panels.pf-sg-panels--narrow { grid-template-columns: minmax(0, 1fr); }
    .pf-vn-row-end { display: flex; gap: 8px; justify-content: flex-end; }
    /* ── ND audit ── */
    .pf-vn-seg { flex: none; }
    .pf-vn-seg .pf-seg__item { height: 32px; }
    .pf-vn-seg__n { color: var(--text-tertiary); font-weight: 500; margin-left: 2px; }
    .pf-vn-new { gap: 12px; }
    .pf-vn-lbl { display: block; margin-bottom: 6px; }
    .pf-vn-hint { margin-top: 4px; }
    /* pf-date defaults to inline-block (shrink to content) so it sits
     * next to other inline controls elsewhere; here it's the sole control
     * in its grid cell and must fill it exactly like the Amount / Note
     * inputs beside it. */
    .pf-topup pf-date { display: block; width: 100%; }

    /* Inline top-up panel */
    .pf-topup {
      display: flex; flex-direction: column; gap: 12px;
      padding: 14px;
      background: var(--pf-chip-bg);
      border: 1px solid var(--pf-line);
      border-radius: var(--pf-radius);
    }

    /* File attach button on the record-payment panel */
    .pf-file-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 14px; border-radius: 10px; cursor: pointer;
      font-size: 12px; font-weight: 600;
      background: var(--pf-card-bg);
      border: 1px solid var(--pf-line);
      color: var(--text-secondary);
      max-width: 100%; overflow-wrap: anywhere;
    }
    .pf-file-btn:hover { border-color: var(--pf-sel-border); }
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
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px;
      background: var(--pf-chip-bg);
      border: 1px solid var(--pf-line);
      border-radius: var(--pf-radius);
    }
    .pf-txns__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .pf-txn {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-areas: "type amt" "reason when";
      gap: 4px 10px; align-items: center;
      padding: 8px 10px;
      background: rgba(255,255,255,0.02);
      border-radius: 8px;
      font-size: 12px;
    }
    .pf-txn__type { grid-area: type; justify-self: start;
      /* Neutral chip — the signed amount carries the direction. */
      background: var(--pf-card-bg); border: 1px solid var(--pf-line); color: var(--text-secondary);
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.06em;
      text-transform: uppercase; text-align: center;
    }
    .pf-txn__reason { grid-area: reason; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .pf-txn__amt { grid-area: amt;
      font-variant-numeric: tabular-nums;
      font-weight: 600; text-align: right; color: var(--text-primary);
    }
    .pf-txn__amt--neg { color: var(--text-secondary); }
    .pf-txn__when { grid-area: when;
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
  /** Hosted in the Settings shell: the grid card renders BARE (ONE card, ONE head). */
  protected readonly bare = sgBare();
  /** Count + status filter, for a host that projects head tools into its own head. */
  readonly headTools = viewChild<TemplateRef<unknown>>('headTools');
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);
  private readonly platform = inject(PlatformService);
  private readonly toasts = inject(ToastService);

  protected readonly vendors = signal<VendorRow[]>([]);
  protected readonly theme = inject(ThemeService);
  /** Settings re-home splits one screen in two: `/admin/billing?tab=credit` is SETUP (add / deactivate a credit
   *  account: name, code, contact, GSTIN, address, opening settlement, alert threshold); `/finance/credit-accounts`
   *  is the MONEY side (top up, record a payment, email a statement, history). The old `/admin/vendors` (no route
   *  data) shows both, as before. Same APIs either way. */
  /** Embedded use (Settings → Billing → Credit accounts) pins the view with this input; a route can pin it with data. */
  readonly view = input<'setup' | 'money' | null>(null);
  private readonly routeView = (inject(ActivatedRoute, { optional: true })?.snapshot.data?.['creditView'] as 'setup' | 'money' | undefined) ?? 'all';
  private readonly creditView = computed(() => this.view() ?? this.routeView);
  readonly showSetup = computed(() => this.creditView() !== 'money');
  readonly showMoney = computed(() => this.creditView() !== 'setup');
  /** Row actions: text on web, icon on touch (PF-PATTERN). */
  protected readonly web = webPointerSignal();

  /** Band pill: free-text search; the card head's status filter (Test Master's All · Active · Inactive). */
  readonly q = signal('');
  readonly status = signal<VendorStatus>('all');
  readonly statusOptions = computed(() => {
    const all = this.vendors();
    return sgStatusOptions(all.length, all.filter(v => !v.isActive).length);
  });
  readonly visibleVendors = computed(() => {
    const rows = sgByStatus(this.vendors(), this.status(), v => v.isActive);
    return bandFilter(rows, this.q(), v => [v.name, v.code, v.contactName, v.contactPhone, v.contactEmail, v.gstin, v.address]);
  });

  // ── Test Master frame: grid + the LEFT side card for ONE open panel ──
  readonly narrow = sgMedia(SG_NARROW_MQ);
  readonly phone = sgMedia(SG_PHONE_MQ);
  readonly gridTheme = sgGridTheme();
  readonly getRowId = (p: GetRowIdParams<VendorRow>) => p.data.id;
  readonly rowClass = sgRowOff<VendorRow>(v => v.isActive);
  readonly defaultColDef: ColDef<VendorRow> = { sortable: true, resizable: true, filter: false, minWidth: 90, wrapText: true, autoHeight: true };
  protected readonly isText = (s: unknown): s is string => typeof s === 'string' && !!s;
  /** Which side panel is open: the setup form, a money panel, or none. */
  readonly panel = computed<'form' | 'money' | null>(() => {
    if (this.newVendorOpen() && this.showSetup()) return 'form';
    if (this.topUpVendorId() || this.paymentVendorId() || this.openTxnsId()) return 'money';
    return null;
  });
  readonly panelVendor = computed(() => {
    const id = this.topUpVendorId() ?? this.paymentVendorId() ?? this.openTxnsId();
    return this.vendors().find(v => v.id === id) ?? null;
  });
  readonly panelTitle = computed(() => {
    if (this.panel() === 'form') return this.draft().id ? 'Edit vendor' : 'New vendor';
    if (this.topUpVendorId()) return 'Top up';
    if (this.paymentVendorId()) return 'Record payment';
    return 'History';
  });

  /** The row's actions: setup = Edit + Deactivate/Reactivate; money = Top up, Record payment, Email statement, History. */
  actionsFor(v: VendorRow, web = this.web()): SgAction[] {
    const acts: SgAction[] = [];
    if (this.showMoney()) {
      acts.push(
        { label: 'Top up', aria: `Top up ${v.name}`, icon: true, path: '<path d="M12 5v14M5 12h14"/>', run: () => this.openTopUp(v) },
        { label: 'Record payment', aria: `Record payment for ${v.name}`, icon: true, path: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>', run: () => this.openPayment(v) },
        { label: this.emailingId() === v.id ? 'Sending…' : 'Email statement', aria: `Email statement to ${v.name}`, icon: true,
          path: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', run: () => this.emailStatement(v) },
        { label: this.openTxnsId() === v.id ? 'Hide history' : 'View history', aria: `${this.openTxnsId() === v.id ? 'Hide' : 'View'} history of ${v.name}`, icon: true,
          path: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/><path d="M12 7v5l3 2"/>', run: () => this.toggleTransactions(v.id) },
      );
    }
    if (this.showSetup()) {
      acts.push(
        { label: 'Edit', aria: `Edit ${v.name}`, icon: true, path: SG_ICON.edit, run: () => this.editVendor(v) },
        { label: v.isActive ? 'Deactivate' : 'Reactivate', aria: `${v.isActive ? 'Deactivate' : 'Reactivate'} ${v.name}`, icon: true,
          path: SG_ICON.power, run: () => this.toggleActive(v) },
      );
    }
    void web;
    return acts;
  }

  readonly colDefs = computed<ColDef<VendorRow>[]>(() => {
    const web = this.web() && !this.phone();
    const phone = this.phone();
    const money = (n: number) => { const el = sgCell(sgInr(n)); el.classList.add('pf-sg-money'); return el; };
    const sample = this.actionsFor({ id: '', name: '', isActive: true } as VendorRow, web);
    const cols: ColDef<VendorRow>[] = [
      { colId: 'name', headerName: 'Account', flex: 1.5, minWidth: 190, sort: 'asc', valueGetter: p => p.data?.name ?? '',
        cellRenderer: (p: ICellRendererParams<VendorRow>) => {
          const v = p.data;
          // Two "Apollo D"s stay distinguishable: contact (+ code on phone) under the name.
          const sub = [phone ? v?.code : null, v?.contactName, v?.contactPhone].filter(this.isText).join(' · ') || (v?.gstin ? `GSTIN ${v.gstin}` : '');
          return sgCell(v?.name, sub || 'No contact', true);
        } },
      { colId: 'code', headerName: 'Code', field: 'code', width: 110, minWidth: 90, flex: 0, cellClass: 'pf-num',
        valueFormatter: p => p.value || '—' },
      sgPillCol<VendorRow>(v => v.isActive),
      { colId: 'charged', headerName: 'Charged', width: 130, minWidth: 110, flex: 0, type: 'rightAligned', valueGetter: p => p.data?.usedCredit ?? 0,
        cellRenderer: (p: ICellRendererParams<VendorRow>) => money(p.data?.usedCredit ?? 0) },
      { colId: 'settled', headerName: 'Settled', width: 130, minWidth: 110, flex: 0, type: 'rightAligned', valueGetter: p => p.data?.totalCredit ?? 0,
        cellRenderer: (p: ICellRendererParams<VendorRow>) => money(p.data?.totalCredit ?? 0) },
      { colId: 'outstanding', headerName: 'Outstanding', flex: 1, minWidth: 210, type: 'rightAligned', valueGetter: p => p.data?.outstanding ?? 0,
        cellRenderer: (p: ICellRendererParams<VendorRow>) => {
          const v = p.data!;
          const over = this.overThreshold(v);
          const n = v.outstanding ?? 0;
          const tone = over ? 'over' : Math.abs(n) < 0.005 ? 'muted' : n > 0 ? 'warn' : 'credit';
          const sub = v.notifyThreshold ? `Alert at ${sgInr(v.notifyThreshold, 0)}${over ? ' · exceeded' : ''}` : null;
          const el = sgCell(this.outstandingText(n), sub);
          el.classList.add('pf-sg-money');
          el.firstElementChild?.classList.add('pf-sg-tone--' + tone, 'pf-vn-out');
          return el;
        } },
      sgActionsCol<VendorRow>(web, sample.filter(a => !a.icon).map(a => a.label), sample.filter(a => a.icon).length,
        (p) => (p.data ? sgActions(web, this.actionsFor(p.data, web)) : document.createElement('span'))),
    ];
    if (phone) return cols.filter(c => ['name', 'outstanding', 'actions'].includes(c.colId ?? ''));
    return cols;
  });

  private readonly outFmt = new WalletOutstandingPipe();
  outstandingText(n: number): string { return this.outFmt.transform(n); }

  /** Close whatever side panel is open. */
  closePanel() {
    if (this.newVendorOpen()) this.toggleNewVendor();
    this.topUpVendorId.set(null);
    this.closePayment();
    this.openTxnsId.set(null);
  }
  private closeMoney() { this.topUpVendorId.set(null); this.paymentVendorId.set(null); this.clearPaymentFile(); this.openTxnsId.set(null); }

  /** Edit an account (setup): the same form, saved with the same PUT the status switch uses. */
  editVendor(v: VendorRow) {
    this.closeMoney();
    this.clearFieldErrors();
    this.draft.set({
      id: v.id, name: v.name, code: v.code ?? '', contactName: v.contactName ?? '', contactPhone: v.contactPhone ?? '',
      contactEmail: v.contactEmail ?? '', gstin: v.gstin ?? '', address: v.address ?? '', openingCredit: '', notifyThreshold: '',
    });
    this.newVendorOpen.set(true);
  }

  saveVendor() {
    const d = this.draft();
    const v = this.vendors().find(x => x.id === d.id);
    if (!d.id || !v || !d.name.trim()) return;
    this.clearFieldErrors();
    const bad = vendorErrors(d);
    if (Object.keys(bad).length) {
      const { name, code, ...rest } = bad;
      this.nameError.set(name ?? null); this.codeError.set(code ?? null); this.fieldErr.set(rest);
      return;
    }
    this.saving.set(true);
    this.api.put<VendorRow>(`/api/vendors/${d.id}`, {
      name: d.name.trim(), code: d.code.trim() || null,
      contactName: d.contactName.trim() || null, contactPhone: d.contactPhone.trim() || null,
      contactEmail: d.contactEmail.trim() || null, gstin: d.gstin.trim() || null,
      address: d.address.trim() || null,
      isActive: v.isActive,
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.toasts.success('Vendor updated');
        this.newVendorOpen.set(false);
        this.draft.set({ ...EMPTY_DRAFT });
        this.refresh();
      },
      error: e => {
        this.saving.set(false);
        const err = ApiError.from(e);
        if (err.field === 'name') this.nameError.set(err.message);
        else if (err.field === 'code') this.codeError.set(err.message);
        else if (err.field) this.fieldErr.set({ [err.field]: err.message });
        else this.toasts.error(err.message);
      }
    });
  }

  protected readonly loading = signal<boolean>(true);
  /** First-load skeleton over the grid, held so a fast load never flashes it. */
  readonly loadingShown = heldFlag(this.loading);
  protected readonly saving = signal<boolean>(false);
  protected readonly newVendorOpen = signal<boolean>(false);
  protected readonly draft = signal<NewVendorDraft>({ ...EMPTY_DRAFT });
  protected readonly nameError = signal<string | null>(null);
  protected readonly codeError = signal<string | null>(null);
  protected readonly fieldErr = signal<Record<string, string>>({});

  protected readonly topUpVendorId = signal<string | null>(null);
  protected readonly topUpAmount = signal<string>('');
  protected readonly topUpReason = signal<string>('');

  protected readonly openTxnsId = signal<string | null>(null);
  protected readonly txns = signal<Record<string, VendorTxn[] | undefined>>({});
  protected readonly loadingTxns = signal<boolean>(false);
  /** Skeleton held >= MIN_LOAD_MS (shared/utils/min-duration) so a fast
   *  load never flashes it. */
  readonly loadingTxnsShown = heldFlag(this.loadingTxns);

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
    this.closeMoney();
    this.newVendorOpen.update(v => !v);
    if (!this.newVendorOpen()) { this.draft.set({ ...EMPTY_DRAFT }); this.clearFieldErrors(); }
  }
  patchDraft(patch: Partial<NewVendorDraft>) {
    if ('name' in patch) this.nameError.set(null);
    if ('code' in patch) this.codeError.set(null);
    const keys = Object.keys(patch).filter(k => this.fieldErr()[k]);
    if (keys.length) this.fieldErr.update(m => { const n = { ...m }; keys.forEach(k => delete n[k]); return n; });
    this.draft.update(d => ({ ...d, ...patch }));
  }
  private clearFieldErrors() { this.nameError.set(null); this.codeError.set(null); this.fieldErr.set({}); }

  createVendor() {
    const d = this.draft();
    if (!d.name.trim()) return;
    this.clearFieldErrors();
    const bad = vendorErrors(d);
    if (Object.keys(bad).length) {
      const { name, code, ...rest } = bad;
      this.nameError.set(name ?? null); this.codeError.set(code ?? null); this.fieldErr.set(rest);
      return;
    }
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
        else if (err.field) this.fieldErr.set({ [err.field]: err.message });
        else this.toasts.error(err.message);
      }
    });
  }

  openTopUp(v: VendorRow) {
    if (this.newVendorOpen()) this.toggleNewVendor();
    this.closeMoney();
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
    if (this.newVendorOpen()) this.toggleNewVendor();
    this.closeMoney();
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
    if (this.newVendorOpen()) this.toggleNewVendor();
    this.closeMoney();
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
