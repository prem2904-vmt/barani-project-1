import { Injectable, computed, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { TenantStateService } from './tenant-state.service';
import { AuthService } from '../auth/auth.service';
import { PRICE_BULK_PATH, PriceWriteItem, priceBulkBody } from '../../shared/utils/test-pricing';

/**
 * The ONE writer of test prices (Test Master single source, phase 2).
 *
 * Prices live only in the per-tenant pricing table; every screen that edits a
 * price (Test Master grid, test editor, pricing page) goes through
 * {@link save} → `PATCH /api/tests/prices/bulk`. A test create/update never
 * carries a price.
 *
 * Branch dimension: when the tenant runs branch isolation, a price may differ
 * per branch, so inline edits price the ACTING branch (`branchId` = the
 * branch switcher's branch). With isolation off there is one tenant price and
 * no `branchId` is sent.
 */
@Injectable({ providedIn: 'root' })
export class TestPricingService {
  private readonly api = inject(ApiService);
  private readonly tenantState = inject(TenantStateService);
  private readonly auth = inject(AuthService);

  /** Tenant runs per-branch isolation (from `GET /api/tenants/current`). */
  readonly isolationOn = computed(() => this.tenantState.tenant()?.branchIsolationEnabled === true);

  /** Make sure the tenant flag is (being) loaded. */
  ensureLoaded(): void { this.tenantState.ensureLoaded(); }

  /** Branch that inline price edits apply to: the acting branch when
   *  isolation is ON, otherwise none (the tenant price). */
  actingBranchId(): string | null {
    if (!this.isolationOn()) return null;
    const fn = (this.auth as Partial<AuthService>).activeBranchId;
    return typeof fn === 'function' ? fn() ?? null : null;
  }

  /** Write prices. `branchId` undefined → the acting-branch rule above;
   *  `null` → force the tenant price; a string → that branch. */
  save(items: PriceWriteItem[], branchId?: string | null): Observable<unknown> {
    const scope = branchId === undefined ? this.actingBranchId() : branchId;
    return this.api.patch(PRICE_BULK_PATH, priceBulkBody(items, scope));
  }
}
