import { Injectable, signal } from '@angular/core';

// Frontdesk-scoped flags. Persisted in localStorage so a reload keeps the
// admin's preference; backed by a signal so both the Billing tab toggle
// and the Order tab's post-save branching react without extra wiring.
//
// Keep this service dumb — no network calls. When the backend grows a
// proper tenant-level billing mode, this turns into a read-through cache.

const KEY = 'pf.frontdesk.collectsBilling';

@Injectable({ providedIn: 'root' })
export class FrontdeskSettingsService {
  private readonly _collectsBilling = signal<boolean>(this.readInitial());
  readonly collectsBilling = this._collectsBilling.asReadonly();

  setCollectsBilling(v: boolean) {
    this._collectsBilling.set(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode, no-op */ }
  }

  private readInitial(): boolean {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw === '1') return true;
      if (raw === '0') return false;
    } catch { /* ignore */ }
    // Default to true — most labs do collect at frontdesk.
    return true;
  }
}
