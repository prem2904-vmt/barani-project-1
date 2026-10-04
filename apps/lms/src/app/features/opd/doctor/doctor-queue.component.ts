import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdLegacyRedirectComponent } from './legacy-redirect';

/** RETIRED — the legacy `/doctor` queue now redirects to `/opd/consult` (see legacy-redirect.ts). */
@Component({
  selector: 'pf-doctor-queue',
  standalone: true,
  imports: [OpdLegacyRedirectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-legacy-redirect></pf-opd-legacy-redirect>`,
})
export class DoctorQueueComponent {}
