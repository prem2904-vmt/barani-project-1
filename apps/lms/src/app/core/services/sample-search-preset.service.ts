import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from '../auth/auth.service';
import { TenantStateService } from './tenant-state.service';
import { SampleSearchPresetConfig, samplePreset } from '../../shared/utils/sample-id-preset';

/**
 * The sample-search preset for the signed-in user (see
 * shared/utils/sample-id-preset.ts). The config — the user's sample-ID prefix,
 * the lab's format and timezone — is loaded once, lazily (the first time a
 * sample search box is focused) and cached per tenant + branch. The DATE part
 * is never cached: `current()` computes it at call time (on focus), so the
 * preset becomes 2610 on 1 October without a reload.
 */
@Injectable({ providedIn: 'root' })
export class SampleSearchPresetService {
  // Everything else is resolved LAZILY through the injector (like
  // PfKeysDepartmentsService): screens and specs that never touch a sample
  // field must not pull in HttpClient through this service.
  private readonly injector = inject(Injector);
  private tenantState: TenantStateService | null | undefined;
  readonly config = signal<SampleSearchPresetConfig | null>(null);
  private loadedFor: string | null = null;

  /** The lab's live Lab-settings choice (tenant state), so flipping the
   *  switch applies at once; undefined until the tenant is known. */
  private readonly liveSetting = computed<boolean | null | undefined>(() => {
    const t = this.tenantStateOrNull()?.tenant();
    return t ? (t.sampleSearchPreset ?? null) : undefined;
  });

  private tenantStateOrNull(): TenantStateService | null {
    if (this.tenantState === undefined) {
      try { this.tenantState = this.injector.get(TenantStateService, null); }
      catch { this.tenantState = null; }
    }
    return this.tenantState ?? null;
  }

  ensure(): void {
    let key = 'anon';
    try {
      const u = this.injector.get(AuthService, null)?.user?.();
      key = `${u?.tenantId ?? ''}:${u?.branchId ?? ''}`;
    } catch { /* no auth in this context */ }
    if (this.loadedFor === key) return;
    let api: ApiService | null = null;
    try { api = this.injector.get(ApiService, null); } catch { /* no HttpClient here */ }
    if (!api) return;
    this.loadedFor = key;
    try {
      api.get<SampleSearchPresetConfig>('/api/config/sample-search-preset').subscribe({
        next: c => this.config.set(c ?? null),
        error: () => { this.loadedFor = null; },
      });
    } catch { this.loadedFor = null; }
  }

  /** Force a refetch (after the lab changes its format / layout). */
  reload(): void {
    this.loadedFor = null;
    this.ensure();
  }

  /** The preset to pre-type right now, or null. */
  current(now: Date = new Date()): string | null {
    return samplePreset(this.config(), now, this.liveSetting());
  }
}
