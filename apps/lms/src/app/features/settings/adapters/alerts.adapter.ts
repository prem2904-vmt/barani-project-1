import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ScreenKey, SettingDef } from '../settings.model';
import { SettingAdapter } from './adapter';

/** One catalog event merged with the tenant's override (mw NotificationCatalogRow). */
export interface AlertRow {
  key: string; module: string; label: string; firesWhen: string; recipients: string;
  kind: 'instant' | 'overdue'; enabled: boolean; thresholdMinutes: number | null; thresholdConfigurable: boolean;
}

/** Plain sub-heading per catalog module (where the alert happens). */
export const ALERT_MODULES: Record<string, string> = {
  frontdesk: 'Front desk', billing: 'Billing', lab: 'Lab', results: 'Results',
  reports: 'Reports', inventory: 'Stock', appointments: 'Appointments', team: 'Team',
};

/** Which ⚙ sheets show a module's alerts (under More options). */
const ALERT_SCREENS: Record<string, ScreenKey[]> = {
  frontdesk: ['frontdesk'], billing: ['billing'], lab: ['collect', 'receive', 'mywork'],
  results: ['result', 'pathologist'], appointments: ['appointments', 'home-collection'],
};

/** Same guard as the Notifications page. */
export const ALERT_PERMS = ['manage_tenant', 'manage_notifications'] as const;

/**
 * In-app alerts (GET /api/config/notifications/catalog; POST one event at a
 * time to /api/config/notifications). The backend catalog is the single
 * source of truth, so each event becomes a Settings row at run time
 * (`defs()`): a switch, plus "Alert after N min" for overdue alerts.
 * Keys: `<event>.enabled`, `<event>.threshold`.
 */
@Injectable({ providedIn: 'root' })
export class AlertsAdapter implements SettingAdapter {
  private readonly api = inject(ApiService);
  private readonly rows = signal<AlertRow[] | null>(null);
  private requested = false;

  ensure(): void {
    if (this.requested) return;
    this.requested = true;
    this.api.get<AlertRow[]>('/api/config/notifications/catalog').subscribe({
      next: (r) => this.rows.set(r ?? []),
      error: () => { this.rows.set([]); this.requested = false; },
    });
  }
  loaded(): boolean { return this.rows() !== null; }

  readonly defs = computed<SettingDef[]>(() => (this.rows() ?? []).map((r) => ({
    id: 'alert.' + r.key,
    group: 'alerts',
    subgroup: ALERT_MODULES[r.module] ?? r.module,
    label: r.label,
    help: r.firesWhen,
    note: r.recipients ? 'To: ' + r.recipients : undefined,
    synonyms: ['alert', 'notification', 'bell', r.module, r.kind === 'overdue' ? 'overdue late' : 'instant'],
    control: r.thresholdConfigurable
      ? { kind: 'switch', fields: [{ key: r.key + '.threshold', label: 'Alert after',
          control: { kind: 'number', min: 1, max: 1440, step: 5, unit: 'min' } }] }
      : { kind: 'switch' },
    scope: 'tenant',
    screens: ALERT_SCREENS[r.module] ?? [],
    permission: ALERT_PERMS,
    adapter: 'alerts',
    key: r.key + '.enabled',
  } satisfies SettingDef)));

  read(key: string): unknown {
    const [ev, field] = splitKey(key);
    const r = this.rows()?.find((x) => x.key === ev);
    if (!r) return undefined;
    return field === 'threshold' ? r.thresholdMinutes : r.enabled;
  }

  async write(key: string, value: unknown): Promise<void> {
    const [ev, field] = splitKey(key);
    const r = this.rows()?.find((x) => x.key === ev);
    if (!r) throw new Error('This alert is not in the list.');
    const next: AlertRow = field === 'threshold'
      ? { ...r, thresholdMinutes: Math.max(1, Math.round(Number(value) || 0)) }
      : { ...r, enabled: value === true };
    if (field === 'threshold' && !(Number(value) >= 1)) throw new Error('Use 1 minute or more.');
    await firstValueFrom(this.api.post('/api/config/notifications', {
      eventType: next.key, inAppEnabled: next.enabled,
      thresholdMinutes: next.thresholdConfigurable ? next.thresholdMinutes : null,
    }));
    this.rows.update((list) => (list ?? []).map((x) => (x.key === ev ? next : x)));
  }
}

function splitKey(key: string): [string, string] {
  const i = key.lastIndexOf('.');
  return [key.slice(0, i), key.slice(i + 1)];
}
