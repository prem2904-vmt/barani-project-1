import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent B (front desk). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-book-visit',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdBookVisitPage {
  readonly title = "Book a visit";
  readonly subtitle = "Patient, doctor or department, purpose, optional lab tests, vitals.";
  readonly plan: string[] = ["Fee from the service or doctor price, or the follow-up rule", "Exact desk override with a reason", "Token issued on booking", "Lab tests become a normal lab order"];
}
