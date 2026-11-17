import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { ToastService } from '../../../core/services/toast.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { BranchLabConfig } from '../../../shared/models/branch-lab-config.model';

/**
 * "Enable inventory" for this branch — moved here from Lab settings › Rules &
 * gates (Settings re-home): the switch lives with the stock items it governs.
 * Same API: PATCH /api/tenants/branch-lab-config { inventoryEnabled }. Shown
 * only when the tenant is entitled to the Inventory module, so an admin can't
 * turn on a module the lab doesn't have.
 */
@Component({
  selector: 'pf-inventory-enable-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (entitlements.moduleEnabled('inventory')) {
      <section class="pf-card pf-ie" data-testid="inventory-enable">
        <div class="pf-card__head">
          <span class="pf-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/></svg></span>
          <h3 class="pf-card__label pf-ie__title">Enable inventory</h3>
          <span class="pf-ie__scope" title="Applies to the branch you are signed in to">This branch</span>
          <span class="pf-card__spacer"></span>
          <button type="button" class="pf-toggle pf-ie__switch" role="switch" data-testid="inventory-enable-switch"
                  [attr.aria-checked]="enabled()" aria-label="Enable inventory" [disabled]="loading()"
                  (click)="set(!enabled())">
            <span class="pf-toggle__track" aria-hidden="true"><span class="pf-toggle__knob"></span></span>
          </button>
        </div>
        <div class="pf-ie__body">
          <p class="pf-ie__hint">
            Track consumable stock (tubes, kits, reagents). When ON, usage is auto-deducted at collection and a test
            <strong>can't be ordered if its kit isn't fully in stock</strong>. When OFF, inventory is ignored entirely.
            What each test uses is set in the test's <strong>Consumables</strong>.
          </p>
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .pf-ie { margin-bottom: 16px; }
    .pf-ie__title { margin: 0; font-size: 13px; }
    .pf-ie__scope { margin-left: 8px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--pf-line); background: var(--pf-chip-bg); font-size: 11px; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
    .pf-ie__body { padding: 12px 18px 16px; }
    .pf-ie__hint { margin: 0; font-size: 12.5px; color: var(--text-tertiary); line-height: 1.55; }
    .pf-ie__switch { flex: none; }
    @media (pointer: coarse) { :host .pf-ie__switch { min-width: 44px; min-height: 44px; justify-content: flex-end; } }
  `],
})
export class InventoryEnableCardComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toasts = inject(ToastService);
  private readonly labCfg = inject(BranchLabConfigService);
  protected readonly entitlements = inject(TenantEntitlementsService);

  readonly enabled = signal(false);
  readonly loading = signal(true);

  ngOnInit() {
    this.entitlements.ensureLoaded();
    this.api.get<any>('/api/tenants/branch-lab-config').subscribe({
      next: c => { this.enabled.set(c?.inventoryEnabled === true); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  set(v: boolean) {
    this.enabled.set(v);
    this.api.patch<BranchLabConfig>('/api/tenants/branch-lab-config', { inventoryEnabled: v }).subscribe({
      next: cfg => {
        // Push the fresh config into the shared service so the Stores nav entry
        // appears / disappears immediately (no reload needed).
        if (cfg) this.labCfg.update(cfg);
        this.toasts.success(v ? 'Inventory enabled for this branch' : 'Inventory disabled');
      },
      error: e => { this.enabled.set(!v); this.toasts.error(ApiError.from(e).message); },
    });
  }
}
