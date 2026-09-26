import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { TenantStateService } from '../../../core/services/tenant-state.service';
import { Tenant } from '../../../shared/models/tenant.model';
import { SettingAdapter } from './adapter';

const CALC_PREFIX = 'calc.';

/**
 * Tenant-wide fields (PATCH /api/tenants/current) through the shared
 * TenantStateService, so the top bar, the lab screens and the old pages see a
 * change at once. Keys are Tenant fields; `calc.ISI` / `calc.MNPT` /
 * `calc.NORMAL_HCT` live inside the calcConstants JSON (blank = default).
 */
@Injectable({ providedIn: 'root' })
export class TenantSettingsAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly state = inject(TenantStateService);

  ensure(): void { this.state.ensureLoaded(); }
  loaded(): boolean { return this.state.status() === 'loaded'; }

  read(key: string): unknown {
    const t = this.state.tenant();
    if (!t) return undefined;
    if (key.startsWith(CALC_PREFIX)) {
      const v = parseCalc(t.calcConstants)[key.slice(CALC_PREFIX.length)];
      return typeof v === 'number' ? v : null;
    }
    switch (key) {
      case 'scanMode': return t.scanMode === 'manual' ? 'manual' : 'scan';
      case 'brandingMode': return t.brandingMode ?? 'both';
      case 'allowNoScanClaim': return t.allowNoScanClaim === true;
      case 'branchIsolationEnabled': return t.branchIsolationEnabled === true;
      default: return (t as unknown as Record<string, unknown>)[key] ?? '';
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    let body: Record<string, unknown>;
    if (key.startsWith(CALC_PREFIX)) {
      const obj = parseCalc(this.state.tenant()?.calcConstants);
      const k = key.slice(CALC_PREFIX.length);
      const n = typeof value === 'number' ? value : Number(value);
      if (value === null || value === '' || !Number.isFinite(n) || n <= 0) delete obj[k];
      else obj[k] = n;
      body = { calcConstants: Object.keys(obj).length ? obj : null };
    } else if (key === 'name' || key === 'brandingName') {
      const s = String(value ?? '').trim();
      if (key === 'name' && !s) throw new Error('Type a lab name.');
      body = { [key]: key === 'brandingName' ? (s || null) : s };
    } else if (key === 'slug') {
      if (!String(value ?? '').trim()) throw new Error('Type a sign-in name.');
      body = { slug: value };
    } else {
      body = { [key]: value };
    }
    const t = await firstValueFrom(this.api.patch<Tenant | null>('/api/tenants/current', body));
    if (t && typeof t === 'object' && 'id' in t) this.state.update(t as Tenant);
    else this.state.refresh();
  }
}

function parseCalc(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'number') out[k] = v;
    return out;
  } catch { return {}; }
}
