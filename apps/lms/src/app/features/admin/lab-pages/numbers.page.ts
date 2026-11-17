import { ChangeDetectionStrategy, Component } from '@angular/core';
import { KpiConfigComponent } from '../kpis/kpi-config.component';

/**
 * Lab › Numbers on lab screens: the number-card (KPI) configuration narrowed
 * to the lab screens — front desk, My Work, collection, receive, pathologist,
 * report queue, billing, TAT board. For the whole lab or per branch (the
 * scope picker is unchanged).
 */
@Component({
  selector: 'pf-lab-numbers-page',
  standalone: true,
  imports: [KpiConfigComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<pf-kpi-config department="lab"></pf-kpi-config>`,
})
export class LabNumbersPage {}
