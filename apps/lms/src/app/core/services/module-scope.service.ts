import { Injectable, computed, inject, isDevMode } from '@angular/core';
import { TenantEntitlementsService } from './tenant-entitlements.service';
import { AuthService } from '../auth/auth.service';
import { CartMode, ModuleId, canUseModule, cartMode } from '../../shared/opd/module-scope';

/**
 * Resolves which product modules the CURRENT USER may work in on this screen —
 * the three-layer gate's user × tenant intersection (permission stays with the
 * screen). Composes {@link TenantEntitlementsService} (tenant entitlement) with
 * the user's module scope.
 *
 * PRODUCTION-SAFETY DEFAULTS (OPD is strictly additive):
 *   - lab scope DEFAULTS ON  — everyone works the lab today, so lab stays
 *     usable and the cart stays `'lab'`.
 *   - opd scope DEFAULTS OFF — OPD is usable only when the user's /me modules
 *     include 'opd' (role tagged 'opd') AND the tenant has OPD entitled.
 * So for every existing user `opdUsable` is false, `mode()` is `'lab'`, and no
 * lab behaviour changes. A dev-only preview flag (below) forces OPD on locally
 * for testing, inert in production.
 */
@Injectable({ providedIn: 'root' })
export class ModuleScopeService {
  private readonly entitlements = inject(TenantEntitlementsService);
  private readonly auth = inject(AuthService);

  /** Modules the current user is scoped to, from /api/auth/me (RBAC role.Module
   *  ?? 'lab'). Defaults to lab when unloaded or from an older server, so the
   *  fork stays lab-only. Only the known module ids are honoured. */
  private readonly userScopes = computed<ReadonlySet<ModuleId>>(() => {
    const mods = this.auth.user()?.modules ?? ['lab'];
    const known = mods.filter((m): m is ModuleId => m === 'lab' || m === 'opd');
    return new Set<ModuleId>(known.length ? known : ['lab']);
  });

  /**
   * DEV-ONLY local preview of the OPD flow. On a dev build (`isDevMode()`),
   * `localStorage['pf.opdPreview']='1'` forces OPD usable so the front-desk fork
   * / consult screen can be exercised WITHOUT any tenant/RBAC/DB change. Read
   * LIVE (each call) so it takes effect without a reload. `isDevMode()` is false
   * in every production build, so this is permanently inert for real users.
   */
  private opdPreview(): boolean {
    try { return isDevMode() && localStorage.getItem('pf.opdPreview') === '1'; }
    catch { return false; }
  }

  labUsable(): boolean {
    return canUseModule(this.entitlements.moduleOn('lab'), this.userScopes().has('lab'));
  }
  opdUsable(): boolean {
    return this.opdPreview()
      || canUseModule(this.entitlements.moduleOn('opd'), this.userScopes().has('opd'));
  }

  /** What the front-desk cart should open. `'lab'` unless OPD is truly usable.
   *  A method (not a memoised signal) so the dev preview flag is honoured live. */
  mode(): CartMode {
    return cartMode(this.labUsable(), this.opdUsable());
  }
}
