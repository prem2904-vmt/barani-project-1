import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { CultureSettingsComponent } from '../../lab/culture-settings/culture-settings.component';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { BusyDirective } from '../../../shared/directives/busy.directive';
import { LabPageComponent, labPageTab } from './lab-page.component';

/**
 * Lab › Results and validation: require validation for all results,
 * calculation constants, and the microbiology stage lock + turnaround per
 * stage (the existing culture settings, shown inside this page).
 */
@Component({
  selector: 'pf-lab-results-page',
  standalone: true,
  imports: [BusyDirective, LabPageComponent, LabSettingsComponent, CultureSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <!-- Microbiology saves on a button (its API): that is the band's ONE primary; the switches autosave. -->
      <button page-actions type="button" class="pf-hb-btn pf-hb-btn--primary press" data-testid="culture-save" [disabled]="cult.saving()"
              [pfBusy]="cult.saving()" pfBusyLabel="Saving…" (click)="cult.save()" aria-label="Save" title="Save microbiology settings">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
        {{ cult.saving() ? 'Saving…' : 'Save' }}
      </button>
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
  protected readonly groups = {
    'require-validation': { id: 'validation', label: 'Validation', scope: 'this branch' },
    'calc-constants': { id: 'constants', label: 'Calculations', scope: 'all branches' },
  } as const;
}
