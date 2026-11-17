import { BusyDirective } from '../../../shared/directives/busy.directive';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { LabPageComponent, labPageTab } from './lab-page.component';
import { SampleIdFormatCardComponent } from './sample-id-format-card.component';
import { SpacePrefixesCardComponent } from './space-prefixes-card.component';

/**
 * Lab › Sample numbers — ONE page for what four screens used to hold:
 * the ID format, the prefix per lab space, the lab structure, the barcode on
 * the label, and how a sample is found (scan or type). Same APIs as before.
 */
@Component({
  selector: 'pf-lab-sample-numbers-page',
  standalone: true,
  imports: [BusyDirective, SettingGroupComponent, LabPageComponent, SampleIdFormatCardComponent, SpacePrefixesCardComponent, LabSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <!-- ONE primary Save in the band (the format is the only part that saves on a button; the rest autosave). -->
      <button page-actions type="button" class="pf-hb-btn pf-hb-btn--primary press pf-sf__save" [disabled]="fmt.saving()"
              [pfBusy]="fmt.saving()" pfBusyLabel="Saving…" (click)="fmt.save()" aria-label="Save" title="Save the sample ID format">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8"/><path d="M7 3v5h8"/></svg>
        {{ fmt.saving() ? 'Saving…' : 'Save' }}
      </button>
      <pf-setting-group label="Format" scope="all branches" id="format"><pf-sample-id-format-card #fmt></pf-sample-id-format-card></pf-setting-group>
      <pf-space-prefixes-card></pf-space-prefixes-card>
      <pf-lab-settings [cards]="['scan-mode', 'lab-structure', 'label-code']" [groups]="groups" [embedded]="true"></pf-lab-settings>
    </pf-lab-page>
  `,
})
export class LabSampleNumbersPage {
  protected readonly page = LAB_PAGES.sampleNumbers;
  private readonly t = labPageTab(LAB_PAGES.sampleNumbers);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
  protected readonly groups = {
    'scan-mode': { id: 'find', label: 'Finding a sample', scope: 'all branches' },
    'label-code': { id: 'barcode', label: 'Labels', scope: 'this branch' },
    'lab-structure': { id: 'structure', label: 'Structure', scope: 'this branch' },
  } as const;
}
