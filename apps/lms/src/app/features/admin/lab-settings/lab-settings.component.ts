import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { DialogService } from '../../../core/services/dialog.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { BillingMode, BranchLabConfig, CollectionMode } from '../../../shared/models/branch-lab-config.model';
import { Department, Tenant } from '../../../shared/models/tenant.model';
import { Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';
import { TouchButtonComponent } from '../../../shared/primitives/touch-button.component';

interface AutoAssignConfig {
  id?: string;
  tenantId?: string;
  departmentId: string;
  isEnabled: boolean;
  autoAssignRoleId?: string | null;
}

interface WipeResult { patients: number; orders: number; bills: number; reports: number; appointments: number; }

@Component({
  selector: 'pf-lab-settings',
  standalone: true,
  imports: [FormsModule, ScreenHeaderComponent, SelectComponent, TileComponent, TouchButtonComponent],
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

      <!-- Patient ID format -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Patient ID format</h3>
            <p class="pf-ls__hint">
              Choose how new patient IDs are generated. The running number is <strong>continuous</strong>
              (never resets); the date is just a prefix. Existing patient IDs are never changed.
            </p>
          </div>
          <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="pidEnabled()">
            <input type="checkbox" [checked]="pidEnabled()" (change)="pidEnabled.set($any($event.target).checked)" />
            <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
          </label>
        </div>

        @if (pidEnabled()) {
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Date prefix</span>
              <select class="pf-input mt-1" [ngModel]="pidDate()" (ngModelChange)="pidDate.set($event)">
                <option value="yymmdd">YYMMDD</option>
                <option value="ddmmyy">DDMMYY</option>
                <option value="mmdd">MMDD</option>
                <option value="yymm">YYMM</option>
                <option value="mmyy">MMYY</option>
                <option value="yy">YY</option>
                <option value="dd">DD</option>
                <option value="none">None</option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Separator <span style="text-transform:none;font-weight:500;opacity:.7">(blank = none)</span></span>
              <input class="pf-input mt-1" maxlength="3" [ngModel]="pidSep()" (ngModelChange)="pidSep.set($event)" placeholder="none" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">{{ pidSerial() === 'alpha' ? 'Min number digits' : 'Number digits' }}</span>
              <input class="pf-input mt-1" type="number" min="1" [attr.max]="pidSerial() === 'alpha' ? 6 : 10" [ngModel]="pidPad()" (ngModelChange)="pidPad.set(+$event)" />
            </label>
            <label class="block">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Prefix (optional)</span>
              <input class="pf-input mt-1" maxlength="16" [ngModel]="pidPrefix()" (ngModelChange)="pidPrefix.set($event)" placeholder="e.g. LAB" />
            </label>
          </div>

          <!-- Letters are optional: ON → alphanumeric odometer, OFF → plain numbers. -->
          <label class="pf-ls__inline-toggle mt-4">
            <span class="pf-ls__inline-toggle-text">
              <strong>Include letters</strong> <span style="opacity:.7">— alphanumeric IDs (a001 … then b, c …). Off = plain numbers.</span>
            </span>
            <span class="pf-ls__toggle" [class.pf-ls__toggle--on]="pidSerial() === 'alpha'">
              <input type="checkbox" [checked]="pidSerial() === 'alpha'" (change)="pidSerial.set($any($event.target).checked ? 'alpha' : 'numeric')" />
              <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
            </span>
          </label>

          @if (pidSerial() === 'alpha') {
            <label class="block mt-4 max-w-[220px]">
              <span class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--text-muted);">Letters</span>
              <select class="pf-input mt-1" [ngModel]="pidLetters()" (ngModelChange)="pidLetters.set(+$event)">
                <option [ngValue]="1">A (1 letter)</option>
                <option [ngValue]="2">AA (2 letters)</option>
                <option [ngValue]="3">AAA (3 letters)</option>
                <option [ngValue]="4">AAAA (4 letters)</option>
              </select>
            </label>
            <p class="pf-ls__hint mt-3">
              Alphanumeric odometer: the number runs up to <strong>6 digits</strong> (max 999999), then the
              <strong>uppercase</strong> letters advance at the chosen fixed width. Example (AA):
              <span class="font-mono">AA001 … AA999999, AB001 …, ZZ999999</span>.
            </p>
          }
          <p class="mt-3 text-[13px]" style="color: var(--text-secondary);">
            Preview: <strong class="font-mono" style="color: var(--text-primary);">{{ pidPreview() }}</strong>
          </p>
        } @else {
          <p class="pf-ls__hint mt-2">Using the built-in format (e.g. <span class="font-mono">DEL-2606-000042-7</span>).</p>
        }
        <button type="button" class="mt-4 px-4 py-2 rounded-xl text-sm font-bold text-white"
                style="background: var(--violet-600, #7c3aed);" [disabled]="pidSaving()" (click)="savePatientId()">
          {{ pidSaving() ? 'Saving…' : 'Save format' }}
        </button>
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

      <!-- Inventory master switch -->
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

      <!-- Require payment before collection -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h3 class="pf-ls__title">Require payment before collection</h3>
            <p class="pf-ls__hint">
              When ON, a sample can't be collected until its order is <strong>paid in full</strong>.
              Leave OFF to let collection and billing run independently (default).
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

      <!-- Auto-assign per department -->
      <pf-tile tone="default" padding="lg" class="block">
        <h3 class="pf-ls__title">Auto-assign by department</h3>
        <p class="pf-ls__hint">
          When a sample is received, tests are auto-assigned to the least-loaded tech holding the
          configured role within the sample's branch / sub-branch. Picking a role without enabling
          the toggle does nothing.
        </p>

        @if (departments().length === 0) {
          <p class="pf-ls__empty">No departments yet — add them from Branches first.</p>
        } @else {
          <div class="pf-ls__dept-grid">
            @for (d of departments(); track d.id) {
              <div class="pf-ls__dept">
                <div class="pf-ls__dept-head">
                  <div>
                    <p class="pf-ls__dept-name">{{ d.name }}</p>
                    <p class="pf-ls__dept-code">{{ d.code }}</p>
                  </div>
                  <label class="pf-ls__toggle" [class.pf-ls__toggle--on]="isEnabledFor(d.id)">
                    <input type="checkbox"
                           [checked]="isEnabledFor(d.id)"
                           (change)="toggleDept(d.id, $any($event.target).checked)" />
                    <span class="pf-ls__toggle-track"><span class="pf-ls__toggle-thumb"></span></span>
                  </label>
                </div>

                <label class="pf-ls__label">Auto-assign role</label>
                <pf-select
                  [options]="roleOptions()"
                  [value]="roleFor(d.id)"
                  placeholder="— pick a role —"
                  [disabled]="!isEnabledFor(d.id)"
                  (valueChange)="setRole(d.id, $any($event))">
                </pf-select>
                @if (isEnabledFor(d.id) && !roleFor(d.id)) {
                  <p class="pf-ls__warn">Enabled without a role — no one will get assigned until a role is picked.</p>
                }
              </div>
            }
          </div>
        }
      </pf-tile>

      <!-- ─── Danger zone ────────────────────────────────────────
       * Dev-testing tool: wipe every patient + order + bill + report
       * + appointment + notification while leaving tenant config /
       * users / roles / test catalog / workflows intact. Gated on
       * manage_tenant — the same perm that lets you save tenant config.
       * Hidden if the user lacks the perm. -->
      @if (canWipe()) {
        <pf-tile tone="rose" padding="lg" class="block mt-6">
          <div class="pf-ls__danger">
            <div class="flex-1 min-w-0">
              <p class="pf-ls__title pf-ls__danger-title">Danger zone · dev testing</p>
              <p class="pf-ls__hint">
                Wipes every patient, order, sample, bill, payment, report, and appointment from
                the database. Tenant config, branches, departments, users, roles, the test catalog,
                and workflows are kept. Use this to reset the system to a clean state during
                dev testing. <span style="color: #fca5a5;">Cannot be undone.</span>
              </p>
              @if (lastWiped(); as w) {
                <p class="pf-ls__warn">Last wipe: cleared {{ w.patients }} patients · {{ w.orders }} orders · {{ w.bills }} bills · {{ w.reports }} reports.</p>
              }
            </div>
            <pf-touch-btn variant="danger" size="md"
                          [disabled]="wiping()"
                          (pressed)="wipePatientData()">
              {{ wiping() ? 'Wiping…' : '🗑 Wipe Patient Data' }}
            </pf-touch-btn>
          </div>
        </pf-tile>
      }
    </section>
  `,
  styles: [`
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ls__danger {
      display: flex; gap: 16px; align-items: center;
      flex-wrap: wrap;
    }
    .pf-ls__danger-title { color: #fca5a5 !important; }
    .pf-ls__danger > pf-touch-btn { flex-shrink: 0; }
    .pf-ls__empty { margin: 12px 0 0; font-size: 13px; color: var(--text-tertiary); font-style: italic; }
    .pf-ls__warn  { margin: 4px 0 0; font-size: 11.5px; color: #fbbf24; font-style: italic; }

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

    .pf-ls__inline-toggle {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; cursor: pointer;
    }
    .pf-ls__inline-toggle-text { font-size: 13px; color: var(--text-secondary); line-height: 1.5; }

    .pf-ls__dept-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
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
      :host .pf-ls__inline-toggle .pf-ls__toggle { min-width: 0; }

      /* This page's own action buttons (Save format / Edit in Workflow):
         the toolbar primitives already meet 44px, but these inline buttons
         are sized with small Tailwind padding — bump their hit area. */
      :host button[type="button"] { min-height: 44px; }
      :host .pf-ls__inline-toggle .pf-ls__toggle { min-height: 44px; align-items: center; }
    }

    /* Touch devices: the inline text buttons use Tailwind hover: classes which
       otherwise stick after a tap. Gate the page's own hover affordances. */
    @media (hover: none) {
      :host .text-violet-400.hover\\:text-violet-300:hover { color: #a78bfa; }
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

      /* Patient-ID grid: 2 cols can crowd narrow phones — go single column. */
      :host .grid.grid-cols-2 { grid-template-columns: 1fr; }

      /* Danger zone: stack the button full-width below the copy on phone. */
      :host .pf-ls__danger { align-items: stretch; }
      :host .pf-ls__danger > pf-touch-btn,
      :host .pf-ls__danger pf-touch-btn button { width: 100%; }

      /* Header rows: the title/copy + toggle stay on one row but allow
         the copy to shrink so the toggle never gets pushed off-screen. */
      :host .pf-ls__inline-toggle { align-items: flex-start; }
    }

    /* iPad (641–1279): use the width — show the patient-ID fields as a
       2-up grid rather than the desktop 4-up, which would be too tight. */
    @media (min-width: 641px) and (max-width: 1279px) {
      :host .grid.grid-cols-2.md\\:grid-cols-4 { grid-template-columns: repeat(2, 1fr); }
    }
  `]
})
export class LabSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly router = inject(Router);

  private readonly _departments = signal<Department[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _configs = signal<AutoAssignConfig[]>([]);
  readonly departments = this._departments.asReadonly();

  // ── Danger-zone state ──
  protected readonly wiping = signal(false);
  protected readonly lastWiped = signal<WipeResult | null>(null);
  /** Mirrors the backend gate. Hide the danger-zone tile if the user
   *  doesn't hold manage_tenant — they'd 403 on click anyway. */
  readonly canWipe = computed(() => this.auth.hasPermission('manage_tenant'));

  readonly allowNoScan = computed(() => this.tenantState.tenant()?.allowNoScanClaim === true);
  readonly collectionMode = this.labCfg.collectionMode;
  readonly billingMode = this.labCfg.billingMode;

  readonly roleOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— none —' },
    ...this._roles().map(r => ({ value: r.id, label: r.name }))
  ]);

  // ── Patient-ID format ──
  protected readonly pidEnabled = signal(false);
  protected readonly pidDate = signal('ddmmyy');
  protected readonly pidSep = signal('-');
  protected readonly pidPad = signal(4);
  protected readonly pidPrefix = signal('');
  /** 'numeric' → zero-padded number; 'alpha' → alphanumeric odometer
   *  ({LETTERS}{number}, number 1…999999 then the fixed-width uppercase
   *  letters advance, e.g. width 2: AA001 … AA999999, AB001 …). */
  protected readonly pidSerial = signal<'numeric' | 'alpha'>('numeric');
  /** Fixed letter-block width for alpha mode (1–4 → A/AA/AAA/AAAA). */
  protected readonly pidLetters = signal(2);
  protected readonly pidSaving = signal(false);
  /** Live sample of what a new id looks like with today's date + seq 1. */
  protected readonly pidPreview = computed(() => {
    const n = new Date();
    const dd = String(n.getDate()).padStart(2, '0');
    const mm = String(n.getMonth() + 1).padStart(2, '0');
    const yy = String(n.getFullYear() % 100).padStart(2, '0');
    const date = this.pidDate() === 'yymmdd' ? yy + mm + dd
      : this.pidDate() === 'ddmmyy' ? dd + mm + yy
      : this.pidDate() === 'mmdd' ? mm + dd
      : this.pidDate() === 'yymm' ? yy + mm
      : this.pidDate() === 'mmyy' ? mm + yy
      : this.pidDate() === 'yy' ? yy
      : this.pidDate() === 'dd' ? dd : '';
    // First id (seq 1): the fixed-width UPPERCASE letters + the number, padded
    // to the configured min width (capped at 6 for alpha). e.g. AA001.
    const serial = this.pidSerial() === 'alpha'
      ? 'A'.repeat(Math.min(Math.max(this.pidLetters(), 1), 4)) + '1'.padStart(Math.min(Math.max(this.pidPad(), 1), 6), '0')
      : '1'.padStart(Math.min(Math.max(this.pidPad(), 1), 10), '0');
    const head = (this.pidPrefix() ?? '') + date;
    // Blank separator → no separator (e.g. mmdd000).
    const sep = this.pidSep() ?? '';
    return head.length ? `${head}${sep}${serial}` : serial;
  });

  // Branch lab-config toggles.
  protected readonly inventoryEnabled = signal(false);
  protected readonly requireBill = signal(false);
  protected readonly requireValidation = signal(false);
  setInventoryEnabled(v: boolean) {
    this.inventoryEnabled.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { inventoryEnabled: v }).subscribe({
      next: cfg => {
        // Push the fresh config into the shared service so the Stores nav entry
        // appears / disappears immediately (no reload needed).
        if (cfg) this.labCfg.update(cfg);
        this.toasts.success(v ? 'Inventory enabled for this branch' : 'Inventory disabled');
      },
      error: () => { this.inventoryEnabled.set(!v); this.toasts.error('Could not update setting'); }
    });
  }
  setRequireBill(v: boolean) {
    this.requireBill.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { requireBillBeforeCollection: v }).subscribe({
      next: () => this.toasts.success(v ? 'Payment now required before collection' : 'Payment no longer required before collection'),
      error: () => { this.requireBill.set(!v); this.toasts.error('Could not update setting'); }
    });
  }
  setRequireValidation(v: boolean) {
    this.requireValidation.set(v);
    this.api.patch('/api/tenants/branch-lab-config', { requireValidationForAllResults: v }).subscribe({
      next: () => this.toasts.success(v ? 'All results now require validation' : 'Direct-flow tests auto-validate again'),
      error: () => { this.requireValidation.set(!v); this.toasts.error('Could not update setting'); }
    });
  }

  ngOnInit() {
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => {
        this.inventoryEnabled.set(c?.inventoryEnabled === true);
        this.requireBill.set(c?.requireBillBeforeCollection === true);
        this.requireValidation.set(c?.requireValidationForAllResults === true);
      }
    });
    this.api.get<any>('/api/config/patient-id').subscribe({
      next: c => {
        if (!c) return;
        this.pidEnabled.set(!!c.enabled);
        this.pidDate.set(c.datePrefix ?? 'ddmmyy');
        this.pidSep.set(c.separator ?? '-');
        this.pidPad.set(c.padding ?? 4);
        this.pidPrefix.set(c.prefix ?? '');
        this.pidSerial.set(c.serialMode === 'alpha' ? 'alpha' : 'numeric');
        this.pidLetters.set(Math.min(Math.max(c.letterCount ?? 2, 1), 4));
      }
    });
    this.api.get<Department[]>('/api/tenants/departments').subscribe({
      next: l => this._departments.set(l ?? [])
    });
    this.api.get<Role[]>('/api/roles/').subscribe({
      next: l => this._roles.set(l ?? [])
    });
    this.api.get<AutoAssignConfig[]>('/api/tenants/auto-assign-configs').subscribe({
      next: l => this._configs.set(l ?? [])
    });
  }

  savePatientId() {
    this.pidSaving.set(true);
    this.api.post('/api/config/patient-id', {
      enabled: this.pidEnabled(),
      datePrefix: this.pidDate(),
      separator: this.pidSep() ?? '',
      padding: this.pidPad(),
      prefix: this.pidPrefix()?.trim() || null,
      serialMode: this.pidSerial(),
      letterCount: this.pidLetters(),
    }).subscribe({
      next: () => { this.pidSaving.set(false); this.toasts.success('Patient ID format saved'); },
      error: () => { this.pidSaving.set(false); this.toasts.error('Could not save patient ID format'); },
    });
  }

  isEnabledFor(departmentId: string): boolean {
    return this._configs().find(c => c.departmentId === departmentId)?.isEnabled ?? false;
  }
  roleFor(departmentId: string): string {
    return this._configs().find(c => c.departmentId === departmentId)?.autoAssignRoleId ?? '';
  }

  toggleDept(departmentId: string, isEnabled: boolean) {
    const current = this._configs().find(c => c.departmentId === departmentId);
    this.upsert({ ...(current ?? { departmentId }), isEnabled });
  }
  setRole(departmentId: string, roleId: string) {
    const current = this._configs().find(c => c.departmentId === departmentId);
    this.upsert({ ...(current ?? { departmentId, isEnabled: false }), autoAssignRoleId: roleId || null });
  }

  private upsert(patch: AutoAssignConfig) {
    this.api.put<unknown>('/api/tenants/auto-assign-configs', {
      departmentId: patch.departmentId,
      isEnabled: !!patch.isEnabled,
      autoAssignRoleId: patch.autoAssignRoleId ?? null
    }).subscribe({
      next: () => {
        this._configs.update(list => {
          const exists = list.some(c => c.departmentId === patch.departmentId);
          return exists
            ? list.map(c => c.departmentId === patch.departmentId ? { ...c, ...patch } : c)
            : [...list, { ...patch, isEnabled: !!patch.isEnabled }];
        });
      },
      error: e => this.toasts.error(e?.message ?? 'Could not save')
    });
  }

  setAllowNoScan(v: boolean) {
    this.api.patch<Tenant>('/api/tenants/current', { allowNoScanClaim: v }).subscribe({
      next: t => this.tenantState.update(t),
      error: e => this.toasts.error(e?.message ?? 'Could not save')
    });
  }

  // Billing/collection modes are now derived from the active Workflow.
  goWorkflow() { this.router.navigate(['/admin/process']); }

  /**
   * Dev-testing wipe — confirm via DialogService, POST to the admin
   * endpoint, surface the cleared counts in the toast and on the tile so
   * the user can see the action took effect.
   */
  async wipePatientData() {
    if (this.wiping()) return;
    const ok = await this.dialog.confirm({
      title: 'Wipe all patient data?',
      message: 'This deletes every patient, order, sample, bill, payment, report, and appointment. Tenant config, branches, departments, users, roles, the test catalog, and workflows are kept. Cannot be undone.',
      confirmLabel: '🗑 Yes, wipe everything',
      cancelLabel: 'Cancel',
      tone: 'danger'
    });
    if (!ok) return;

    this.wiping.set(true);
    this.api.post<{ wiped: boolean; before: { patientsBefore: number; ordersBefore: number; billsBefore: number; reportsBefore: number; appointmentsBefore: number } }>(
      '/api/admin/wipe-patient-data', {}
    ).subscribe({
      next: r => {
        this.wiping.set(false);
        const b = r?.before;
        if (b) {
          this.lastWiped.set({
            patients: b.patientsBefore,
            orders: b.ordersBefore,
            bills: b.billsBefore,
            reports: b.reportsBefore,
            appointments: b.appointmentsBefore
          });
          this.toasts.success(`Cleared ${b.patientsBefore} patients · ${b.ordersBefore} orders · ${b.billsBefore} bills · ${b.reportsBefore} reports`);
        } else {
          this.toasts.success('Patient data wiped');
        }
      },
      error: e => {
        this.wiping.set(false);
        this.toasts.error(e?.message ?? 'Could not wipe data');
      }
    });
  }
}
