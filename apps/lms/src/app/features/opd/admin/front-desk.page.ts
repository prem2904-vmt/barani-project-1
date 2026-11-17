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
  imports: [RouterLink, AppointmentsConfigComponent, ReferringNetworkComponent, NotificationsConfigComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (section()) {
      @case ('referring') { <pf-referring-network></pf-referring-network> }
      @case ('alerts') { <pf-notifications-config [department]="'opd'"></pf-notifications-config> }
      @default {
        <pf-appointments-config [tabs]="['slots']"></pf-appointments-config>
        <p class="pf-ofd__note">
          OPD tokens and queue order are set in <a routerLink="/admin/opd/workflow">OPD workflow</a>.
        </p>
      }
    }
  `,
  styles: [`
    .pf-ofd__note { margin: 4px 0 0; padding: 0 16px 24px; max-width: 56rem; margin-inline: auto; font-size: 12.5px; color: var(--text-tertiary); }
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
