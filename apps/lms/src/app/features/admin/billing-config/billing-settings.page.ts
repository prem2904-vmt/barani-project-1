import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { VendorsComponent } from '../vendors/vendors.component';
import { BillingConfigComponent } from './billing-config.component';
import { PaymentRulesCardComponent } from './payment-rules.component';

/** The categories the Settings left panel lists for Organization › Billing and taxes (`?tab=`). */
import { BILLING_SECTIONS } from '../settings/settings-map';
export { BILLING_SECTIONS };
export type BillingSection = typeof BILLING_SECTIONS[number]['id'];

/** Old `?tab=` values (the three-tab Billing Config page) land on their new category. */
export function billingSectionOf(tab: string | null | undefined): BillingSection {
  if (tab === 'discounts') return 'gst';
  return BILLING_SECTIONS.some(s => s.id === tab) ? (tab as BillingSection) : 'gst';
}

/**
 * Settings → Organization → Billing and taxes (`/admin/billing?tab=gst|invoice|payments|credit`). One host; each category
 * reuses the existing screen:
 *  - GST and discounts, Invoices and bill design: Billing Config (pinned to that section).
 *  - Payment rules: the two rules moved here from Lab settings (`PaymentRulesCardComponent`).
 *  - Credit accounts: vendor wallets, SETUP only (name, code, contact, GSTIN, address, opening settlement, alert
 *    threshold). Top-ups, payments and statements are on the Finance screen (`/finance/credit-accounts`).
 */
@Component({
  selector: 'pf-billing-settings',
  standalone: true,
  imports: [BillingConfigComponent, PaymentRulesCardComponent, VendorsComponent, HeroBandComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (section()) {
      @case ('payments') {
        <section class="pf-band-page px-4 md:px-8 pt-6 pb-10" data-testid="billing-payments">
          <pf-hero-band [back]="true" [tabsOnly]="true"></pf-hero-band>
          <div class="pf-band-body"><pf-payment-rules-card></pf-payment-rules-card></div>
        </section>
      }
      @case ('credit') { <pf-vendors [view]="'setup'"></pf-vendors> }
      @default { <pf-billing-config [section]="section() === 'invoice' ? 'invoice' : 'gst'"></pf-billing-config> }
    }
  `,
})
export class BillingSettingsPage {
  private readonly route = inject(ActivatedRoute);
  private readonly tab = toSignal(this.route.queryParamMap.pipe(map(q => q.get('tab'))), { initialValue: this.route.snapshot.queryParamMap.get('tab') });
  readonly section = computed<BillingSection>(() => billingSectionOf(this.tab()));
}
