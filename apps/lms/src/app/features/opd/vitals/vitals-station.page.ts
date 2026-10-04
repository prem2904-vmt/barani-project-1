import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OpdVitalsWorkspaceComponent } from './vitals-workspace.component';

/** OPD → Vitals station (`/opd/vitals`) — AGENT B. The queue + capture
 *  workspace, opening the oldest patient waiting for vitals. */
@Component({
  selector: 'pf-opd-vitals-station',
  standalone: true,
  imports: [OpdVitalsWorkspaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-opd-vitals-workspace></pf-opd-vitals-workspace>`,
  styles: [':host { display: block; height: 100%; min-height: 0; }'],
})
export class OpdVitalsStationPage {}
