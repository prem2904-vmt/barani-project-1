import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
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
import { TileComponent } from '../../../shared/primitives/tile.component';

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
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="px-4 md:px-8 pt-6 pb-10">
      <pf-screen-header
        eyebrow="Admin · Lab"
        title="Lab settings"
        subtitle="Control how samples are auto-assigned to techs and whether supervisors can claim without a scan.">
      </pf-screen-header>

      <!-- This page has no Save button by design: every change persists the
           moment you make it (OPS-15). Make that explicit so it doesn't read as
           unsaved. -->
      <div class="pf-ls__autosave" role="status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        <span>Changes are saved automatically</span>
      </div>

      <!-- Counters & collection — now driven by the Workflow (single source) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Counters &amp; collection</h3>
        <p class="pf-ls__hint">
          Whether <strong>billing</strong> and <strong>sample collection</strong> run at a separate
          counter is now set in the <strong>Workflow</strong>: drop the action into its own menu for a
          separate counter, or keep it inside Frontdesk to run inline. These stay in sync automatically.
        </p>
        <div class="flex flex-wrap items-center gap-2 mt-3">
          <span class="text-[12px] px-3 py-1 rounded-full" style="background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);">
            Billing — <strong style="color: var(--text-primary);">{{ billingMode() === 'separate_counter' ? 'Separate counter' : 'Front desk' }}</strong>
          </span>
          <span class="text-[12px] px-3 py-1 rounded-full" style="background: var(--glass-bg); border: 1px solid var(--glass-border); color: var(--text-secondary);">
            Collection — <strong style="color: var(--text-primary);">{{ collectionMode() === 'dedicated_counter' ? 'Dedicated counter' : 'Front desk' }}</strong>
          </span>
          <button type="button" class="text-[12px] font-semibold text-violet-400 hover:text-violet-300" (click)="goWorkflow()">Edit in Workflow →</button>
        </div>
      </pf-tile>

      <!-- Sample identification mode (tenant-wide) — governs the lab screens. -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Sample identification</h3>
        <p class="pf-ls__hint">
          How techs identify a sample on the lab screens. <strong>Scan</strong> shows the camera
          QR/barcode scanner (a hardware scanner also types into the field). <strong>Manual</strong>
          hides the scanner and shows the <strong>sample number</strong> to read and type by hand.
        </p>
        <div class="pf-ls__gate">
          @for (opt of scanModeOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" [class.pf-ls__gate-opt--on]="scanMode() === opt.value"
                    (click)="setScanMode(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
      </pf-tile>

      <!-- Queue focus (per-branch) — how the lab worklists group work. -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Queue focus</h3>
        <p class="pf-ls__hint">
          How the technician worklist, lab intake and result-entry queues group work.
          <strong>Patient</strong> lists patients with their tests nested; <strong>Sample</strong>
          keys each row by Sample ID (patient shown small). By default this follows the
          <strong>Lab structure</strong> below — pick one to override it.
        </p>
        <div class="pf-ls__gate">
          @for (opt of queueFocusOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" [class.pf-ls__gate-opt--on]="queueFocusSelected() === opt.value"
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
      </pf-tile>

      <!-- Lab structure (per-branch): integrated / standalone / auto -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Lab structure</h3>
        <p class="pf-ls__hint">
          How this branch's tubes group into spaces.
          <strong>Auto</strong> (default) = arrange freely on the Branches board —
          placed departments follow their space, the rest share the default "Lab".
          <strong>Integrated</strong> = one lab, ONE space — everything shares the
          default "Lab" space.
          <strong>Standalone</strong> = every department is its own space with its
          own sample-ID prefix.
        </p>
        <div class="pf-ls__gate">
          @for (opt of labStructureOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" [class.pf-ls__gate-opt--on]="labStructure() === opt.value"
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
      </pf-tile>

      <!-- Sample ID — short sample barcode number width (tenant-wide) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Sample ID</h3>
        <p class="pf-ls__hint">
          The short sample barcode is <strong>DD</strong>(dept) + <strong>YY</strong>(year) +
          this many digits, e.g. <span class="font-mono">012600001</span>. Set each department's
          2-digit code in <strong>Departments</strong>.
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-4">
          <label class="block max-w-[160px]">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Number width</span>
            <input class="pf-input mt-1" type="number" min="1" max="9"
                   [ngModel]="sampleNumberWidth()"
                   (ngModelChange)="sampleNumberWidth.set(+$event)"
                   (blur)="saveSampleNumberWidth()" />
          </label>
          <p class="text-[13px] pb-2" style="color: var(--text-secondary);">
            Preview: <strong class="font-mono" style="color: var(--text-primary);">{{ sampleBarcodePreview() }}</strong>
          </p>
        </div>
      </pf-tile>

      <!-- Calculation constants (tenant-wide) — feed calculated results. -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Calculation constants</h3>
        <p class="pf-ls__hint">
          Lab-specific numbers used by calculated results during entry.
          <strong>ISI</strong> and <strong>MNPT</strong> come from your thromboplastin
          reagent's insert (they drive INR); <strong>Normal HCT</strong> anchors the
          reticulocyte production index. Leave blank to use the defaults shown.
        </p>
        <div class="mt-4 flex flex-wrap items-end gap-4">
          <label class="block max-w-[130px]">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">ISI</span>
            <input class="pf-input mt-1" type="number" step="0.01" min="0" placeholder="1.0"
                   [ngModel]="calcIsi()"
                   (ngModelChange)="calcIsi.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
          <label class="block max-w-[150px]">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">MNPT (seconds)</span>
            <input class="pf-input mt-1" type="number" step="0.1" min="0" placeholder="12.0"
                   [ngModel]="calcMnpt()"
                   (ngModelChange)="calcMnpt.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
          <label class="block max-w-[150px]">
            <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Normal HCT (%)</span>
            <input class="pf-input mt-1" type="number" step="1" min="1" max="99" placeholder="45"
                   [ngModel]="calcNormalHct()"
                   (ngModelChange)="calcNormalHct.set($event)"
                   (blur)="saveCalcConstants()" />
          </label>
        </div>
      </pf-tile>

      <!-- No-scan override (tenant-wide) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Allow no-scan claim (supervisor override)</h3>
            <p class="pf-ls__hint">
              When ON, a supervisor can claim a test without scanning the vial — for broken or
              smudged barcodes. Every override is audit-logged. Leave OFF for strict
              scan-first workflow.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="allowNoScan()">
            <input type="checkbox"
                   [checked]="allowNoScan()"
                   (change)="setAllowNoScan($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>
      </pf-tile>

      <!-- Inventory master switch — only when the tenant is entitled to the
           inventory module, so an admin can't turn on a module they don't have. -->
      @if (entitlements.moduleEnabled('inventory')) {
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Enable inventory</h3>
            <p class="pf-ls__hint">
              Track consumable stock (tubes, kits, reagents). When ON, usage is auto-deducted at
              collection and a test <strong>can't be ordered if its kit isn't fully in stock</strong>.
              When OFF, inventory is ignored entirely. Manage stock under Admin → Inventory.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="inventoryEnabled()">
            <input type="checkbox" [checked]="inventoryEnabled()" (change)="setInventoryEnabled($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>
      </pf-tile>
      }

      <!-- Payment gate: choose WHERE an unpaid balance blocks the workflow. -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Require full payment to progress</h3>
        <p class="pf-ls__hint">
          Choose where an unpaid balance blocks the workflow. Sample <em>collection</em> is never blocked —
          you can bill pay-later / part-advance and still draw the tube; the difference is settled at the gate.
        </p>
        <div class="pf-ls__gate">
          @for (opt of gateOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" [class.pf-ls__gate-opt--on]="paymentGateStage() === opt.value"
                    (click)="setPaymentGateStage(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>
      </pf-tile>

      <!-- Specimen label CODE — an org-wide policy. Label SIZE + printer + darkness
           are per-station (a user's Print settings), never stored in the cloud. -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Specimen label code</h3>
        <p class="pf-ls__hint">
          The <strong>one</strong> machine-readable code printed on every tube label across the
          organisation. A tube label can't fit more than one. Label size, printer &amp; darkness
          are set per station under <strong>Print settings</strong> (profile menu).
        </p>

        <div class="pf-ls__gate mt-3">
          @for (opt of labelCodeOptions; track opt.value) {
            <button type="button" class="pf-ls__gate-opt" [class.pf-ls__gate-opt--on]="labelCodeMode() === opt.value"
                    (click)="setLabelCodeMode(opt.value)">
              <span class="pf-ls__gate-radio"></span>
              <span class="pf-ls__gate-text">
                <span class="pf-ls__gate-t">{{ opt.label }}</span>
                <span class="pf-ls__gate-s">{{ opt.desc }}</span>
              </span>
            </button>
          }
        </div>

      </pf-tile>

      <!-- Require validation for all results -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Require validation for all results</h3>
            <p class="pf-ls__hint">
              When ON, every result must be validated by a pathologist — even tests set to
              <strong>direct flow</strong> (which otherwise auto-validate on entry). Leave OFF for default behaviour.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="requireValidation()">
            <input type="checkbox" [checked]="requireValidation()" (change)="setRequireValidation($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>
      </pf-tile>

      <!-- Front-desk Payments-due tab visibility -->
      <pf-tile tone="default" padding="lg" class="block">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Show "Payments due" tab</h3>
            <p class="pf-ls__hint">
              When ON, the front-desk shows a <strong>Payments due</strong> tab listing every order with an
              outstanding balance. In Progress and Completed are always shown. Leave OFF to hide it.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="showPaymentsDue()">
            <input type="checkbox" [checked]="showPaymentsDue()" (change)="setShowPaymentsDue($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>
      </pf-tile>

      <!-- Auto-assign per department -->
      <pf-tile tone="default" padding="lg" class="block">
        <h3 class="pf-ls__title">Auto-assign by department</h3>
        <p class="pf-ls__hint">
          Two independent legs. <strong>Technicians</strong> — when a sample is received, each test is
          routed to the person (or least-loaded member of a role) set for its department.
          <strong>Validators</strong> — when a tech submits a result, it is routed to the least-loaded
          validator the same way. Departments with nothing set fall into the shared queue.
        </p>

        <!-- Master toggles for this branch: one per leg -->
        <div class="flex items-start justify-between gap-4 pf-ls__autoassign-master">
          <div class="min-w-0">
            <p class="pf-ls__dept-name">Auto-assign technicians</p>
            <p class="pf-ls__hint">On receive, route each test to its department's tech pool. Off → the shared bench queue.</p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="autoAssignEnabled()">
            <input type="checkbox" [checked]="autoAssignEnabled()"
                   (change)="setAutoAssignEnabled($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>
        <div class="flex items-start justify-between gap-4 pf-ls__autoassign-master">
          <div class="min-w-0">
            <p class="pf-ls__dept-name">Auto-assign validators</p>
            <p class="pf-ls__hint">On submit, route the result to its department's validator pool. Their Pending-validation screen lists it first; anyone can still validate it.</p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="autoAssignValidatorsEnabled()">
            <input type="checkbox" [checked]="autoAssignValidatorsEnabled()"
                   (change)="setAutoAssignValidatorsEnabled($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
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

                <p class="pf-ls__pool" [class.pf-ls__pool--off]="!autoAssignValidatorsEnabled()">Validators — review submitted results</p>
                <label class="pf-ls__label">People</label>
                <pf-select
                  [multiple]="true"
                  [options]="allUserOptions()"
                  [values]="validatorsFor(d.id)"
                  placeholder="Select people…"
                  [disabled]="!autoAssignValidatorsEnabled()"
                  (valuesChange)="setValidators(d.id, $any($event))">
                </pf-select>

                <label class="pf-ls__label">Roles (least-loaded member gets it)</label>
                <pf-select
                  [multiple]="true"
                  [options]="allRoleOptions()"
                  [values]="validatorRolesFor(d.id)"
                  placeholder="Select roles…"
                  [disabled]="!autoAssignValidatorsEnabled()"
                  (valuesChange)="setValidatorRoles(d.id, $any($event))">
                </pf-select>

                @if (autoAssignValidatorsEnabled() && !validatorsFor(d.id).length && !validatorRolesFor(d.id).length) {
                  <p class="pf-ls__warn">No one set — this department's results wait in the shared validation queue.</p>
                }
              </div>
            }
          </div>
        }
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-ls__autosave {
      display: inline-flex; align-items: center; gap: 6px;
      margin: 2px 0 18px; padding: 5px 12px; border-radius: 999px;
      font-size: 12px; font-weight: 600;
      color: var(--emerald-text, #10b981);
      background: rgba(16, 185, 129, 0.10);
      border: 1px solid rgba(16, 185, 129, 0.28);
    }
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ls__link  { background: none; border: none; padding: 0; font-size: 12.5px; color: var(--color-violet-400, #a78bfa); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
    .pf-ls__link:hover { color: var(--color-violet-300, #c4b5fd); }
    .pf-ls__empty { margin: 12px 0 0; font-size: 13px; color: var(--text-tertiary); font-style: italic; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 11.5px; color: var(--amber-text); font-style: italic; }
    /* Pool sub-headings inside a department card (Technicians / Validators). */
    .pf-ls__pool { margin: 14px 0 2px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-secondary); }
    .pf-ls__pool:first-of-type { margin-top: 10px; }
    .pf-ls__pool--off { opacity: 0.45; }


    /* Payment-gate radio options */
    .pf-ls__gate { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
    .pf-ls__gate-opt { display: flex; align-items: flex-start; gap: 12px; text-align: left; padding: 12px 14px; border-radius: 12px; background: var(--glass-bg); border: 1px solid var(--glass-border); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
    .pf-ls__gate-opt:hover { border-color: rgba(124,58,237,0.4); }
    .pf-ls__gate-opt--on { border-color: rgba(124,58,237,0.6); background: rgba(124,58,237,0.06); }
    .pf-ls__gate-radio { flex-shrink: 0; width: 18px; height: 18px; margin-top: 1px; border-radius: 50%; border: 2px solid var(--border-input, #cbd5e1); position: relative; transition: border-color .15s ease; }
    .pf-ls__gate-opt--on .pf-ls__gate-radio { border-color: var(--color-violet-500, #7c3aed); }
    .pf-ls__gate-opt--on .pf-ls__gate-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--color-violet-500, #7c3aed); }
    .pf-ls__gate-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .pf-ls__gate-t { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__gate-s { font-size: 12px; color: var(--text-tertiary); line-height: 1.5; }

    .pf-ls__toggle { cursor: pointer; display: inline-flex; align-items: center; }
    .pf-ls__toggle input { position: absolute; opacity: 0; pointer-events: none; }
    .pf-ls__toggle-track {
      position: relative; width: 44px; height: 24px; border-radius: 9999px;
      background: var(--border-muted); transition: background 0.2s ease;
    }
    .pf-ls__toggle-thumb {
      position: absolute; top: 3px; left: 3px;
      width: 18px; height: 18px; border-radius: 9999px;
      background: #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      transition: transform 0.2s ease;
    }
    .pf-ls__toggle--on .pf-ls__toggle-track { background: var(--gradient-primary); }
    .pf-ls__toggle--on .pf-ls__toggle-thumb { transform: translateX(20px); }

    .pf-ls__autoassign-master {
      margin-top: 12px; padding: 12px 14px;
      border: 1px solid var(--glass-border); border-radius: 12px;
      background: var(--glass-bg, rgba(255,255,255,0.03));
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
      border-radius: 14px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
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
    .pf-ls__radio--on {
      border-color: rgba(45, 212, 191, 0.55);
      background: rgba(45, 212, 191, 0.08);
    }
    .pf-ls__radio input { position: absolute; opacity: 0; pointer-events: none; }
    .pf-ls__radio-title { font-size: 13.5px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__radio-sub { font-size: 11.5px; color: var(--text-tertiary); }

    .pf-ls__dept-name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__dept-code { margin: 2px 0 0; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; color: var(--text-muted); }
    .pf-ls__label {
      margin: 8px 0 4px;
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; color: var(--text-muted);
    }

    /* ── Cross-platform overrides — additive only, never touch base rules ── */

    /* Coarse-pointer (touch) sizing: make the toggle a >=44px tap target
       without changing its visual track size. Scoped to this page's toggle. */
    @media (pointer: coarse) {
      :host .pf-ls__toggle { min-width: 44px; min-height: 44px; justify-content: flex-end; }

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
    { value: 'integrated', label: 'Integrated', desc: 'One lab, ONE space. Every department shares the default "Lab" space — same-colour tests draw one shared vial with the Lab-code prefix. Space arrangement on the Branches board is ignored.' },
    { value: 'standalone', label: 'Standalone', desc: 'Every department is split into its own space — its own sample-ID prefix (the department code), and a separate vial per department even for the same tube colour.' },
  ];
  // ── Sample ID — running-number width of the short sample barcode ──
  /** Editable number width (1–9). Seeded from the tenant once it loads. */
  protected readonly sampleNumberWidth = signal(5);
  /** Keep the editable signal in sync with the loaded/saved tenant. */
  private readonly _swSync = effect(() => {
    const w = this.tenantState.tenant()?.sampleNumberWidth;
    if (typeof w === 'number') this.sampleNumberWidth.set(Math.min(Math.max(w, 1), 9));
  });
  /** Live example barcode: dept 01 + last-2-digit year + zero-padded number. */
  protected readonly sampleBarcodePreview = computed(() => {
    const yy = String(new Date().getFullYear() % 100).padStart(2, '0');
    const width = Math.min(Math.max(this.sampleNumberWidth() || 1, 1), 9);
    return '01' + yy + '1'.padStart(width, '0');
  });
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
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { inventoryEnabled: v }).subscribe({
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
    this.api.patch('/api/tenants/branch-lab-config', { paymentGateStage: v }).subscribe({
      next: () => this.toasts.success(msg),
      error: e => { this.paymentGateStage.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setLabelCodeMode(v: 'barcode' | 'qr' | 'datamatrix') {
    const prev = this.labelCodeMode();
    if (prev === v) return;
    this.labelCodeMode.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { labelCodeMode: v }).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success('Label code format updated'); },
      error: e => { this.labelCodeMode.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setQueueFocusMode(v: 'auto' | 'patient' | 'sample') {
    const prev = this.queueFocusMode();
    if (prev === v) return;
    this.queueFocusMode.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { queueFocusMode: v }).subscribe({
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
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { labStructure: v }).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success('Lab structure updated'); },
      error: e => { this.labStructure.set(prev); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setRequireValidation(v: boolean) {
    this.requireValidation.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { requireValidationForAllResults: v }).subscribe({
      next: () => this.toasts.success(v ? 'All results now require validation' : 'Direct-flow tests auto-validate again'),
      error: e => { this.requireValidation.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }
  setShowPaymentsDue(v: boolean) {
    this.showPaymentsDue.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { showPaymentsDueTab: v }).subscribe({
      next: cfg => { if (cfg) this.labCfg.update(cfg); this.toasts.success(v ? '"Payments due" tab shown at the front desk' : '"Payments due" tab hidden'); },
      error: e => { this.showPaymentsDue.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }

  ngOnInit() {
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
    this.entitlements.ensureLoaded();
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => {
        this.inventoryEnabled.set(c?.inventoryEnabled === true);
        this.paymentGateStage.set(c?.paymentGateStage ?? (c?.requireBillBeforeCollection ? 'dispatch' : 'none'));
        this.labelCodeMode.set(c?.labelCodeMode === 'both' ? 'barcode' : (c?.labelCodeMode ?? 'barcode'));
        this.requireValidation.set(c?.requireValidationForAllResults === true);
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
      }
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
    this.api.get<Role[]>('/api/roles/').subscribe({
      next: l => this._roles.set(l ?? [])
    });
    this.api.get<User[]>('/api/users/').subscribe({
      next: l => this._users.set((l ?? []).filter(u => u.isActive !== false))
    });
    this.api.get<AutoAssignConfig[]>('/api/tenants/auto-assign-configs').subscribe({
      next: l => this._configs.set(l ?? [])
    });
  }

  /** Per-branch master toggle. Off → all received tests go to the queue. */
  setAutoAssignEnabled(v: boolean) {
    this.autoAssignEnabled.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { autoAssignEnabled: v }).subscribe({
      next: () => this.toasts.success(v ? 'Auto-assign on for this branch' : 'Auto-assign off — tests go to the queue'),
      error: e => { this.autoAssignEnabled.set(!v); this.toasts.error(ApiError.from(e).message); }
    });
  }

  /** Validator-leg master toggle. Off → submitted results just wait in the
   *  shared validation queue. */
  setAutoAssignValidatorsEnabled(v: boolean) {
    this.autoAssignValidatorsEnabled.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { autoAssignValidatorsEnabled: v }).subscribe({
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
    this.api.put<unknown>('/api/tenants/auto-assign-configs', body).subscribe({
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
    this.api.patch<Tenant>('/api/tenants/current', { allowNoScanClaim: v }).subscribe({
      next: t => this.tenantState.update(t),
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Tenant-wide scan vs manual sample-identification mode. Broadcasts via
   *  tenantState so the lab screens flip immediately (no reload). */
  setScanMode(v: 'scan' | 'manual') {
    if (this.scanMode() === v) return;
    this.api.patch<Tenant>('/api/tenants/current', { scanMode: v }).subscribe({
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
    this.api.patch<Tenant>('/api/tenants/current', { calcConstants: next }).subscribe({
      next: t => { this.tenantState.update(t); this.toasts.success('Calculation constants saved'); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  /** Clamp to 1–9, then PATCH the tenant-wide sample number width. */
  saveSampleNumberWidth() {
    const width = Math.min(Math.max(Math.trunc(this.sampleNumberWidth() || 1), 1), 9);
    this.sampleNumberWidth.set(width);
    this.api.patch<Tenant>('/api/tenants/current', { sampleNumberWidth: width }).subscribe({
      next: t => { this.tenantState.update(t); this.toasts.success('Sample number width saved'); },
      error: e => this.toasts.error(ApiError.from(e).message)
    });
  }

  // Billing/collection modes are now derived from the active Workflow.
  goWorkflow() { this.router.navigate(['/admin/process']); }
}
