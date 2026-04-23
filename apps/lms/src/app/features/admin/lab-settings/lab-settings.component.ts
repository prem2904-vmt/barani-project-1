import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { ToastService } from '../../../core/services/toast.service';
import { Department, Tenant } from '../../../shared/models/tenant.model';
import { Role } from '../../../shared/models/user.model';
import { ScreenHeaderComponent } from '../../../shared/primitives/screen-header.component';
import { SelectComponent, PfSelectOption } from '../../../shared/primitives/select.component';
import { TileComponent } from '../../../shared/primitives/tile.component';

interface AutoAssignConfig {
  id?: string;
  tenantId?: string;
  departmentId: string;
  isEnabled: boolean;
  autoAssignRoleId?: string | null;
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
    </section>
  `,
  styles: [`
    .pf-ls__title { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .pf-ls__hint  { margin: 6px 0 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
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

  private readonly _departments = signal<Department[]>([]);
  private readonly _roles = signal<Role[]>([]);
  private readonly _configs = signal<AutoAssignConfig[]>([]);
  readonly departments = this._departments.asReadonly();

  readonly allowNoScan = computed(() => this.tenantState.tenant()?.allowNoScanClaim === true);

  readonly roleOptions = computed<PfSelectOption<string>[]>(() => [
    { value: '', label: '— none —' },
    ...this._roles().map(r => ({ value: r.id, label: r.name }))
  ]);

  ngOnInit() {
    this.tenantState.ensureLoaded();
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
}
