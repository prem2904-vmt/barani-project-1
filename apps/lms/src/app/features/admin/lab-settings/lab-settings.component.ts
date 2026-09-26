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
import { HeroBandComponent } from '../../../shared/components/hero-band/hero-band.component';
import { SegmentedComponent, SegmentedOption } from '../../../shared/primitives/segmented.component';
import { SettingsJumpComponent, SettingsSection } from '../../../shared/components/settings-page/settings-jump.component';
import { SettingAnchorDirective } from '../../../shared/components/settings-page/setting-anchor.directive';
import { ThemeService } from '../../../core/services/theme.service';


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
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, HeroBandComponent, SegmentedComponent,
            SettingsJumpComponent, SettingAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="pf-band-page px-4 md:px-8 pt-6 pb-10">
      @if (theme.isNewDesign()) {
        <!-- Band (ND-PATTERN "Admin pages"): no tabs, no search — the pill
             names the page. Every change saves at once, so no Save. -->
        <pf-hero-band [back]="true" [tabsOnly]="true">
          <ng-container band-tools><h1 class="nd-band-page">Lab settings</h1></ng-container>
          <ng-container band-actions>
            <span class="nd-savestate pf-ls__savestate" role="status">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
              <span class="pf-ls__savestate-t">Saves by itself</span>
            </span>
          </ng-container>
        </pf-hero-band>
      }
      <pf-screen-header class="pf-classic-only"
        eyebrow="Admin · Lab"
        title="Lab settings"
        subtitle="Every change saves by itself.">
      </pf-screen-header>

      <div class="pf-band-body">
      <div class="nd-setpage nd-setpage--jump">
        <pf-settings-jump [sections]="sections"></pf-settings-jump>
        <div class="nd-setcol">

        <!-- ── Samples ── -->
        <section class="nd-card nd-setsec pf-ls__sec" id="sec-samples" aria-labelledby="sec-samples-h">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2v17a3 3 0 0 0 6 0V2M8 2h8M9 12h6"/></svg></span>
            <h2 class="nd-card__label" id="sec-samples-h">Samples</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="scan-mode">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-scan-l">How staff find a sample</p>
              <p class="nd-set__help">Scan the code on the tube, or type its number.</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" ariaLabelledby="ls-scan-l" [options]="scanModeSeg" [value]="scanMode()"
                            (valueChange)="setScanMode($any($event))"></pf-segmented>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="label-code">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-code-l">Code on tube sticker</p>
              <p class="nd-set__help">For this branch. Sticker size is in Print settings.</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" ariaLabelledby="ls-code-l" [options]="labelCodeSeg" [value]="labelCodeMode()"
                            (valueChange)="setLabelCodeMode($any($event))"></pf-segmented>
            </div>
          </div>
        </section>

        <!-- ── Work lists ── -->
        <section class="nd-card nd-setsec pf-ls__sec" id="sec-queues" aria-labelledby="sec-queues-h">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg></span>
            <h2 class="nd-card__label" id="sec-queues-h">Work lists</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="queue-focus">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-focus-l">Work list shows</p>
              <p class="nd-set__help">{{ queueFocusHelp() }}</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" ariaLabelledby="ls-focus-l" [options]="queueFocusSeg" [value]="queueFocusMode()"
                            (valueChange)="setQueueFocusMode($any($event))"></pf-segmented>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="lab-structure">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-struct-l">Lab layout</p>
              <p class="nd-set__help">{{ labStructureHelp() }}</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" ariaLabelledby="ls-struct-l" [options]="labStructureSeg" [value]="labStructure()"
                            (valueChange)="setLabStructure($any($event))"></pf-segmented>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="auto-assign">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-aa-l">Auto-assign tests</p>
              <p class="nd-set__help" id="ls-aa-h">Send new tests to each department's people.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignEnabled()"
                      aria-labelledby="ls-aa-l" aria-describedby="ls-aa-h"
                      (click)="setAutoAssignEnabled(!autoAssignEnabled())">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="auto-assign-validators">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-aav-l">Auto-assign result checks</p>
              <p class="nd-set__help" id="ls-aav-h">Send results to each department's checkers.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="autoAssignValidatorsEnabled()"
                      aria-labelledby="ls-aav-l" aria-describedby="ls-aav-h"
                      (click)="setAutoAssignValidatorsEnabled(!autoAssignValidatorsEnabled())">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          <div class="nd-set" [class.nd-set--off]="!autoAssignEnabled() && !autoAssignValidatorsEnabled()">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-pools-l">Who gets each department</p>
              <p class="nd-set__help">Pick people or roles. Empty uses the shared list.</p>
            </div>
            <div class="nd-set__ctl nd-set__ctl--wide">
              @if (departments().length === 0) {
                <p class="nd-set__help">No departments yet. Add them in Branches.</p>
              } @else {
                <div class="pf-ls__dept-grid" role="group" aria-labelledby="ls-pools-l">
                  @for (d of departments(); track d.id) {
                    <div class="pf-ls__dept" role="group" [attr.aria-label]="d.name">
                      <p class="pf-ls__dept-name">{{ d.name }} <span class="pf-ls__dept-code nd-num">{{ d.code }}</span></p>

                      <p class="pf-ls__pool" [class.pf-ls__pool--off]="!autoAssignEnabled()">Tests go to</p>
                      <pf-select [multiple]="true" [options]="allUserOptions()" [values]="assigneesFor(d.id)"
                                 placeholder="People" [disabled]="!autoAssignEnabled()"
                                 (valuesChange)="setAssignees(d.id, $any($event))"></pf-select>
                      <pf-select [multiple]="true" [options]="allRoleOptions()" [values]="rolesFor(d.id)"
                                 placeholder="Or roles" [disabled]="!autoAssignEnabled()"
                                 (valuesChange)="setRoles(d.id, $any($event))"></pf-select>

                      <p class="pf-ls__pool" [class.pf-ls__pool--off]="!autoAssignValidatorsEnabled()">Results checked by</p>
                      <pf-select [multiple]="true" [options]="allUserOptions()" [values]="validatorsFor(d.id)"
                                 placeholder="People" [disabled]="!autoAssignValidatorsEnabled()"
                                 (valuesChange)="setValidators(d.id, $any($event))"></pf-select>
                      <pf-select [multiple]="true" [options]="allRoleOptions()" [values]="validatorRolesFor(d.id)"
                                 placeholder="Or roles" [disabled]="!autoAssignValidatorsEnabled()"
                                 (valuesChange)="setValidatorRoles(d.id, $any($event))"></pf-select>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </section>

        <!-- ── Rules ── -->
        <section class="nd-card nd-setsec pf-ls__sec" id="sec-rules" aria-labelledby="sec-rules-h">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Z"/></svg></span>
            <h2 class="nd-card__label" id="sec-rules-h">Rules</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="require-validation">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-val-l">Doctor must check every result</p>
              <p class="nd-set__help" id="ls-val-h">Even quick tests wait for a doctor's check.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="requireValidation()"
                      aria-labelledby="ls-val-l" aria-describedby="ls-val-h"
                      (click)="setRequireValidation(!requireValidation())">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="payment-gate">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-gate-l">Unpaid bill stops</p>
              <p class="nd-set__help">Taking the sample is never stopped.</p>
            </div>
            <div class="nd-set__ctl">
              <pf-segmented size="sm" ariaLabelledby="ls-gate-l" [options]="gateSeg" [value]="paymentGateStage()"
                            (valueChange)="setPaymentGateStage($any($event))"></pf-segmented>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="payments-due-tab">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-due-l">Show Payments due list</p>
              <p class="nd-set__help" id="ls-due-h">Front desk sees orders with money still owed.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="showPaymentsDue()"
                      aria-labelledby="ls-due-l" aria-describedby="ls-due-h"
                      (click)="setShowPaymentsDue(!showPaymentsDue())">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          <div class="nd-set" pfSettingAnchor="no-scan-claim">
            <div class="nd-set__text">
              <p class="nd-set__label" id="ls-noscan-l">Claim without scanning</p>
              <p class="nd-set__help" id="ls-noscan-h">Supervisors only, for damaged labels. Every use is logged.</p>
            </div>
            <div class="nd-set__ctl">
              <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="allowNoScan()"
                      aria-labelledby="ls-noscan-l" aria-describedby="ls-noscan-h"
                      (click)="setAllowNoScan(!allowNoScan())">
                <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
              </button>
            </div>
          </div>
          <!-- Only when the tenant has the inventory module. -->
          @if (entitlements.moduleEnabled('inventory')) {
            <div class="nd-set" pfSettingAnchor="inventory-on">
              <div class="nd-set__text">
                <p class="nd-set__label" id="ls-inv-l">Track stock</p>
                <p class="nd-set__help" id="ls-inv-h">Uses stock at collection. Blocks tests whose kit ran out.</p>
              </div>
              <div class="nd-set__ctl">
                <button type="button" class="nd-toggle pf-ls__switch" role="switch" [attr.aria-checked]="inventoryEnabled()"
                        aria-labelledby="ls-inv-l" aria-describedby="ls-inv-h"
                        (click)="setInventoryEnabled(!inventoryEnabled())">
                  <span class="nd-toggle__track" aria-hidden="true"><span class="nd-toggle__knob"></span></span>
                </button>
              </div>
            </div>
          }
        </section>

        <!-- ── Counters (read-only: the Process builder decides) ── -->
        <section class="nd-card nd-setsec pf-ls__sec" id="sec-counters" aria-labelledby="sec-counters-h">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v4H3zM5 7v14h14V7M9 11h6"/></svg></span>
            <h2 class="nd-card__label" id="sec-counters-h">Counters</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="counters">
            <div class="nd-set__text">
              <p class="nd-set__label">Billing and collection counters</p>
              <p class="nd-set__help">Change these in the Process builder.</p>
            </div>
            <div class="nd-set__ctl">
              <span class="nd-chip nd-chip--static pf-ls__chipm">Billing: <strong>{{ billingMode() === 'separate_counter' ? 'Own counter' : 'Front desk' }}</strong></span>
              <span class="nd-chip nd-chip--static pf-ls__chipm">Collection: <strong>{{ collectionMode() === 'dedicated_counter' ? 'Own counter' : 'Front desk' }}</strong></span>
              <button type="button" class="nd-btn nd-btn--quiet pf-ls__wfbtn" (click)="goWorkflow()">Open Process builder</button>
            </div>
          </div>
        </section>

        <!-- ── Calculations ── -->
        <section class="nd-card nd-setsec pf-ls__sec" id="sec-calc" aria-labelledby="sec-calc-h">
          <header class="nd-card__head">
            <span class="nd-card__icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8"/></svg></span>
            <h2 class="nd-card__label" id="sec-calc-h">Calculations</h2>
          </header>
          <div class="nd-set" pfSettingAnchor="calc-constants">
            <div class="nd-set__text">
              <p class="nd-set__label">INR and RPI numbers</p>
              <p class="nd-set__help">From your reagent insert. Leave blank for the default.</p>
            </div>
            <div class="nd-set__ctl pf-ls__nums">
              <label class="nd-field" for="ls-isi"><span class="nd-field__lbl">ISI</span>
                <input id="ls-isi" class="nd-input nd-num" type="number" step="0.01" min="0" placeholder="1.0" inputmode="decimal"
                       [ngModel]="calcIsi()" (ngModelChange)="calcIsi.set($event)" (blur)="saveCalcConstants()" /></label>
              <label class="nd-field" for="ls-mnpt"><span class="nd-field__lbl">MNPT (seconds)</span>
                <input id="ls-mnpt" class="nd-input nd-num" type="number" step="0.1" min="0" placeholder="12.0" inputmode="decimal"
                       [ngModel]="calcMnpt()" (ngModelChange)="calcMnpt.set($event)" (blur)="saveCalcConstants()" /></label>
              <label class="nd-field" for="ls-hct"><span class="nd-field__lbl">Normal HCT (%)</span>
                <input id="ls-hct" class="nd-input nd-num" type="number" step="1" min="1" max="99" placeholder="45" inputmode="numeric"
                       [ngModel]="calcNormalHct()" (ngModelChange)="calcNormalHct.set($event)" (blur)="saveCalcConstants()" /></label>
            </div>
          </div>
        </section>

        </div>
      </div>
      </div>
    </section>
  `,
  styles: [`
    /* Layout, rows, toggles and a11y come from the kit (.nd-setpage / .nd-set,
       ND-PATTERN "Admin pages"); only this page's own bits live here. */
    .pf-ls__switch { flex: none; }
    .pf-ls__chipm { height: auto; min-height: 30px; white-space: normal; }
    .pf-ls__chipm strong { color: var(--text-primary); font-weight: 600; margin-left: 4px; }
    .pf-ls__wfbtn { min-height: 32px; }
    .pf-ls__nums { flex: 1 1 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 150px)); gap: 12px; }
    .pf-ls__dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .pf-ls__dept { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: var(--nd-radius); border: 1px solid var(--nd-line); background: var(--nd-card-bg); }
    .pf-ls__dept-name { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__dept-code { margin-left: 6px; font-size: 12px; font-weight: 500; color: var(--text-tertiary); }
    .pf-ls__pool { margin: 6px 0 0; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .pf-ls__pool--off { opacity: 0.55; }
    @media (max-width: 640px) {
      .pf-ls__savestate-t { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .pf-ls__nums { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
      .pf-ls__dept-grid { grid-template-columns: 1fr; }
    }
    @media (pointer: coarse) { .pf-ls__wfbtn { min-height: 44px; } }
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

  /** ONE scrolling page (ND-PATTERN "Admin pages"): the jump list's sections. */
  readonly sections: SettingsSection[] = [
    { id: 'sec-samples', label: 'Samples' },
    { id: 'sec-queues', label: 'Work lists' },
    { id: 'sec-rules', label: 'Rules' },
    { id: 'sec-counters', label: 'Counters' },
    { id: 'sec-calc', label: 'Calculations' },
  ];

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
  protected readonly scanModeSeg: SegmentedOption<'scan' | 'manual'>[] = [
    { value: 'scan', label: 'Scan code' },
    { value: 'manual', label: 'Type number' },
  ];

  // ── Queue focus (per-branch): patient vs sample ──
  // No "Auto" card here — by default the focus FOLLOWS the Lab structure
  // (integrated → patient, standalone → sample, auto → by the board's spaces);
  // picking an option overrides it, and "follow" can be restored.
  protected readonly queueFocusMode = signal<'auto' | 'patient' | 'sample'>('auto');
  /** Server-resolved focus when the mode follows the lab structure. */
  protected readonly effectiveQueueFocus = signal<'patient' | 'sample'>('patient');
  protected readonly queueFocusSeg: SegmentedOption<'auto' | 'patient' | 'sample'>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'patient', label: 'Patients' },
    { value: 'sample', label: 'Samples' },
  ];
  /** One plain line that follows the choice (Auto names what it resolves to). */
  protected readonly queueFocusHelp = computed(() => {
    const m = this.queueFocusMode();
    if (m === 'patient') return 'Each row is a patient, tests inside.';
    if (m === 'sample') return 'Each row is one tube, by sample ID.';
    return `Follows the lab layout. Now: ${this.effectiveQueueFocus() === 'sample' ? 'Samples' : 'Patients'}.`;
  });

  // ── Lab structure (per-branch): auto (default) / integrated / standalone ──
  // Drives how vials group + sample-ID prefixes when an order is placed.
  // Auto is the default: the Branches-board arrangement applies (with nothing
  // arranged it behaves exactly like Integrated — everything in the one Lab).
  protected readonly labStructure = signal<'auto' | 'integrated' | 'standalone'>('auto');
  protected readonly labStructureSeg: SegmentedOption<'auto' | 'integrated' | 'standalone'>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'integrated', label: 'Shared' },
    { value: 'standalone', label: 'Separate' },
  ];
  protected readonly labStructureHelp = computed(() => {
    const v = this.labStructure();
    if (v === 'integrated') return 'All departments share tubes and one code.';
    if (v === 'standalone') return 'Each department has its own tubes and code.';
    return 'Follows how you arrange the Branches board.';
  });
  // Sample ID "number width" (the legacy short barcode) is no longer shown:
  // the owner confirmed the short code is unused. lab/my-work still reads
  // tenant.sampleNumberWidth, untouched.
  readonly collectionMode = this.labCfg.collectionMode;
  readonly billingMode = this.labCfg.billingMode;

  // Branch lab-config toggles.
  protected readonly inventoryEnabled = signal(false);
  /** Where the "require full payment" gate applies: none | dispatch | report. */
  protected readonly paymentGateStage = signal<'none' | 'dispatch' | 'report'>('none');
  protected readonly gateSeg: SegmentedOption<'none' | 'dispatch' | 'report'>[] = [
    { value: 'none', label: 'Nothing' },
    { value: 'dispatch', label: 'Sending to lab' },
    { value: 'report', label: 'Report' },
  ];
  protected readonly requireValidation = signal(false);
  protected readonly showPaymentsDue = signal(true);
  /** The SINGLE code that prints on a specimen label, stored PER BRANCH
   *  (branch-lab-config). A tube label can't fit more than one. */
  protected readonly labelCodeMode = signal<'barcode' | 'qr' | 'datamatrix'>('barcode');
  protected readonly labelCodeSeg: SegmentedOption<'barcode' | 'qr' | 'datamatrix'>[] = [
    { value: 'barcode', label: 'Barcode' },
    { value: 'qr', label: 'QR' },
    { value: 'datamatrix', label: 'Data Matrix' },
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

  // Billing/collection modes are now derived from the active Workflow.
  goWorkflow() { this.router.navigate(['/admin/process']); }
}
