import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AppointmentConfig } from '../../../shared/models/appointment.model';
import { SettingAdapter, WholeObjectStore, branchHeader } from './adapter';

type Cfg = AppointmentConfig & Record<string, unknown>;
const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/** Backend defaults (Services/AppointmentQueueOptions.cs) — "Reset to default". */
export const QUEUE_DEFAULTS: AppointmentConfig['queueOptions'] = {
  baseAppointment: 500, baseWalkin: 100, baseFollowup: 300, waitWeight: 1,
  appointmentGraceMinutes: 15, latePenalty: 200, noShowThresholdMinutes: 30,
  avgCollectionMinutes: 5, urgentOverrideScore: 9999,
};

export function firstWindow(json?: string | null): { from: string; to: string } | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Record<string, Array<{ from: string; to: string }>>;
    for (const k of Object.keys(parsed)) {
      const w = parsed[k];
      if (Array.isArray(w) && w[0]?.from && w[0]?.to) return { from: w[0].from, to: w[0].to };
    }
  } catch { /* malformed → defaults */ }
  return null;
}

function schedule(from: string, to: string): string {
  const s: Record<string, { from: string; to: string }[]> = {};
  for (const d of DOW) s[d] = [{ from, to }];
  return JSON.stringify(s);
}

/**
 * Per-branch appointment + queue config (PUT /api/appointments/config, the
 * whole object, keyed on X-Active-Branch). Open hours live in
 * weeklyScheduleJson as one window for every weekday — the same shape the
 * Appointments page and the booking modal use. Keys: queueMode, slotMinutes,
 * maxConcurrentSlots, open24h, hours.from, hours.to, opt.<queue option>.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentsAdapter extends WholeObjectStore<Cfg> implements SettingAdapter {
  private readonly api = inject(ApiService);

  protected fetch(b: string | null): Observable<Cfg> { return this.api.get<Cfg>('/api/appointments/config', branchHeader(b)); }
  protected save(c: Cfg, b: string | null): Observable<unknown> { return this.api.put('/api/appointments/config', c, branchHeader(b)); }
  protected defaults(): Cfg {
    return { branchId: '', slotMinutes: 15, open24h: false, weeklyScheduleJson: null, maxConcurrentSlots: 1,
      queueMode: 'token_queue', queueOptions: { ...QUEUE_DEFAULTS } } as Cfg;
  }
  protected override afterSave(sent: Cfg, res: unknown): Cfg {
    return res && typeof res === 'object' && 'queueMode' in (res as object) ? (res as Cfg) : sent;
  }

  private hours(c: Cfg): { from: string; to: string } {
    return firstWindow(c.weeklyScheduleJson) ?? { from: '09:00', to: '17:00' };
  }

  read(key: string, b: string | null): unknown {
    const c = this.obj(b);
    if (key === 'hours.from') return this.hours(c).from;
    if (key === 'hours.to') return this.hours(c).to;
    if (key.startsWith('opt.')) {
      const k = key.slice(4) as keyof AppointmentConfig['queueOptions'];
      return c.queueOptions?.[k] ?? QUEUE_DEFAULTS[k];
    }
    return c[key];
  }

  write(key: string, value: unknown, b: string | null): Promise<void> {
    if (key === 'hours.from' || key === 'hours.to') {
      const v = String(value ?? '');
      if (!/^\d{2}:\d{2}$/.test(v)) return Promise.reject(new Error('Pick a time.'));
      const cur = this.hours(this.obj(b));
      const next = key === 'hours.from' ? { from: v, to: cur.to } : { from: cur.from, to: v };
      if (next.from >= next.to) return Promise.reject(new Error('Closing time must be after opening time.'));
      return this.mutate(b, (c) => {
        const h = { ...this.hours(c), ...(key === 'hours.from' ? { from: v } : { to: v }) };
        return { ...c, weeklyScheduleJson: schedule(h.from, h.to) };
      });
    }
    if (key === 'open24h') {
      const on = value === true;
      return this.mutate(b, (c) => ({ ...c, open24h: on,
        weeklyScheduleJson: on ? null : c.weeklyScheduleJson ?? schedule('09:00', '17:00') }));
    }
    if (key.startsWith('opt.')) {
      const k = key.slice(4);
      const n = Number(value);
      if (value === null || !Number.isFinite(n)) return Promise.reject(new Error('Type a number.'));
      return this.mutate(b, (c) => ({ ...c, queueOptions: { ...QUEUE_DEFAULTS, ...c.queueOptions, [k]: n } }));
    }
    if ((key === 'slotMinutes' || key === 'maxConcurrentSlots') && !(Number(value) >= 1)) {
      return Promise.reject(new Error('Use 1 or more.'));
    }
    return this.mutate(b, (c) => ({ ...c, [key]: value }));
  }
}
