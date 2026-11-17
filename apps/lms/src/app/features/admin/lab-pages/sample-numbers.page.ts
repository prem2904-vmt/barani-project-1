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
  imports: [SettingGroupComponent, LabPageComponent, SampleIdFormatCardComponent, SpacePrefixesCardComponent, LabSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <pf-setting-group id="format"><pf-sample-id-format-card></pf-sample-id-format-card></pf-setting-group>
      <pf-setting-group id="prefixes"><pf-space-prefixes-card></pf-space-prefixes-card></pf-setting-group>
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
    // The row labels name each one: anchors only (no duplicate headings).
    'lab-structure': { id: 'structure', label: '' },
    'label-code': { id: 'barcode', label: '' },
    'scan-mode': { id: 'find', label: '' },
  } as const;
}
