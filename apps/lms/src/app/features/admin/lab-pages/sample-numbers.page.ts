import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { LabPageComponent, labPageTab } from './lab-page.component';
import { SampleIdFormatCardComponent } from './sample-id-format-card.component';
import { OrderIdFormatCardComponent } from '../../../shared/components/order-id-format-card/order-id-format-card.component';
import { SpacePrefixesCardComponent } from './space-prefixes-card.component';

/**
 * Lab › Sample numbers — ONE page for what four screens used to hold:
 * the sample ID format, the prefix per lab space, the lab structure, the barcode on
 * the label, and how a sample is found (scan or type). Same APIs as before.
 * Order IDs per module (2026-11-18): the Lab's ORDER ID format lives here too (it moved from
 * Organization); OPD's visit number and Pharmacy's dispense number are on their own pages.
 */
@Component({
  selector: 'pf-lab-sample-numbers-page',
  standalone: true,
  imports: [SettingGroupComponent, LabPageComponent, SampleIdFormatCardComponent, OrderIdFormatCardComponent, SpacePrefixesCardComponent, LabSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <pf-setting-group label="Format" scope="all branches" id="format" [wide]="true"><pf-sample-id-format-card></pf-sample-id-format-card></pf-setting-group>
      <pf-setting-group label="Order ID" scope="all branches" id="order" [wide]="true"><pf-order-id-format-card module="lab"></pf-order-id-format-card></pf-setting-group>
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
  /** Ask before leaving with an unsaved sample or order ID format. */
  private readonly fmt = viewChild(SampleIdFormatCardComponent);
  private readonly orderFmt = viewChild(OrderIdFormatCardComponent);
  readonly unsavedLabel = 'the sample and order ID formats';
  hasUnsavedChanges(): boolean { return !!this.fmt()?.dirty() || !!this.orderFmt()?.dirty(); }
  protected readonly groups = {
    'scan-mode': { id: 'find', label: 'Finding a sample', scope: 'all branches' },
    'label-code': { id: 'barcode', label: 'Labels', scope: 'this branch' },
    'lab-structure': { id: 'structure', label: 'Structure', scope: 'this branch' },
  } as const;
}
