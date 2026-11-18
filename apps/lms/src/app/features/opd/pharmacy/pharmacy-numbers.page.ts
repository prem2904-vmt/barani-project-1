import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { OrderIdFormatCardComponent } from '../../../shared/components/order-id-format-card/order-id-format-card.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';

/**
 * Settings → Pharmacy → Dispense numbers (`/admin/pharmacy/numbers`): how the dispense number reads (`PD-2611-000123`
 * until the pharmacy saves its own). Order IDs per module (2026-11-18): this is Pharmacy's "order ID". Pharmacy bills
 * (PH-…) and purchase orders (PO-…) keep their own series. Counted per branch, as before. Behind the OPD gate, like
 * every pharmacy screen.
 */
@Component({
  selector: 'pf-pharmacy-numbers-page',
  standalone: true,
  imports: [SettingGroupComponent, OrderIdFormatCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-sgrid">
      <pf-setting-group label="Dispense numbers" scope="per branch" id="dispense" [wide]="true"
                        icon="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 12h6M9 16h4">
        <pf-order-id-format-card module="pharmacy"></pf-order-id-format-card>
      </pf-setting-group>
    </div>
  `,
})
export class PharmacyNumbersPage {
  private readonly fmt = viewChild(OrderIdFormatCardComponent);
  readonly unsavedLabel = 'the dispense number format';
  hasUnsavedChanges(): boolean { return !!this.fmt()?.dirty(); }
}
