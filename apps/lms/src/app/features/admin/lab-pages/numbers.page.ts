import { ChangeDetectionStrategy, Component, computed, viewChild } from '@angular/core';
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
export class LabNumbersPage {
  private readonly kpis = viewChild(KpiConfigComponent);
  /** The Settings card head shows the grid's head tools (scope · count, Add KPI). */
  readonly headTools = computed(() => this.kpis()?.headTools() ?? null);
  hasUnsavedChanges(): boolean { return !!this.kpis()?.hasUnsavedChanges(); }
  saveChanges(): Promise<boolean> { return this.kpis()?.saveChanges() ?? Promise.resolve(true); }
  readonly unsavedLabel = 'the number cards';
}
