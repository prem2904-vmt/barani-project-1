import { Injectable, Injector, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { OpdGateService } from '../../features/opd/shared/opd-gate.service';
import {
  ModuleId, ModulesState, catalogDefaults, defaultModuleEnabled,
} from '../modules/module-catalog';

/**
 * Legacy module keys still referenced across nav + guards. `inventory` is now a
 * top-level MODULE; `messages`/`homeCollection`/`reports` are FEATURES of the Lab
 * module. `moduleEnabled(key)` resolves all of them against the two-level model
 * so existing callers keep working unchanged.
 */
export type ModuleKey = ModuleId | 'messages' | 'homeCollection' | 'reports' | PlatformSwitchKey | 'files';

/** Files (Neuron, Synapse, Axon, Myelin, Retina) is OPT-IN per tenant, the opposite of the switches above: Full only when the
 *  server says `files: true` (module-config). No row, no key, a failed call or a call still loading all mean VIEW ONLY. */
export function filesFullOn(wire: Partial<Record<string, unknown>> | null | undefined): boolean {
  return wire?.['files'] === true;
}

const LAB_FEATURE_KEYS = new Set(['messages', 'homeCollection', 'reports']);

/** "WhatsApp Auto" / "WhatsApp Chat" / "Email share" / "SMS Chat": platform switches (admin console,
 *  per tenant) that are ON unless switched off — an ABSENT value is on (the lab had them before they
 *  were switchable; email_share / sms_chat are new and default on the same way, 2026-11-13). */
export type WhatsAppModeKey = 'whatsappAuto' | 'whatsappChat';
export type PlatformSwitchKey = WhatsAppModeKey | 'emailShare' | 'smsChat';
export const DEFAULT_ON_WHEN_ABSENT: readonly PlatformSwitchKey[] = ['whatsappAuto', 'whatsappChat', 'emailShare', 'smsChat'];

/** The server's snake_case spelling of a switch (module-config may answer either). */
const SNAKE: Record<PlatformSwitchKey, string> = {
  whatsappAuto: 'whatsapp_auto', whatsappChat: 'whatsapp_chat', emailShare: 'email_share', smsChat: 'sms_chat',
};

/** Resolve one default-on key from GET /api/tenants/module-config (absent / non-boolean ⇒ on). */
export function platformSwitchOn(wire: Partial<Record<string, unknown>> | null | undefined, key: PlatformSwitchKey): boolean {
  return wire?.[key] !== false && wire?.[SNAKE[key]] !== false;
}

const ALL_ON: Record<PlatformSwitchKey, boolean> = { whatsappAuto: true, whatsappChat: true, emailShare: true, smsChat: true };
const isPlatformSwitch = (k: string): k is PlatformSwitchKey => (DEFAULT_ON_WHEN_ABSENT as readonly string[]).includes(k);

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
  private readonly injector = inject(Injector);

  /** null until loaded — callers fall back to catalog defaults meanwhile. */
  private readonly _modules = signal<ModulesState | null>(null);
  private readonly _loaded = signal(false);
  private loadPromise: Promise<void> | null = null;

  /** The platform's WhatsApp / email / SMS switches. Fail-open (on) until loaded or when the server is older. */
  private readonly _platform = signal<Record<PlatformSwitchKey, boolean>>({ ...ALL_ON });
  /** Fail-closed: false (View only) until the server has said otherwise, so Save never flashes in. */
  private readonly _filesFull = signal(false);
  readonly filesFull = this._filesFull.asReadonly();

  readonly modules = this._modules.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  /** Master switch for a module. Defaults to the catalog default until loaded. */
  moduleOn(id: ModuleId): boolean {
    // OPD dark build: OPD is on ONLY through the OPD gate (explicit tenant
    // entitlement or the owner's console preview) — never through the stored
    // map or a catalog default. Resolved lazily (the gate reads AuthService).
    if (id === 'opd') return this.injector.get(OpdGateService).visible();
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
    if (key === 'files') return this._filesFull();
    if (isPlatformSwitch(key)) return this._platform()[key];
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
    // Platform WhatsApp / email / SMS switches (module-config); a failure leaves them on.
    this.api.get<Record<string, unknown>>('/api/tenants/module-config').subscribe({
      next: (wire) => { this._filesFull.set(filesFullOn(wire)); this._platform.set({
        whatsappAuto: platformSwitchOn(wire, 'whatsappAuto'), whatsappChat: platformSwitchOn(wire, 'whatsappChat'),
        emailShare: platformSwitchOn(wire, 'emailShare'), smsChat: platformSwitchOn(wire, 'smsChat'),
      }); },
      error: () => { /* the switches stay on; Files stays View only */ },
    });
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
    this._platform.set({ ...ALL_ON });
    this._filesFull.set(false);
    this._modules.set(null);
    this._loaded.set(false);
    this.loadPromise = null;
  }
}
