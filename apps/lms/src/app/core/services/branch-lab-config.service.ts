import { Injectable, computed, inject, signal } from '@angular/core';
import { BillingMode, BranchLabConfig, CollectionMode } from '../../shared/models/branch-lab-config.model';
import { ApiService } from './api.service';

/**
 * Singleton for the current branch's lab config. Nav items, reception
 * screens, and the admin Lab Settings page all read `collectionMode` from
 * here. Loaded lazily on first access; refreshed after admin updates.
 */
@Injectable({ providedIn: 'root' })
export class BranchLabConfigService {
  private readonly api = inject(ApiService);

  private readonly _config = signal<BranchLabConfig | null>(null);
  private readonly _loaded = signal(false);
  private _loading = false;

  readonly config = this._config.asReadonly();
  readonly loaded = this._loaded.asReadonly();
  readonly collectionMode = computed<CollectionMode>(
    () => this._config()?.collectionMode ?? 'front_desk'
  );
  readonly billingMode = computed<BillingMode>(
    () => this._config()?.billingMode ?? 'front_desk'
  );

  ensureLoaded(): void {
    if (this._loaded() || this._loading) return;
    this._loading = true;
    this.api.get<BranchLabConfig>('/api/tenants/branch-lab-config').subscribe({
      next: cfg => {
        if (cfg) this._config.set(cfg);
        this._loaded.set(true);
        this._loading = false;
      },
      error: () => { this._loading = false; }
    });
  }

  update(next: BranchLabConfig): void { this._config.set(next); }

  reset(): void {
    this._config.set(null);
    this._loaded.set(false);
    this._loading = false;
  }
}
