import { Injectable, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { LabSortKey, LabSortScope, isLabSortKey } from '../../shared/utils/lab-sort';

/** The tech's chosen sort per lab list, remembered per user on this device
 *  (localStorage, every access guarded — it can throw or come back empty).
 *  `keyFor` is read inside `computed()`s, so it never writes a signal. */
@Injectable({ providedIn: 'root' })
export class LabSortService {
  private readonly auth = inject(AuthService);
  /** Picks made in this session, keyed `userId|scope`. */
  private readonly _picked = signal<Record<string, LabSortKey>>({});

  private uid(): string { return this.auth.user()?.id ?? 'anon'; }
  private storeKey(scope: LabSortScope): string { return `pf.labSort.${this.uid()}.${scope}`; }

  /** The current choice for a list ('default' until the tech picks). Reactive. */
  keyFor(scope: LabSortScope): LabSortKey {
    const picked = this._picked()[`${this.uid()}|${scope}`];
    if (picked) return picked;
    try {
      const raw = localStorage.getItem(this.storeKey(scope));
      if (isLabSortKey(scope, raw)) return raw;
    } catch { /* storage unavailable */ }
    return 'default';
  }

  set(scope: LabSortScope, key: LabSortKey): void {
    if (!isLabSortKey(scope, key)) return;
    this._picked.update(m => ({ ...m, [`${this.uid()}|${scope}`]: key }));
    try { localStorage.setItem(this.storeKey(scope), key); } catch { /* ignore */ }
  }
}
