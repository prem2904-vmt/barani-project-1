import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent D (pharmacy). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-pharmacy-dispense',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class PharmacyDispensePage {
  readonly title = "Dispense";
  readonly subtitle = "Dispense a prescription.";
  readonly plan: string[] = ["Quantity from the Rx schedule", "Batch pick: earliest expiry or pharmacist pick", "Schedule H, H1 and X checks, H1 register"];
}
