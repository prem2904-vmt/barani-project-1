/**
 * Pure helper (OPD build): does the current role selection include a
 * doctor-type role? Drives whether Create User shows the doctor-details
 * section. Kept DOM-free so it's unit-tested without the component.
 *
 * A role is a "doctor role" when its `kind` is 'doctor' — the explicit type the
 * admin picks in the Role editor — regardless of what the role is named.
 */
export interface RoleKind {
  id: string;
  kind?: string | null;
}

export function hasDoctorRole(roles: readonly RoleKind[], selectedIds: readonly string[]): boolean {
  if (!selectedIds.length) return false;
  const doctorIds = new Set(roles.filter(r => r.kind === 'doctor').map(r => r.id));
  return selectedIds.some(id => doctorIds.has(id));
}
