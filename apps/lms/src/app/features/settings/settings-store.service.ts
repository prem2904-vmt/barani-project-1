import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/auth/auth.service';
import { PlatformService } from '../../core/services/platform.service';
import { TenantEntitlementsService } from '../../core/services/tenant-entitlements.service';
import { SettingAdapter } from './adapters/adapter';
import { AutoAssignAdapter } from './adapters/auto-assign.adapter';
import { BranchLabConfigAdapter } from './adapters/branch-lab-config.adapter';
import { LabModesAdapter } from './adapters/lab-modes.adapter';
import { TenantSettingsAdapter } from './adapters/tenant.adapter';
import { AccessContext, canSee } from './settings-access';
import { SETTINGS, SETTINGS_BY_ID } from './settings-registry';
import { AdapterKey, RowContext, SettingDef } from './settings.model';

/**
 * The one store behind Settings — the page AND every screen's ⚙ sheet read
 * the same adapters, so a change made in one shows in the other at once.
 *
 * Branch-scoped rows edit `branchId()`: the active branch until someone picks
 * another one on a row's scope chip. That choice is page-wide (every "This
 * branch" row follows it) and each call carries it as X-Active-Branch.
 */
@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PlatformService);
  private readonly entitlements = inject(TenantEntitlementsService);

  private readonly adapters: Partial<Record<AdapterKey, SettingAdapter>> = {
    tenant: inject(TenantSettingsAdapter),
    blc: inject(BranchLabConfigAdapter),
    autoAssign: inject(AutoAssignAdapter),
    labModes: inject(LabModesAdapter),
  };

  /** Register a store (phase-2 adapters, tests). */
  register(key: AdapterKey, adapter: SettingAdapter): void { this.adapters[key] = adapter; }
  adapter(key: AdapterKey): SettingAdapter | undefined { return this.adapters[key]; }

  private readonly _branch = signal<string | null>(null);
  readonly activeBranchId = computed(() => this.auth.activeBranchId() ?? this.auth.user()?.branchId ?? null);
  /** The branch "This branch" rows edit. */
  readonly branchId = computed(() => this._branch() ?? this.activeBranchId());
  readonly branches = computed(() => this.auth.user()?.branches ?? []);
  readonly branchName = computed(() => {
    const id = this.branchId();
    return this.branches().find((b) => b.id === id)?.name
      ?? (id === this.auth.user()?.branchId ? this.auth.user()?.branchName : null)
      ?? 'This branch';
  });
  setBranch(id: string): void {
    if (!this.branches().some((b) => b.id === id)) return;
    this._branch.set(id === this.activeBranchId() ? null : id);
  }

  /** The branch a row's calls go to (null = not branch-scoped). */
  scopeBranch(def: Pick<SettingDef, 'scope'>): string | null {
    return def.scope === 'branch' || def.scope === 'dept' ? this.branchId() : null;
  }

  readonly access = computed<AccessContext>(() => ({
    perms: this.auth.user()?.permissions ?? [],
    moduleOn: (k) => this.entitlements.moduleEnabled(k),
  }));

  /** Permission + module + store present. */
  allowed(def: SettingDef): boolean {
    return !!this.adapters[def.adapter] && canSee(def, this.access());
  }

  /** Allowed AND its `visibleWhen` holds right now. */
  visible(def: SettingDef): boolean {
    if (!this.allowed(def)) return false;
    return def.visibleWhen ? def.visibleWhen(this.rowContext) : true;
  }

  readonly rowContext: RowContext = {
    value: (id: string) => {
      const d = SETTINGS_BY_ID.get(id);
      return d ? this.read(d) : undefined;
    },
    isElectron: this.platform.isElectron(),
  };

  ensure(defs: readonly SettingDef[]): void {
    this.entitlements.ensureLoaded();
    const seen = new Set<string>();
    for (const d of defs) {
      const a = this.adapters[d.adapter];
      const b = this.scopeBranch(d);
      const k = `${d.adapter}|${b ?? ''}`;
      if (!a || seen.has(k)) continue;
      seen.add(k);
      a.ensure(b);
    }
  }

  loaded(def: SettingDef): boolean {
    return this.adapters[def.adapter]?.loaded(this.scopeBranch(def)) ?? false;
  }

  read(def: SettingDef, key: string = def.key): unknown {
    return this.adapters[def.adapter]?.read(key, this.scopeBranch(def));
  }

  write(def: SettingDef, value: unknown, key: string = def.key): Promise<void> {
    const a = this.adapters[def.adapter];
    if (!a) return Promise.reject(new Error('Not available here.'));
    try { return a.write(key, value, this.scopeBranch(def)); }
    catch (e) { return Promise.reject(e); }
  }

  /** All rows the user may see (page and sheets). */
  readonly allowedRows = computed(() => SETTINGS.filter((d) => this.allowed(d)));
}
