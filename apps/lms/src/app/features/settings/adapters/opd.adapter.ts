import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter, WholeObjectStore } from './adapter';

export interface FollowUpTier { withinDays: number; discountPercent: number }
interface Opd { followUpMode: 'off' | 'auto' | 'assisted'; tiers: FollowUpTier[] }

/**
 * OPD follow-up policy (GET / PUT /api/opd/settings, whole object).
 * Keys: followUpMode, tiers (the whole list — rows with 0 days are dropped).
 */
@Injectable({ providedIn: 'root' })
export class OpdAdapter extends WholeObjectStore<Opd> implements SettingAdapter {
  private readonly api = inject(ApiService);

  protected fetch(): Observable<Opd> { return this.api.get<Opd>('/api/opd/settings'); }
  protected save(o: Opd): Observable<unknown> {
    return this.api.put('/api/opd/settings', { followUpMode: o.followUpMode, tiers: (o.tiers ?? []).filter((t) => t.withinDays > 0) });
  }
  protected defaults(): Opd { return { followUpMode: 'off', tiers: [] }; }

  read(key: string): unknown { return ({ ...this.defaults(), ...this.obj(null) } as unknown as Record<string, unknown>)[key]; }

  write(key: string, value: unknown): Promise<void> {
    if (key === 'tiers') {
      const tiers = (Array.isArray(value) ? value : []).map((t: FollowUpTier) => ({
        withinDays: Math.max(0, Math.round(Number(t.withinDays) || 0)),
        discountPercent: Math.min(100, Math.max(0, Math.round(Number(t.discountPercent) || 0))),
      }));
      return this.mutate(null, (o) => ({ ...o, tiers }));
    }
    return this.mutate(null, (o) => ({ ...o, [key]: value }));
  }
}
