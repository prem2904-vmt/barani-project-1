import { SettingGroupComponent } from '../../../shared/components/setting-row/setting-row.component';
import { HasUnsavedChanges, guardUnsavedOnUnload } from '../../../shared/utils/unsaved-changes';
import { SegmentedComponent } from '../../../shared/primitives/segmented.component';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AppointmentsConfigComponent } from '../../admin/appointments-config/appointments-config.component';
import { NotificationsConfigComponent } from '../../admin/notifications-config/notifications-config.component';
import { ReferringNetworkComponent } from '../../admin/referring-network/referring-network.component';
import { FdGridColumnsComponent } from '../../admin/fd-grid-columns/fd-grid-columns.component';
import { OpdGateService } from '../shared/opd-gate.service';

/** The categories the Settings left panel lists for OPD › Front desk (`?tab=`). */
import { OPD_FRONT_DESK_SECTIONS } from '../../admin/settings/settings-map';
export { OPD_FRONT_DESK_SECTIONS };
export type OpdFrontDeskSection = typeof OPD_FRONT_DESK_SECTIONS[number]['id'];

/**
 * Settings → OPD → Front desk, alerts and numbers (`/admin/opd/front-desk`). Every OPD-only choice that used to sit on a
 * shared page, in one place; each category reuses the existing screen unchanged:
 *  - Appointments and booking: Booking slots (appointments-config) + a link to OPD workflow for the queue token.
 *  - Referring doctors and hospitals: the ONE shared list (referring-network), same data the Lab's Front desk edits.
 *  - OPD alerts: notifications-config filtered to OPD.
 * "Numbers on OPD screens" is omitted: the KPI-card screen list has no OPD screens yet.
 */
@Component({
  selector: 'pf-opd-front-desk',
  standalone: true,
  imports: [SettingGroupComponent, SegmentedComponent, RouterLink, AppointmentsConfigComponent, ReferringNetworkComponent, NotificationsConfigComponent, FdGridColumnsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ONE page (owner 2026-11-17): booking slots and OPD alerts as group cards, the shared referring list full width. -->
    <div class="pf-sgrid">
      <pf-setting-group id="appointments"><pf-appointments-config [tabs]="['slots']"></pf-appointments-config></pf-setting-group>
      <pf-setting-group id="alerts"><pf-notifications-config [department]="'opd'"></pf-notifications-config></pf-setting-group>
      <pf-setting-group label="Referring doctors and hospitals" scope="one shared list" id="referring" [wide]="true"
                        icon="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01">
        <pf-segmented group-tools size="sm" ariaLabel="Hospitals or doctors" [options]="rn.viewOptions()" [value]="rn.view()" (valueChange)="rn.setView($any($event))"></pf-segmented>
        <!-- The list's actions in the group head (the grid inside is bare, so its own head is hidden): outlined,
             Save stays the page's one primary. -->
        <button group-tools type="button" class="pf-btn pf-btn--secondary pf-sg-act press" data-testid="rn-add"
                [disabled]="rn.editorOpen()" (click)="rn.addNew()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          {{ rn.view() === 'hospitals' ? 'Add hospital' : 'Add doctor' }}
        </button>
        <button group-tools type="button" class="pf-btn pf-btn--secondary pf-sg-act press" data-testid="rn-paste-open"
                [disabled]="rn.editorOpen()" (click)="rn.openPaste()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
          Paste from sheet
        </button>
        <pf-referring-network #rn></pf-referring-network>
      </pf-setting-group>
      @if (opdGate.visible()) {
        <!-- Work grid columns: the OPD rows of the common Frontdesk, this branch (only while OPD is on). -->
        <pf-setting-group label="Work grid columns" scope="this branch" id="columns" [wide]="true" hint="What the Frontdesk list shows for OPD."
                          icon="M3 4h18v16H3zM3 10h18M9 10v10M15 10v10">
          <button group-tools type="button" class="pf-btn pf-btn--secondary pf-ofd__reset" data-testid="fdgc-reset"
                  [disabled]="!gc.canReset()" (click)="gc.reset()" aria-label="Reset columns to default">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>
          Reset to default
        </button>
          <pf-fd-grid-columns #gc module="opd"></pf-fd-grid-columns>
        </pf-setting-group>
      }
      <p class="pf-ofd__note">OPD tokens and queue order are set in <a routerLink="/admin/opd/workflow">OPD workflow</a>.</p>
    </div>
  `,
  styles: [`
    .pf-ofd__note { grid-column: 1 / -1; margin: 0; font-size: 12.5px; color: var(--text-tertiary); }
    .pf-ofd__note a { color: var(--violet-text, #7c3aed); font-weight: 600; text-decoration: none; }
    .pf-ofd__note a:hover { text-decoration: underline; }
  `],
})
export class OpdFrontDeskPage implements HasUnsavedChanges {
  /** Booking slots / queue mode / priority have an explicit Save: leaving with edits asks first. */
  private readonly appointments = viewChild(AppointmentsConfigComponent);
  private readonly columns = viewChild(FdGridColumnsComponent);
  protected readonly opdGate = inject(OpdGateService);
  readonly unsavedLabel = 'the OPD front desk settings';
  hasUnsavedChanges(): boolean {
    return (this.appointments()?.hasUnsavedChanges() ?? false) || (this.columns()?.hasUnsavedChanges() ?? false);
  }
  async saveChanges(): Promise<boolean> {
    const colsDirty = this.columns()?.hasUnsavedChanges() ?? false;
    // Only the columns changed: leave the booking settings alone (they save on their own when they change).
    const a = !colsDirty || this.appointments()?.hasUnsavedChanges() ? await (this.appointments()?.saveChanges() ?? Promise.resolve(true)) : true;
    const c = this.columns()?.hasUnsavedChanges() ? await this.columns()!.saveChanges() : true;
    return a && c;
  }
  private readonly _unloadGuard = guardUnsavedOnUnload(this);
  private readonly route = inject(ActivatedRoute);
  private readonly tab = toSignal(this.route.queryParamMap.pipe(map(q => q.get('tab'))), { initialValue: this.route.snapshot.queryParamMap.get('tab') });
  readonly section = computed<OpdFrontDeskSection>(() => {
    const t = this.tab();
    return OPD_FRONT_DESK_SECTIONS.some(s => s.id === t) ? (t as OpdFrontDeskSection) : 'appointments';
  });
}
