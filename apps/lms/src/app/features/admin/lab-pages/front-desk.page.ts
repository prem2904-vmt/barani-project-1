import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { AppointmentsConfigComponent } from '../appointments-config/appointments-config.component';
import { ReferringNetworkComponent } from '../referring-network/referring-network.component';
import { labPageTab } from './lab-page.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';

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
  imports: [AppointmentsConfigComponent, ReferringNetworkComponent, SettingGroupComponent, SegmentedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ONE page (owner 2026-11-17): Queue mode · Booking slots · Priority engine as group cards in the grid, then the
         referring doctors and hospitals as one full-width card (Hospitals | Doctors in its head). -->
    <div class="pf-sgrid pf-fd">
      <pf-appointments-config></pf-appointments-config>
      <pf-setting-group label="Referring doctors and hospitals" scope="one shared list" id="referring" [wide]="true"
                        icon="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01">
        <pf-segmented group-tools size="sm" ariaLabel="Hospitals or doctors" [options]="rn.viewOptions()" [value]="rn.view()" (valueChange)="rn.setView($any($event))"></pf-segmented>
        <pf-referring-network #rn></pf-referring-network>
      </pf-setting-group>
    </div>
  `,
})
export class LabFrontDeskPage {
  /** Ask before leaving with unsaved front desk changes (the appointments config owns them). */
  private readonly appts = viewChild(AppointmentsConfigComponent);
  readonly unsavedLabel = 'the front desk settings';
  hasUnsavedChanges(): boolean { return !!this.appts()?.hasUnsavedChanges(); }
  protected readonly tab = labPageTab(LAB_PAGES.frontDesk).tab;
}
