import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LAB_PAGES } from '../../../shared/utils/lab-settings-pages';
import { LabSettingsComponent } from '../lab-settings/lab-settings.component';
import { LabPageComponent, labPageTab } from './lab-page.component';
import { ReportSendingCardComponent } from './report-sending-card.component';

/**
 * Lab › Report options — the two report switches that sit next to Report
 * design: technician notes on the report, and what the lab sends by WhatsApp
 * Auto. Report design itself (letterhead, patient strip, results table…) is
 * untouched; its band links here.
 */
@Component({
  selector: 'pf-lab-report-options-page',
  standalone: true,
  imports: [RouterLink, LabPageComponent, LabSettingsComponent, ReportSendingCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pf-lab-page [page]="page" [tab]="tab()" (tabChange)="pick($event)"
                 subtitle="What technicians can add to a report, and how finished reports are sent.">
      @switch (tab()) {
        @case ('notes') { <pf-lab-settings [cards]="['tech-notes']"></pf-lab-settings> }
        @case ('sending') { <pf-report-sending-card></pf-report-sending-card> }
      }
      <p class="pf-ro__back">
        The layout of the report itself is in
        <a class="pf-ro__link" routerLink="/admin/reports" [queryParams]="{ tab: 'table' }" data-testid="ro-design-link">Report design</a>.
      </p>
    </pf-lab-page>
  `,
  styles: [`
    .pf-ro__back { margin: 4px 0 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-ro__link { color: var(--violet-text, #7c3aed); text-decoration: underline; text-underline-offset: 3px; font-weight: 600; }
  `],
})
export class LabReportOptionsPage {
  protected readonly page = LAB_PAGES.reportOptions;
  private readonly t = labPageTab(LAB_PAGES.reportOptions);
  protected readonly tab = this.t.tab;
  protected pick(id: string) { this.t.pick(id); }
}
