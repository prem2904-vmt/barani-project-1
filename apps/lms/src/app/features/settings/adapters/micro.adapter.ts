import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { SettingAdapter, WholeObjectStore } from './adapter';

interface StageTat { stageKey: string; tatHours: number }
interface Micro { lockTimeoutMinutes: number; allowSupervisorTakeover: boolean; stageTats: StageTat[] }

/**
 * Culture bench settings (GET / PUT /api/microbiology/settings, whole
 * object). Keys: lockTimeoutMinutes, allowSupervisorTakeover, tat.<stage>
 * (gram · growth · identification · ast, in hours).
 */
@Injectable({ providedIn: 'root' })
export class MicroAdapter extends WholeObjectStore<Micro> implements SettingAdapter {
  private readonly api = inject(ApiService);

  protected fetch(): Observable<Micro> { return this.api.get<Micro>('/api/microbiology/settings'); }
  protected save(m: Micro): Observable<unknown> { return this.api.put('/api/microbiology/settings', m); }
  protected defaults(): Micro { return { lockTimeoutMinutes: 60, allowSupervisorTakeover: true, stageTats: [] }; }

  read(key: string): unknown {
    const m = { ...this.defaults(), ...this.obj(null) };
    if (key.startsWith('tat.')) return m.stageTats.find((t) => t.stageKey === key.slice(4))?.tatHours ?? null;
    return (m as unknown as Record<string, unknown>)[key];
  }

  write(key: string, value: unknown): Promise<void> {
    if (key.startsWith('tat.')) {
      const stage = key.slice(4);
      const h = Math.round(Number(value));
      if (!Number.isFinite(h) || h < 1) return Promise.reject(new Error('Use 1 hour or more.'));
      return this.mutate(null, (m) => {
        const list = m.stageTats ?? [];
        return { ...m, stageTats: list.some((t) => t.stageKey === stage)
          ? list.map((t) => (t.stageKey === stage ? { ...t, tatHours: h } : t))
          : [...list, { stageKey: stage, tatHours: h }] };
      });
    }
    if (key === 'lockTimeoutMinutes') {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n) || n < 0) return Promise.reject(new Error('Use 0 or more minutes.'));
      value = n;
    }
    return this.mutate(null, (m) => ({ ...m, [key]: value }));
  }
}
