/**
 * Module scope + cart-mode decision (OPD build, slice 1). Pure and DOM-free so
 * the branching rules are unit-tested in isolation.
 *
 * SAFETY INVARIANT (this app is in production): OPD is strictly additive. When
 * OPD is not usable, `cartMode` must resolve to exactly the pre-OPD behaviour —
 * `'lab'` — so the front-desk cart is byte-identical for lab-only / OPD-off
 * tenants. Lab scope therefore DEFAULTS ON; OPD scope DEFAULTS OFF (see
 * ModuleScopeService). Nothing here may make the lab path conditional on OPD.
 */
export type ModuleId = 'lab' | 'opd';

/** What the front-desk cart should open when tapped. */
export type CartMode = 'lab' | 'opd' | 'choose' | 'none';

/** A module is usable here only when the TENANT is entitled to it AND the USER
 *  is scoped to it. Both must be true (the three-layer gate; permission is
 *  checked separately by the screen). */
export function canUseModule(tenantEnabled: boolean, userScoped: boolean): boolean {
  return tenantEnabled && userScoped;
}

/**
 * Decide the cart's behaviour from which modules are usable:
 *   - both  → 'choose' (show the Test / Consultation dropdown)
 *   - opd   → 'opd'    (open the consult builder directly)
 *   - lab   → 'lab'    (open the test picker directly — today's behaviour)
 *   - none  → 'none'   (no usable module; caller keeps the cart inert)
 * Lab wins as the safe fallback: if OPD is off, a lab-usable user is always 'lab'.
 */
export function cartMode(labUsable: boolean, opdUsable: boolean): CartMode {
  if (labUsable && opdUsable) return 'choose';
  if (opdUsable) return 'opd';
  if (labUsable) return 'lab';
  return 'none';
}
