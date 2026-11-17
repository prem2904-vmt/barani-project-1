import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
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
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <pf-lab-settings [cards]="['require-validation', 'calc-constants']" [groups]="groups" [embedded]="true"></pf-lab-settings>
      <pf-culture-settings #cult [embedded]="true"></pf-culture-settings>
    </pf-lab-page>
  `,
})
export class LabResultsPage {
  protected readonly page = LAB_PAGES.results;
  private readonly t = labPageTab(LAB_PAGES.results);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
  /** Ask before leaving with unsaved microbiology changes. */
  private readonly culture = viewChild(CultureSettingsComponent);
  readonly unsavedLabel = 'the microbiology settings';
  hasUnsavedChanges(): boolean { return !!this.culture()?.isDirty(); }
  protected readonly groups = {
    'require-validation': { id: 'validation', label: 'Validation', scope: 'this branch' },
    'calc-constants': { id: 'constants', label: 'Calculations', scope: 'all branches' },
  } as const;
}
