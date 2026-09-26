import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  ModuleId, ModulesState, catalogDefaults, defaultModuleEnabled,
} from '../modules/module-catalog';

/**
 * Legacy module keys still referenced across nav + guards. `inventory` is now a
 * top-level MODULE; `messages`/`homeCollection`/`reports` are FEATURES of the Lab
 * module. `moduleEnabled(key)` resolves all of them against the two-level model
 * so existing callers keep working unchanged.
 */
export type ModuleKey = ModuleId | 'messages' | 'homeCollection' | 'reports';

const LAB_FEATURE_KEYS = new Set(['messages', 'homeCollection', 'reports']);

/** Wire shape of GET /api/tenants/modules. */
interface ModulesWire {
  modulesJson: string | null;
  legacy: { inventory: boolean; messages: boolean; homeCollection: boolean; reports: boolean };
}

/**
 * Singleton for the current tenant's MODULE + FEATURE enablement (which product
 * modules the tenant is licensed for, and which features inside each are on).
 * Nav items, route guards, and the admin Modules page read it.
 *
 * Fail-OPEN to the CATALOG DEFAULT while loading / on error: live modules (Lab,
 * Inventory) default ON so they never flash away; not-yet-purchased modules (OPD,
 * IPD…) default OFF so they never flash in. Loaded lazily (single-flight), primed
 * from the shell nav components.
 */
@Injectable({ providedIn: 'root' })
export class TenantEntitlementsService {
  private readonly api = inject(ApiService);

  /** null until loaded — callers fall back to catalog defaults meanwhile. */
  private readonly _modules = signal<ModulesState | null>(null);
  private readonly _loaded = signal(false);
  private loadPromise: Promise<void> | null = null;

  readonly modules = this._modules.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Master switch for a module. Defaults to the catalog default until loaded. */
  moduleOn(id: ModuleId): boolean {
    const state = this._modules();
    if (!state) return defaultModuleEnabled(id);
    return state[id]?.enabled ?? defaultModuleEnabled(id);
  }

  /** A feature is on only when its module is on AND the feature flag isn't off.
   *  Unknown/unset feature ⇒ true (features default on within an enabled module). */
  featureOn(moduleId: ModuleId, featureKey: string): boolean {
    if (!this.moduleOn(moduleId)) return false;
    const state = this._modules();
    if (!state) return true;
    return state[moduleId]?.features?.[featureKey] !== false;
  }

  /**
   * Back-compat resolver used by existing nav items and guards. Maps legacy keys
   * to the two-level model: `inventory` → the Inventory module; `messages` /
   * `homeCollection` / `reports` → the matching Lab feature. Fail-open preserved.
   */
  moduleEnabled(key: ModuleKey): boolean {
    if (LAB_FEATURE_KEYS.has(key)) return this.featureOn('lab', key);
    return this.moduleOn(key as ModuleId);
  }

  /** Effective state merged over catalog defaults — for the admin toggle page. */
  effectiveState(): ModulesState {
    const base = catalogDefaults();
    const stored = this._modules();
    if (!stored) return base;
    const out: ModulesState = {};
    for (const id of Object.keys(base)) {
      const s = stored[id];
      out[id] = {
        enabled: s?.enabled ?? base[id].enabled,
        features: { ...base[id].features, ...(s?.features ?? {}) },
      };
    }
    return out;
  }

  /** Single-flight load. Guards await it; nav components prime fire-and-forget. */
  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) this.loadPromise = this.fetch();
    return this.loadPromise;
  }

  private fetch(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.api.get<ModulesWire>('/api/tenants/modules').subscribe({
        next: (wire) => { this._modules.set(this.parse(wire)); this._loaded.set(true); resolve(); },
        error: () => { resolve(); },
      });
    });
  }

  /** Turn the wire payload into ModulesState: prefer the stored JSON, else seed
   *  from the legacy flags (older tenants) so their config is still honored. */
  private parse(wire: ModulesWire | null): ModulesState | null {
    if (!wire) return null;
    if (wire.modulesJson) {
      try {
        const parsed = JSON.parse(wire.modulesJson) as ModulesState;
        if (parsed && typeof parsed === 'object') return parsed;
      } catch { /* fall through to legacy seed */ }
    }
    const lg = wire.legacy;
    // A malformed payload (no legacy block) must not throw inside the
    // subscription: fall back to the catalog defaults (fail-open).
    if (!lg) return null;
    return {
      lab: {
        enabled: defaultModuleEnabled('lab'),
        features: { messages: lg.messages, homeCollection: lg.homeCollection, reports: lg.reports },
      },
      inventory: { enabled: lg.inventory },
    };
  }

  /** Persist the full module/feature map (admin Modules page). */
  save(state: ModulesState): Observable<unknown> {
    this._modules.set(state);
    return this.api.put('/api/tenants/modules', { modules: state });
  }

  /** Re-fetch after a save elsewhere / tenant switch. */
  refresh(): void { this.loadPromise = this.fetch(); }

  reset(): void {
    this._modules.set(null);
    this._loaded.set(false);
    this.loadPromise = null;
  }
}
