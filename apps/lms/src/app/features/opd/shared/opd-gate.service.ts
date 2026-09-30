import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { installPfOpd, opdConsolePreview, opdVisible, readOpdFlag, safeLocalStorage } from './opd-gate';

/**
 * THE OPD gate for the UI (OPD dark build). Every OPD surface — routes (opdGuard),
 * nav items, admin tiles, the doctor Consults item, the role editor's Doctor
 * type, the create-user doctor fields, the new-order fork, the Modules page
 * row, finance / search entries — asks {@link visible}. Nothing else may decide
 * OPD visibility.
 *
 * Inputs: the console flag (localStorage `pf.opd`, set by `pf.opd()` — any
 * signed-in user, no allowlist; while set, opd-preview.interceptor.ts sends
 * `X-PF-OPD: 1` so the server admits OPD calls) and the tenant's explicit
 * entitlement (`/api/auth/me` `opdEntitled`). Rule in ./opd-gate.ts (pure,
 * unit-tested).
 */
@Injectable({ providedIn: 'root' })
export class OpdGateService {
  private readonly auth = inject(AuthService);
  private readonly storage = safeLocalStorage();
  /** Read once per page load: `pf.opd()` reloads the page to apply. */
  private readonly flag = signal(readOpdFlag(this.storage));

  private readonly inputs = computed(() => {
    const u = this.auth.user();
    return {
      consoleFlag: this.flag(),
      tenantEntitled: !!u?.opdEntitled,
    };
  });

  /** Show OPD anywhere in the UI. */
  readonly visible = computed(() => opdVisible(this.inputs()));
  /** Console preview via `pf.opd()` (treated as OPD-scoped for the fork). */
  readonly consolePreview = computed(() => opdConsolePreview(this.inputs()));

  /** Install `window.pf.opd()` silently. Called once at app start. */
  install(): void {
    if (typeof window === 'undefined' || !this.storage) return;
    installPfOpd(window as unknown as { pf?: Record<string, unknown> } & Record<string, unknown>,
      this.storage, () => { try { window.location.reload(); } catch { /* noop */ } });
  }
}
