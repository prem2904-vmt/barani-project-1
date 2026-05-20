import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Tenant } from '../../shared/models/tenant.model';

// Shared cache + pub/sub for the current tenant. One fetch on first use;
// every subsequent save through update() is broadcast to every subscriber
// (including other tabs of the same origin via BroadcastChannel), so the
// top strip reflects branding changes without a page reload.

@Injectable({ providedIn: 'root' })
export class TenantStateService {
  private readonly api = inject(ApiService);

  private readonly _tenant = signal<Tenant | null>(null);
  // 'pending' until the first fetch resolves. Consumers use this to hide
  // placeholders (e.g. "YOUR LOGO") until they know whether real branding
  // exists, avoiding a flash of the placeholder on every page load.
  private readonly _status = signal<'pending' | 'loaded'>('pending');
  private _requested = false;

  readonly tenant = this._tenant.asReadonly();
  readonly status = this._status.asReadonly();

  // Cross-tab broadcast so edits in one tab propagate to every other open
  // tab of the same origin. Supported in all modern browsers; on older
  // browsers this silently no-ops and intra-tab state still works fine.
  private readonly channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('pf-tenant-state')
    : null;

  constructor() {
    this.channel?.addEventListener('message', ev => {
      if (ev.data?.type === 'tenant-update' && ev.data?.tenant) {
        this._tenant.set(ev.data.tenant as Tenant);
        this._status.set('loaded');
      }
    });
  }

  ensureLoaded() {
    if (this._requested) return;
    this._requested = true;
    this.refresh();
  }

  refresh() {
    this.api.get<Tenant | null>('/api/tenants/current').subscribe({
      next: t => {
        if (t) this._tenant.set(t);
        this._status.set('loaded');
      },
      error: () => { this._status.set('loaded'); }
    });
  }

  // Called after a successful PATCH /api/tenants/current. Updates this
  // tab's signal synchronously and echoes to peers.
  update(tenant: Tenant) {
    this._tenant.set(tenant);
    this._status.set('loaded');
    try { this.channel?.postMessage({ type: 'tenant-update', tenant }); }
    catch { /* BroadcastChannel failed — same-tab still works */ }
  }

  reset() {
    this._tenant.set(null);
    this._status.set('pending');
    this._requested = false;
  }
}
