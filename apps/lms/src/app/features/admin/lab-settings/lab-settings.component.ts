import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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

      <!-- Billing (branch-scoped) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Billing</h3>
        <p class="pf-ls__hint">
          Front Desk bills the order at the same desk that creates it. Separate Counter
          unlocks a /billing-counter screen for billing-only staff to pick up unbilled
          orders by name / phone / order ID and process payment.
        </p>
        <div class="pf-ls__radio-row">
          <label class="pf-ls__radio" [class.pf-ls__radio--on]="billingMode() === 'front_desk'">
            <input type="radio" name="billing-mode" value="front_desk"
                   [checked]="billingMode() === 'front_desk'"
                   (change)="setBillingMode('front_desk')" />
            <span class="pf-ls__radio-title">Front Desk</span>
            <span class="pf-ls__radio-sub">Reception bills inline.</span>
          </label>
          <label class="pf-ls__radio" [class.pf-ls__radio--on]="billingMode() === 'separate_counter'">
            <input type="radio" name="billing-mode" value="separate_counter"
                   [checked]="billingMode() === 'separate_counter'"
                   (change)="setBillingMode('separate_counter')" />
            <span class="pf-ls__radio-title">Separate Counter</span>
            <span class="pf-ls__radio-sub">A billing-only staff member processes payments.</span>
          </label>
        </div>
      </pf-tile>

      <!-- Sample Collection (branch-scoped) -->
      <pf-tile tone="default" padding="lg" class="block mb-5">
        <h3 class="pf-ls__title">Sample Collection</h3>
        <p class="pf-ls__hint">
          Choose who collects samples for this branch. Front Desk lets the receptionist
          collect inline after billing. Dedicated Counter sends billed orders to a queue
          for a Sample Collector role — a separate sidebar screen is unlocked for them.
        </p>
        <div class="pf-ls__radio-row">
          <label class="pf-ls__radio" [class.pf-ls__radio--on]="collectionMode() === 'front_desk'">
            <input type="radio" name="collection-mode" value="front_desk"
                   [checked]="collectionMode() === 'front_desk'"
                   (change)="setCollectionMode('front_desk')" />
            <span class="pf-ls__radio-title">Front Desk</span>
            <span class="pf-ls__radio-sub">Reception collects after payment.</span>
          </label>
          <label class="pf-ls__radio" [class.pf-ls__radio--on]="collectionMode() === 'dedicated_counter'">
            <input type="radio" name="collection-mode" value="dedicated_counter"
                   [checked]="collectionMode() === 'dedicated_counter'"
                   (change)="setCollectionMode('dedicated_counter')" />
            <span class="pf-ls__radio-title">Dedicated Counter</span>
            <span class="pf-ls__radio-sub">A Sample Collector works a queue.</span>
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
  `]
})
export class LabSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly tenantState = inject(TenantStateService);
  private readonly labCfg = inject(BranchLabConfigService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);

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

  ngOnInit() {
    this.tenantState.ensureLoaded();
    this.labCfg.ensureLoaded();
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

  setCollectionMode(mode: CollectionMode) {
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { collectionMode: mode }).subscribe({
      next: cfg => this.labCfg.update(cfg),
      error: e => this.toasts.error(e?.message ?? 'Could not save')
    });
  }

  setBillingMode(mode: BillingMode) {
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { billingMode: mode }).subscribe({
      next: cfg => this.labCfg.update(cfg),
      error: e => this.toasts.error(e?.message ?? 'Could not save')
    });
  }

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
