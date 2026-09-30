import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdStubPageComponent } from '../shared/opd-stub-page.component';

/**
 * OPD FOUNDATION STUB — owned by Agent A (OPD Master). Routed and gated already
 * (features/opd/opd.routes.ts); replace this component's body, keep the
 * class name + file path (the route imports them).
 */
@Component({
  selector: 'pf-opd-form-library',
  standalone: true,
  imports: [OpdStubPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-stub-page [title]="title" [subtitle]="subtitle" [plan]="plan"></pf-opd-stub-page>`,
})
export class OpdFormLibraryPage {
  readonly title = "Consult forms";
  readonly subtitle = "One shared, versioned form library.";
  readonly plan: string[] = ["Department default, then service override, then doctor add-only fields", "Vitals, diagnosis, Rx, investigations and follow-up are built in, never form fields", "Past consults keep the version they were filled with"];
}
