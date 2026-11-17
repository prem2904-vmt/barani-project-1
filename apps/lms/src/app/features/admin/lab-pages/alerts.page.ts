import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NotificationsConfigComponent } from '../notifications-config/notifications-config.component';

/**
 * Lab › Lab alerts: the Notifications screen narrowed to the lab's alert
 * groups (front desk, billing, bench, results, reports, WhatsApp billing,
 * inventory, appointments and home collection, team). The master switch is
 * unchanged — it is lab-wide.
 */
@Component({
  selector: 'pf-lab-alerts-page',
  standalone: true,
  imports: [NotificationsConfigComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-notifications-config department="lab"></pf-notifications-config>`,
})
export class LabAlertsPage {}
