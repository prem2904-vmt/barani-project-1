import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AppointmentsConfigComponent } from '../../admin/appointments-config/appointments-config.component';
import { NotificationsConfigComponent } from '../../admin/notifications-config/notifications-config.component';
import { ReferringNetworkComponent } from '../../admin/referring-network/referring-network.component';

/** The categories the Settings left panel lists for OPD › Front desk (`?tab=`). */
import { OPD_FRONT_DESK_SECTIONS } from '../../admin/settings/settings-map';
export { OPD_FRONT_DESK_SECTIONS };
export type OpdFrontDeskSection = typeof OPD_FRONT_DESK_SECTIONS[number]['id'];

/**
 * Settings → OPD → Front desk, alerts and numbers (`/admin/opd/front-desk`). Every OPD-only choice that used to sit on a
 * shared page, in one place; each category reuses the existing screen unchanged:
 *  - Appointments and booking: Booking slots (appointments-config) + a link to OPD workflow for the queue token.
 *  - Referring doctors and hospitals: the ONE shared list (referring-network), same data the Lab's Front desk edits.
 *  - OPD alerts: notifications-config filtered to OPD.
 * "Numbers on OPD screens" is omitted: the KPI-card screen list has no OPD screens yet.
 */
@Component({
  selector: 'pf-opd-front-desk',
  standalone: true,
  imports: [SettingGroupComponent, SegmentedComponent, RouterLink, AppointmentsConfigComponent, ReferringNetworkComponent, NotificationsConfigComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ONE page (owner 2026-11-17): booking slots and OPD alerts as group cards, the shared referring list full width. -->
    <div class="pf-sgrid">
      <pf-appointments-config [tabs]="['slots']"></pf-appointments-config>
      <pf-notifications-config [department]="'opd'"></pf-notifications-config>
      <pf-setting-group label="Referring doctors and hospitals" scope="one shared list" id="referring" [wide]="true"
                        icon="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01">
        <pf-segmented group-tools size="sm" ariaLabel="Hospitals or doctors" [options]="rn.viewOptions()" [value]="rn.view()" (valueChange)="rn.setView($any($event))"></pf-segmented>
        <pf-referring-network #rn></pf-referring-network>
      </pf-setting-group>
      <p class="pf-ofd__note">OPD tokens and queue order are set in <a routerLink="/admin/opd/workflow">OPD workflow</a>.</p>
    </div>
  `,
  styles: [`
    .pf-ofd__note { grid-column: 1 / -1; margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-ofd__note a { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .pf-ofd__note a:hover { text-decoration: underline; }
  `],
})
export class OpdFrontDeskPage {
  private readonly route = inject(ActivatedRoute);
  private readonly tab = toSignal(this.route.queryParamMap.pipe(map(q => q.get('tab'))), { initialValue: this.route.snapshot.queryParamMap.get('tab') });
  readonly section = computed<OpdFrontDeskSection>(() => {
    const t = this.tab();
    return OPD_FRONT_DESK_SECTIONS.some(s => s.id === t) ? (t as OpdFrontDeskSection) : 'appointments';
  });
}
