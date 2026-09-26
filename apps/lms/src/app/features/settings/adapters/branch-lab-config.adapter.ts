import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { BranchLabConfigService } from '../../../core/services/branch-lab-config.service';
import { BranchLabConfig } from '../../../shared/models/branch-lab-config.model';
import { BranchCache, SettingAdapter, branchHeader } from './adapter';

type Blc = Record<string, unknown>;

/**
 * Per-branch lab config (PATCH /api/tenants/branch-lab-config). The backend
 * keys it on X-Active-Branch, so every call names the branch the row edits.
 * When that is the ACTIVE branch the shared BranchLabConfigService is
 * refreshed too (nav, queues and the old Lab settings page follow at once).
 */
@Injectable({ providedIn: 'root' })
export class BranchLabConfigAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly shared = inject(BranchLabConfigService);
  private readonly cache = new BranchCache<Blc>();

  ensure(branchId: string | null): void {
    this.cache.load(branchId,
      () => this.api.get<Blc>('/api/tenants/branch-lab-config', branchHeader(branchId)),
      () => ({}));
  }
  loaded(branchId: string | null): boolean { return this.cache.get(branchId) !== null; }

  read(key: string, branchId: string | null): unknown {
    const c = this.cache.get(branchId);
    if (!c) return undefined;
    return readBlc(c, key);
  }

  async write(key: string, value: unknown, branchId: string | null): Promise<void> {
    const cfg = await firstValueFrom(
      this.api.patch<Blc | null>('/api/tenants/branch-lab-config', { [key]: value }, branchHeader(branchId)));
    const next: Blc = cfg && typeof cfg === 'object' && Object.keys(cfg).length
      ? cfg : { ...(this.cache.get(branchId) ?? {}), [key]: value };
    this.cache.set(branchId, next);
    const active = this.auth.activeBranchId() ?? this.auth.user()?.branchId ?? null;
    if (!branchId || branchId === active) this.shared.update(next as unknown as BranchLabConfig);
  }
}

/** Normalise the stored value the way the Lab settings page always has:
 *  legacy values read as today's choices and are never shown. */
export function readBlc(c: Blc, key: string): unknown {
  switch (key) {
    case 'paymentGateStage':
      return c['paymentGateStage'] ?? (c['requireBillBeforeCollection'] ? 'dispatch' : 'none');
    case 'labelCodeMode': {
      const m = c['labelCodeMode'];
      return m === 'qr' || m === 'datamatrix' ? m : 'barcode';
    }
    case 'queueFocusMode': {
      const m = c['queueFocusMode'];
      return m === 'patient' || m === 'sample' ? m : 'auto';
    }
    case 'labStructure': {
      const m = c['labStructure'];
      return m === 'standalone' || m === 'individual' ? 'standalone' : m === 'integrated' ? 'integrated' : 'auto';
    }
    case 'showPaymentsDueTab': return c['showPaymentsDueTab'] !== false;
    case 'inventoryEnabled':
    case 'requireValidationForAllResults':
    case 'autoAssignEnabled':
    case 'autoAssignValidatorsEnabled':
      return c[key] === true;
    case 'effectiveQueueFocus': return c['effectiveQueueFocus'] === 'sample' ? 'sample' : 'patient';
    default: return c[key];
  }
}
