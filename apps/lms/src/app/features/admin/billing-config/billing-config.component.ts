import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { OrgProfileService } from "../org/org-profile.service";
import { bankDetailsLine } from "../org/bank-details";
import { DomSanitizer, SafeResourceUrl } from "@angular/platform-browser";
import { ApiService } from "../../../core/services/api.service";
import { ToastService } from "../../../core/services/toast.service";
import {
  generateInvoicePdf,
  loadImageDataUrl,
  InvoiceTemplateStyle,
} from "../../frontdesk/billing/invoice-pdf";
import { Bill } from "../../../shared/models/bill.model";
import { Order } from "../../../shared/models/order.model";
import { ApiError } from "../../../shared/models/api-response.model";
import { Branch } from "../../../shared/models/tenant.model";
import { NumberInputComponent } from "../../../shared/primitives/number-input.component";
import { ScreenHeaderComponent } from "../../../shared/primitives/screen-header.component";
import {
  SegmentedComponent,
  SegmentedOption,
} from "../../../shared/primitives/segmented.component";
import {
  SelectComponent,
  PfSelectOption,
} from "../../../shared/primitives/select.component";
import { TouchButtonComponent } from "../../../shared/primitives/touch-button.component";
import { environment } from "../../../../environments/environment";
import { ThemeService } from "../../../core/services/theme.service";
import { HeroBandComponent } from "../../../shared/components/hero-band/hero-band.component";
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { busyWhile } from '../../../shared/utils/busy';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { finalize } from 'rxjs';
import { SkeletonFormComponent } from '../../../shared/primitives/skeleton-kit.component';

type Tab = "gst" | "discounts" | "invoice";
type GstScope = "branch" | "region" | "tenant";

interface TenantBillingConfig {
  id?: string;
  tenantId: string;
  gstEnabled: boolean;
  gstScope: GstScope;
  filingFrequency: "monthly" | "quarterly";
  allowDiscounts: boolean;
  maxDiscountPct: number;
  overrideDiscountPct: number;
  approvalThresholdPct: number;
  invoicePrefix: string;
  invoiceStartNumber: number;
  upiVpa?: string;
  upiPayeeName?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankName?: string;
  invoiceOnFullPaymentOnly?: boolean;
}

interface GstRow {
  branchId: string;
  gstin: string;
  stateCode: string;
}

@Component({
  selector: "pf-billing-config",
  standalone: true,
  imports: [SkeletonFormComponent, BusyDirective, RouterLink,
    FormsModule,
    NumberInputComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TouchButtonComponent,
    HeroBandComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): GST / Discounts / Invoice are the pill's tabs
             (tabs-only pill); Save rides the band. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            @if (!section()) {
            <pf-segmented
              class="pf-hb-tabs"
              size="sm"
              [options]="tabOptions"
              [value]="tab()"
              (valueChange)="setTab($event)"
            ></pf-segmented>
            }
          </ng-container>
          <ng-container band-actions>
            <button
              type="button"
              class="pf-hb-btn pf-hb-btn--primary press"
              [disabled]="savingConfig() || configSkeleton()"
              [pfBusy]="savingConfig()"
              pfBusyLabel="Saving…"
              (click)="saveConfig()"
              aria-label="Save billing config"
              title="Save billing config"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path
                  d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
                />
                <path d="M17 21v-8H7v8" />
                <path d="M7 3v5h8" />
              </svg>
              Save
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header
        class="pf-classic-only"
        eyebrow="Admin"
        title="Billing Config"
        subtitle="GST, discounts, and invoice numbering."
      >
        <pf-touch-btn
          actions
          size="sm"
          variant="primary"
          [busy]="savingConfig()"
          [disabled]="configSkeleton()"
          busyLabel="Saving…"
          (pressed)="saveConfig()"
        >
          <span icon-left aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"
              />
              <path d="M17 21v-8H7v8" />
              <path d="M7 3v5h8" />
            </svg>
          </span>
          Save
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
        @if (configSkeleton()) {
          <!-- First load: the form's shape until the saved config lands
               (never the defaults flashing before the lab's own values). -->
          <section class="pf-card"><div class="pf-card__body">
            <pf-skeleton-form [fields]="8" [cols]="2" label="Loading billing config…"></pf-skeleton-form>
          </div></section>
        } @else {
        <div class="mb-5 pf-classic-only" [style.display]="section() ? 'none' : null">
          <pf-segmented
            [options]="tabOptions"
            [value]="tab()"
            size="md"
            (valueChange)="setTab($event)"
          >
          </pf-segmented>
        </div>

        @if (tab() === "gst") {
          <div class="pf-bc-card mb-4">
            <div class="flex items-center justify-between">
              <div>
                <p
                  class="font-semibold text-[15px]"
                  style="color: var(--text-primary);"
                >
                  Enable GST
                </p>
                <p
                  class="text-[12px] mt-0.5"
                  style="color: var(--text-tertiary);"
                >
                  Off → bills carry no tax and invoices print as
                  <strong>Bill of Supply</strong> (most diagnostic services are
                  GST-exempt). On → each test's tax slab applies.
                </p>
              </div>
              <button
                type="button"
                class="pf-toggle pf-bc-sw"
                role="switch"
                [attr.aria-checked]="!!config().gstEnabled"
                aria-label="Enable GST"
                (click)="patch({ gstEnabled: !config().gstEnabled })"
              >
                <span class="pf-toggle__track" aria-hidden="true"
                  ><span class="pf-toggle__knob"></span
                ></span>
              </button>
            </div>
          </div>

          <div
            class="pf-bc-card"
            [style.opacity]="config().gstEnabled ? 1 : 0.5"
            [style.pointer-events]="config().gstEnabled ? 'auto' : 'none'"
          >
            <div class="space-y-5">
              <div>
                <label class="pf-label">GST scope</label>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                  @for (s of scopes; track s.value) {
                    <button
                      type="button"
                      class="pf-scope-card"
                      [attr.aria-pressed]="config().gstScope === s.value"
                      (click)="patch({ gstScope: s.value })"
                    >
                      <span class="font-semibold text-[14px]">{{
                        s.label
                      }}</span>
                      <span
                        class="text-[11px] mt-0.5"
                        style="color: var(--text-tertiary);"
                        >{{ s.hint }}</span
                      >
                    </button>
                  }
                </div>
              </div>

              <div class="max-w-xs">
                <label class="pf-label">Filing frequency</label>
                <pf-select
                  [options]="filingFrequencyOptions"
                  [value]="config().filingFrequency"
                  (valueChange)="patch({ filingFrequency: $event })"
                >
                </pf-select>
              </div>
            </div>

            <div
              class="mt-6 pt-5"
              style="border-top: 1px solid var(--border-muted);"
            >
              <h3 class="pf-bc-sub">GSTIN per branch</h3>

              @if (branches().length === 0) {
                <p class="text-[13px]" style="color: var(--text-tertiary);">
                  No branches configured yet.
                </p>
              } @else {
                <div class="space-y-2">
                  @for (b of branches(); track b.id) {
                    <div
                      class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2 items-stretch lg:items-center pf-gst-row"
                    >
                      <div class="lg:col-span-4 min-w-0">
                        <p class="pf-bc-bname">{{ b.name }}</p>
                        <p
                          class="text-[11px] pf-num"
                          style="color: var(--text-muted);"
                        >
                          {{ b.code }}
                        </p>
                      </div>
                      <div class="lg:col-span-4">
                        <input
                          type="text"
                          class="pf-input w-full"
                          placeholder="GSTIN"
                          [ngModel]="gstinFor(b.id)"
                          (ngModelChange)="setGstin(b.id, $event)"
                        />
                      </div>
                      <div class="lg:col-span-3">
                        <input
                          type="text"
                          inputmode="numeric"
                          class="pf-input w-full"
                          placeholder="State code"
                          [ngModel]="stateCodeFor(b.id)"
                          (ngModelChange)="setStateCode(b.id, $event)"
                        />
                      </div>
                      <div class="sm:col-span-2 lg:col-span-1 lg:text-right">
                        <pf-touch-btn
                          size="sm"
                          variant="ghost"
                          [disabled]="!hasGstinFor(b.id) || gstinSaving() === b.id"
                          [busy]="gstinSaving() === b.id"
                          busyLabel="Saving…"
                          (pressed)="saveGstin(b.id)"
                          >Save</pf-touch-btn
                        >
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        @if (tab() === "discounts" || section() === "gst") {
          <div class="pf-bc-card">
            <div
              class="flex items-center justify-between pb-4 mb-4"
              style="border-bottom: 1px solid var(--border-muted);"
            >
              <div>
                <p
                  class="font-semibold text-[15px]"
                  style="color: var(--text-primary);"
                >
                  Allow discounts
                </p>
                <p
                  class="text-[12px] mt-0.5"
                  style="color: var(--text-tertiary);"
                >
                  Turn off to block all discounts across the system.
                </p>
              </div>
              <button
                type="button"
                class="pf-toggle pf-bc-sw"
                role="switch"
                [attr.aria-checked]="!!config().allowDiscounts"
                aria-label="Allow discounts"
                (click)="patch({ allowDiscounts: !config().allowDiscounts })"
              >
                <span class="pf-toggle__track" aria-hidden="true"
                  ><span class="pf-toggle__knob"></span
                ></span>
              </button>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label class="pf-label">Level 1 · give_discount max %</label>
                <pf-number-input
                  [value]="config().maxDiscountPct"
                  [min]="0"
                  [max]="100"
                  [step]="1"
                  suffix="%"
                  [disabled]="!config().allowDiscounts"
                  (valueChange)="patch({ maxDiscountPct: $event ?? 0 })"
                >
                </pf-number-input>
              </div>
              <div>
                <label class="pf-label">Level 2 · override max %</label>
                <pf-number-input
                  [value]="config().overrideDiscountPct"
                  [min]="0"
                  [max]="100"
                  [step]="1"
                  suffix="%"
                  [disabled]="!config().allowDiscounts"
                  (valueChange)="patch({ overrideDiscountPct: $event ?? 0 })"
                >
                </pf-number-input>
              </div>
              <div>
                <label class="pf-label">Approval threshold %</label>
                <pf-number-input
                  [value]="config().approvalThresholdPct"
                  [min]="0"
                  [max]="100"
                  [step]="1"
                  suffix="%"
                  [disabled]="!config().allowDiscounts"
                  (valueChange)="patch({ approvalThresholdPct: $event ?? 0 })"
                >
                </pf-number-input>
              </div>
            </div>

            <p class="text-[12px] mt-4" style="color: var(--text-tertiary);">
              Discounts above the approval threshold require a second approver.
            </p>
          </div>
        }

        @if (tab() === "invoice") {
          <div
            class="grid grid-cols-1 xl:grid-cols-[1fr_minmax(380px,460px)] gap-5 items-start"
          >
            <div class="min-w-0">
              <div class="pf-bc-card">
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  <div>
                    <label class="pf-label">Invoice prefix</label>
                    <input
                      type="text"
                      class="pf-input"
                      [ngModel]="config().invoicePrefix"
                      (ngModelChange)="patch({ invoicePrefix: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Next invoice number</label>
                    <pf-number-input
                      [value]="config().invoiceStartNumber"
                      [min]="1"
                      [step]="1"
                      (valueChange)="patch({ invoiceStartNumber: $event ?? 1 })"
                    >
                    </pf-number-input>
                    <p class="pf-bc-hint">Can only move forward — issued numbers are never reused.</p>
                  </div>
                </div>

                <div class="pf-invoice-preview">
                  <p class="pf-bc-sub">Next invoice</p>
                  <p
                    class="pf-num text-[16px] font-semibold"
                    style="color: var(--text-primary);"
                  >
                    {{ invoicePreview() }}
                  </p>
                </div>

                <div
                  class="flex items-start justify-between gap-4 mt-5 pt-5"
                  style="border-top: 1px solid var(--glass-border);"
                >
                  <div class="min-w-0">
                    <p
                      class="font-semibold text-[15px]"
                      style="color: var(--text-primary);"
                    >
                      Issue invoice only on full payment
                    </p>
                    <p
                      class="text-[12px] mt-0.5"
                      style="color: var(--text-tertiary);"
                    >
                      On → a bill stays a <strong>proforma</strong> (no invoice
                      number) until it's fully paid; the invoice number is
                      issued at settlement. Off → the invoice number is
                      allocated when the bill is created.
                    </p>
                  </div>
                  <button
                    type="button"
                    class="pf-toggle pf-bc-sw"
                    role="switch"
                    [attr.aria-checked]="
                      !!(config().invoiceOnFullPaymentOnly ?? false)
                    "
                    aria-label="Issue invoice only on full payment"
                    (click)="
                      patch({
                        invoiceOnFullPaymentOnly: !(
                          config().invoiceOnFullPaymentOnly ?? false
                        ),
                      })
                    "
                  >
                    <span class="pf-toggle__track" aria-hidden="true"
                      ><span class="pf-toggle__knob"></span
                    ></span>
                  </button>
                </div>
              </div>

              <!-- Online payment (UPI): powers the "Pay via UPI" link + QR on the
             public status page a patient reaches by scanning the invoice QR. -->
              <div class="pf-bc-card mt-5">
                <h3 class="pf-label" style="margin-bottom:2px;">
                  Online payment (UPI)
                </h3>
                <p
                  class="text-[12px] mb-4"
                  style="color: var(--text-tertiary);"
                >
                  Add your UPI address so patients can pay from the status page
                  — it opens Google&nbsp;Pay / PhonePe / any UPI app with the
                  amount prefilled. Leave blank to hide the pay option.
                </p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="pf-label">UPI address (VPA)</label>
                    <input
                      type="text"
                      class="pf-input"
                      placeholder="clinic@axis"
                      autocapitalize="none"
                      spellcheck="false"
                      [ngModel]="config().upiVpa || ''"
                      (ngModelChange)="patch({ upiVpa: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Payee name</label>
                    <input
                      type="text"
                      class="pf-input"
                      placeholder="Prefrontal Lab"
                      [ngModel]="config().upiPayeeName || ''"
                      (ngModelChange)="patch({ upiPayeeName: $event })"
                    />
                  </div>
                </div>
              </div>

              <!-- Bank account: the tenant's settlement / reference account. Optional;
             used for payouts and printed bank details on invoices. -->
              <div class="pf-bc-card mt-5">
                <h3 class="pf-label" style="margin-bottom:2px;">
                  Bank account
                </h3>
                <p
                  class="text-[12px] mb-4"
                  style="color: var(--text-tertiary);"
                >
                  Link the bank account where payments settle. Shown for
                  reference and can be printed on invoices. All fields optional.
                </p>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label class="pf-label">Account holder name</label>
                    <input
                      type="text"
                      class="pf-input"
                      placeholder="Prefrontal Diagnostics Pvt Ltd"
                      [ngModel]="config().bankAccountName || ''"
                      (ngModelChange)="patch({ bankAccountName: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Account number</label>
                    <input
                      type="text"
                      inputmode="numeric"
                      class="pf-input"
                      placeholder="0123456789"
                      autocapitalize="none"
                      spellcheck="false"
                      [ngModel]="config().bankAccountNumber || ''"
                      (ngModelChange)="patch({ bankAccountNumber: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">IFSC</label>
                    <input
                      type="text"
                      class="pf-input"
                      placeholder="HDFC0001234"
                      autocapitalize="characters"
                      spellcheck="false"
                      [ngModel]="config().bankIfsc || ''"
                      (ngModelChange)="patch({ bankIfsc: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Bank name</label>
                    <input
                      type="text"
                      class="pf-input"
                      placeholder="HDFC Bank"
                      [ngModel]="config().bankName || ''"
                      (ngModelChange)="patch({ bankName: $event })"
                    />
                  </div>
                </div>
              </div>

              <!-- Letterhead & document type -->
              <div class="pf-bc-card mt-5">
                <h3
                  class="text-sm font-bold mb-1"
                  style="color: var(--text-primary);"
                >
                  Letterhead &amp; document
                </h3>
                <p
                  class="text-[13px] mb-4"
                  style="color: var(--text-tertiary);"
                >
                  Shown on the invoice / receipt PDF. Most diagnostic services
                  are GST-exempt — use Bill of Supply (or Auto).
                </p>

                <label class="pf-label">Template style</label>
                <div class="flex flex-wrap gap-2 mb-4">
                  @for (s of templateStyles; track s.value) {
                    <button
                      type="button"
                      class="pf-tpl-chip"
                      [attr.aria-pressed]="
                        (tpl().template ?? 'classic') === s.value
                      "
                      (click)="patchTpl({ template: s.value })"
                    >
                      {{ s.label }}
                    </button>
                  }
                </div>

                @if ((tpl().template ?? "classic") === "cashbill") {
                  <label class="pf-label">Print size</label>
                  <div class="flex flex-wrap gap-2 mb-4">
                    @for (p of paperSizes; track p.value) {
                      <button
                        type="button"
                        class="pf-tpl-chip"
                        [attr.aria-pressed]="
                          (tpl().paperSize ?? 'a4') === p.value
                        "
                        (click)="patchTpl({ paperSize: p.value })"
                      >
                        {{ p.label }}
                      </button>
                    }
                  </div>
                }

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div data-testid="bc-name-ro">
                    <!-- The lab name is set ONCE in Organization profile (Settings re-home); read-only here. -->
                    <span class="pf-label">Lab name</span>
                    <p class="pf-bc-gstin-ro">{{ effectiveTpl().labName || "Prefrontal Lab" }}</p>
                    <a class="pf-bc-gstin-link" routerLink="/admin/org/profile">Change in Organization profile</a>
                  </div>
                  <div>
                    <!-- GSTIN is not a template field: every invoice prints its
                         branch's GSTIN (GST Setup), snapshotted on the bill. -->
                    <span class="pf-label">GSTIN</span>
                    @if (branchGstins().length === 0) {
                      <p class="pf-bc-gstin-ro">No branch GSTIN set</p>
                    } @else {
                      @for (g of branchGstins(); track g.branchId) {
                        <p class="pf-bc-gstin-ro">
                          <span class="pf-num">{{ g.gstin }}</span>
                          @if (branchGstins().length > 1) { <span class="pf-bc-gstin-br">· {{ g.branchName }}</span> }
                        </p>
                      }
                    }
                    <button type="button" class="pf-bc-gstin-link" (click)="setTab('gst')">
                      Set per branch in GST Setup
                    </button>
                  </div>
                  <div class="col-span-1 sm:col-span-2">
                    <label class="pf-label">Address</label
                    ><input
                      class="pf-input"
                      [ngModel]="tpl().address"
                      (ngModelChange)="patchTpl({ address: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Phone</label
                    ><input
                      type="tel"
                      class="pf-input"
                      [ngModel]="tpl().phone"
                      (ngModelChange)="patchTpl({ phone: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Email</label
                    ><input
                      type="email"
                      autocapitalize="none"
                      class="pf-input"
                      [ngModel]="tpl().email"
                      (ngModelChange)="patchTpl({ email: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Document type</label>
                    <pf-select
                      [options]="documentModeOptions"
                      [value]="tpl().documentMode ?? 'auto'"
                      (valueChange)="patchTpl({ documentMode: $event })"
                    ></pf-select>
                  </div>
                  <div>
                    <label class="pf-label">Accent colour</label
                    ><input
                      class="pf-input pf-bc-color"
                      type="color"
                      [ngModel]="tpl().accentColor || '#1B3A6B'"
                      (ngModelChange)="patchTpl({ accentColor: $event })"
                    />
                  </div>
                  <div>
                    <label class="pf-label">Signatory label</label
                    ><input
                      class="pf-input"
                      [ngModel]="tpl().signatureLabel"
                      (ngModelChange)="patchTpl({ signatureLabel: $event })"
                      placeholder="Authorised Signatory"
                    />
                  </div>
                  <div class="col-span-1 sm:col-span-2">
                    <span class="pf-label">Logo</span>
                    <p class="pf-bc-gstin-ro" data-testid="bc-logo-ro">{{ effectiveTpl().logoUrl ? "The organization logo prints on the bill." : "No logo set." }}</p>
                    <a class="pf-bc-gstin-link" routerLink="/admin/org/profile">Change in Organization profile</a>
                  </div>
                  <div>
                    <label class="pf-label">Jurisdiction</label
                    ><input
                      class="pf-input"
                      [ngModel]="tpl().jurisdiction"
                      (ngModelChange)="patchTpl({ jurisdiction: $event })"
                      placeholder="e.g. Chennai"
                    />
                  </div>
                  <div class="col-span-1 sm:col-span-2">
                    <!-- ONE bank-details source: the Bank account card above. The bill prints it from there. -->
                    <span class="pf-label">Bank details</span>
                    <p class="pf-bc-gstin-ro" data-testid="bc-bank-ro">{{ effectiveTpl().bankDetails || "No bank account set yet" }}</p>
                    <span class="pf-bc-gstin-note">Printed from the Bank account card above.</span>
                  </div>
                  <div class="col-span-1 sm:col-span-2">
                    <label class="pf-label">Declaration</label
                    ><input
                      class="pf-input"
                      [ngModel]="tpl().declaration"
                      (ngModelChange)="patchTpl({ declaration: $event })"
                      placeholder="Certified that the particulars given above are true and correct."
                    />
                  </div>
                  <div class="col-span-1 sm:col-span-2">
                    <label class="pf-label">Footer / terms</label
                    ><input
                      class="pf-input"
                      [ngModel]="tpl().footerText"
                      (ngModelChange)="patchTpl({ footerText: $event })"
                    />
                  </div>
                </div>
                <div class="flex flex-wrap gap-5 mt-3">
                  <button
                    type="button"
                    class="pf-toggle pf-bc-sw"
                    role="switch"
                    [attr.aria-checked]="tpl().showLogo !== false"
                    (click)="patchTpl({ showLogo: tpl().showLogo === false })"
                  >
                    <span class="pf-toggle__track" aria-hidden="true"
                      ><span class="pf-toggle__knob"></span></span
                    >Show logo
                  </button>
                  <button
                    type="button"
                    class="pf-toggle pf-bc-sw"
                    role="switch"
                    [attr.aria-checked]="tpl().showGstin !== false"
                    (click)="patchTpl({ showGstin: tpl().showGstin === false })"
                  >
                    <span class="pf-toggle__track" aria-hidden="true"
                      ><span class="pf-toggle__knob"></span></span
                    >Show GSTIN
                  </button>
                  <button
                    type="button"
                    class="pf-toggle pf-bc-sw"
                    role="switch"
                    [attr.aria-checked]="tpl().showTrackingQr !== false"
                    (click)="
                      patchTpl({
                        showTrackingQr: tpl().showTrackingQr === false,
                      })
                    "
                  >
                    <span class="pf-toggle__track" aria-hidden="true"
                      ><span class="pf-toggle__knob"></span></span
                    >Show result-tracking QR
                  </button>
                </div>
                <!-- Secondary: the band's Save (billing config) is the ONE primary. -->
                <button
                  type="button"
                  class="pf-btn pf-btn--secondary pf-save-letterhead mt-4 press"
                  [disabled]="savingTpl()"
                  [pfBusy]="savingTpl()"
                  pfBusyLabel="Saving…"
                  (click)="saveTpl()"
                >
                  {{ savingTpl() ? "Saving…" : "Save letterhead" }}
                </button>
              </div>
            </div>

            <!-- Live invoice preview (right) -->
            <div class="pf-bc-card xl:sticky xl:top-4">
              <div
                class="flex flex-wrap items-center justify-between gap-2 mb-3"
              >
                <h3
                  class="text-sm font-bold"
                  style="color: var(--text-primary);"
                >
                  Live preview
                </h3>
                <div class="flex flex-wrap gap-1">
                  <button
                    type="button"
                    class="pf-tpl-chip"
                    [attr.aria-pressed]="previewMode() === 'bill_of_supply'"
                    (click)="setPreviewMode('bill_of_supply')"
                  >
                    Bill of Supply
                  </button>
                  <button
                    type="button"
                    class="pf-tpl-chip"
                    [attr.aria-pressed]="previewMode() === 'tax_invoice'"
                    (click)="setPreviewMode('tax_invoice')"
                  >
                    Tax Invoice
                  </button>
                </div>
              </div>
              @if (invoicePreviewUrl(); as src) {
                <div
                  class="pf-invoice-viewport"
                  [style.--pf-inv-scale]="invoicePreviewScale()"
                >
                  <div class="pf-invoice-stage">
                    <iframe
                      [src]="src"
                      title="Invoice preview"
                      class="pf-invoice-iframe"
                      style="width:100%;height:62dvh;border:1px solid var(--glass-border);border-radius:12px;background:#525659"
                    ></iframe>
                  </div>
                </div>
              } @else {
                <div
                  class="text-[13px] py-10 text-center"
                  style="color: var(--text-tertiary);"
                >
                  Rendering preview…
                </div>
              }
            </div>
          </div>
        }
        }
      </div>
    </section>
  `,
  styles: [
    `
      .pf-scope-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 12px 14px;
        border-radius: var(--pf-radius, 12px);
        background: var(--pf-card-bg);
        border: 1px solid var(--pf-line);
        color: var(--text-secondary);
        cursor: pointer;
        text-align: left;
        transition:
          border-color 0.2s ease,
          background 0.2s ease,
          transform 0.08s ease;
      }
      .pf-scope-card:active {
        transform: scale(0.98);
      }
      .pf-scope-card:hover {
        border-color: var(--card-hover-border);
      }
      .pf-scope-card[aria-pressed="true"] {
        background: var(--pf-sel-bg);
        border-color: var(--pf-sel-border);
        color: var(--text-primary);
      }

      .pf-gst-row {
        padding: 10px 12px;
        border-radius: var(--pf-radius-sm, 10px);
        background: var(--pf-card-bg);
        border: 1px solid var(--pf-line);
      }

      .pf-invoice-preview {
        padding: 14px 18px;
        border-radius: 14px;
        background: var(--pf-chip-bg);
        border: 1px solid var(--pf-line);
      }
      /* Kit chips: the selected one is the NEUTRAL selected state (never a gradient). */
      .pf-tpl-chip {
        height: 34px;
        padding: 0 12px;
        border-radius: var(--pf-radius-chip, 8px);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        border: 1px solid var(--pf-line);
        background: var(--pf-card-bg);
        color: var(--text-secondary);
      }
      .pf-tpl-chip[aria-pressed="true"] {
        background: var(--pf-sel-bg);
        border-color: var(--pf-sel-border);
        color: var(--text-primary);
        font-weight: 600;
      }

      /* Section surfaces = the kit card (hairline, soft shadow). */
      .pf-bc-card {
        display: block;
        padding: 18px;
        border-radius: var(--pf-radius-card, 16px);
        background: var(--pf-card-bg);
        border: 1px solid var(--pf-line);
        box-shadow: var(--pf-shadow-sm);
      }
      .pf-bc-hint { margin: 6px 0 0; font-size: 12px; color: var(--text-muted); }
      .pf-bc-gstin-note { display: block; margin-top: 4px; font-size: 12px; color: var(--text-tertiary); }
      .pf-bc-gstin-ro { margin: 6px 0 0; font-size: 13px; color: var(--text-primary); overflow-wrap: anywhere; }
      .pf-bc-gstin-br { color: var(--text-muted); font-size: 12px; }
      .pf-bc-gstin-link {
        margin-top: 4px; padding: 6px 0; min-height: 32px; background: none; border: 0;
        font-size: 12px; font-weight: 500; color: var(--color-primary); cursor: pointer;
        text-decoration: underline; text-underline-offset: 2px;
      }
      .pf-bc-sub {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary);
      }
      .pf-bc-bname {
        margin: 0;
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }
      .pf-bc-sw {
        flex-shrink: 0;
        font-size: 13px;
      }
      .pf-bc-color {
        height: 40px;
        padding: 4px;
      }

      /* Desktop/iPad: the scale wrappers are transparent — the iframe keeps its
       original width:100% / height:62dvh behaviour. They only become real
       (scaling) boxes at ≤640px below, so the desktop preview is unchanged. */
      .pf-invoice-viewport,
      .pf-invoice-stage {
        display: contents;
      }

      /* ── Cross-platform additive overrides (scoped to this page only) ── */

      /* Phone: stop iOS auto-zoom on focus by keeping form text >= 16px.
       Scoped under :host so the shared .pf-input primitive is untouched globally. */
      @media (max-width: 640px) {
        :host .pf-input,
        :host input[type="text"],
        :host input[type="color"],
        :host select {
          font-size: 16px;
        }
        /* ── Invoice preview: CONTAIN the A4 page inside the phone. The PDF
            iframe renders the page at its intrinsic 794px CSS width, which
            otherwise spills past the tile and clips the right edge ("MicroLab",
            "CASH B…", the phone number). We scale it down to the tile width via
            --pf-inv-scale (set in TS), then let the viewport scroll + pinch-zoom
            so the whole bill is visible and zoomable. The wrappers (which are
            display:contents at ≥641px) become real boxes here. */
        :host .pf-invoice-viewport {
          display: block;
          width: 100%;
          height: 56dvh;
          overflow: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y pinch-zoom;
          border-radius: 12px;
          background: #525659; /* letterbox around the scaled page */
        }
        :host .pf-invoice-stage {
          display: block;
          /* Scaled footprint so the scroller sizes correctly and nothing
           overflows horizontally at the default fit. 794×1123 = A4 @ ~96dpi. */
          width: calc(794px * var(--pf-inv-scale, 1));
          height: calc(1123px * var(--pf-inv-scale, 1));
          margin: 0 auto;
        }
        :host .pf-invoice-iframe {
          width: 794px !important;
          height: 1123px !important;
          border: 0 !important;
          border-radius: 0 !important;
          transform-origin: top left;
          transform: scale(var(--pf-inv-scale, 1));
        }
      }

      /* Touch devices: ensure tap targets are comfortably >= 44px. */
      @media (pointer: coarse) {
        :host .pf-tpl-chip {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
        }
        :host .pf-scope-card {
          min-height: 44px;
        }
        /* The "Save letterhead" raw button is a plain element, not a pf-touch-btn,
         so give it a comfortable touch target on coarse pointers. */
        :host .pf-save-letterhead {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        /* The colour swatch carries an inline 38px height; lift it to a tappable
         size on touch (the inline style still wins on desktop precise pointers). */
        :host input[type="color"] {
          min-height: 44px;
        }
        :host .pf-bc-sw {
          min-height: 44px;
        }
      }

      /* Touch hover guard: the scope-card hover border is harmless on touch,
       but keep the lift transition crisp on coarse pointers. */
      @media (hover: none) {
        :host .pf-scope-card:hover {
          border-color: var(--glass-border);
        }
      }
    `,
  ],
})
export class BillingConfigComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly theme = inject(ThemeService);

  /** Invoice document type (was a native select). */
  readonly documentModeOptions: PfSelectOption<string>[] = [
    { value: "auto", label: "Auto (by tax)" },
    { value: "tax_invoice", label: "Tax Invoice" },
    { value: "bill_of_supply", label: "Bill of Supply" },
  ];

  readonly tabOptions: SegmentedOption<Tab>[] = [
    { value: "gst", label: "GST Setup" },
    { value: "discounts", label: "Discounts" },
    { value: "invoice", label: "Invoice" },
  ];
  private readonly _tab = signal<Tab>("gst");
  readonly tab = this._tab.asReadonly();
  setTab(t: Tab) {
    this._tab.set(t);
    if (t === "invoice" && !this.invoicePreviewUrl())
      setTimeout(() => this.renderInvoicePreview(), 50);
  }

  readonly scopes: Array<{ label: string; value: GstScope; hint: string }> = [
    {
      label: "Per branch",
      value: "branch",
      hint: "Each branch files separately",
    },
    {
      label: "Per region",
      value: "region",
      hint: "Branches grouped by region",
    },
    { label: "Per tenant", value: "tenant", hint: "One consolidated filing" },
  ];

  readonly filingFrequencyOptions: PfSelectOption<"monthly" | "quarterly">[] = [
    {
      value: "monthly",
      label: "Monthly",
      hint: "Returns every calendar month",
    },
    {
      value: "quarterly",
      label: "Quarterly",
      hint: "Returns every three months",
    },
  ];

  private readonly _config = signal<TenantBillingConfig>({
    tenantId: "",
    gstEnabled: true,
    gstScope: "branch",
    filingFrequency: "monthly",
    allowDiscounts: true,
    maxDiscountPct: 10,
    overrideDiscountPct: 25,
    approvalThresholdPct: 50,
    invoicePrefix: "INV",
    invoiceStartNumber: 1000,
  });
  readonly config = this._config.asReadonly();
  patch(p: Partial<TenantBillingConfig>) {
    this._config.update((c) => ({ ...c, ...p }));
  }

  private readonly _branches = signal<Branch[]>([]);
  readonly branches = this._branches.asReadonly();

  private readonly _gstinByBranch = signal<Map<string, GstRow>>(new Map());
  /** SAVED branch GSTINs (GET /api/config/gst) — what invoices print. The
   *  editable map above also holds unsaved typing. */
  private readonly _savedGst = signal<GstRow[]>([]);
  readonly branchGstins = computed(() => {
    const names = new Map(this._branches().map((b) => [b.id, b.name]));
    return this._savedGst()
      .filter((g) => (g.gstin ?? "").trim())
      .map((g) => ({ ...g, branchName: names.get(g.branchId) ?? "Branch" }));
  });
  /** The preview prints a real branch GSTIN (the first), as invoices do. */
  previewGstin(): string | undefined {
    return this.branchGstins()[0]?.gstin || undefined;
  }

  readonly invoicePreview = computed(() => {
    const c = this._config();
    const year = new Date().getFullYear();
    return `${c.invoicePrefix}/${year}/${c.invoiceStartNumber}`;
  });

  // Invoice letterhead/template
  private readonly TPL_DEFAULTS = {
    documentMode: "auto",
    showGstin: true,
    showTrackingQr: true,
    template: "classic",
    accentColor: "#1B3A6B",
    showLogo: true,
  };
  private readonly _tpl = signal<any>({ ...this.TPL_DEFAULTS });
  readonly tpl = this._tpl.asReadonly();
  readonly savingTpl = signal(false);

  /** Settings re-home: the bill's name + logo come from Organization profile (read-only here) and its bank details
   *  from the structured Bank account card (one source). The legacy free-text bank details stay as a fallback until
   *  the card is filled, so a lab that only used the old field never loses what its bills print. */
  private readonly orgProfile = inject(OrgProfileService);
  readonly effectiveTpl = computed(() => {
    const t = this._tpl();
    return {
      ...t,
      labName: this.orgProfile.name() || t.labName,
      logoUrl: this.orgProfile.logoUrl() || t.logoUrl,
      bankDetails: bankDetailsLine(this._config()) || t.bankDetails || "",
    };
  });

  /** `/admin/billing` pins one section (the Settings left panel is the switch): `gst` = GST AND Discounts, `invoice`.
   *  Unset = the old three-tab page (GST Setup / Discounts / Invoice). */
  readonly section = input<"gst" | "invoice" | null>(null);
  private readonly pinSection = effect(() => {
    const s = this.section();
    if (s && this._tab() !== s) this.setTab(s);
  });
  readonly templateStyles: Array<{
    value: InvoiceTemplateStyle;
    label: string;
  }> = [
    { value: "classic", label: "Classic" },
    { value: "modern", label: "Modern" },
    { value: "letterhead", label: "Letterhead" },
    { value: "cashbill", label: "Receipt Bill" },
  ];
  readonly paperSizes: Array<{
    value: "a4" | "thermal" | "thermal_3in" | "thermal_25in";
    label: string;
  }> = [
    { value: "a4", label: "A4 sheet" },
    { value: "thermal", label: 'Receipt 4"' },
    { value: "thermal_3in", label: 'Receipt 3"' },
    { value: "thermal_25in", label: 'Receipt 2.5"' },
  ];
  patchTpl(p: Record<string, unknown>) {
    this._tpl.set({ ...this._tpl(), ...p });
  }
  saveTpl() {
    this.savingTpl.set(true);
    this.api.post("/api/config/invoice-template", this.effectiveTpl()).subscribe({
      next: () => {
        this.savingTpl.set(false);
        this.toasts.success("Letterhead saved");
      },
      error: (e) => {
        this.savingTpl.set(false);
        this.toasts.error(ApiError.from(e).message);
      },
    });
  }

  // ── Live invoice preview (right pane) ──────────────────────────
  readonly previewMode = signal<"tax_invoice" | "bill_of_supply">(
    "bill_of_supply",
  );
  readonly invoicePreviewUrl = signal<SafeResourceUrl | null>(null);
  private previewBlob: string | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-render the preview (debounced) whenever the template or mode changes.
    effect(() => {
      const t = this.effectiveTpl();
      const mode = this.previewMode();
      if (this._tab() !== "invoice") return;
      void t;
      void mode;
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => this.renderInvoicePreview(), 300);
    });
  }

  setPreviewMode(m: "tax_invoice" | "bill_of_supply") {
    this.previewMode.set(m);
  }

  /** Fit-to-width scale for the phone invoice preview. The PDF iframe renders
   *  the A4 page at its intrinsic ~794px CSS width (595.28pt × 96/72); on a
   *  narrow screen we scale it down to the tile's content width so the whole
   *  bill is visible with nothing clipped on the right ("MicroLab", "CASH B").
   *  Capped at 1 so it never upscales. Only consumed by the ≤640px CSS. */
  invoicePreviewScale(): number {
    const w = typeof window !== "undefined" ? window.innerWidth : 794;
    return Math.min(1, Math.max(0.1, (w - 64) / 794));
  }

  // Sample QR data URLs so the preview shows the tracking + order QRs the
  // real invoice carries. Generated once, lazily.
  private _sampleQrs: { qr: string; orderQr: string } | null = null;
  private async sampleQrs(): Promise<{ qr: string; orderQr: string }> {
    if (this._sampleQrs) return this._sampleQrs;
    const QRCode = (await import("qrcode")).default;
    const [qr, orderQr] = await Promise.all([
      QRCode.toDataURL("https://example.lab/track/SAMPLE", {
        margin: 1,
        width: 220,
      }),
      QRCode.toDataURL("https://example.lab/o/SAMPLE", {
        margin: 1,
        width: 220,
      }),
    ]);
    this._sampleQrs = { qr, orderQr };
    return this._sampleQrs;
  }

  private async renderInvoicePreview() {
    const t = this.effectiveTpl();
    const taxMode = this.previewMode() === "tax_invoice";
    const { bill, order } = this.sampleBill(taxMode);
    const logoDataUrl =
      t.showLogo === false
        ? undefined
        : await loadImageDataUrl(t.logoUrl || undefined, environment.apiUrl);
    const qrs = await this.sampleQrs();
    try {
      const blob = generateInvoicePdf({
        bill,
        order,
        invoiceNumber: `${this._config().invoicePrefix}/${new Date().getFullYear()}/${this._config().invoiceStartNumber}`,
        effectivePayable: bill.totalPayable,
        tatLabel: "~ 1 day to report",
        docTitle: taxMode ? "TAX INVOICE" : "BILL OF SUPPLY",
        practice: {
          name: t.labName || "Prefrontal Lab",
          address: t.address,
          phone: t.phone,
          email: t.email,
          gstin: this.previewGstin(),
        },
        template: (t.template ?? "classic") as InvoiceTemplateStyle,
        paperSize: (t.paperSize ?? "a4") as
          | "a4"
          | "thermal"
          | "thermal_3in"
          | "thermal_25in",
        accentColor: t.accentColor,
        logoDataUrl,
        qrDataUrl: qrs.qr,
        orderQrDataUrl: qrs.orderQr,
        tagline: t.tagline,
        footerText: t.footerText,
        bankDetails: t.bankDetails,
        signatureLabel: t.signatureLabel,
        jurisdiction: t.jurisdiction,
        declaration: t.declaration,
        cashierName: "sathyapriya",
        action: "blob",
      }) as string | undefined;
      if (!blob) return;
      if (this.previewBlob) {
        try {
          URL.revokeObjectURL(this.previewBlob);
        } catch {
          /* noop */
        }
      }
      this.previewBlob = blob;
      this.invoicePreviewUrl.set(
        this.sanitizer.bypassSecurityTrustResourceUrl(blob),
      );
    } catch {
      /* preview is best-effort */
    }
  }

  /** Sample bill for the preview. With tax for the Tax-Invoice preview, exempt
   *  (no tax) for the Bill-of-Supply preview. */
  private sampleBill(withTax: boolean): { bill: Bill; order: Order } {
    const items = [
      { name: "Complete Blood Count (CBC)", hsn: "999316", price: 350 },
      { name: "Lipid Profile", hsn: "999316", price: 600 },
    ];
    const slab = withTax ? 18 : 0;
    const billItems = items.map((it, i) => {
      const taxable = it.price;
      const tax = Math.round((taxable * slab) / 100);
      const half = Math.round(tax / 2);
      return {
        id: `i${i}`,
        billId: "b",
        testId: `t${i}`,
        testName: it.name,
        hsnSacCode: it.hsn,
        price: it.price,
        discount: 0,
        taxableAmount: taxable,
        taxSlab: slab,
        cgstRate: slab / 2,
        sgstRate: slab / 2,
        igstRate: 0,
        cgstAmount: half,
        sgstAmount: tax - half,
        igstAmount: 0,
        total: taxable + tax,
      };
    });
    const subTotal = billItems.reduce((s, i) => s + i.price, 0);
    const totalTax = billItems.reduce(
      (s, i) => s + i.cgstAmount + i.sgstAmount + i.igstAmount,
      0,
    );
    const bill = {
      id: "b",
      orderId: "o",
      patientId: "p",
      branchId: "br",
      type: withTax ? "tax_invoice" : "bill_of_supply",
      invoiceNumber: "PREVIEW",
      supplierGstin: this.previewGstin(),
      placeOfSupply: "Tamil Nadu (33)",
      isInterstate: false,
      subTotal,
      overrideDiscount: 0,
      totalDiscount: 0,
      totalTaxable: subTotal,
      totalCgst: billItems.reduce((s, i) => s + i.cgstAmount, 0),
      totalSgst: billItems.reduce((s, i) => s + i.sgstAmount, 0),
      totalIgst: 0,
      totalTax,
      totalPayable: subTotal + totalTax,
      totalPaid: subTotal + totalTax,
      balance: 0,
      status: "paid",
      items: billItems as Bill["items"],
      createdAt: new Date().toISOString(),
      payments: [
        {
          id: "pay1",
          billId: "b",
          amount: subTotal + totalTax,
          mode: "online",
          referenceNo: "B255173",
          paidAt: new Date().toISOString(),
        },
      ],
    } as Bill;
    const order = {
      id: "order-26057734",
      refDoctorName: "Dr. D. Satheesh Kumar MD",
      patient: {
        mrn: "TRY00928929",
        displayName: "Aarav Sharma",
        age: 32,
        sex: "Male",
        phone: "98765 43210",
      },
      samples: [{ barcode: "26057734" }],
    } as unknown as Order;
    return { bill, order };
  }

  closeInvoicePreview() {
    if (this.previewBlob) {
      try {
        URL.revokeObjectURL(this.previewBlob);
      } catch {
        /* noop */
      }
      this.previewBlob = null;
    }
    this.invoicePreviewUrl.set(null);
  }
  ngOnDestroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.closeInvoicePreview();
  }

  ngOnInit() {
    this.orgProfile.ensureLoaded();
    this.destroyRef.onDestroy(() => this.configHold.cancel());
    this.loadConfig(() => this.configHold.done());
    this.api.get<any>("/api/config/invoice-template").subscribe({
      next: (t) => {
        this._tpl.set({ ...this.TPL_DEFAULTS, ...(t ?? {}) });
      },
    });
    this.api.get<Branch[]>("/api/tenants/branches").subscribe({
      next: (l) => this._branches.set(l ?? []),
    });
    this.loadGst();
  }

  /** Saved branch GST configs — GST Setup showed blank inputs for GSTINs
   *  that were already saved (there was no GET). */
  private loadGst() {
    this.api.get<GstRow[]>("/api/config/gst").subscribe({
      next: (rows) => {
        const list = rows ?? [];
        this._savedGst.set(list);
        this._gstinByBranch.set(new Map(list.map((r) => [r.branchId, { ...r }])));
      },
    });
  }

  gstinFor(bid: string): string {
    return this._gstinByBranch().get(bid)?.gstin ?? "";
  }
  stateCodeFor(bid: string): string {
    return this._gstinByBranch().get(bid)?.stateCode ?? "";
  }
  hasGstinFor(bid: string): boolean {
    const r = this._gstinByBranch().get(bid);
    return !!(r?.gstin && r?.stateCode);
  }
  setGstin(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: "", stateCode: "" };
    map.set(bid, { ...cur, gstin: v });
    this._gstinByBranch.set(map);
  }
  setStateCode(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: "", stateCode: "" };
    map.set(bid, { ...cur, stateCode: v });
    this._gstinByBranch.set(map);
  }
  /** Loading feedback: the branch row whose GSTIN is saving / the config save. */
  readonly gstinSaving = signal<string | null>(null);
  readonly savingConfig = signal(false);
  saveGstin(bid: string) {
    const row = this._gstinByBranch().get(bid);
    if (!row || this.gstinSaving() === bid) return;
    this.gstinSaving.set(bid);
    this.api
      .post("/api/config/gst", {
        branchId: bid,
        gstin: row.gstin,
        stateCode: row.stateCode,
      })
      .pipe(finalize(() => { if (this.gstinSaving() === bid) this.gstinSaving.set(null); }))
      .subscribe({
        next: () => {
          this.toasts.success("GSTIN saved");
          this.loadGst();
        },
        error: (e) => this.toasts.error(ApiError.from(e).message),
      });
  }

  /** The server's config — incl. the LIVE invoice counter, which moves on
   *  every bill; re-read after a save so the form never holds a stale one. */
  private loadConfig(landed?: () => void) {
    this.api.get<TenantBillingConfig>("/api/config/billing").subscribe({
      next: (c) => {
        if (c) this._config.set({ ...this._config(), ...c });
        landed?.();
      },
      ...(landed ? { error: () => landed() } : {}),
    });
  }
  /** First load: skeleton form until the saved config lands (held, no flash). */
  private readonly configHold = createLoadHold(true);
  readonly configSkeleton = this.configHold.active;
  private readonly destroyRef = inject(DestroyRef);

  /** The bank-account card is the one source; the bill reads one printed line, so a changed card re-posts the bill
   *  template with the line derived from it (same API, same payload shape — only bankDetails differs). */
  private syncBankDetails(line: string) {
    if (!line || line === (this._tpl().bankDetails ?? "")) return;
    this.patchTpl({ bankDetails: line });
    this.api.post("/api/config/invoice-template", { ...this.effectiveTpl(), bankDetails: line }).subscribe({
      error: (e) => this.toasts.error(ApiError.from(e).message),
    });
  }

  saveConfig() {
    if (this.savingConfig()) return;
    const c = this._config();
    this.api
      .post("/api/config/billing", {
        gstEnabled: c.gstEnabled,
        gstScope: c.gstScope,
        filingFrequency: c.filingFrequency,
        allowDiscounts: c.allowDiscounts,
        maxDiscountPct: c.maxDiscountPct,
        overrideDiscountPct: c.overrideDiscountPct,
        approvalThresholdPct: c.approvalThresholdPct,
        invoicePrefix: c.invoicePrefix,
        invoiceStartNumber: c.invoiceStartNumber,
        upiVpa: c.upiVpa?.trim() || null,
        upiPayeeName: c.upiPayeeName?.trim() || null,
        bankAccountName: c.bankAccountName?.trim() || null,
        bankAccountNumber: c.bankAccountNumber?.trim() || null,
        bankIfsc: c.bankIfsc?.trim() || null,
        bankName: c.bankName?.trim() || null,
        invoiceOnFullPaymentOnly: c.invoiceOnFullPaymentOnly ?? false,
      })
      .pipe(busyWhile(this.savingConfig))
      .subscribe({
        next: () => {
          this.toasts.success("Billing config saved");
          this.loadConfig();
          this.syncBankDetails(bankDetailsLine(c));
        },
        error: (e) => this.toasts.error(ApiError.from(e).message),
      });
  }
}
