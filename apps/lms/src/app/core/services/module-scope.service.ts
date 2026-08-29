import { Injectable, computed, inject } from '@angular/core';
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
 *   - lab scope DEFAULTS ON  — everyone works the lab today, so lab must stay
 *     usable and the cart must stay `'lab'` until real scoping is wired.
 *   - opd scope DEFAULTS OFF — OPD stays invisible/inert until a user is
 *     explicitly granted it (a later RBAC-tagging slice sets `setUserScopes`).
 * Net effect right now: `opdUsable` is false everywhere, `mode()` is `'lab'`,
 * and no lab behaviour changes.
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

  readonly labUsable = computed(() =>
    canUseModule(this.entitlements.moduleOn('lab'), this.userScopes().has('lab')));
  readonly opdUsable = computed(() =>
    canUseModule(this.entitlements.moduleOn('opd'), this.userScopes().has('opd')));

  /** What the front-desk cart should open. `'lab'` unless OPD is truly usable. */
  readonly mode = computed<CartMode>(() => cartMode(this.labUsable(), this.opdUsable()));
}
