import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent C (consult). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-consult-workspace',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdConsultWorkspacePage {
  readonly title = "Consult";
  readonly subtitle = "Full-screen consult.";
  readonly plan: string[] = ["Header vitals, left stepper, centre steps, right at-a-glance", "Prescription with the schedule model", "Investigations become a normal lab order", "Private notes, follow-up, complete consult"];
}
