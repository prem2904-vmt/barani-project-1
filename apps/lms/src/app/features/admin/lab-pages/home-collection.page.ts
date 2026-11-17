import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { HomeCollectionAgentsComponent } from '../home-collection/home-collection-agents.component';
import { HomeCollectionSwitchCardComponent } from './home-collection-switch-card.component';
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
  imports: [LabPageComponent, HomeCollectionSwitchCardComponent, HomeCollectionAgentsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab() === 'agents') {
      <pf-home-collection-agents></pf-home-collection-agents>
    } @else {
      <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)"
                   subtitle="Whether this branch collects at the patient's home, and who goes.">
        <pf-home-collection-switch-card></pf-home-collection-switch-card>
      </pf-lab-page>
    }
  `,
})
export class LabHomeCollectionPage {
  protected readonly page = LAB_PAGES.homeCollection;
  private readonly t = labPageTab(LAB_PAGES.homeCollection);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
}
