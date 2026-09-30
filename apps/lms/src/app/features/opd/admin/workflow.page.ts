import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent A (OPD Master). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-workflow',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdWorkflowPage {
  readonly title = "OPD flow";
  readonly subtitle = "Which steps run, where, and what pre-fills.";
  readonly plan: string[] = ["Vitals at the desk, at a separate station, or off", "Lab tests at the desk on or off", "Token and queue organisation", "Doctor unavailable: manual reassign, auto-move or reschedule"];
}
