import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent A (OPD Master). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-departments',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdDepartmentsPage {
  readonly title = "OPD Master";
  readonly subtitle = "Departments and their services.";
  readonly plan: string[] = ["Departments with a default consult form", "Services per department: consultation or procedure", "Price: common, or per doctor", "Follow-up rule: within N days, fee (desk can override the exact amount)"];
}
