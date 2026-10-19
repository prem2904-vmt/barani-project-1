/**
 * Consultant ↔ department link for Users & roles (owner 2026-09-27: "each
 * person is relevant to a particular department — a pathologist sees only
 * that department"). The server stores it in each department's VALIDATOR
 * POOL (the same list Lab settings edits); see mw ConsultantScopeService.
 *
 *   GET /api/users/departments          → every user's row (Users list)
 *   GET /api/users/{id}/departments     → one user's row (user edit)
 *   PUT /api/users/{id}/departments     → { departmentIds } (direct list)
 *
 * Empty = no assignment = the consultant sees ALL departments (the safe
 * default, so labs that never assigned anyone keep working). A role placed
 * in a department's pool also counts (read-only here: Lab settings owns it).
 */
export interface UserDepartmentsRow {
  userId: string;
  /** Departments the user is listed on directly (editable here). */
  departmentIds: string[];
  /** Departments reached through one of their roles (Lab settings). */
  viaRoles: { departmentId: string; roleId: string }[];
}

export const DEPARTMENTS_HINT =
  'Consultants (pathologists, microbiologists, biochemists…) see and sign only these departments\' work. ' +
  'Leave empty and they see every department.';

/** Every department a user covers (direct ∪ through a role), deduped. */
export function allDepartmentIds(row: UserDepartmentsRow | undefined | null): string[] {
  if (!row) return [];
  return [...new Set([...(row.departmentIds ?? []), ...(row.viaRoles ?? []).map(v => v.departmentId)])];
}

/** Department names for the Users list column, alphabetical. Unknown ids
 *  (a department deleted since) are skipped, never shown as a raw id. */
export function departmentNames(row: UserDepartmentsRow | undefined | null, names: Map<string, string>): string[] {
  return allDepartmentIds(row)
    .map(id => names.get(id))
    .filter((n): n is string => !!n)
    .sort((a, b) => a.localeCompare(b));
}

/** The read-only "through a role" line on the user editor:
 *  "Microbiology (Microbiologist)". Direct picks are not repeated. */
export function viaRoleLabels(
  row: UserDepartmentsRow | undefined | null,
  deptNames: Map<string, string>,
  roleNames: Map<string, string>,
): string[] {
  if (!row) return [];
  const direct = new Set(row.departmentIds ?? []);
  return (row.viaRoles ?? [])
    .filter(v => !direct.has(v.departmentId) && deptNames.has(v.departmentId))
    .map(v => `${deptNames.get(v.departmentId)} (${roleNames.get(v.roleId) ?? 'role'})`)
    .sort((a, b) => a.localeCompare(b));
}

/** Same set, any order → nothing to save. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every(x => s.has(x));
}
