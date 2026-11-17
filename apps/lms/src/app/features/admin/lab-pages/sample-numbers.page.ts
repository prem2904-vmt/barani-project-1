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
      <pf-setting-group label="Sample ID format" id="format"><pf-sample-id-format-card></pf-sample-id-format-card></pf-setting-group>
      <pf-setting-group label="Prefix per lab space" id="prefixes"><pf-space-prefixes-card></pf-space-prefixes-card></pf-setting-group>
      <pf-lab-settings [cards]="['scan-mode', 'lab-structure', 'label-code']" [groups]="groups"></pf-lab-settings>
    </pf-lab-page>
  `,
})
export class LabSampleNumbersPage {
  protected readonly page = LAB_PAGES.sampleNumbers;
  private readonly t = labPageTab(LAB_PAGES.sampleNumbers);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
  protected readonly groups = {
    'lab-structure': { id: 'structure', label: 'Lab structure' },
    'label-code': { id: 'barcode', label: 'Barcode type' },
    'scan-mode': { id: 'find', label: 'Find a sample' },
  } as const;
}
