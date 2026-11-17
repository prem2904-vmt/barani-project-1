import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { MonoTypeOperatorFunction, defer, finalize } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BillingMode, BranchLabConfig, CollectionMode } from '../../../shared/models/branch-lab-config.model';
import { Department, Tenant } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SettingRowComponent } from '../../../shared/components/setting-row/setting-row.component';
import { BusyComponent, SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { spinDelay } from '../../../shared/utils/busy';
import { LAB_SPACES_PATH, LAB_SPACES_QUERY } from '../../../shared/utils/lab-settings-pages';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { SampleSearchPresetService } from '../../../core/services/sample-search-preset.service';
import { labDate, nextLabMonth, sampleIdHead } from '../../../shared/utils/sample-id-preset';

/**
 * The cards this host can show. A Lab settings PAGE lists the ones it owns
 * through `[cards]`; no input = every card (the legacy single page).
 *  Sample numbers: scan-mode · lab-structure · label-code
 *  Collection and queues: counters · queue-focus · auto-assign · no-scan
 *  Results and validation: require-validation · calc-constants
 *  Report options: tech-notes
 */
export type LabSettingsCard =
  | 'counters' | 'scan-mode' | 'queue-focus' | 'lab-structure' | 'calc-constants' | 'no-scan'
  | 'label-code' | 'require-validation' | 'tech-notes' | 'auto-assign';

interface AutoAssignConfig {
  id?: string;
  tenantId?: string;
  departmentId: string;
  isEnabled?: boolean;
  // The API stores the eligible pool as JSON arrays of GUIDs.
  assigneeUserIdsJson?: string | null;
  autoAssignRoleIdsJson?: string | null;
  // Validator leg: who reviews this department's submitted results.
  validatorUserIdsJson?: string | null;
  validatorRoleIdsJson?: string | null;
}

@Component({
  selector: 'pf-lab-settings',
  standalone: true,
  imports: [FormsModule, SelectComponent, BusyComponent, SkeletonCardComponent, SegmentedComponent, SettingRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A card host: the Lab settings pages (Sample numbers, Collection and queues, Results and validation, Report
         options) list the settings they own through [cards]; each is ONE minimal row (DESIGN-V2 rule 5) — label +
         one hint line left, the control right. Every change autosaves. -->
    <div class="pf-ls__host">
      @if (firstLoad()) {
        <div class="pf-ls__skel">
          <pf-skeleton-card [lines]="3" label="Loading lab settings…"></pf-skeleton-card>
        </div>
      } @else {

      @if (!embedded()) {
        <!-- Where these apply: "This branch" rows are for the signed-in branch; "All branches" rows everywhere. -->
        <div class="pf-ls__meta">
          <p class="pf-ls__scopenote" data-testid="ls-scope-note">
            <strong>This branch</strong> rows apply to <strong>{{ branchName() }}</strong> only; <strong>All branches</strong> rows apply everywhere.
          </p>
          <span class="pf-savestate pf-ls__savestate" role="status" title="Every change saves as you make it"
                [attr.aria-busy]="savingShown() ? 'true' : null">
            @if (savingShown()) {
              <pf-busy label="Saving…"></pf-busy>
              <span class="pf-ls__savestate-t">Saving…</span>
            } @else {
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="pf-ls__savestate-t">Saves automatically</span>
            }
          </span>
        </div>
      }

      @if (show('counters')) {
        @if (groupLabel('counters'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('counters')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Counters and collection" [hint]="'Billing: ' + (billingMode() === 'separate_counter' ? 'separate counter' : 'front desk') + ' · Collection: ' + (collectionMode() === 'dedicated_counter' ? 'dedicated counter' : 'front desk') + ' — set in Work steps.'">
          <span row-badge class="pf-ls__scope">This branch</span>
          <button type="button" class="pf-hb-btn pf-hb-btn--ghost pf-ls__wfbtn" (click)="goWorkflow()">Edit in Work steps</button>
        </pf-setting-row>
      }

      @if (show('scan-mode')) {
        @if (groupLabel('scan-mode'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('scan-mode')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Find a sample" [hint]="optDesc(scanModeOptions, scanMode())">
          <span row-badge class="pf-ls__scope pf-ls__scope--all">All branches</span>
          <pf-segmented class="pf-ls__gate" size="sm" aria-label="Find a sample" [options]="seg(scanModeOptions)" [value]="scanMode()"
                        (valueChange)="setScanMode($any($event))"></pf-segmented>
        </pf-setting-row>
        <pf-setting-row class="pf-ls__card pf-ls__preset" label="Pre-fill sample search">
          <span row-badge class="pf-ls__scope pf-ls__scope--all">All branches</span>
          <span row-hint class="pf-ls__hint">
            @if (presetExample(); as ex) {
              Search opens with <strong class="pf-ls__mono">{{ ex.now }}</strong> typed — enter only the number.
            } @else {
              Search opens with the current sample-ID start typed — enter only the number.
            }
            @if (samplePresetSetting() !== null) {
              <button type="button" class="pf-ls__link" (click)="resetSamplePreset()">Reset to {{ samplePresetDefault() ? 'on' : 'off' }}</button>
            }
          </span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="samplePresetOn()"
                  aria-label="Pre-fill sample search" (click)="setSamplePreset(!samplePresetOn())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
      }

      @if (show('queue-focus')) {
        @if (groupLabel('queue-focus'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('queue-focus')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Queue focus"
                        [hint]="queueFocusMode() === 'auto' ? 'Follows the lab structure — now ' + (effectiveQueueFocus() === 'sample' ? 'by sample.' : 'by patient.') : optDesc(queueFocusOptions, queueFocusSelected())">
          <span row-badge class="pf-ls__scope">This branch</span>
          @if (queueFocusMode() !== 'auto') {
            <button type="button" class="pf-ls__link" (click)="setQueueFocusMode('auto')">Follow lab structure</button>
          }
          <pf-segmented class="pf-ls__gate" size="sm" aria-label="Queue focus" [options]="seg(queueFocusOptions)" [value]="queueFocusSelected()"
                        (valueChange)="setQueueFocusMode($any($event))"></pf-segmented>
        </pf-setting-row>
      }

      @if (show('lab-structure')) {
        @if (groupLabel('lab-structure'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('lab-structure')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Lab structure" [hint]="optDesc(labStructureOptions, labStructure())">
          <span row-badge class="pf-ls__scope">This branch</span>
          <pf-segmented class="pf-ls__gate" size="sm" aria-label="Lab structure" [options]="seg(labStructureOptions)" [value]="labStructure()"
                        (valueChange)="setLabStructure($any($event))"></pf-segmented>
        </pf-setting-row>
        <pf-setting-row class="pf-ls__note" label="Default &quot;Lab&quot; code" hint="The prefix for departments without their own space — set on the lab spaces board.">
          <button type="button" class="pf-ls__link" (click)="goBranches()">Open lab spaces</button>
        </pf-setting-row>
      }

      @if (show('calc-constants')) {
        @if (groupLabel('calc-constants'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('calc-constants')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Calculation constants" hint="ISI and MNPT drive INR; Normal HCT the reticulocyte index. Blank = the default shown.">
          <span row-badge class="pf-ls__scope pf-ls__scope--all">All branches</span>
          <label class="pf-ls__mini"><span>ISI</span>
            <input class="pf-input pf-num" type="number" step="0.01" min="0" placeholder="1.0" aria-label="ISI"
                   [ngModel]="calcIsi()" (ngModelChange)="calcIsi.set($event)" (blur)="saveCalcConstants()" /></label>
          <label class="pf-ls__mini"><span>MNPT s</span>
            <input class="pf-input pf-num" type="number" step="0.1" min="0" placeholder="12.0" aria-label="MNPT (seconds)"
                   [ngModel]="calcMnpt()" (ngModelChange)="calcMnpt.set($event)" (blur)="saveCalcConstants()" /></label>
          <label class="pf-ls__mini"><span>HCT %</span>
            <input class="pf-input pf-num" type="number" step="1" min="1" max="99" placeholder="45" aria-label="Normal HCT (%)"
                   [ngModel]="calcNormalHct()" (ngModelChange)="calcNormalHct.set($event)" (blur)="saveCalcConstants()" /></label>
        </pf-setting-row>
      }

      @if (show('no-scan')) {
        @if (groupLabel('no-scan'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('no-scan')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Allow no-scan claim" hint="A supervisor can claim a test without scanning (broken barcodes). Every override is logged.">
          <span row-badge class="pf-ls__scope pf-ls__scope--all">All branches</span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="allowNoScan()" aria-label="Allow no-scan claim (supervisor override)"
                  (click)="setAllowNoScan(!allowNoScan())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
      }

      @if (show('label-code')) {
        @if (groupLabel('label-code'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('label-code')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Barcode on tube labels" [hint]="optDesc(labelCodeOptions, labelCodeMode())">
          <span row-badge class="pf-ls__scope">This branch</span>
          <pf-segmented class="pf-ls__gate" size="sm" aria-label="Barcode on tube labels" [options]="seg(labelCodeOptions)" [value]="labelCodeMode()"
                        (valueChange)="setLabelCodeMode($any($event))"></pf-segmented>
        </pf-setting-row>
      }

      @if (show('require-validation')) {
        @if (groupLabel('require-validation'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('require-validation')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Require validation for all results" hint="Every result needs a pathologist — even direct-flow tests that would auto-validate.">
          <span row-badge class="pf-ls__scope">This branch</span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="requireValidation()" aria-label="Require validation for all results"
                  (click)="setRequireValidation(!requireValidation())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
      }

      @if (show('tech-notes')) {
        @if (groupLabel('tech-notes'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('tech-notes')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" data-testid="ls-tech-notes" label="Technician notes on report"
                        hint="Notes written at result entry print on the final report (never on a preliminary). Off hides them at entry; written notes still print.">
          <span row-badge class="pf-ls__scope">This branch</span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="techReportNotes()"
                  aria-label="Technician notes on report" (click)="setTechReportNotes(!techReportNotes())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
      }

      @if (show('auto-assign')) {
        @if (groupLabel('auto-assign'); as g) { <div class="pf-ls__group" [attr.data-group]="groupId('auto-assign')">{{ g }}</div> }
        <pf-setting-row class="pf-ls__card" label="Auto-assign technicians" hint="On receive, each test goes to its department's people or least-loaded role member. Off: the shared bench queue.">
          <span row-badge class="pf-ls__scope">This branch</span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignEnabled()" aria-label="Auto-assign technicians"
                  (click)="setAutoAssignEnabled(!autoAssignEnabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>
        <pf-setting-row class="pf-ls__card" label="Auto-assign validators" hint="On submit, a result goes to its department's validators. A consultant listed here signs only those departments.">
          <span row-badge class="pf-ls__scope">This branch</span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignValidatorsEnabled()" aria-label="Auto-assign validators"
                  (click)="setAutoAssignValidatorsEnabled(!autoAssignValidatorsEnabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </pf-setting-row>

        @if (departments().length === 0) {
          <p class="pf-ls__empty">No departments yet — add them in Departments and lab spaces first.</p>
        } @else {
          <div class="pf-ls__depts" role="table" aria-label="Who gets each department's work">
            <div class="pf-ls__drow pf-ls__drow--head" role="row">
              <span role="columnheader">Department</span>
              <span role="columnheader" [class.pf-ls__pool--off]="!autoAssignEnabled()">Technicians — people · roles</span>
              <span role="columnheader">Validators — people · roles</span>
            </div>
            @for (d of departments(); track d.id) {
              <div class="pf-ls__drow pf-ls__dept" role="row">
                <span class="pf-ls__dname" role="cell">{{ d.name }} <span class="pf-ls__dept-code">{{ d.code }}</span></span>
                <span class="pf-ls__dcell" role="cell" [class.pf-ls__pool--off]="!autoAssignEnabled()">
                  <pf-select [multiple]="true" [options]="allUserOptions()" [values]="assigneesFor(d.id)" placeholder="People…"
                             [disabled]="!autoAssignEnabled()" (valuesChange)="setAssignees(d.id, $any($event))"></pf-select>
                  <pf-select [multiple]="true" [options]="allRoleOptions()" [values]="rolesFor(d.id)" placeholder="Roles…"
                             [disabled]="!autoAssignEnabled()" (valuesChange)="setRoles(d.id, $any($event))"></pf-select>
                  @if (autoAssignEnabled() && !assigneesFor(d.id).length && !rolesFor(d.id).length) {
                    <span class="pf-ls__warn">No one set — shared queue.</span>
                  }
                </span>
                <span class="pf-ls__dcell" role="cell">
                  <pf-select [multiple]="true" [options]="allUserOptions()" [values]="validatorsFor(d.id)" placeholder="People…"
                             (valuesChange)="setValidators(d.id, $any($event))"></pf-select>
                  <pf-select [multiple]="true" [options]="allRoleOptions()" [values]="validatorRolesFor(d.id)" placeholder="Roles…"
                             (valuesChange)="setValidatorRoles(d.id, $any($event))"></pf-select>
                  @if (autoAssignValidatorsEnabled() && !validatorsFor(d.id).length && !validatorRolesFor(d.id).length) {
                    <span class="pf-ls__warn">No one set — shared validation queue.</span>
                  }
                </span>
              </div>
            }
          </div>
        }
      }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .pf-ls__group { display: flex; align-items: center; min-height: 36px; padding-top: 14px; margin-top: 6px; border-top: 1px solid var(--pf-line); font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-tertiary); scroll-margin-top: 8px; }
    .pf-ls__host > .pf-ls__group:first-child, .pf-ls__meta + .pf-ls__group { border-top: 0; margin-top: 0; }
    .pf-ls__skel { display: flex; flex-direction: column; gap: 16px; padding-top: 12px; }
    .pf-ls__meta { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 0 2px; }
    .pf-ls__scopenote { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--text-tertiary); }
    .pf-ls__scopenote strong { color: var(--text-secondary); font-weight: 600; }
    .pf-ls__savestate { display: inline-flex; align-items: center; gap: 6px; }
    .pf-ls__scope {
      flex: none; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg);
      font-size: 10.5px; font-weight: 600; line-height: 1.5; color: var(--text-secondary); white-space: nowrap;
    }
    .pf-ls__scope--all { color: var(--text-tertiary); }
    .pf-ls__hint { font-size: 12.5px; line-height: 1.4; color: var(--text-tertiary); }
    .pf-ls__mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-primary); }
    .pf-ls__link { background: none; border: none; padding: 0; margin-left: 6px; font: inherit; font-size: 12.5px; color: var(--violet-text, #7c3aed); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .pf-ls__switch { flex: none; }
    .pf-ls__wfbtn { height: 32px; padding: 0 12px; font-size: 13px; }
    .pf-ls__mini { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .pf-ls__mini .pf-input { width: 76px; height: 34px; min-height: 34px; padding: 0 8px; }
    .pf-ls__empty { margin: 12px 0 0; font-size: 13px; color: var(--text-tertiary); }
    .pf-ls__warn { font-size: 12px; color: var(--text-tertiary); }
    .pf-ls__pool--off { opacity: 0.5; }
    /* Per-department pools: one compact row per department (no tile grid). */
    .pf-ls__depts { margin-top: 4px; }
    .pf-ls__drow { display: grid; grid-template-columns: minmax(140px, 0.8fr) minmax(0, 1.6fr) minmax(0, 1.6fr); gap: 12px; align-items: start; padding: 10px 0; border-top: 1px solid var(--pf-line); }
    .pf-ls__drow--head { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--text-tertiary); padding: 8px 0 6px; }
    .pf-ls__dname { font-size: 13.5px; font-weight: 500; color: var(--text-primary); padding-top: 8px; }
    .pf-ls__dept-code { margin-left: 4px; font-size: 11px; color: var(--text-tertiary); font-variant-numeric: tabular-nums; }
    .pf-ls__dcell { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; min-width: 0; }
    .pf-ls__dcell .pf-ls__warn { grid-column: 1 / -1; }
    @media (pointer: coarse) { :host .pf-ls__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
    @media (max-width: 900px) {
      .pf-ls__drow { grid-template-columns: 1fr; gap: 6px; }
      .pf-ls__drow--head { display: none; }
      .pf-ls__dname { padding-top: 0; }
    }
    @media (max-width: 640px) {
      :host input[type="number"] { font-size: 16px; }
      .pf-ls__dcell { grid-template-columns: 1fr; }
    }
  `]
})
export class LabSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Which cards to show; null = all (the legacy single page). */
  readonly cards = input<readonly LabSettingsCard[] | null>(null);
  /** Group label (small uppercase) shown before a card's rows — the page's categories when it is ONE card. */
  readonly groups = input<Partial<Record<LabSettingsCard, { id: string; label: string }>>>({});
  groupLabel(key: LabSettingsCard): string | null { return this.groups()[key]?.label ?? null; }
  groupId(key: LabSettingsCard): string | null { return this.groups()[key]?.id ?? null; }
  /** Inside a page that already says where rows apply and how they save (several hosts on one card): no meta line. */
  readonly embedded = input(false);
  /** Short labels for a segmented control (the long description becomes the row's hint). */
  seg<T extends string>(opts: ReadonlyArray<{ value: T; label: string; short?: string }>): SegmentedOption<T>[] {
    return opts.map((o) => ({ value: o.value, label: o.short ?? o.label }));
  }
  optDesc<T extends string>(opts: ReadonlyArray<{ value: T; desc: string }>, v: T | null | undefined): string {
    return opts.find((o) => o.value === v)?.desc ?? '';
  }
  show(key: LabSettingsCard): boolean {
    const c = this.cards();
    return c === null || c.includes(key);
  }


  // ── Loading feedback (PF-PATTERN "Loading feedback") ──
  /** First load: skeleton cards until the branch config answers (held, no flash). */
  private readonly loadHold = createLoadHold(true);
  readonly firstLoad = this.loadHold.active;
  /** Autosaves in flight — the band's save state reads "Saving…" meanwhile. */
  private readonly pendingSaves = signal(0);
  /** "Saving…" after 150ms (no flicker for a fast answer), held 300ms. */
  readonly savingShown = spinDelay(computed(() => this.pendingSaves() > 0));
  /** Counts one autosave request while it runs (request itself unchanged). */
  private tracked<T>(): MonoTypeOperatorFunction<T> {
    return src => defer(() => {
      this.pendingSaves.update(n => n + 1);
      return src.pipe(finalize(() => this.pendingSaves.update(n => Math.max(0, n - 1))));
    });
  }
  /** The branch the per-branch cards on this page apply to (the signed-in /
   *  active branch — the server scopes branch-lab-config to it). */
  readonly branchName = computed(() => this.auth.activeBranch?.()?.name ?? this.auth.user()?.branchName ?? 'this branch');

  private readonly _departments = signal<Department[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _users = signal<User[]>([]);
  private readonly _configs = signal<AutoAssignConfig[]>([]);
  readonly departments = this._departments.asReadonly();

  // Per-branch master toggles — one per auto-assign leg (owner: two
  // independent switches, technicians vs validators).
  protected readonly autoAssignEnabled = signal(false);
  protected readonly autoAssignValidatorsEnabled = signal(false);

  readonly allowNoScan = computed(() => this.tenantState.tenant()?.allowNoScanClaim === true);

  // ── Sample identification mode (tenant-wide): scan (QR) vs manual entry ──
  /** Current mode; anything other than 'manual' (incl. absent/empty) = 'scan'. */
  readonly scanMode = computed<'scan' | 'manual'>(() =>
    this.tenantState.tenant()?.scanMode === 'manual' ? 'manual' : 'scan');
  protected readonly scanModeOptions: Array<{ value: 'scan' | 'manual'; label: string; desc: string; short?: string }> = [
    { value: 'scan', short: 'Scan', label: 'Scan (QR / barcode)', desc: 'Camera scanner on the lab screens; hardware scanners also type into the field (default).' },
    { value: 'manual', short: 'Manual', label: 'Manual entry', desc: 'No QR — the sample number is shown and typed by hand.' },
  ];

  // ── Queue focus (per-branch): patient vs sample ──
  // No "Auto" card here — by default the focus FOLLOWS the Lab structure
  // (integrated → patient, standalone → sample, auto → by the board's spaces);
  // picking an option overrides it, and "follow" can be restored.
  protected readonly queueFocusMode = signal<'auto' | 'patient' | 'sample'>('auto');
  /** Server-resolved focus when the mode follows the lab structure. */
  protected readonly effectiveQueueFocus = signal<'patient' | 'sample'>('patient');
  protected readonly queueFocusOptions: Array<{ value: 'patient' | 'sample'; label: string; desc: string; short?: string }> = [
    { value: 'patient', short: 'Patient', label: 'Patient-focused', desc: 'Rows are patients; their tests nested underneath.' },
    { value: 'sample', short: 'Sample', label: 'Sample-focused', desc: 'Rows keyed by Sample ID; patient shown as secondary.' },
  ];
  /** The option that reads as selected: a forced mode wins; otherwise the
   *  structure-derived effective focus. */
  protected readonly queueFocusSelected = computed<'patient' | 'sample'>(() => {
    const m = this.queueFocusMode();
    return m === 'patient' || m === 'sample' ? m : this.effectiveQueueFocus();
  });

  // ── Lab structure (per-branch): auto (default) / integrated / standalone ──
  // Drives how vials group + sample-ID prefixes when an order is placed.
  // Auto is the default: the Branches-board arrangement applies (with nothing
  // arranged it behaves exactly like Integrated — everything in the one Lab).
  protected readonly labStructure = signal<'auto' | 'integrated' | 'standalone'>('auto');
  protected readonly labStructureOptions: Array<{ value: 'auto' | 'integrated' | 'standalone'; label: string; desc: string; short?: string }> = [
    { value: 'auto', short: 'Auto', label: 'Auto (default)', desc: 'Arrange departments on the lab spaces board; unplaced ones share the default "Lab" space.' },
    { value: 'integrated', label: 'Integrated', desc: 'One lab, one space: every department shares the default "Lab" space and its prefix.' },
    { value: 'standalone', label: 'Standalone', desc: 'Every department keeps its own sample-ID prefix; tubes are still shared per tube type.' },
  ];
  readonly collectionMode = this.labCfg.collectionMode;
  readonly billingMode = this.labCfg.billingMode;

  protected readonly requireValidation = signal(false);
  /** Technician notes on the report (per branch, off by default). */
  protected readonly techReportNotes = signal(false);
  /** The SINGLE code that prints on a specimen label. A tube label can't fit
   *  more than one, so this is a mutually-exclusive choice. */
  protected readonly labelCodeMode = signal<'barcode' | 'qr' | 'datamatrix'>('barcode');
  protected readonly labelCodeOptions: Array<{ value: 'barcode' | 'qr' | 'datamatrix'; label: string; desc: string; short?: string }> = [
    { value: 'barcode', short: '1D barcode', label: 'Barcode (1D)', desc: 'A 1D Code-128 barcode encoding the Sample ID (default).' },
    { value: 'qr', short: 'QR', label: 'QR (2D)', desc: 'A QR encoding the MRN + Sample ID.' },
    { value: 'datamatrix', short: 'Data Matrix', label: 'Data Matrix (2D)', desc: 'A compact Data Matrix (Sample ID) — fits a tiny tube area and still scans.' },
  ];
  setLabelCodeMode(v: 'barcode' | 'qr' | 'datamatrix') {
    const prev = this.labelCodeMode();
    if (prev === v) return;
    this.labelCodeMode.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { labelCodeMode: v }).pipe(this.tracked()).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success('Label code format updated'); },
      error: e => { this.labelCodeMode.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setQueueFocusMode(v: 'auto' | 'patient' | 'sample') {
    const prev = this.queueFocusMode();
    if (prev === v) return;
    this.queueFocusMode.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { queueFocusMode: v }).pipe(this.tracked()).subscribe({
      next: cfg => {
        if (cfg) { this.labCfg.update(cfg); this.effectiveQueueFocus.set(cfg.effectiveQueueFocus ?? 'patient'); }
        this.toasts.success('Queue focus updated');
      },
      error: e => { this.queueFocusMode.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setLabStructure(v: 'integrated' | 'standalone' | 'auto') {
    const prev = this.labStructure();
    if (prev === v) return;
    this.labStructure.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { labStructure: v }).pipe(this.tracked()).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success('Lab structure updated'); },
      error: e => { this.labStructure.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setRequireValidation(v: boolean) {
    this.requireValidation.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { requireValidationForAllResults: v }).pipe(this.tracked()).subscribe({
      next: () => this.toasts.success(v ? 'All results now require validation' : 'Direct-flow tests auto-validate again'),
      error: e => { this.requireValidation.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setTechReportNotes(v: boolean) {
    this.techReportNotes.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { techReportNotes: v }).pipe(this.tracked()).subscribe({
      next: cfg => {
        if (cfg) this.labCfg.update(cfg);
        this.toasts.success(v ? 'Technicians can now add notes that print on the report' : 'Technician report notes turned off — saved notes still print');
      },
      error: e => { this.techReportNotes.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }
  /** Lab spaces (names + codes) are edited on the Departments and lab spaces page. */
  goBranches() { this.router.navigate([LAB_SPACES_PATH], { queryParams: LAB_SPACES_QUERY }); }

  private readonly destroyRef = inject(DestroyRef);
  ngOnInit() {
    this.destroyRef.onDestroy(() => this.loadHold.cancel());
    this.tenantState.ensureLoaded();
    this.samplePresets.reload();
    this.labCfg.ensureLoaded();
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => {
        this.labelCodeMode.set(c?.labelCodeMode === 'both' ? 'barcode' : (c?.labelCodeMode ?? 'barcode'));
        this.requireValidation.set(c?.requireValidationForAllResults === true);
        this.techReportNotes.set(c?.techReportNotes === true);
        this.autoAssignEnabled.set(c?.autoAssignEnabled === true);
        this.autoAssignValidatorsEnabled.set(c?.autoAssignValidatorsEnabled === true);
        this.queueFocusMode.set(c?.queueFocusMode ?? 'auto');
        this.effectiveQueueFocus.set(c?.effectiveQueueFocus ?? 'patient');
        // Legacy "individual" reads as standalone; anything unknown/empty is
        // auto — the default.
        this.labStructure.set(
          c?.labStructure === 'standalone' || c?.labStructure === 'individual' ? 'standalone'
          : c?.labStructure === 'integrated' ? 'integrated'
          : 'auto');
        this.loadHold.done();
      },
      error: () => this.loadHold.done(),
    });
    // Auto-assign + the per-branch toggle are scoped to the ACTIVE branch (the
    // backend keys branch-lab-config / auto-assign on the X-Active-Branch
    // header). Departments are per-branch, so list ONLY this branch's — without
    // this filter the page showed every branch's departments, which looked like
    // duplicate "Biochemistry" rows (one per branch).
    const bid = this.auth.activeBranchId() ?? this.auth.user()?.branchId ?? null;
    this.api.get<Department[]>(bid ? `/api/tenants/departments?branchId=${bid}` : '/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });
    // Name-only pickers (GET api/roles/picker, api/users/picker): readable with
    // manage_lab_settings, so the auto-assign editor works for a Lab Admin
    // (Technical) without the user-admin lists (manage_users).
    this.api.get<Role[]>('/api/roles/picker').subscribe({
      next: l => this._roles.set(l ?? [])
    });
    this.api.get<User[]>('/api/users/picker').subscribe({
      next: l => this._users.set((l ?? []).filter(u => u.isActive !== false))
    });
    this.api.get<AutoAssignConfig[]>('/api/tenants/auto-assign-configs').subscribe({
      next: l => this._configs.set(l ?? [])
    });
  }

  /** Per-branch master toggle. Off → all received tests go to the queue. */
  setAutoAssignEnabled(v: boolean) {
    this.autoAssignEnabled.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { autoAssignEnabled: v }).pipe(this.tracked()).subscribe({
      next: () => this.toasts.success(v ? 'Auto-assign on for this branch' : 'Auto-assign off — tests go to the queue'),
      error: e => { this.autoAssignEnabled.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Validator-leg master toggle. Off → submitted results just wait in the
   *  shared validation queue. */
  setAutoAssignValidatorsEnabled(v: boolean) {
    this.autoAssignValidatorsEnabled.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { autoAssignValidatorsEnabled: v }).pipe(this.tracked()).subscribe({
      next: () => this.toasts.success(v ? 'Validator auto-assign on for this branch' : 'Validator auto-assign off — results wait in the shared queue'),
      error: e => { this.autoAssignValidatorsEnabled.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }

  private parseIds(json?: string | null): string[] {
    if (!json) return [];
    try { const v = JSON.parse(json); return Array.isArray(v) ? v.map(String) : []; }
    catch { return []; }
  }
  assigneesFor(departmentId: string): string[] {
    return this.parseIds(this._configs().find(c => c.departmentId === departmentId)?.assigneeUserIdsJson);
  }
  rolesFor(departmentId: string): string[] {
    return this.parseIds(this._configs().find(c => c.departmentId === departmentId)?.autoAssignRoleIdsJson);
  }
  validatorsFor(departmentId: string): string[] {
    return this.parseIds(this._configs().find(c => c.departmentId === departmentId)?.validatorUserIdsJson);
  }
  validatorRolesFor(departmentId: string): string[] {
    return this.parseIds(this._configs().find(c => c.departmentId === departmentId)?.validatorRoleIdsJson);
  }
  userName(id: string): string {
    const u = this._users().find(x => x.id === id);
    return u ? (u.displayName || u.firstName || u.email) : 'User';
  }
  roleName(id: string): string {
    return this._roles().find(r => r.id === id)?.name ?? 'Role';
  }
  /** Full option lists for the multi-select dropdowns. */
  readonly allUserOptions = computed<PfSelectOption<string>[]>(() =>
    this._users().map(u => ({ value: u.id, label: u.displayName || u.firstName || u.email })));
  readonly allRoleOptions = computed<PfSelectOption<string>[]>(() =>
    this._roles().map(r => ({ value: r.id, label: r.name })));

  /** Replace the whole selection for a department (from the multi-select).
   *  The PUT replaces the WHOLE config row, so every setter sends all four
   *  pools — otherwise changing the tech pool would wipe the validators. */
  setAssignees(departmentId: string, userIds: string[]) {
    this.upsert(departmentId, { assigneeUserIds: userIds ?? [] });
  }
  setRoles(departmentId: string, roleIds: string[]) {
    this.upsert(departmentId, { roleIds: roleIds ?? [] });
  }
  setValidators(departmentId: string, userIds: string[]) {
    this.upsert(departmentId, { validatorUserIds: userIds ?? [] });
  }
  setValidatorRoles(departmentId: string, roleIds: string[]) {
    this.upsert(departmentId, { validatorRoleIds: roleIds ?? [] });
  }
  removeAssignee(departmentId: string, userId: string) {
    this.setAssignees(departmentId, this.assigneesFor(departmentId).filter(id => id !== userId));
  }
  removeRole(departmentId: string, roleId: string) {
    this.setRoles(departmentId, this.rolesFor(departmentId).filter(id => id !== roleId));
  }

  private upsert(departmentId: string, change: Partial<{
    assigneeUserIds: string[]; roleIds: string[];
    validatorUserIds: string[]; validatorRoleIds: string[];
  }>) {
    const body = {
      departmentId,
      assigneeUserIds: change.assigneeUserIds ?? this.assigneesFor(departmentId),
      roleIds: change.roleIds ?? this.rolesFor(departmentId),
      validatorUserIds: change.validatorUserIds ?? this.validatorsFor(departmentId),
      validatorRoleIds: change.validatorRoleIds ?? this.validatorRolesFor(departmentId),
    };
    this.api.put<unknown>('/api/tenants/auto-assign-configs', body).pipe(this.tracked()).subscribe({
      next: () => {
        const patch: AutoAssignConfig = {
          departmentId,
          isEnabled: body.assigneeUserIds.length > 0 || body.roleIds.length > 0
                  || body.validatorUserIds.length > 0 || body.validatorRoleIds.length > 0,
          assigneeUserIdsJson: JSON.stringify(body.assigneeUserIds),
          autoAssignRoleIdsJson: JSON.stringify(body.roleIds),
          validatorUserIdsJson: JSON.stringify(body.validatorUserIds),
          validatorRoleIdsJson: JSON.stringify(body.validatorRoleIds),
        };
        this._configs.update(list => {
          const exists = list.some(c => c.departmentId === departmentId);
          return exists
            ? list.map(c => c.departmentId === departmentId ? { ...c, ...patch } : c)
            : [...list, patch];
        });
      },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  setAllowNoScan(v: boolean) {
    this.api.patch<Tenant>('/api/tenants/current', { allowNoScanClaim: v }).pipe(this.tracked()).subscribe({
      next: t => this.tenantState.update(t),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Sample-search preset (tenant-wide) ─────────────────────────────
  private readonly samplePresets = inject(SampleSearchPresetService);
  /** The lab's explicit choice; null = automatic (follows the ID format). */
  readonly samplePresetSetting = computed<boolean | null>(() => this.tenantState.tenant()?.sampleSearchPreset ?? null);
  readonly samplePresetDefault = computed(() => this.samplePresets.config()?.defaultEnabled ?? true);
  readonly samplePresetOn = computed(() => this.samplePresetSetting() ?? this.samplePresetDefault());
  /** "2609" now and "2610" next month, from the lab's real format. */
  readonly presetExample = computed<{ now: string; next: string } | null>(() => {
    const c = this.samplePresets.config();
    if (!c) return null;
    const d = labDate(new Date(), c.timeZone);
    const n = nextLabMonth(d);
    const a = sampleIdHead(c.prefix, c.datePrefix, c.separator, d);
    return a ? { now: a, next: sampleIdHead(c.prefix, c.datePrefix, c.separator, n) } : null;
  });

  setSamplePreset(v: boolean) {
    this.api.patch<Tenant>('/api/tenants/current', { sampleSearchPreset: v }).pipe(this.tracked()).subscribe({
      next: t => { this.tenantState.update(t); this.toasts.success(v ? 'Sample search pre-fills the current ID start' : 'Sample search starts empty'); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  resetSamplePreset() {
    this.api.patch<Tenant>('/api/tenants/current', { resetSampleSearchPreset: true }).pipe(this.tracked()).subscribe({
      next: t => this.tenantState.update(t),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Tenant-wide scan vs manual sample-identification mode. Broadcasts via
   *  tenantState so the lab screens flip immediately (no reload). */
  setScanMode(v: 'scan' | 'manual') {
    if (this.scanMode() === v) return;
    this.api.patch<Tenant>('/api/tenants/current', { scanMode: v }).pipe(this.tracked()).subscribe({
      next: t => { this.tenantState.update(t); this.toasts.success(v === 'manual' ? 'Manual entry — scanner hidden on lab screens' : 'Scan mode — QR/barcode scanner shown'); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // ── Calculation constants (tenant-wide) ───────────────────────────
  // ISI/MNPT are thromboplastin-reagent properties (INR); NORMAL_HCT anchors
  // the reticulocyte production index. Blank = shipped default, so the inputs
  // hold '' (placeholder shows the default) unless the tenant has set a value.
  protected readonly calcIsi = signal<number | ''>('');
  protected readonly calcMnpt = signal<number | ''>('');
  protected readonly calcNormalHct = signal<number | ''>('');
  private readonly _ccSync = effect(() => {
    const raw = this.tenantState.tenant()?.calcConstants;
    let obj: Record<string, unknown> = {};
    if (raw) { try { obj = JSON.parse(raw) as Record<string, unknown>; } catch { /* keep blanks */ } }
    this.calcIsi.set(typeof obj['ISI'] === 'number' ? obj['ISI'] : '');
    this.calcMnpt.set(typeof obj['MNPT'] === 'number' ? obj['MNPT'] : '');
    this.calcNormalHct.set(typeof obj['NORMAL_HCT'] === 'number' ? obj['NORMAL_HCT'] : '');
  });

  /** PATCH only the keys the tenant actually set — blanks fall back to the
   *  shipped defaults on the entry screens. The server accepts numbers only. */
  saveCalcConstants() {
    const out: Record<string, number> = {};
    const put = (k: string, v: number | '') => {
      const n = typeof v === 'number' ? v : Number(v);
      if (v !== '' && Number.isFinite(n) && n > 0) out[k] = n;
    };
    put('ISI', this.calcIsi());
    put('MNPT', this.calcMnpt());
    put('NORMAL_HCT', this.calcNormalHct());
    const next = Object.keys(out).length > 0 ? out : null;
    const cur = this.tenantState.tenant()?.calcConstants ?? null;
    const curNorm = cur ? JSON.stringify(JSON.parse(cur)) : null;
    if ((next ? JSON.stringify(next) : null) === curNorm) return;
    this.api.patch<Tenant>('/api/tenants/current', { calcConstants: next }).pipe(this.tracked()).subscribe({
      next: t => { this.tenantState.update(t); this.toasts.success('Calculation constants saved'); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Clamp to 1–9, then PATCH the tenant-wide sample number width. */

  // Billing/collection modes are now derived from the active Workflow.
  goWorkflow() { this.router.navigate(['/admin/process']); }
}
