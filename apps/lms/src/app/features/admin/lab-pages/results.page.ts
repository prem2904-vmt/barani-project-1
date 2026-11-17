import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { CultureSettingsComponent } from '../../lab/culture-settings/culture-settings.component';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { LabPageComponent, labPageTab } from './lab-page.component';

/**
 * Lab › Results and validation: require validation for all results,
 * calculation constants, and the microbiology stage lock + turnaround per
 * stage (the existing culture settings, shown inside this page).
 */
@Component({
  selector: 'pf-lab-results-page',
  standalone: true,
  imports: [LabPageComponent, LabSettingsComponent, CultureSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)"
                 subtitle="Who signs results, the numbers calculated results use, and how the culture bench is timed.">
      @switch (tab()) {
        @case ('validation') { <pf-lab-settings [cards]="['require-validation']"></pf-lab-settings> }
        @case ('constants') { <pf-lab-settings [cards]="['calc-constants']"></pf-lab-settings> }
        @case ('micro') { <pf-culture-settings [embedded]="true"></pf-culture-settings> }
      }
    </pf-lab-page>
  `,
})
export class LabResultsPage {
  protected readonly page = LAB_PAGES.results;
  private readonly t = labPageTab(LAB_PAGES.results);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
}
