import { Injectable, computed, inject, signal } from '@angular/core';
import { TenantEntitlementsService } from './tenant-entitlements.service';
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

  /** Modules the current user is scoped to. Safe default: lab only. Real source
   *  (RBAC module-tagged roles) is wired in a later slice via {@link setUserScopes}. */
  private readonly _userScopes = signal<ReadonlySet<ModuleId>>(new Set<ModuleId>(['lab']));

  /** Replace the user's module scope (called once RBAC tagging exists). */
  setUserScopes(scopes: Iterable<ModuleId>): void {
    this._userScopes.set(new Set(scopes));
  }

  readonly labUsable = computed(() =>
    canUseModule(this.entitlements.moduleOn('lab'), this._userScopes().has('lab')));
  readonly opdUsable = computed(() =>
    canUseModule(this.entitlements.moduleOn('opd'), this._userScopes().has('opd')));

  /** What the front-desk cart should open. `'lab'` unless OPD is truly usable. */
  readonly mode = computed<CartMode>(() => cartMode(this.labUsable(), this.opdUsable()));
}
