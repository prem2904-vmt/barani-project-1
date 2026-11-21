import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { AppointmentsConfigComponent } from '../appointments-config/appointments-config.component';
import { ReferringNetworkComponent } from '../referring-network/referring-network.component';
import { labPageTab } from './lab-page.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { FdGridColumnsComponent } from '../fd-grid-columns/fd-grid-columns.component';

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
  imports: [AppointmentsConfigComponent, ReferringNetworkComponent, SettingGroupComponent, SegmentedComponent, FdGridColumnsComponent],
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
      <!-- Work grid columns (owner mock grid-settings-v3, 2026-11-21): the Lab Frontdesk grid's columns for this branch. -->
      <pf-setting-group label="Work grid columns" scope="this branch" id="columns" [wide]="true" hint="What the Frontdesk list shows for Lab."
                        icon="M3 4h18v16H3zM3 10h18M9 10v10M15 10v10">
        <button group-tools type="button" class="pf-btn pf-btn--secondary pf-fd__reset" data-testid="fdgc-reset"
                [disabled]="!gc.canReset()" (click)="gc.reset()">Reset to default</button>
        <pf-fd-grid-columns #gc module="lab"></pf-fd-grid-columns>
      </pf-setting-group>
    </div>
  `,
})
export class LabFrontDeskPage implements HasUnsavedChanges {
  /** Booking slots / queue mode / priority have an explicit Save: leaving with edits asks first. */
  private readonly appointments = viewChild(AppointmentsConfigComponent);
  private readonly columns = viewChild(FdGridColumnsComponent);
  readonly unsavedLabel = 'the front desk settings';
  hasUnsavedChanges(): boolean {
    return (this.appointments()?.hasUnsavedChanges() ?? false) || (this.columns()?.hasUnsavedChanges() ?? false);
  }
  async saveChanges(): Promise<boolean> {
    const colsDirty = this.columns()?.hasUnsavedChanges() ?? false;
    // Only the columns changed: leave the booking settings alone (they save on their own when they change).
    const a = !colsDirty || this.appointments()?.hasUnsavedChanges() ? await (this.appointments()?.saveChanges() ?? Promise.resolve(true)) : true;
    const c = this.columns()?.hasUnsavedChanges() ? await this.columns()!.saveChanges() : true;
    return a && c;
  }
  private readonly _unloadGuard = guardUnsavedOnUnload(this);
  protected readonly tab = labPageTab(LAB_PAGES.frontDesk).tab;
}
