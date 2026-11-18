import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { OrderIdFormatCardComponent } from '../../../shared/components/order-id-format-card/order-id-format-card.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';

/**
 * Settings → OPD → Visit numbers (`/admin/opd/numbers`): how the OPD visit number reads (`OPD-2611-000123` until the
 * clinic saves its own). Order IDs per module (2026-11-18): this is OPD's "order ID". Counted per branch, as before.
 * The page sits behind the OPD gate (adminGuard + opdGuard — pf.opd() / the tenant's OPD entitlement).
 */
@Component({
  selector: 'pf-opd-numbers-page',
  standalone: true,
  imports: [SettingGroupComponent, OrderIdFormatCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pf-sgrid">
      <pf-setting-group label="Visit numbers" scope="per branch" id="visit" [wide]="true"
                        icon="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 3h6v4H9zM9 12h6M9 16h4">
        <pf-order-id-format-card module="opd"></pf-order-id-format-card>
      </pf-setting-group>
    </div>
  `,
})
export class OpdNumbersPage {
  private readonly fmt = viewChild(OrderIdFormatCardComponent);
  readonly unsavedLabel = 'the visit number format';
  hasUnsavedChanges(): boolean { return !!this.fmt()?.dirty(); }
}
