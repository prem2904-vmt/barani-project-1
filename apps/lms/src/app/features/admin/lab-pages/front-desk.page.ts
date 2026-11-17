import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { AppointmentsConfigComponent } from '../appointments-config/appointments-config.component';
import { ReferringNetworkComponent } from '../referring-network/referring-network.component';
import { labPageTab } from './lab-page.component';

/**
 * Lab › Front desk: lab appointments and queue (token or walk-up, booking
 * slots, priority rules — Home collection moved to its own page) and the
 * referring doctors and hospitals. The referring list is ONE shared list
 * (`<pf-referring-network>` is embeddable: OPD › Front desk renders the same
 * component). Each category is the existing screen with its own band.
 */
@Component({
  selector: 'pf-lab-front-desk-page',
  standalone: true,
  imports: [AppointmentsConfigComponent, ReferringNetworkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab() === 'referring') {
      <pf-referring-network></pf-referring-network>
    } @else {
      <pf-appointments-config></pf-appointments-config>
    }
  `,
})
export class LabFrontDeskPage {
  protected readonly tab = labPageTab(LAB_PAGES.frontDesk).tab;
}
