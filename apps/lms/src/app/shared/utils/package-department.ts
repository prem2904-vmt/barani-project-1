/**
 * Owner 2026-09-27: "we don't need a department mentioned for a package".
 *
 * A PACKAGE bundles tests and profiles from several departments, so it carries
 * no department of its own — its members print, route and bill under THEIR
 * departments. Single tests and profiles are unchanged.
 *
 * A legacy package row may still hold a `department` on the wire (nothing
 * clears stored data); every screen reads a row's department through these
 * helpers, which ignore it for a package.
 *
 * Department FILTERS: a package is listed under every department its members
 * (recursively, through profiles / nested packages) belong to, so picking a
 * department never makes a package vanish when it has tests there; "All" and
 * the type segment ("Packages") always list every package.
 */

/** The fields these helpers read (a Test, a TestRow, a picker row …). */
export interface DeptRow {
  id?: string;
  type?: string | null;
  parameters?: string | null;
  department?: { name?: string | null } | null;
}

export function isPackage(t: DeptRow | null | undefined): boolean {
  return (t?.type ?? '') === 'package';
}

/** The row's own department name as SHOWN — always '' for a package. */
export function shownDepartmentName(t: DeptRow | null | undefined): string {
  if (!t || isPackage(t)) return '';
  return (t.department?.name ?? '').trim();
}

/** Member ids of a bundle (`parameters` = `{ items: [{ testId }] }`). */
export function bundleMemberIds(t: DeptRow | null | undefined): string[] {
  if (!t?.parameters) return [];
  try {
    const parsed = JSON.parse(t.parameters) as { items?: Array<{ testId?: string }> };
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.map(it => (it?.testId ?? '').trim()).filter(id => id.length > 0);
  } catch {
    return [];
  }
}

/** Distinct department names a package's members span, walking nested
 *  profiles / packages (cycle-safe). Members not in `byId` are skipped. */
export function memberDepartmentNames(pkg: DeptRow, byId: ReadonlyMap<string, DeptRow>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>(pkg.id ? [pkg.id] : []);
  const walk = (row: DeptRow) => {
    for (const id of bundleMemberIds(row)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const m = byId.get(id);
      if (!m) continue;
      if (isPackage(m)) { walk(m); continue; }
      const name = shownDepartmentName(m);
      if (name) out.add(name);
      if (m.type === 'profile') walk(m);
    }
  };
  walk(pkg);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** The department keys a row counts under in a department filter: a test or
 *  profile → its own department (or `unassigned`); a package → its members'
 *  departments (none → no key: it is still listed under "All"). */
export function departmentKeys(
  t: DeptRow, byId: ReadonlyMap<string, DeptRow>, unassigned: string,
): string[] {
  if (isPackage(t)) return memberDepartmentNames(t, byId);
  return [shownDepartmentName(t) || unassigned];
}
