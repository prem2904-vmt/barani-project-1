import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent A (OPD Master). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-form-builder',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdFormBuilderPage {
  readonly title = "Form builder";
  readonly subtitle = "Build and publish a form version.";
  readonly plan: string[] = ["Sections and fields", "Draft, then publish (published versions never change)"];
}
