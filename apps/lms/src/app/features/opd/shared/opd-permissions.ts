/**
 * Permission codes that belong to OPD / pharmacy (OPD dark build). None are
 * seeded by the current backend, but a dead Phase-0 build left some of them in
 * the dev database, where they surfaced in the role editor's "Other" group.
 * While OPD is dark the role editor hides them (grants are preserved on save).
 * When OPD ships its own permission codes, add them here AND to the backend
 * PermissionSeeder in the same change (integrator).
 */
export const OPD_PERMISSION_CODES: ReadonlySet<string> = new Set([
  'manage_opd', 'opd_consult', 'dispense_drug', 'manage_pharmacy',
]);
