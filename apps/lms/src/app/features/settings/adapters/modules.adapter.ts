import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TenantEntitlementsService } from '../../../core/services/tenant-entitlements.service';
import { MODULE_CATALOG } from '../../../core/modules/module-catalog';
import { SettingAdapter } from './adapter';

/**
 * Add-ons (PUT /api/tenants/modules, the whole map) through
 * TenantEntitlementsService, so nav and guards follow at once.
 * Keys: `lab.<feature>` (a Lab feature) or `<module>` (a live module).
 */
@Injectable({ providedIn: 'root' })
export class ModulesAdapter implements SettingAdapter {
  private readonly ent = inject(TenantEntitlementsService);

  ensure(): void { void this.ent.ensureLoaded(); }
  loaded(): boolean { return this.ent.loaded(); }

  read(key: string): unknown {
    if (key === 'comingSoon') {
      return MODULE_CATALOG.filter((m) => m.status === 'coming_soon').map((m) => m.label.replace(/\s*\(.*\)$/, '')).join(', ');
    }
    const [mod, feat] = key.split('.');
    return feat ? this.ent.featureOn(mod as never, feat) : this.ent.moduleOn(mod as never);
  }

  async write(key: string, value: unknown): Promise<void> {
    const [mod, feat] = key.split('.');
    const s = JSON.parse(JSON.stringify(this.ent.effectiveState())) as ReturnType<TenantEntitlementsService['effectiveState']>;
    const cur = s[mod] ?? { enabled: false, features: {} };
    s[mod] = feat
      ? { ...cur, features: { ...(cur.features ?? {}), [feat]: value === true } }
      : { ...cur, enabled: value === true };
    try { await firstValueFrom(this.ent.save(s)); }
    catch (e) { this.ent.refresh(); throw e; }       // save() is optimistic: put the truth back
  }
}
