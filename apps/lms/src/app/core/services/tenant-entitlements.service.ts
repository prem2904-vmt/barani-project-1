import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/** The four gateable module keys — must match the cross-repo contract exactly. */
export type ModuleKey = 'inventory' | 'messages' | 'homeCollection' | 'reports';

/** Wire shape of GET /api/tenants/module-config. */
export interface TenantModuleConfig {
  inventory: boolean;
  messages: boolean;
  homeCollection: boolean;
  reports: boolean;
}

/**
 * Singleton for the current tenant's MODULE ENTITLEMENTS (which product
 * modules this tenant is licensed for). Nav items and route guards read
 * `moduleEnabled(key)` to hide/block a whole module.
 *
 * Fail-OPEN: modules default to enabled while the config is loading or if the
 * request fails, so an entitled module never flashes away then back. The
 * backend is likewise backward-compatible (a tenant with no config record gets
 * everything), so an unconfigured/legacy tenant sees all modules. Loaded lazily
 * on first access (single-flight), primed early from the shell nav components.
 */
@Injectable({ providedIn: 'root' })
export class TenantEntitlementsService {
  private readonly api = inject(ApiService);

  private readonly _config = signal<TenantModuleConfig | null>(null);
  private readonly _loaded = signal(false);
  private loadPromise: Promise<void> | null = null;

  readonly config = this._config.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Whether the named module is enabled for this tenant. Defaults to TRUE
   *  until the config has loaded (and on error) so entitled modules don't flash
   *  away — corrected once the real config arrives. */
  moduleEnabled(key: ModuleKey): boolean {
    const cfg = this._config();
    if (!cfg) return true;
    return cfg[key] !== false;
  }

  /** Single-flight load. Returns a Promise so route guards can await the real
   *  config before deciding; nav components call it fire-and-forget to prime. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.fetch();
    return this.loadPromise;
  }

  private fetch(): Promise<void> {
    return new Promise<void>(resolve => {
      this.api.get<TenantModuleConfig>('/api/tenants/module-config').subscribe({
        next: cfg => { if (cfg) this._config.set(cfg); this._loaded.set(true); resolve(); },
        error: () => { resolve(); }
      });
    });
  }

  reset(): void {
    this._config.set(null);
    this._loaded.set(false);
    this.loadPromise = null;
  }
}
