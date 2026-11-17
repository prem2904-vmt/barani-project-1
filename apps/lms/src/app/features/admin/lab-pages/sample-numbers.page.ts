import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
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
  imports: [LabPageComponent, SampleIdFormatCardComponent, SpacePrefixesCardComponent, LabSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)"
                 subtitle="How a sample gets its number and how it is found at the bench.">
      @switch (tab()) {
        @case ('format') { <pf-sample-id-format-card></pf-sample-id-format-card> }
        @case ('prefixes') { <pf-space-prefixes-card></pf-space-prefixes-card> }
        @case ('structure') { <pf-lab-settings [cards]="['lab-structure']"></pf-lab-settings> }
        @case ('barcode') { <pf-lab-settings [cards]="['label-code']"></pf-lab-settings> }
        @case ('find') { <pf-lab-settings [cards]="['scan-mode']"></pf-lab-settings> }
      }
    </pf-lab-page>
  `,
})
export class LabSampleNumbersPage {
  protected readonly page = LAB_PAGES.sampleNumbers;
  private readonly t = labPageTab(LAB_PAGES.sampleNumbers);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
}
