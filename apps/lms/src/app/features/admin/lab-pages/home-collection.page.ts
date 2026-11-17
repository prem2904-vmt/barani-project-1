import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { HomeCollectionAgentsComponent } from '../home-collection/home-collection-agents.component';
import { HomeCollectionSwitchCardComponent } from './home-collection-switch-card.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { LabPageComponent, labPageTab } from './lab-page.component';

/**
 * Lab › Home collection: on or off (three places before: the queue mode on
 * Appointments, the module switch, the workflow step) and the agents with
 * their coverage area. The agents list is the existing screen (own band:
 * search + Add agent).
 */
@Component({
  selector: 'pf-lab-home-collection-page',
  standalone: true,
  imports: [SettingGroupComponent, LabPageComponent, HomeCollectionSwitchCardComponent, HomeCollectionAgentsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <pf-setting-group label="Home collection" scope="this branch" id="switch"><pf-home-collection-switch-card></pf-home-collection-switch-card></pf-setting-group>
      <pf-setting-group label="Agents" id="agents"><pf-home-collection-agents></pf-home-collection-agents></pf-setting-group>
    </pf-lab-page>
  `,
})
export class LabHomeCollectionPage {
  protected readonly page = LAB_PAGES.homeCollection;
  private readonly t = labPageTab(LAB_PAGES.homeCollection);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
}
