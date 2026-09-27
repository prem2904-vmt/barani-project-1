import type { Role } from '../../../shared/models/user.model';

/**
 * Which roles a user picker may offer. The rule is the SERVER's
 * (RoleAssignmentRule.cs): GET /api/roles flags each role `assignable` (to
 * another user) and `assignableToSelf` for the caller — a role is assignable
 * when its permissions are a subset of the caller's, or the caller holds
 * manage_tenant; assigning to yourself is held to the subset rule even with
 * manage_tenant. This file never re-derives that rule, it only reads the flags.
 *
 * Roles the edited user ALREADY holds that the caller can't assign are shown
 * ON and read-only (locked) — never silently dropped, because the save is a
 * full replace and would strip them. The server keeps them as long as their
 * branch scope doesn't widen.
 */
export interface RolePickerRow {
  value: string;
  label: string;
  /** Held by the user but not assignable by this caller: shown ON, can't be toggled. */
  locked: boolean;
}

/** Server flag for this caller; a response without flags (older server) keeps
 *  the previous behaviour (everything offered) — the server still enforces. */
export function canAssignRole(r: Pick<Role, 'assignable' | 'assignableToSelf'>, toSelf: boolean): boolean {
  const flag = toSelf ? r.assignableToSelf : r.assignable;
  return flag !== false;
}

/** Picker rows: every assignable role + the held roles the caller can't assign
 *  (locked). Unassignable roles the user doesn't hold are hidden. List order kept. */
export function rolePickerRows(roles: readonly Role[], heldIds: readonly string[], toSelf: boolean): RolePickerRow[] {
  const held = new Set(heldIds);
  const rows: RolePickerRow[] = [];
  for (const r of roles) {
    const ok = canAssignRole(r, toSelf);
    if (ok || held.has(r.id)) rows.push({ value: r.id, label: r.name, locked: !ok });
  }
  return rows;
}
