import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';
import { FlagStorage, installPfOpd, opdConsolePreview, opdVisible, readOpdFlag } from './opd-gate';

function safeLocalStorage(): FlagStorage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/**
 * THE OPD gate for the UI (OPD dark build). Every OPD surface — routes (opdGuard),
 * nav items, admin tiles, the doctor Consults item, the role editor's Doctor
 * type, the create-user doctor fields, the new-order fork, the Modules page
 * row, finance / search entries — asks {@link visible}. Nothing else may decide
 * OPD visibility.
 *
 * Inputs: the console flag (localStorage `pf.opd`, set by `pf.opd()`) and the
 * server's `/api/auth/me` flags (`opdAccess`, `opdEntitled`). Rule in
 * ./opd-gate.ts (pure, unit-tested).
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
      serverAccess: !!u?.opdAccess,
      tenantEntitled: !!u?.opdEntitled,
    };
  });

  /** Show OPD anywhere in the UI. */
  readonly visible = computed(() => opdVisible(this.inputs()));
  /** Owner preview via the console flag (treated as OPD-scoped for the fork). */
  readonly consolePreview = computed(() => opdConsolePreview(this.inputs()));

  /** Install `window.pf.opd()` silently. Called once at app start. */
  install(): void {
    if (typeof window === 'undefined' || !this.storage) return;
    installPfOpd(window as unknown as { pf?: Record<string, unknown> } & Record<string, unknown>,
      this.storage, () => { try { window.location.reload(); } catch { /* noop */ } });
  }
}
