import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ApiService } from '../../../core/services/api.service';
import { ToastService } from '../../../core/services/toast.service';
import { generateInvoicePdf, loadImageDataUrl, InvoiceTemplateStyle } from '../../frontdesk/billing/invoice-pdf';
import { Bill } from '../../../shared/models/bill.model';
import { Order } from '../../../shared/models/order.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { Branch } from '../../../shared/models/tenant.model';
import { NumberInputComponent } from '../../../shared/primitives/number-input.component';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';
import { ImageUploadComponent } from '../report-template/image-upload.component';
import { environment } from '../../../../environments/environment';
import { ThemeService } from '../../../core/services/theme.service';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SettingsJumpComponent, SettingsSection } from '../../../shared/components/settings-page/settings-jump.component';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';

type GstScope = 'branch' | 'region' | 'tenant';

interface TenantBillingConfig {
  id?: string;
  tenantId: string;
  gstEnabled: boolean;
  gstScope: GstScope;
  filingFrequency: 'monthly' | 'quarterly';
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
  selector: 'pf-billing-config',
  standalone: true,
  imports: [
    FormsModule,
    NumberInputComponent,
    ScreenHeaderComponent,
    SegmentedComponent,
    SelectComponent,
    TouchButtonComponent,
    ImageUploadComponent,
    HeroBandComponent,
    SettingsJumpComponent,
    SettingAnchorDirective
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (ND-PATTERN "Admin pages"): no tabs — the pill names the page;
             Save (the whole billing config) is the ONE primary. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <h1 class="nd-band-page">Billing settings</h1>
          </ng-container>
          <ng-container band-actions>
            <button type="button" class="pf-hb-btn pf-hb-btn--primary press" (click)="saveConfig()"
                    aria-label="Save billing settings" title="Save billing settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/>
              </svg>
              Save
            </button>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin"
        title="Billing settings"
        subtitle="GST, discounts, bill number and bill look.">
        <pf-touch-btn actions size="sm" variant="primary" (pressed)="saveConfig()">
          <span icon-left aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <path d="M17 21v-8H7v8"/>
              <path d="M7 3v5h8"/>
            </svg>
          </span>
          Save
        </pf-touch-btn>
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="nd-setpage nd-setpage--jump">
        <pf-settings-jump [sections]="sections"></pf-settings-jump>
        <div class="nd-setcol">

        <!-- ── GST ── -->
        <section class="nd-card nd-setsec" id="sec-gst" aria-labelledby="bc-h-gst">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM17.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/></svg></span>
            <h2 class="nd-card__label" id="bc-h-gst">GST</h2>
          </header>
          <div pfSettingAnchor="gst">
            <div class="nd-set">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-gst-on">Charge GST</p>
                <p class="nd-set__help">Off prints bills as "Bill of Supply", with no tax.</p>
              </div>
              <div class="nd-set__ctl">
                <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="!!(config().gstEnabled)" aria-labelledby="bc-gst-on"
                  (click)="patch({ gstEnabled: !config().gstEnabled })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
              </div>
            </div>
            <div class="nd-set nd-set--sub" [class.nd-set--off]="!config().gstEnabled" [attr.inert]="config().gstEnabled ? null : ''">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-gst-scope">GST filed for</p>
                <p class="nd-set__help">Where your GST returns are filed.</p>
              </div>
              <div class="nd-set__ctl">
                <pf-segmented size="sm" [options]="scopeOptions" [value]="config().gstScope"
                              ariaLabelledby="bc-gst-scope"
                              (valueChange)="patch({ gstScope: $event })"></pf-segmented>
              </div>
            </div>
            <div class="nd-set nd-set--sub" [class.nd-set--off]="!config().gstEnabled" [attr.inert]="config().gstEnabled ? null : ''">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-gst-freq">How often you file</p>
                <p class="nd-set__help">Monthly or every three months.</p>
              </div>
              <div class="nd-set__ctl pf-bc-selectw" role="group" aria-labelledby="bc-gst-freq">
                <pf-select
                  [options]="filingFrequencyOptions"
                  [value]="config().filingFrequency"
                  (valueChange)="patch({ filingFrequency: $event })">
                </pf-select>
              </div>
            </div>
          </div>

          <div class="nd-set" pfSettingAnchor="gstin">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-gstin">GST number per branch</p>
              <p class="nd-set__help">Each branch's GSTIN and state code. Save each row.</p>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide">
              @if (branches().length === 0) {
                <p class="nd-set__help">No branches yet.</p>
              } @else {
                <div class="pf-bc-gstlist" role="list" aria-labelledby="bc-gstin">
                  @for (b of branches(); track b.id) {
                    <div class="pf-gst-row" role="listitem">
                      <div class="pf-gst-row__name">
                        <p class="pf-bc-bname">{{ b.name }}</p>
                        <p class="pf-bc-bcode nd-num">{{ b.code }}</p>
                      </div>
                      <label class="nd-field pf-gst-row__f">
                        <span class="nd-field__lbl">GSTIN</span>
                        <input type="text" class="nd-input w-full" placeholder="33ABCDE1234F1Z5" autocapitalize="characters" spellcheck="false"
                               [ngModel]="gstinFor(b.id)" (ngModelChange)="setGstin(b.id, $event)" />
                      </label>
                      <label class="nd-field pf-gst-row__s">
                        <span class="nd-field__lbl">State code</span>
                        <input type="text" inputmode="numeric" class="nd-input w-full" placeholder="33"
                               [ngModel]="stateCodeFor(b.id)" (ngModelChange)="setStateCode(b.id, $event)" />
                      </label>
                      <button type="button" class="nd-btn nd-btn--secondary pf-gst-row__save press"
                              [disabled]="!hasGstinFor(b.id)" (click)="saveGstin(b.id)"
                              [attr.aria-label]="'Save GST number for ' + b.name">Save</button>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </section>

        <!-- ── Discounts ── -->
        <section class="nd-card nd-setsec" id="sec-discounts" aria-labelledby="bc-h-disc">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01"/></svg></span>
            <h2 class="nd-card__label" id="bc-h-disc">Discounts</h2>
          </header>
          <div pfSettingAnchor="discounts">
            <div class="nd-set">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-disc-on">Allow discounts</p>
                <p class="nd-set__help">Off stops every discount on every bill.</p>
              </div>
              <div class="nd-set__ctl">
                <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="!!(config().allowDiscounts)" aria-labelledby="bc-disc-on"
                  (click)="patch({ allowDiscounts: !config().allowDiscounts })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
              </div>
            </div>
            <div class="nd-set nd-set--sub" [class.nd-set--off]="!config().allowDiscounts">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-disc-l1">Front desk can give up to</p>
                <p class="nd-set__help">Largest discount for staff who give discounts.</p>
              </div>
              <div class="nd-set__ctl pf-bc-numw" role="group" aria-labelledby="bc-disc-l1">
                <pf-number-input ariaLabelledby="bc-disc-l1" [value]="config().maxDiscountPct" [min]="0" [max]="100" [step]="1" suffix="%"
                  [disabled]="!config().allowDiscounts" (valueChange)="patch({ maxDiscountPct: $event ?? 0 })"></pf-number-input>
              </div>
            </div>
            <div class="nd-set nd-set--sub" [class.nd-set--off]="!config().allowDiscounts">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-disc-l2">Senior staff can give up to</p>
                <p class="nd-set__help">Largest discount for staff allowed to override.</p>
              </div>
              <div class="nd-set__ctl pf-bc-numw" role="group" aria-labelledby="bc-disc-l2">
                <pf-number-input ariaLabelledby="bc-disc-l2" [value]="config().overrideDiscountPct" [min]="0" [max]="100" [step]="1" suffix="%"
                  [disabled]="!config().allowDiscounts" (valueChange)="patch({ overrideDiscountPct: $event ?? 0 })"></pf-number-input>
              </div>
            </div>
            <div class="nd-set nd-set--sub" [class.nd-set--off]="!config().allowDiscounts">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-disc-appr">Second approval above</p>
                <p class="nd-set__help">Bigger discounts need a second person to approve.</p>
              </div>
              <div class="nd-set__ctl pf-bc-numw" role="group" aria-labelledby="bc-disc-appr">
                <pf-number-input ariaLabelledby="bc-disc-appr" [value]="config().approvalThresholdPct" [min]="0" [max]="100" [step]="1" suffix="%"
                  [disabled]="!config().allowDiscounts" (valueChange)="patch({ approvalThresholdPct: $event ?? 0 })"></pf-number-input>
              </div>
            </div>
          </div>
        </section>

        <!-- ── Bill: number, proforma, UPI, bank ── -->
        <section class="nd-card nd-setsec" id="sec-bill" aria-labelledby="bc-h-bill">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v16l-3-2-2 2-3-2-3 2-2-2-3 2zM8 9h8M8 13h5"/></svg></span>
            <h2 class="nd-card__label" id="bc-h-bill">Bill</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="invoice-number">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-inv">Bill number</p>
              <p class="nd-set__help">The start of the bill number, then the first number.</p>
              <p class="nd-set__preview">Looks like: <strong>{{ invoicePreview() }}</strong></p>
            </div>
            <div class="nd-set__ctl">
              <label class="nd-field pf-bc-f">
                <span class="nd-field__lbl">Starts with</span>
                <input type="text" class="nd-input" id="bc-inv-prefix"
                       [ngModel]="config().invoicePrefix"
                       (ngModelChange)="patch({ invoicePrefix: $event })" />
              </label>
              <div class="nd-field pf-bc-f" role="group" aria-labelledby="bc-inv-start">
                <span class="nd-field__lbl" id="bc-inv-start">First number</span>
                <pf-number-input ariaLabelledby="bc-inv-start" [value]="config().invoiceStartNumber" [min]="1" [step]="1"
                  (valueChange)="patch({ invoiceStartNumber: $event ?? 1 })"></pf-number-input>
              </div>
            </div>
          </div>

          <div class="nd-set" pfSettingAnchor="proforma">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-proforma">Bill only when fully paid</p>
              <p class="nd-set__help">Until paid, the patient gets an estimate, not a bill.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="!!(config().invoiceOnFullPaymentOnly ?? false)" aria-labelledby="bc-proforma"
                (click)="patch({ invoiceOnFullPaymentOnly: !(config().invoiceOnFullPaymentOnly ?? false) })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          </div>

          <div class="nd-set" pfSettingAnchor="upi">
            <div class="nd-set__text">
              <p class="nd-set__label">UPI payment</p>
              <p class="nd-set__help">Patients can pay by UPI. Blank hides it.</p>
            </div>
            <div class="nd-set__ctl">
              <label class="nd-field pf-bc-f">
                <span class="nd-field__lbl">UPI ID</span>
                <input type="text" class="nd-input" placeholder="clinic@axis" autocapitalize="none" spellcheck="false"
                       [ngModel]="config().upiVpa || ''" (ngModelChange)="patch({ upiVpa: $event })" />
              </label>
              <label class="nd-field pf-bc-f">
                <span class="nd-field__lbl">Name shown</span>
                <input type="text" class="nd-input" placeholder="Prefrontal Lab"
                       [ngModel]="config().upiPayeeName || ''" (ngModelChange)="patch({ upiPayeeName: $event })" />
              </label>
            </div>
          </div>

          <div class="nd-set" pfSettingAnchor="bank">
            <div class="nd-set__text">
              <p class="nd-set__label">Bank account</p>
              <p class="nd-set__help">Where your money goes. All optional.</p>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide pf-bc-grid">
              <label class="nd-field">
                <span class="nd-field__lbl">Account holder</span>
                <input type="text" class="nd-input" placeholder="Prefrontal Diagnostics Pvt Ltd"
                       [ngModel]="config().bankAccountName || ''" (ngModelChange)="patch({ bankAccountName: $event })" />
              </label>
              <label class="nd-field">
                <span class="nd-field__lbl">Account number</span>
                <input type="text" inputmode="numeric" class="nd-input nd-num" placeholder="0123456789" autocapitalize="none" spellcheck="false"
                       [ngModel]="config().bankAccountNumber || ''" (ngModelChange)="patch({ bankAccountNumber: $event })" />
              </label>
              <label class="nd-field">
                <span class="nd-field__lbl">IFSC</span>
                <input type="text" class="nd-input" placeholder="HDFC0001234" autocapitalize="characters" spellcheck="false"
                       [ngModel]="config().bankIfsc || ''" (ngModelChange)="patch({ bankIfsc: $event })" />
              </label>
              <label class="nd-field">
                <span class="nd-field__lbl">Bank name</span>
                <input type="text" class="nd-input" placeholder="HDFC Bank"
                       [ngModel]="config().bankName || ''" (ngModelChange)="patch({ bankName: $event })" />
              </label>
            </div>
          </div>
        </section>

        <!-- ── Bill look: style, size, letterhead, preview ── -->
        <section class="nd-card nd-setsec" id="sec-look" aria-labelledby="bc-h-look">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h11l5 5v11H4zM15 4v5h5M8 14h8M8 18h6"/></svg></span>
            <h2 class="nd-card__label" id="bc-h-look">Bill look</h2>
            <span class="nd-card__spacer"></span>
            <!-- Secondary: the band's Save (billing settings) is the ONE primary;
                 the letterhead is a separate record with its own save. -->
            <button type="button" class="nd-btn nd-btn--secondary pf-save-letterhead press" [disabled]="savingTpl()" (click)="saveTpl()">{{ savingTpl() ? 'Saving…' : 'Save bill look' }}</button>
          </header>
          <div class="nd-set" pfSettingAnchor="bill-template">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-tpl">Bill style</p>
              <p class="nd-set__help">How the printed bill looks.</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" [options]="templateStyleOptions" [value]="tpl().template ?? 'classic'"
                            ariaLabelledby="bc-tpl" (valueChange)="patchTpl({ template: $event })"></pf-segmented>
            </div>
          </div>
          @if ((tpl().template ?? 'classic') === 'cashbill') {
            <div class="nd-set nd-set--sub">
              <div class="nd-set__text">
                <p class="nd-set__label" id="bc-paper">Paper size</p>
                <p class="nd-set__help">A4 sheet or a receipt roll.</p>
              </div>
              <div class="nd-set__ctl">
                <pf-segmented size="sm" [options]="paperSizeOptions" [value]="tpl().paperSize ?? 'a4'"
                              ariaLabelledby="bc-paper" (valueChange)="patchTpl({ paperSize: $event })"></pf-segmented>
              </div>
            </div>
          }

          <div class="nd-set" pfSettingAnchor="letterhead">
            <div class="nd-set__text">
              <p class="nd-set__label">Bill letterhead</p>
              <p class="nd-set__help">Name, address and notes printed on each bill.</p>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide pf-bc-grid">
              <label class="nd-field"><span class="nd-field__lbl">Lab name</span><input class="nd-input" [ngModel]="tpl().labName" (ngModelChange)="patchTpl({ labName: $event })" placeholder="Prefrontal Lab"/></label>
              <label class="nd-field"><span class="nd-field__lbl">GSTIN on bill</span><input class="nd-input" [ngModel]="tpl().gstin" (ngModelChange)="patchTpl({ gstin: $event })" placeholder="Optional"/></label>
              <label class="nd-field pf-bc-span"><span class="nd-field__lbl">Address</span><input class="nd-input" [ngModel]="tpl().address" (ngModelChange)="patchTpl({ address: $event })"/></label>
              <label class="nd-field"><span class="nd-field__lbl">Phone</span><input type="tel" class="nd-input" [ngModel]="tpl().phone" (ngModelChange)="patchTpl({ phone: $event })"/></label>
              <label class="nd-field"><span class="nd-field__lbl">Email</span><input type="email" autocapitalize="none" class="nd-input" [ngModel]="tpl().email" (ngModelChange)="patchTpl({ email: $event })"/></label>
              <div class="nd-field" role="group" aria-labelledby="bc-doctype"><span class="nd-field__lbl" id="bc-doctype">Bill title</span>
                <pf-select [options]="documentModeOptions" [value]="tpl().documentMode ?? 'auto'"
                           (valueChange)="patchTpl({ documentMode: $event })"></pf-select>
              </div>
              <label class="nd-field"><span class="nd-field__lbl">Accent colour</span><input class="nd-input pf-bc-color" type="color" [ngModel]="tpl().accentColor || '#1B3A6B'" (ngModelChange)="patchTpl({ accentColor: $event })"/></label>
              <label class="nd-field"><span class="nd-field__lbl">Signature line</span><input class="nd-input" [ngModel]="tpl().signatureLabel" (ngModelChange)="patchTpl({ signatureLabel: $event })" placeholder="Authorised Signatory"/></label>
              <label class="nd-field"><span class="nd-field__lbl">Court city</span><input class="nd-input" [ngModel]="tpl().jurisdiction" (ngModelChange)="patchTpl({ jurisdiction: $event })" placeholder="e.g. Chennai"/></label>
              <div class="nd-field pf-bc-span">
                <span class="nd-field__lbl">Logo</span>
                <pf-image-upload [url]="tpl().logoUrl" (urlChange)="patchTpl({ logoUrl: $event })"></pf-image-upload>
                <input class="nd-input mt-2" aria-label="Logo web address" [ngModel]="tpl().logoUrl" (ngModelChange)="patchTpl({ logoUrl: $event })" placeholder="https://…/logo.png  (or upload above)"/>
              </div>
              <label class="nd-field pf-bc-span"><span class="nd-field__lbl">Bank details line</span><input class="nd-input" [ngModel]="tpl().bankDetails" (ngModelChange)="patchTpl({ bankDetails: $event })" placeholder="A/c · IFSC · Bank"/></label>
              <label class="nd-field pf-bc-span"><span class="nd-field__lbl">Declaration</span><input class="nd-input" [ngModel]="tpl().declaration" (ngModelChange)="patchTpl({ declaration: $event })" placeholder="Certified that the particulars given above are true and correct."/></label>
              <label class="nd-field pf-bc-span"><span class="nd-field__lbl">Footer</span><input class="nd-input" [ngModel]="tpl().footerText" (ngModelChange)="patchTpl({ footerText: $event })"/></label>
            </div>
          </div>

          <div class="nd-set">
            <div class="nd-set__text"><p class="nd-set__label" id="bc-show-logo">Print logo</p></div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="tpl().showLogo !== false" aria-labelledby="bc-show-logo"
                      (click)="patchTpl({ showLogo: tpl().showLogo === false })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          </div>
          <div class="nd-set">
            <div class="nd-set__text"><p class="nd-set__label" id="bc-show-gstin">Print GST number</p></div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="tpl().showGstin !== false" aria-labelledby="bc-show-gstin"
                      (click)="patchTpl({ showGstin: tpl().showGstin === false })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          </div>
          <div class="nd-set">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-show-qr">Print result QR code</p>
              <p class="nd-set__help">Patients scan it to see their results.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-bc-sw" role="switch" [attr.aria-checked]="tpl().showTrackingQr !== false" aria-labelledby="bc-show-qr"
                      (click)="patchTpl({ showTrackingQr: tpl().showTrackingQr === false })"><span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span></button>
            </div>
          </div>

          <!-- Live bill preview -->
          <div class="nd-set">
            <div class="nd-set__text">
              <p class="nd-set__label" id="bc-prev">Preview</p>
              <p class="nd-set__help">A sample bill with your settings.</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" [options]="previewModeOptions" [value]="previewMode()"
                            ariaLabelledby="bc-prev" (valueChange)="setPreviewMode($event)"></pf-segmented>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide">
              @if (invoicePreviewUrl(); as src) {
                <div class="pf-invoice-viewport" [style.--pf-inv-scale]="invoicePreviewScale()">
                  <div class="pf-invoice-stage">
                    <iframe [src]="src" title="Bill preview" class="pf-invoice-iframe" style="width:100%;height:62dvh;border:1px solid var(--nd-line);border-radius:12px;background:#525659"></iframe>
                  </div>
                </div>
              } @else {
                <p class="nd-set__help pf-bc-rendering">Making the preview…</p>
              }
            </div>
          </div>
        </section>

        </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    /* One scrolling page (ND-PATTERN "Admin pages"); rows come from the kit. */
    .pf-bc-selectw { min-width: 200px; }
    .pf-bc-numw { width: 160px; }
    .pf-bc-f { width: 200px; }
    .pf-bc-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .pf-bc-span { grid-column: 1 / -1; }
    .pf-bc-gstlist { display: flex; flex-direction: column; gap: 8px; }
    .pf-gst-row {
      display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1.4fr) minmax(0, 0.8fr) auto; gap: 10px; align-items: end;
      padding: 10px 12px; border-radius: var(--nd-radius-sm, 10px);
      background: var(--nd-card-bg); border: 1px solid var(--nd-line);
    }
    .pf-gst-row__name { align-self: center; min-width: 0; }
    .pf-gst-row__save { height: 40px; }
    .pf-bc-bname { margin: 0; font-size: 14px; font-weight: 500; color: var(--text-primary); overflow-wrap: anywhere; }
    .pf-bc-bcode { margin: 0; font-size: 12px; color: var(--text-tertiary); }
    .pf-bc-rendering { padding: 24px 0; text-align: center; }
    .pf-bc-sw { flex-shrink: 0; }
    .pf-save-letterhead { height: 32px; }
    @media (max-width: 640px) {
      .pf-bc-grid { grid-template-columns: minmax(0, 1fr); }
      .pf-gst-row { grid-template-columns: minmax(0, 1fr); }
      .pf-bc-f, .pf-bc-numw, .pf-bc-selectw { width: 100%; min-width: 0; }
    }
    .pf-bc-color { height: 40px; padding: 4px; }

    /* Desktop/iPad: the scale wrappers are transparent — the iframe keeps its
       original width:100% / height:62dvh behaviour. They only become real
       (scaling) boxes at ≤640px below, so the desktop preview is unchanged. */
    .pf-invoice-viewport,
    .pf-invoice-stage { display: contents; }

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
      :host .pf-gst-row__save { min-height: 44px; }
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
      :host .pf-bc-sw { min-height: 44px; }
    }
  `]
})
export class BillingConfigComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly theme = inject(ThemeService);

  /** Invoice document type (was a native select). */
  readonly documentModeOptions: PfSelectOption<string>[] = [
    { value: 'auto',           label: 'Auto (by GST)' },
    { value: 'tax_invoice',    label: 'Tax Invoice' },
    { value: 'bill_of_supply', label: 'Bill of Supply' },
  ];

  /** Sections of the one scrolling page (desktop jump list). */
  readonly sections: SettingsSection[] = [
    { id: 'sec-gst', label: 'GST' },
    { id: 'sec-discounts', label: 'Discounts' },
    { id: 'sec-bill', label: 'Bill' },
    { id: 'sec-look', label: 'Bill look' },
  ];

  readonly scopeOptions: SegmentedOption<GstScope>[] = [
    { value: 'branch', label: 'Each branch' },
    { value: 'region', label: 'Each region' },
    { value: 'tenant', label: 'Whole lab' },
  ];

  readonly filingFrequencyOptions: PfSelectOption<'monthly' | 'quarterly'>[] = [
    { value: 'monthly',   label: 'Every month' },
    { value: 'quarterly', label: 'Every 3 months' }
  ];

  private readonly _config = signal<TenantBillingConfig>({
    tenantId: '',
    gstEnabled: true,
    gstScope: 'branch',
    filingFrequency: 'monthly',
    allowDiscounts: true,
    maxDiscountPct: 10,
    overrideDiscountPct: 25,
    approvalThresholdPct: 50,
    invoicePrefix: 'INV',
    invoiceStartNumber: 1000
  });
  readonly config = this._config.asReadonly();
  patch(p: Partial<TenantBillingConfig>) { this._config.update(c => ({ ...c, ...p })); }

  private readonly _branches = signal<Branch[]>([]);
  readonly branches = this._branches.asReadonly();

  private readonly _gstinByBranch = signal<Map<string, GstRow>>(new Map());

  readonly invoicePreview = computed(() => {
    const c = this._config();
    const year = new Date().getFullYear();
    return `${c.invoicePrefix}/${year}/${c.invoiceStartNumber}`;
  });

  // Invoice letterhead/template
  private readonly TPL_DEFAULTS = { documentMode: 'auto', showGstin: true, showTrackingQr: true, template: 'classic', accentColor: '#1B3A6B', showLogo: true };
  private readonly _tpl = signal<any>({ ...this.TPL_DEFAULTS });
  readonly tpl = this._tpl.asReadonly();
  readonly savingTpl = signal(false);
  readonly templateStyles: Array<{ value: InvoiceTemplateStyle; label: string }> = [
    { value: 'classic', label: 'Classic' },
    { value: 'modern', label: 'Modern' },
    { value: 'letterhead', label: 'Letterhead' },
    { value: 'cashbill', label: 'Cash Bill' },
  ];
  readonly paperSizes: Array<{ value: 'a4' | 'thermal' | 'thermal_3in' | 'thermal_25in'; label: string }> = [
    { value: 'a4',           label: 'A4 sheet' },
    { value: 'thermal',      label: 'Receipt 4"' },
    { value: 'thermal_3in',  label: 'Receipt 3"' },
    { value: 'thermal_25in', label: 'Receipt 2.5"' },
  ];
  readonly templateStyleOptions: SegmentedOption<InvoiceTemplateStyle>[] = this.templateStyles.map(s => ({ value: s.value, label: s.label }));
  readonly paperSizeOptions: SegmentedOption<string>[] = this.paperSizes.map(p => ({ value: p.value, label: p.label }));
  readonly previewModeOptions: SegmentedOption<'tax_invoice' | 'bill_of_supply'>[] = [
    { value: 'bill_of_supply', label: 'Bill of Supply' },
    { value: 'tax_invoice', label: 'Tax Invoice' },
  ];
  patchTpl(p: Record<string, unknown>) { this._tpl.set({ ...this._tpl(), ...p }); }
  saveTpl() {
    this.savingTpl.set(true);
    this.api.post('/api/config/invoice-template', this._tpl()).subscribe({
      next: () => { this.savingTpl.set(false); this.toasts.success('Letterhead saved'); },
      error: e => { this.savingTpl.set(false); this.toasts.error(ApiError.from(e).message); }
    });
  }

  // ── Live invoice preview (right pane) ──────────────────────────
  readonly previewMode = signal<'tax_invoice' | 'bill_of_supply'>('bill_of_supply');
  readonly invoicePreviewUrl = signal<SafeResourceUrl | null>(null);
  private previewBlob: string | null = null;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Re-render the preview (debounced) whenever the template or mode changes.
    effect(() => {
      const t = this._tpl();
      const mode = this.previewMode();
      void t; void mode;
      if (this.renderTimer) clearTimeout(this.renderTimer);
      this.renderTimer = setTimeout(() => this.renderInvoicePreview(), 300);
    });
  }

  setPreviewMode(m: 'tax_invoice' | 'bill_of_supply') { this.previewMode.set(m); }

  /** Fit-to-width scale for the phone invoice preview. The PDF iframe renders
   *  the A4 page at its intrinsic ~794px CSS width (595.28pt × 96/72); on a
   *  narrow screen we scale it down to the tile's content width so the whole
   *  bill is visible with nothing clipped on the right ("MicroLab", "CASH B").
   *  Capped at 1 so it never upscales. Only consumed by the ≤640px CSS. */
  invoicePreviewScale(): number {
    const w = typeof window !== 'undefined' ? window.innerWidth : 794;
    return Math.min(1, Math.max(0.1, (w - 64) / 794));
  }

  // Sample QR data URLs so the preview shows the tracking + order QRs the
  // real invoice carries. Generated once, lazily.
  private _sampleQrs: { qr: string; orderQr: string } | null = null;
  private async sampleQrs(): Promise<{ qr: string; orderQr: string }> {
    if (this._sampleQrs) return this._sampleQrs;
    const QRCode = (await import('qrcode')).default;
    const [qr, orderQr] = await Promise.all([
      QRCode.toDataURL('https://example.lab/track/SAMPLE', { margin: 1, width: 220 }),
      QRCode.toDataURL('https://example.lab/o/SAMPLE', { margin: 1, width: 220 }),
    ]);
    this._sampleQrs = { qr, orderQr };
    return this._sampleQrs;
  }

  private async renderInvoicePreview() {
    const t = this._tpl();
    const taxMode = this.previewMode() === 'tax_invoice';
    const { bill, order } = this.sampleBill(taxMode);
    const logoDataUrl = t.showLogo === false ? undefined : await loadImageDataUrl(t.logoUrl || undefined, environment.apiUrl);
    const qrs = await this.sampleQrs();
    try {
      const blob = generateInvoicePdf({
        bill, order,
        invoiceNumber: `${this._config().invoicePrefix}/${new Date().getFullYear()}/${this._config().invoiceStartNumber}`,
        effectivePayable: bill.totalPayable,
        tatLabel: '~ 1 day to report',
        docTitle: taxMode ? 'TAX INVOICE' : 'BILL OF SUPPLY',
        practice: { name: t.labName || 'Prefrontal Lab', address: t.address, phone: t.phone, email: t.email, gstin: t.gstin },
        template: (t.template ?? 'classic') as InvoiceTemplateStyle,
        paperSize: (t.paperSize ?? 'a4') as 'a4' | 'thermal' | 'thermal_3in' | 'thermal_25in',
        accentColor: t.accentColor, logoDataUrl,
        qrDataUrl: qrs.qr, orderQrDataUrl: qrs.orderQr,
        tagline: t.tagline, footerText: t.footerText, bankDetails: t.bankDetails,
        signatureLabel: t.signatureLabel, jurisdiction: t.jurisdiction, declaration: t.declaration,
        cashierName: 'sathyapriya',
        action: 'blob',
      }) as string | undefined;
      if (!blob) return;
      if (this.previewBlob) { try { URL.revokeObjectURL(this.previewBlob); } catch { /* noop */ } }
      this.previewBlob = blob;
      this.invoicePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(blob));
    } catch { /* preview is best-effort */ }
  }

  /** Sample bill for the preview. With tax for the Tax-Invoice preview, exempt
   *  (no tax) for the Bill-of-Supply preview. */
  private sampleBill(withTax: boolean): { bill: Bill; order: Order } {
    const items = [
      { name: 'Complete Blood Count (CBC)', hsn: '999316', price: 350 },
      { name: 'Lipid Profile', hsn: '999316', price: 600 },
    ];
    const slab = withTax ? 18 : 0;
    const billItems = items.map((it, i) => {
      const taxable = it.price;
      const tax = Math.round(taxable * slab / 100);
      const half = Math.round(tax / 2);
      return {
        id: `i${i}`, billId: 'b', testId: `t${i}`, testName: it.name, hsnSacCode: it.hsn,
        price: it.price, discount: 0, taxableAmount: taxable, taxSlab: slab,
        cgstRate: slab / 2, sgstRate: slab / 2, igstRate: 0,
        cgstAmount: half, sgstAmount: tax - half, igstAmount: 0, total: taxable + tax,
      };
    });
    const subTotal = billItems.reduce((s, i) => s + i.price, 0);
    const totalTax = billItems.reduce((s, i) => s + i.cgstAmount + i.sgstAmount + i.igstAmount, 0);
    const bill = {
      id: 'b', orderId: 'o', patientId: 'p', branchId: 'br', type: withTax ? 'tax_invoice' : 'bill_of_supply',
      invoiceNumber: 'PREVIEW', supplierGstin: this._tpl().gstin, placeOfSupply: 'Tamil Nadu (33)', isInterstate: false,
      subTotal, overrideDiscount: 0, totalDiscount: 0, totalTaxable: subTotal,
      totalCgst: billItems.reduce((s, i) => s + i.cgstAmount, 0), totalSgst: billItems.reduce((s, i) => s + i.sgstAmount, 0),
      totalIgst: 0, totalTax, totalPayable: subTotal + totalTax, totalPaid: subTotal + totalTax, balance: 0,
      status: 'paid', items: billItems as Bill['items'], createdAt: new Date().toISOString(),
      payments: [{ id: 'pay1', billId: 'b', amount: subTotal + totalTax, mode: 'online', referenceNo: 'B255173', paidAt: new Date().toISOString() }],
    } as Bill;
    const order = {
      id: 'order-26057734', refDoctorName: 'Dr. D. Satheesh Kumar MD',
      patient: { mrn: 'TRY00928929', displayName: 'Aarav Sharma', age: 32, sex: 'Male', phone: '98765 43210' },
      samples: [{ barcode: '26057734' }],
    } as unknown as Order;
    return { bill, order };
  }

  closeInvoicePreview() {
    if (this.previewBlob) { try { URL.revokeObjectURL(this.previewBlob); } catch { /* noop */ } this.previewBlob = null; }
    this.invoicePreviewUrl.set(null);
  }
  ngOnDestroy() { if (this.renderTimer) clearTimeout(this.renderTimer); this.closeInvoicePreview(); }

  ngOnInit() {
    this.api.get<TenantBillingConfig>('/api/config/billing').subscribe({
      next: c => { if (c) this._config.set({ ...this._config(), ...c }); }
    });
    this.api.get<any>('/api/config/invoice-template').subscribe({
      next: t => { this._tpl.set({ ...this.TPL_DEFAULTS, ...(t ?? {}) }); }
    });
    this.api.get<Branch[]>('/api/tenants/branches').subscribe({
      next: l => this._branches.set(l ?? [])
    });
  }

  gstinFor(bid: string): string { return this._gstinByBranch().get(bid)?.gstin ?? ''; }
  stateCodeFor(bid: string): string { return this._gstinByBranch().get(bid)?.stateCode ?? ''; }
  hasGstinFor(bid: string): boolean {
    const r = this._gstinByBranch().get(bid);
    return !!(r?.gstin && r?.stateCode);
  }
  setGstin(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: '', stateCode: '' };
    map.set(bid, { ...cur, gstin: v });
    this._gstinByBranch.set(map);
  }
  setStateCode(bid: string, v: string) {
    const map = new Map(this._gstinByBranch());
    const cur = map.get(bid) ?? { branchId: bid, gstin: '', stateCode: '' };
    map.set(bid, { ...cur, stateCode: v });
    this._gstinByBranch.set(map);
  }
  saveGstin(bid: string) {
    const row = this._gstinByBranch().get(bid);
    if (!row) return;
    this.api.post('/api/config/gst', { branchId: bid, gstin: row.gstin, stateCode: row.stateCode }).subscribe({
      next: () => this.toasts.success('GSTIN saved'),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  saveConfig() {
    const c = this._config();
    this.api.post('/api/config/billing', {
      gstEnabled: c.gstEnabled,
      gstScope: c.gstScope, filingFrequency: c.filingFrequency,
      allowDiscounts: c.allowDiscounts, maxDiscountPct: c.maxDiscountPct,
      overrideDiscountPct: c.overrideDiscountPct, approvalThresholdPct: c.approvalThresholdPct,
      invoicePrefix: c.invoicePrefix, invoiceStartNumber: c.invoiceStartNumber,
      upiVpa: c.upiVpa?.trim() || null, upiPayeeName: c.upiPayeeName?.trim() || null,
      bankAccountName: c.bankAccountName?.trim() || null,
      bankAccountNumber: c.bankAccountNumber?.trim() || null,
      bankIfsc: c.bankIfsc?.trim() || null,
      bankName: c.bankName?.trim() || null,
      invoiceOnFullPaymentOnly: c.invoiceOnFullPaymentOnly ?? false
    }).subscribe({
      next: () => this.toasts.success('Billing config saved'),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }
}
