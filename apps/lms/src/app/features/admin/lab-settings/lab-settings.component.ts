import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, effect, inject, signal } from '@angular/core';
import { MonoTypeOperatorFunction, defer, finalize } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { PAYMENT_RULE_PERMS } from '../../../core/auth/route-access';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BillingMode, BranchLabConfig, CollectionMode } from '../../../shared/models/branch-lab-config.model';
import { Department, Tenant } from '../../../shared/models/tenant.model';
import { Role, User } from '../../../shared/models/user.model';
import { ApiError } from '../../../shared/models/api-response.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { ThemeService } from '../../../core/services/theme.service';
import { LAB_SETTINGS_TABS } from '../../../shared/utils/settings-catalog';
import { BusyComponent, SkeletonCardComponent } from '../../../shared/primitives/skeleton-kit.component';
import { spinDelay } from '../../../shared/utils/busy';
import { createLoadHold } from '../../../shared/utils/min-duration';
import { SampleSearchPresetService } from '../../../core/services/sample-search-preset.service';
import { labDate, nextLabMonth, sampleIdHead } from '../../../shared/utils/sample-id-preset';

/** Band pill tabs — the 13 section cards grouped by what they govern. */
export type LabSettingsTab = 'collection' | 'queues' | 'rules' | 'report';

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
  imports: [FormsModule, RouterLink, ScreenHeaderComponent, SelectComponent, HeroBandComponent, SegmentedComponent, BusyComponent, SkeletonCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (owner): no search here — the section cards are grouped into
             tabs in a tabs-only pill. Every change autosaves, so no actions. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools>
            <pf-segmented class="pf-hb-tabs" size="sm" [options]="tabOptions" [value]="tab()"
                          (valueChange)="pickTab($event)"></pf-segmented>
          </ng-container>
          <!-- Autosave is authoritative here (no Save button): the band says
               so as the neutral save state with a violet check. -->
          <ng-container band-actions>
            <span class="pf-savestate pf-ls__savestate" role="status" title="Every change saves as you make it"
                  [attr.aria-busy]="savingShown() ? 'true' : null">
              @if (savingShown()) {
                <pf-busy label="Saving…"></pf-busy>
                <span class="pf-ls__savestate-t">Saving…</span>
              } @else {
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                <span class="pf-ls__savestate-t">Changes save automatically</span>
              }
            </span>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Lab"
        title="Lab settings"
        subtitle="Control how samples are auto-assigned to techs and whether supervisors can claim without a scan.">
      </pf-screen-header>

      <div class="pf-band-body">
      <!-- This page has no Save button by design: every change persists the
           moment you make it (OPS-15). Make that explicit so it doesn't read as
           unsaved. -->
      <div class="pf-ls__autosave pf-classic-only" role="status" [attr.aria-busy]="savingShown() ? 'true' : null">
        @if (savingShown()) {
          <pf-busy label="Saving…"></pf-busy>
          <span>Saving…</span>
        } @else {
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>Changes are saved automatically</span>
        }
      </div>

      @if (firstLoad()) {
        <!-- First load: the section cards' shape until the branch config lands. -->
        <div class="pf-ls__skel">
          <pf-skeleton-card [lines]="3" label="Loading lab settings…"></pf-skeleton-card>
          <pf-skeleton-card [lines]="4" label="Loading lab settings…"></pf-skeleton-card>
          <pf-skeleton-card [lines]="3" label="Loading lab settings…"></pf-skeleton-card>
        </div>
      } @else {

      <!-- Where these apply: most cards are per BRANCH (the signed-in one —
           the server scopes branch-lab-config to it); a few are for the
           whole organisation. Each card says which. -->
      <p class="pf-ls__scopenote" data-testid="ls-scope-note">
        Cards marked <strong>This branch</strong> apply to <strong>{{ branchName() }}</strong> only — switch branch to set
        another branch. <strong>All branches</strong> cards apply everywhere.
      </p>

      @if (showSec('collection')) {
      <!-- Counters & collection — now driven by the Workflow (single source) -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6"/></svg></span><h3 class="pf-card__label pf-ls__title">Counters &amp; collection</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          Whether <strong>billing</strong> and <strong>sample collection</strong> run at a separate
          counter is now set in the <strong>Workflow</strong>: drop the action into its own menu for a
          separate counter, or keep it inside Frontdesk to run inline. These stay in sync automatically.
        </p>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <span class="pf-chip pf-chip--static pf-ls__chipm">
            Billing — <strong style="color: var(--text-primary);">{{ billingMode() === 'separate_counter' ? 'Separate counter' : 'Front desk' }}</strong>
          </span>
          <span class="pf-chip pf-chip--static pf-ls__chipm">
            Collection — <strong style="color: var(--text-primary);">{{ collectionMode() === 'dedicated_counter' ? 'Dedicated counter' : 'Front desk' }}</strong>
          </span>
          <button type="button" class="pf-btn pf-btn--tertiary pf-ls__wfbtn" (click)="goWorkflow()">Edit in Workflow</button>
        </div>
      </div>
      </section>
      }

      @if (showSec('collection')) {
      <!-- Sample identification mode (tenant-wide) — governs the lab screens. -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14"/></svg></span><h3 class="pf-card__label pf-ls__title">Sample identification</h3><span class="pf-ls__scope pf-ls__scope--all" title="Applies to every branch">All branches</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          How techs identify a sample on the lab screens. <strong>Scan</strong> shows the camera
          QR/barcode scanner (a hardware scanner also types into the field). <strong>Manual</strong>
          hides the scanner and shows the <strong>sample number</strong> to read and type by hand.
        </p>
        <div class="pf-ls__gate" role="radiogroup">
          @for (opt of scanModeOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" role="radio" [attr.aria-checked]="scanMode() === opt.value"
                    (click)="setScanMode(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
        <!-- Sample-search preset (a lab user's suggestion): the lab search
             boxes open pre-typed with the current ID head. -->
        <div class="pf-ls__preset">
          <div class="pf-ls__preset-text">
            <span class="pf-ls__preset-t">Pre-fill sample search</span>
            <span class="pf-ls__hint">
              @if (presetExample(); as ex) {
                Collect, Receive and My Work open their sample search with
                <strong class="pf-ls__mono">{{ ex.now }}</strong> already typed — enter only the number.
                @if (ex.next !== ex.now) { It becomes <strong class="pf-ls__mono">{{ ex.next }}</strong> next month on its own. }
                Backspace clears it.
              } @else {
                Sample search boxes open with the current sample-ID start already typed — enter only the number.
              }
            </span>
            @if (samplePresetSetting() !== null) {
              <button type="button" class="pf-ls__link" style="margin-top: 6px;" (click)="resetSamplePreset()">
                Reset — {{ samplePresetDefault() ? 'on' : 'off' }} by default for this ID format
              </button>
            }
          </div>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="samplePresetOn()"
                  aria-label="Pre-fill sample search" (click)="setSamplePreset(!samplePresetOn())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
      </div>
      </section>
      }

      @if (showSec('queues')) {
      <!-- Queue focus (per-branch) — how the lab worklists group work. -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span><h3 class="pf-card__label pf-ls__title">Queue focus</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          How the technician worklist, lab intake and result-entry queues group work.
          <strong>Patient</strong> lists patients with their tests nested; <strong>Sample</strong>
          keys each row by Sample ID (patient shown small). By default this follows the
          <strong>Lab structure</strong> below — pick one to override it.
        </p>
        <div class="pf-ls__gate" role="radiogroup">
          @for (opt of queueFocusOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" role="radio" [attr.aria-checked]="queueFocusSelected() === opt.value"
                    (click)="setQueueFocusMode(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
        @if (queueFocusMode() === 'auto') {
          <p class="pf-ls__hint" style="margin-top: 10px;">
            Following the lab structure — currently
            <strong style="color: var(--text-primary);">{{ effectiveQueueFocus() === 'sample' ? 'Sample-focused' : 'Patient-focused' }}</strong>.
          </p>
        } @else {
          <button type="button" class="pf-ls__link" style="margin-top: 10px;" (click)="setQueueFocusMode('auto')">
            Reset — follow the lab structure
          </button>
        }
      </div>
      </section>
      }

      @if (showSec('queues')) {
      <!-- Lab structure (per-branch): integrated / standalone / auto -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></span><h3 class="pf-card__label pf-ls__title">Lab structure</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          How this branch's tubes group into spaces.
          <strong>Auto</strong> (default) = arrange freely on the Branches board —
          placed departments follow their space, the rest share the default "Lab".
          <strong>Integrated</strong> = one lab, ONE space — everything shares the
          default "Lab" space.
          <strong>Standalone</strong> = every department keeps its own sample-ID
          prefix. In every structure one tube per tube type is drawn per visit,
          whatever the department (CBC + HbA1c share one EDTA); only a separate
          space draws its own tube.
        </p>
        <div class="pf-ls__gate" role="radiogroup">
          @for (opt of labStructureOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" role="radio" [attr.aria-checked]="labStructure() === opt.value"
                    (click)="setLabStructure(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
        <p class="pf-ls__hint" style="margin-top: 12px;">
          Tip: set the default "Lab" code (the sample-ID prefix for departments with no
          dedicated space) on the default "Lab" lane in <strong>Branches</strong> —
          leave it blank for no prefix.
        </p>
        <button type="button" class="pf-ls__link" style="margin-top: 6px;" (click)="goBranches()">Open Branches</button>
      </div>
      </section>
      }

      @if (showSec('collection')) {
      <!-- Sample IDs have ONE home each: the format (date, separator, digits)
           is Organization › Sample ID; each space's prefix is on the
           Branches board. (The old "number width" here was read by nothing
           — removed 2026-11-01.) This is a pointer, not an editor. -->
      <section class="pf-card pf-ls__card" data-testid="ls-sample-ids">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg></span><h3 class="pf-card__label pf-ls__title">Sample IDs</h3></div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
            Every tube's ID is <strong>prefix + date + number</strong> (e.g. <span class="pf-num">MIC-2607-00001</span>).
            The <strong>format</strong> is set once for the organisation; the <strong>prefix</strong> is each
            lab space's code, set per branch.
          </p>
          <div class="pf-ls__links">
            <button type="button" class="pf-btn pf-btn--secondary pf-ls__linkbtn" (click)="goSampleIdFormat()">Sample ID format</button>
            <button type="button" class="pf-btn pf-btn--secondary pf-ls__linkbtn" (click)="goBranches()">Prefixes in Branches</button>
          </div>
        </div>
      </section>
      }

      @if (showSec('rules')) {
      <!-- Calculation constants (tenant-wide) — feed calculated results. -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/></svg></span><h3 class="pf-card__label pf-ls__title">Calculation constants</h3><span class="pf-ls__scope pf-ls__scope--all" title="Applies to every branch">All branches</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          Lab-specific numbers used by calculated results during entry.
          <strong>ISI</strong> and <strong>MNPT</strong> come from your thromboplastin
          reagent's insert (they drive INR); <strong>Normal HCT</strong> anchors the
          reticulocyte production index. Leave blank to use the defaults shown.
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-4">
          <label class="block max-w-[130px]">
            <span class="pf-field__lbl">ISI</span>
            <input class="pf-input pf-num mt-1" type="number" step="0.01" min="0" placeholder="1.0"
                   [ngModel]="calcIsi()"
                   (ngModelChange)="calcIsi.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
          <label class="block max-w-[150px]">
            <span class="pf-field__lbl">MNPT (seconds)</span>
            <input class="pf-input pf-num mt-1" type="number" step="0.1" min="0" placeholder="12.0"
                   [ngModel]="calcMnpt()"
                   (ngModelChange)="calcMnpt.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
          <label class="block max-w-[150px]">
            <span class="pf-field__lbl">Normal HCT (%)</span>
            <input class="pf-input pf-num mt-1" type="number" step="1" min="1" max="99" placeholder="45"
                   [ngModel]="calcNormalHct()"
                   (ngModelChange)="calcNormalHct.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
        </div>
      </div>
      </section>
      }

      @if (showSec('rules')) {
      <!-- No-scan override (tenant-wide) -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z"/></svg></span><h3 class="pf-card__label pf-ls__title">Allow no-scan claim (supervisor override)</h3><span class="pf-ls__scope pf-ls__scope--all" title="Applies to every branch">All branches</span><span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="allowNoScan()" aria-label="Allow no-scan claim (supervisor override)"
                  (click)="setAllowNoScan(!allowNoScan())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
              When ON, a supervisor can claim a test without scanning the vial — for broken or
              smudged barcodes. Every override is audit-logged. Leave OFF for strict
              scan-first workflow.
            </p>
        </div>
      </section>
      }

      @if (showSec('rules')) {
      <!-- Inventory master switch — only when the tenant is entitled to the
           inventory module, so an admin can't turn on a module they don't have. -->
      @if (entitlements.moduleEnabled('inventory')) {
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span><h3 class="pf-card__label pf-ls__title">Enable inventory</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span><span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="inventoryEnabled()" aria-label="Enable inventory"
                  (click)="setInventoryEnabled(!inventoryEnabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
              Track consumable stock (tubes, kits, reagents). When ON, usage is auto-deducted at
              collection and a test <strong>can't be ordered if its kit isn't fully in stock</strong>.
              When OFF, inventory is ignored entirely. Manage stock under Admin → Inventory.
            </p>
        </div>
      </section>
      }
      }

      @if (showSec('rules') && canManagePayments()) {
      <!-- Payment gate: choose WHERE an unpaid balance blocks the workflow.
           Revenue policy — billing / organisation admins only (never the
           Lab Admin (Technical) role); the server refuses it the same way. -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg></span><h3 class="pf-card__label pf-ls__title">Require full payment to progress</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          Choose where an unpaid balance blocks the workflow. Sample <em>collection</em> is never blocked —
          you can bill pay-later / part-advance and still draw the tube; the difference is settled at the gate.
        </p>
        <div class="pf-ls__gate" role="radiogroup">
          @for (opt of gateOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" role="radio" [attr.aria-checked]="paymentGateStage() === opt.value"
                    (click)="setPaymentGateStage(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
      </div>
      </section>
      }

      @if (showSec('collection')) {
      <!-- Specimen label CODE — a per-branch policy (branch-lab-config). Label SIZE + printer + darkness
           are per-station (a user's Print settings), never stored in the cloud. -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg></span><h3 class="pf-card__label pf-ls__title">Specimen label code</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          The <strong>one</strong> machine-readable code printed on every tube label in this
          branch. A tube label can't fit more than one. Label size, printer &amp; darkness
          are set per station under <strong>Printing</strong> (profile menu).
        </p>

        <div class="pf-ls__gate mt-3" role="radiogroup">
          @for (opt of labelCodeOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" role="radio" [attr.aria-checked]="labelCodeMode() === opt.value"
                    (click)="setLabelCodeMode(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>

      </div>
      </section>
      }

      @if (showSec('rules')) {
      <!-- Require validation for all results -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></span><h3 class="pf-card__label pf-ls__title">Require validation for all results</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span><span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="requireValidation()" aria-label="Require validation for all results"
                  (click)="setRequireValidation(!requireValidation())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
              When ON, every result must be validated by a pathologist — even tests set to
              <strong>direct flow</strong> (which otherwise auto-validate on entry). Leave OFF for default behaviour.
            </p>
        </div>
      </section>
      }

      @if (showSec('rules') && canManagePayments()) {
      <!-- Front-desk Payments-due tab visibility (billing admins only). -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/></svg></span><h3 class="pf-card__label pf-ls__title">Show "Payments due" tab</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span><span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="showPaymentsDue()" aria-label="Show &quot;Payments due&quot; tab"
                  (click)="setShowPaymentsDue(!showPaymentsDue())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
              When ON, the front-desk shows a <strong>Payments due</strong> tab listing every order with an
              outstanding balance. In Progress and Completed are always shown. Leave OFF to hide it.
            </p>
        </div>
      </section>
      }

      @if (showSec('report')) {
      <!-- The consolidated abnormal-results sheet is a report-template option:
           its ONE switch lives in Report Template › Results table (with the
           live preview). A pointer here, never a second switch. -->
      <section class="pf-card pf-ls__card" data-testid="ls-abnormal-link">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg></span><h3 class="pf-card__label pf-ls__title">Report layout</h3></div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
            The consolidated abnormal results sheet, columns, letterhead and the rest of the report layout
            are set in <strong>Report Template</strong>.
          </p>
          <div class="pf-ls__links">
            <button type="button" class="pf-btn pf-btn--secondary pf-ls__linkbtn" (click)="goReportTemplate()">Open Report Template</button>
          </div>
        </div>
      </section>
      }

      @if (showSec('report')) {
      <!-- Technician notes on the report (per branch, like the other
           result-entry switches): the bench writes rich-text notes that print
           under a test, a profile, a department section or the whole report. -->
      <section class="pf-card pf-ls__card" data-testid="ls-tech-notes">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg></span><h3 class="pf-card__label pf-ls__title">Technician notes on report</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span><span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="techReportNotes()"
                  aria-label="Technician notes on report" (click)="setTechReportNotes(!techReportNotes())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">
            When ON, technicians entering results can add a note that <strong>prints on the final report</strong> (and an amended final; never on a preliminary / partial release) —
            under a test (also each test inside a profile), under a profile, at the end of a department section,
            or for the whole report. Notes can be <strong>bold</strong>, <em>italic</em>, underlined, or bulleted /
            numbered lists, and stay editable until the test is validated (after that, through Edit result).
            The validating pathologist sees every note on the validation screen. Turning it OFF hides the notes on result entry; notes already written still print.
          </p>
        </div>
      </section>
      }

      @if (showSec('report')) {
      <!-- WhatsApp, Email and SMS moved to Settings → Communication (2026-11-13): ONE place for them. -->
      <section class="pf-card pf-ls__card" data-testid="ls-comms-link">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg></span><h3 class="pf-card__label pf-ls__title">WhatsApp, email and SMS</h3><span class="pf-card__spacer"></span></div>
        <div class="pf-ls__cardbody">
          <p class="pf-ls__hint">Sending reports and invoices by WhatsApp, email and SMS is set up in <strong>Communication</strong>.</p>
          <div class="pf-ls__links">
            <a class="pf-btn pf-btn--secondary pf-ls__linkbtn press" routerLink="/admin/communication" data-testid="ls-comms-open">Open Communication</a>
          </div>
        </div>
      </section>
      }

      @if (showSec('queues')) {
      <!-- Auto-assign per department -->
      <section class="pf-card pf-ls__card">
        <div class="pf-card__head"><span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg></span><h3 class="pf-card__label pf-ls__title">Auto-assign by department</h3><span class="pf-ls__scope" title="Applies to the branch you are signed in to">This branch</span></div>
        <div class="pf-ls__cardbody">
        <p class="pf-ls__hint">
          Two independent legs. <strong>Technicians</strong> — when a sample is received, each test is
          routed to the person (or least-loaded member of a role) set for its department.
          <strong>Validators</strong> — when a tech submits a result, it is routed to the least-loaded
          validator the same way. Departments with nothing set fall into the shared queue.
          A consultant listed as a department's validator (here or in Users &amp; roles) sees and signs
          only their departments' results; consultants listed nowhere see every department.
        </p>

        <!-- Master toggles for this branch: one per leg -->
        <div class="flex items-start justify-between gap-4 pf-ls__autoassign-master">
          <div class="min-w-0">
            <p class="pf-ls__dept-name">Auto-assign technicians</p>
            <p class="pf-ls__hint">On receive, route each test to its department's tech pool. Off → the shared bench queue.</p>
          </div>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignEnabled()" aria-label="Auto-assign technicians"
                  (click)="setAutoAssignEnabled(!autoAssignEnabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="flex items-start justify-between gap-4 pf-ls__autoassign-master">
          <div class="min-w-0">
            <p class="pf-ls__dept-name">Auto-assign validators</p>
            <p class="pf-ls__hint">On submit, route the result to its department's validator pool. Their Pending-validation screen lists it first; any validator of that department can still validate it.</p>
          </div>
          <button type="button" class="pf-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignValidatorsEnabled()" aria-label="Auto-assign validators"
                  (click)="setAutoAssignValidatorsEnabled(!autoAssignValidatorsEnabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>

        @if (departments().length === 0) {
          <p class="pf-ls__empty">No departments yet — add them from Branches first.</p>
        } @else {
          <div class="pf-ls__dept-grid" [class.pf-ls__dept-grid--off]="!autoAssignEnabled() && !autoAssignValidatorsEnabled()">
            @for (d of departments(); track d.id) {
              <div class="pf-ls__dept">
                <div class="pf-ls__dept-head">
                  <div>
                    <p class="pf-ls__dept-name">{{ d.name }}</p>
                    <p class="pf-ls__dept-code">{{ d.code }}</p>
                  </div>
                </div>

                <p class="pf-ls__pool" [class.pf-ls__pool--off]="!autoAssignEnabled()">Technicians — enter results</p>
                <label class="pf-ls__label">People</label>
                <pf-select
                  [multiple]="true"
                  [options]="allUserOptions()"
                  [values]="assigneesFor(d.id)"
                  placeholder="Select people…"
                  [disabled]="!autoAssignEnabled()"
                  (valuesChange)="setAssignees(d.id, $any($event))">
                </pf-select>

                <label class="pf-ls__label">Roles (least-loaded member gets it)</label>
                <pf-select
                  [multiple]="true"
                  [options]="allRoleOptions()"
                  [values]="rolesFor(d.id)"
                  placeholder="Select roles…"
                  [disabled]="!autoAssignEnabled()"
                  (valuesChange)="setRoles(d.id, $any($event))">
                </pf-select>

                @if (autoAssignEnabled() && !assigneesFor(d.id).length && !rolesFor(d.id).length) {
                  <p class="pf-ls__warn">No one set — this department's tests go to the shared queue.</p>
                }

                <!-- Always editable: the pool also decides which departments a
                     consultant sees (the switch above only controls routing). -->
                <p class="pf-ls__pool">Validators — review and sign this department's results</p>
                <label class="pf-ls__label">People</label>
                <pf-select
                  [multiple]="true"
                  [options]="allUserOptions()"
                  [values]="validatorsFor(d.id)"
                  placeholder="Select people…"
                  (valuesChange)="setValidators(d.id, $any($event))">
                </pf-select>

                <label class="pf-ls__label">Roles (least-loaded member gets it)</label>
                <pf-select
                  [multiple]="true"
                  [options]="allRoleOptions()"
                  [values]="validatorRolesFor(d.id)"
                  placeholder="Select roles…"
                  (valuesChange)="setValidatorRoles(d.id, $any($event))">
                </pf-select>

                @if (autoAssignValidatorsEnabled() && !validatorsFor(d.id).length && !validatorRolesFor(d.id).length) {
                  <p class="pf-ls__warn">No one set — this department's results wait in the shared validation queue.</p>
                }
              </div>
            }
          </div>
        }
      </div>
      </section>
      }
      }
      </div>
    </section>
  `,
  styles: [`
    .pf-ls__skel { display: flex; flex-direction: column; gap: 16px; }
    .pf-ls__autosave {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 2px 0 18px; padding: 5px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 600;
      /* Palette only (pf-kit): a neutral chip, no green. */
      color: var(--text-secondary);
      background: var(--pf-chip-bg, rgba(127, 127, 127, 0.1));
      border: 1px solid var(--pf-line, rgba(127, 127, 127, 0.25));
    }
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    /* ── ND audit: kit cards (BILLING header), slate switches, neutral radios ── */
    .pf-ls__card { margin-bottom: 16px; }
    .pf-ls__card .pf-ls__title.pf-card__label { font-size: 13px; }
    /* Where a card applies: a quiet neutral chip after the title. */
    .pf-ls__scope {
      flex: none; margin-left: 8px; padding: 2px 8px; border-radius: 999px;
      border: 1px solid var(--pf-line); background: var(--pf-chip-bg);
      font-size: 11px; font-weight: 600; line-height: 1.4; color: var(--text-secondary);
      text-transform: none; letter-spacing: 0; white-space: nowrap;
    }
    .pf-ls__scope--all { color: var(--text-tertiary); }
    .pf-ls__scopenote { margin: 0 0 12px; font-size: 12.5px; line-height: 1.55; color: var(--text-tertiary); }
    .pf-ls__scopenote strong { color: var(--text-secondary); font-weight: 600; }
    .pf-ls__links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .pf-ls__linkbtn { min-height: 40px; }
    .pf-ls__cardbody { padding: 14px 18px 18px; }
    .pf-ls__cardbody > .pf-ls__hint:first-child { margin-top: 0; }
    .pf-ls__switch { flex: none; }
    .pf-ls__chipm { height: auto; min-height: 30px; white-space: normal; }
    .pf-ls__wfbtn { height: 32px; min-height: 32px; }
    @media (max-width: 640px) {
      .pf-ls__savestate-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    }
    .pf-ls__preset { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--glass-border, rgba(148,163,184,0.25)); }
    .pf-ls__preset-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .pf-ls__preset-t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-primary); }
    .pf-ls__link  { background: none; border: none; padding: 0; font-size: 12.5px; color: var(--color-violet-400, #a78bfa); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .pf-ls__link:hover { color: var(--color-violet-300, #c4b5fd); }
    .pf-ls__empty { margin: 12px 0 0; font-size: 13px; color: var(--text-tertiary); font-style: italic; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 12px; color: var(--text-secondary); font-style: italic; }
    /* Pool sub-headings inside a department card (Technicians / Validators). */
    .pf-ls__pool { margin: 14px 0 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
    .pf-ls__pool:first-of-type { margin-top: 10px; }
    .pf-ls__pool--off { opacity: 0.45; }


    /* Payment-gate radio options */
    .pf-ls__gate { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .pf-ls__gate-opt { display: flex; align-items: flex-start; gap: 12px; text-align: left; padding: 12px 14px; border-radius: var(--pf-radius); background: var(--pf-card-bg); border: 1px solid var(--pf-line); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
    .pf-ls__gate-opt:hover { border-color: var(--pf-sel-border); }
    /* Neutral selected state; the radio's small violet dot is the one accent. */
    .pf-ls__gate-opt[aria-checked='true'] { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-ls__gate-opt:focus-visible { outline: 2px solid var(--color-violet-600, #7c3aed); outline-offset: 2px; }
    .pf-ls__gate-radio { flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--border-input, #cbd5e1); position: relative; transition: border-color .15s ease; }
    .pf-ls__gate-opt[aria-checked='true'] .pf-ls__gate-radio { border-color: var(--color-violet-500, #7c3aed); }
    .pf-ls__gate-opt[aria-checked='true'] .pf-ls__gate-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--color-violet-500, #7c3aed); }
    .pf-ls__gate-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-ls__gate-t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__gate-s { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }


    .pf-ls__autoassign-master {
      margin-top: 12px; padding: 12px 14px;
      border: 1px solid var(--pf-line); border-radius: var(--pf-radius);
      background: var(--pf-card-bg);
    }
    .pf-ls__dept-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    /* When the master toggle is off, dim the per-department editors — their
       selects are disabled and have no effect until auto-assign is on. */
    .pf-ls__dept-grid--off { opacity: 0.5; }
    .pf-ls__chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 8px; }
    .pf-ls__chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 4px 6px 4px 10px; border-radius: 999px; font-size: 12.5px;
      background: color-mix(in srgb, var(--accent, #a855f7) 16%, transparent);
      color: var(--text-primary); border: 1px solid var(--glass-border);
    }
    .pf-ls__chip-x {
      display: inline-flex; align-items: center; justify-content: center;
      width: 18px; height: 18px; border-radius: 999px; border: 0; cursor: pointer;
      background: rgba(255,255,255,0.12); color: var(--text-secondary); font-size: 10px; line-height: 1;
    }
    .pf-ls__chip-x:hover:not(:disabled) { background: rgba(255,255,255,0.22); color: var(--text-primary); }
    .pf-ls__chip-x:disabled { opacity: 0.4; cursor: not-allowed; }
    .pf-ls__dept {
      padding: 14px;
      border-radius: var(--pf-radius);
      background: var(--pf-card-bg);
      border: 1px solid var(--pf-line);
      display: flex; flex-direction: column; gap: 8px;
    }
    .pf-ls__dept-head {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
    }
    .pf-ls__radio-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    .pf-ls__radio {
      cursor: pointer;
      display: flex; flex-direction: column; gap: 2px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pf-ls__radio:hover { border-color: rgba(168, 85, 247, 0.35); }
    .pf-ls__radio--on { border-color: var(--pf-sel-border); background: var(--pf-sel-bg); }
    .pf-ls__radio input { position: absolute; opacity: 0; pointer-events: none; }
    .pf-ls__radio-title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__radio-sub { font-size: 11.5px; color: var(--text-tertiary); }

    .pf-ls__dept-name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__dept-code { margin: 2px 0 0; font-size: 11.5px; font-variant-numeric: tabular-nums; color: var(--text-muted); }
    .pf-ls__label { margin: 8px 0 4px; font-size: 12px; font-weight: 500; color: var(--text-secondary); }

    /* ── Cross-platform overrides — additive only, never touch base rules ── */

    /* Coarse-pointer (touch) sizing: make the toggle a >=44px tap target
       without changing its visual track size. Scoped to this page's toggle. */
    @media (pointer: coarse) {
      :host .pf-ls__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; }

      /* This page's own action button (Edit in Workflow): the toolbar
         primitives already meet 44px, but this inline button is sized with
         small Tailwind padding — bump its hit area. */
      :host button[type="button"] { min-height: 44px; }
    }

    /* Touch devices: the inline text buttons use Tailwind hover: classes which
       otherwise stick after a tap. Gate the page's own hover affordances. */
    @media (hover: none) {
      :host .text-violet-400.hover\\:text-violet-300:hover { color: var(--violet-text); }
    }

    /* Phone (<=640): keep iOS from auto-zooming form fields by ensuring
       a >=16px font on this page's own controls. Targets element selectors
       under :host so the shared .pf-input primitive is left untouched. */
    @media (max-width: 640px) {
      :host .px-4 { padding-left: 16px; padding-right: 16px; }
      :host select,
      :host input[type="text"],
      :host input[type="number"],
      :host input:not([type]) { font-size: 16px; }

      /* Auto-assign dept grid uses minmax(260px,…) which can exceed a narrow
         phone's available width (section + tile padding) and force horizontal
         overflow. Collapse to a single fluid column on phones. */
      :host .pf-ls__dept-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class LabSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  protected readonly entitlements = inject(TenantEntitlementsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  /** Band pill tabs (new design). Classic shows every card, as before. */
  readonly tabOptions: SegmentedOption<LabSettingsTab>[] = [
    { value: 'collection', label: 'Collection & IDs' },
    { value: 'queues', label: 'Queues & assignment' },
    { value: 'rules', label: 'Rules & gates' },
    { value: 'report', label: 'Report' },
  ];
  readonly tab = signal<LabSettingsTab>('collection');

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
  /** Switch tab and keep it in the URL (`?tab=`, replacing this history
   *  entry) so a reload, a shared link and back all return to it. */
  pickTab(t: LabSettingsTab): void {
    this.tab.set(t);
    void this.router.navigate([], { queryParams: { tab: t }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  /** The branch the per-branch cards on this page apply to (the signed-in /
   *  active branch — the server scopes branch-lab-config to it). */
  readonly branchName = computed(() => this.auth.activeBranch?.()?.name ?? this.auth.user()?.branchName ?? 'this branch');
  showSec(key: LabSettingsTab): boolean {
    return !this.theme.isNewDesign() || this.tab() === key;
  }

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
  protected readonly scanModeOptions: Array<{ value: 'scan' | 'manual'; label: string; desc: string }> = [
    { value: 'scan', label: 'Scan (QR / barcode)', desc: 'Camera scanner on the lab screens; hardware scanners also type into the field (default).' },
    { value: 'manual', label: 'Manual entry', desc: 'No QR — the sample number is shown and typed by hand.' },
  ];

  // ── Queue focus (per-branch): patient vs sample ──
  // No "Auto" card here — by default the focus FOLLOWS the Lab structure
  // (integrated → patient, standalone → sample, auto → by the board's spaces);
  // picking an option overrides it, and "follow" can be restored.
  protected readonly queueFocusMode = signal<'auto' | 'patient' | 'sample'>('auto');
  /** Server-resolved focus when the mode follows the lab structure. */
  protected readonly effectiveQueueFocus = signal<'patient' | 'sample'>('patient');
  protected readonly queueFocusOptions: Array<{ value: 'patient' | 'sample'; label: string; desc: string }> = [
    { value: 'patient', label: 'Patient-focused', desc: 'Rows are patients; their tests nested underneath.' },
    { value: 'sample', label: 'Sample-focused', desc: 'Rows keyed by Sample ID; patient shown as secondary.' },
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
  protected readonly labStructureOptions: Array<{ value: 'auto' | 'integrated' | 'standalone'; label: string; desc: string }> = [
    { value: 'auto', label: 'Auto (default)', desc: 'You arrange it: drag departments between spaces on the Branches board. A placed department follows its space (code + shared vials); unplaced departments share the default "Lab" space.' },
    { value: 'integrated', label: 'Integrated', desc: 'One lab, ONE space. Every department shares the default "Lab" space — same-colour tests draw one shared tube with the Lab-code prefix. Space arrangement on the Branches board is ignored.' },
    { value: 'standalone', label: 'Standalone', desc: 'Every department keeps its own sample-ID prefix (the department code). Tubes are still shared: one tube per tube type per visit, whatever the department.' },
  ];
  readonly collectionMode = this.labCfg.collectionMode;
  readonly billingMode = this.labCfg.billingMode;

  // Branch lab-config toggles.
  protected readonly inventoryEnabled = signal(false);
  /** Where the "require full payment" gate applies: none | dispatch | report. */
  protected readonly paymentGateStage = signal<'none' | 'dispatch' | 'report'>('none');
  protected readonly gateOptions: Array<{ value: 'none' | 'dispatch' | 'report'; label: string; desc: string }> = [
    { value: 'none', label: 'Off', desc: 'Billing, dispatch and reporting run independently (default).' },
    { value: 'dispatch', label: 'Block at dispatch', desc: "Samples can't be dispatched to the lab until the bill is fully paid (strongest)." },
    { value: 'report', label: 'Block at report', desc: "Dispatch is allowed, but the report can't be shared until the bill is fully paid." },
  ];
  protected readonly requireValidation = signal(false);
  /** Technician notes on the report (per branch, off by default). */
  protected readonly techReportNotes = signal(false);
  protected readonly showPaymentsDue = signal(true);
  /** The SINGLE code that prints on a specimen label. A tube label can't fit
   *  more than one, so this is a mutually-exclusive choice. */
  protected readonly labelCodeMode = signal<'barcode' | 'qr' | 'datamatrix'>('barcode');
  protected readonly labelCodeOptions: Array<{ value: 'barcode' | 'qr' | 'datamatrix'; label: string; desc: string }> = [
    { value: 'barcode', label: 'Barcode (1D)', desc: 'A 1D Code-128 barcode encoding the Sample ID (default).' },
    { value: 'qr', label: 'QR (2D)', desc: 'A QR encoding the MRN + Sample ID.' },
    { value: 'datamatrix', label: 'Data Matrix (2D)', desc: 'A compact Data Matrix (Sample ID) — fits a tiny tube area and still scans.' },
  ];
  setInventoryEnabled(v: boolean) {
    this.inventoryEnabled.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { inventoryEnabled: v }).pipe(this.tracked()).subscribe({
      next: cfg => {
        // Push the fresh config into the shared service so the Stores nav entry
        // appears / disappears immediately (no reload needed).
        if (cfg) this.labCfg.update(cfg);
        this.toasts.success(v ? 'Inventory enabled for this branch' : 'Inventory disabled');
      },
      error: e => { this.inventoryEnabled.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setPaymentGateStage(v: 'none' | 'dispatch' | 'report') {
    const prev = this.paymentGateStage();
    if (prev === v) return;
    this.paymentGateStage.set(v);
    const msg = v === 'none' ? 'Payment gate removed'
      : v === 'dispatch' ? 'Full payment now required before dispatch'
      : 'Full payment now required before sharing the report';
    this.api.patch('/api/tenants/branch-lab-config', { paymentGateStage: v }).pipe(this.tracked()).subscribe({
      next: () => this.toasts.success(msg),
      error: e => { this.paymentGateStage.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
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
  setShowPaymentsDue(v: boolean) {
    this.showPaymentsDue.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { showPaymentsDueTab: v }).pipe(this.tracked()).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success(v ? '"Payments due" tab shown at the front desk' : '"Payments due" tab hidden'); },
      error: e => { this.showPaymentsDue.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }

  goReportTemplate() { this.router.navigate(['/admin/reports'], { queryParams: { tab: 'table' } }); }
  goSampleIdFormat() { this.router.navigate(['/admin/organization'], { queryParams: { tab: 'sample' } }); }
  goBranches() { this.router.navigate(['/admin/branches']); }

  private readonly destroyRef = inject(DestroyRef);
  /** Payment gate + Payments-due tab — revenue policy (PATCH branch-lab-config
   *  refuses those fields without manage_tenant / manage_billing_config). */
  readonly canManagePayments = computed(() => this.auth.hasAnyPermission(PAYMENT_RULE_PERMS));

  ngOnInit() {
    this.destroyRef.onDestroy(() => this.loadHold.cancel());
    // Deep link: …/lab-settings?tab=<collection|queues|rules|report> opens that
    // tab (the settings search and other pages link straight to a card).
    const t = this.router.parseUrl(this.router.url).queryParams['tab'];
    if ((LAB_SETTINGS_TABS as readonly string[]).includes(t)) this.tab.set(t as LabSettingsTab);
    // The old WhatsApp deep link (…/lab-settings?tab=whatsapp) lands on Communication.
    if (t === 'whatsapp' || t === 'email' || t === 'sms') {
      void this.router.navigate(['/admin/communication'], { queryParams: { tab: t }, replaceUrl: true });
    }
    this.tenantState.ensureLoaded();
    this.samplePresets.reload();
    this.labCfg.ensureLoaded();
    this.entitlements.ensureLoaded();
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => {
        this.inventoryEnabled.set(c?.inventoryEnabled === true);
        this.paymentGateStage.set(c?.paymentGateStage ?? (c?.requireBillBeforeCollection ? 'dispatch' : 'none'));
        this.labelCodeMode.set(c?.labelCodeMode === 'both' ? 'barcode' : (c?.labelCodeMode ?? 'barcode'));
        this.requireValidation.set(c?.requireValidationForAllResults === true);
        this.techReportNotes.set(c?.techReportNotes === true);
        this.autoAssignEnabled.set(c?.autoAssignEnabled === true);
        this.autoAssignValidatorsEnabled.set(c?.autoAssignValidatorsEnabled === true);
        this.showPaymentsDue.set(c?.showPaymentsDueTab !== false);
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
