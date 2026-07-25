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

      <!-- Strong payment gate: dispatch + report -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Require full payment to progress (strong)</h3>
            <p class="pf-ls__hint">
              When ON, an order must be <strong>paid in full</strong> before it can move forward:
              samples <strong>can't be dispatched</strong> to the lab, and (where there's no dispatch step) the
              <strong>report can't be shared</strong> — only after payment. Sample <em>collection</em> is never
              blocked, so you can bill pay-later / part-advance and still draw the tube. Leave OFF to let billing,
              dispatch and reporting run independently (default).
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="requireBill()">
            <input type="checkbox" [checked]="requireBill()" (change)="setRequireBill($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
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
          When a sample is received, each test is routed to the person — or the least-loaded member
          of a role — you set for its department. Departments with nothing set fall into the shared
          queue for anyone to pick up.
        </p>

        <!-- Master toggle for this branch -->
        <div class="flex items-start justify-between gap-4 pf-ls__autoassign-master">
          <div class="min-w-0">
            <p class="pf-ls__dept-name">Enable auto-assign for this branch</p>
            <p class="pf-ls__hint">Off → every received test goes to the shared queue.</p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="autoAssignEnabled()">
            <input type="checkbox" [checked]="autoAssignEnabled()"
                   (change)="setAutoAssignEnabled($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>

        @if (departments().length === 0) {
          <p class="pf-ls__empty">No departments yet — add them from Branches first.</p>
        } @else {
          <div class="pf-ls__dept-grid" [class.pf-ls__dept-grid--off]="!autoAssignEnabled()">
            @for (d of departments(); track d.id) {
              <div class="pf-ls__dept">
                <div class="pf-ls__dept-head">
                  <div>
                    <p class="pf-ls__dept-name">{{ d.name }}</p>
                    <p class="pf-ls__dept-code">{{ d.code }}</p>
                  </div>
                </div>

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
              </div>
            }
          </div>
        }
      </pf-tile>
    </section>
  `,
  styles: [`
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ls__empty { margin: 12px 0 0; font-size: 13px; color: var(--text-tertiary); font-style: italic; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 11.5px; color: var(--amber-text); font-style: italic; }

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

  // Per-branch master toggle for auto-assign.
  protected readonly autoAssignEnabled = signal(false);

  readonly allowNoScan = computed(() => this.tenantState.tenant()?.allowNoScanClaim === true);

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
  protected readonly requireBill = signal(false);
  protected readonly requireValidation = signal(false);
  protected readonly showPaymentsDue = signal(true);
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
  setRequireBill(v: boolean) {
    this.requireBill.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { requireBillBeforeCollection: v }).subscribe({
      next: () => this.toasts.success(v ? 'Full payment now required before dispatch / report' : 'Payment gate removed'),
      error: e => { this.requireBill.set(!v); this.toasts.error(ApiError.from(e).message); }
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
        this.requireBill.set(c?.requireBillBeforeCollection === true);
        this.requireValidation.set(c?.requireValidationForAllResults === true);
        this.autoAssignEnabled.set(c?.autoAssignEnabled === true);
        this.showPaymentsDue.set(c?.showPaymentsDueTab !== false);
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

  /** Replace the whole selection for a department (from the multi-select). */
  setAssignees(departmentId: string, userIds: string[]) {
    this.upsert(departmentId, userIds ?? [], this.rolesFor(departmentId));
  }
  setRoles(departmentId: string, roleIds: string[]) {
    this.upsert(departmentId, this.assigneesFor(departmentId), roleIds ?? []);
  }
  removeAssignee(departmentId: string, userId: string) {
    this.setAssignees(departmentId, this.assigneesFor(departmentId).filter(id => id !== userId));
  }
  removeRole(departmentId: string, roleId: string) {
    this.setRoles(departmentId, this.rolesFor(departmentId).filter(id => id !== roleId));
  }

  private upsert(departmentId: string, assigneeUserIds: string[], roleIds: string[]) {
    this.api.put<unknown>('/api/tenants/auto-assign-configs', { departmentId, assigneeUserIds, roleIds }).subscribe({
      next: () => {
        const patch: AutoAssignConfig = {
          departmentId,
          isEnabled: assigneeUserIds.length > 0 || roleIds.length > 0,
          assigneeUserIdsJson: JSON.stringify(assigneeUserIds),
          autoAssignRoleIdsJson: JSON.stringify(roleIds),
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
