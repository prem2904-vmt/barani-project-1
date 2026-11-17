import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { LabPageComponent, labPageTab } from './lab-page.component';

/**
 * Lab › Collection and queues: queue focus, auto-assign technicians AND
 * validators per department (the ONE home for validator pools — Users ›
 * "Validates for" reads from here), and the no-scan claim override.
 */
@Component({
  selector: 'pf-lab-collection-page',
  standalone: true,
  imports: [LabPageComponent, LabSettingsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)">
      <pf-lab-settings [cards]="['counters', 'queue-focus', 'no-scan', 'auto-assign']" [groups]="groups"></pf-lab-settings>
    </pf-lab-page>
  `,
})
export class LabCollectionPage {
  protected readonly page = LAB_PAGES.collection;
  private readonly t = labPageTab(LAB_PAGES.collection);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
  protected readonly groups = {
    counters: { id: 'queue', label: '' },
    'no-scan': { id: 'noscan', label: '' },
    'auto-assign': { id: 'assign', label: '' },
  } as const;
}
