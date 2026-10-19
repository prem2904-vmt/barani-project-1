import { Branch } from '../../../shared/models/tenant.model';
import { PfSelectOption } from '../../../shared/primitives/select.component';

/**
 * Multi-branch user scope (owner, 2026-09-27): a user can belong to one, two
 * or three branches — or to every branch. Shared by Create user, Edit user
 * and the Users list.
 *
 * Select values:
 *   'all'      — All branches (tenant-wide);
 *   'b:<id>'   — one branch.
 *
 * Rules (mirrors the server's UserBranchScope):
 *   - All branches is exclusive: picking it clears the rest, picking a branch
 *     clears it;
 *   - order on save = the list's order, so the FIRST one is the default
 *     branch the user signs in to.
 */
export const ALL_BRANCHES = 'all';

export interface ScopeRoleRow { branchId?: string | null }
export interface ScopePayload {
  allBranches?: boolean;
  branches?: { branchId: string }[];
}

export function scopeOptions(branches: Branch[]): PfSelectOption<string>[] {
  const out: PfSelectOption<string>[] = [{ value: ALL_BRANCHES, label: 'All branches (tenant-wide)' }];
  for (const b of branches) out.push({ value: `b:${b.id}`, label: b.name });
  return out;
}

/** Apply the exclusivity rule to a multi-select change (prev → next). */
export function applyScopePick(prev: string[], next: string[], _branches?: Branch[]): string[] {
  const added = next.filter(v => !prev.includes(v));
  if (added.includes(ALL_BRANCHES)) return [ALL_BRANCHES];
  return next.filter(v => v !== ALL_BRANCHES);
}

/** A user's role rows → select values (any branch-less row = All branches). */
export function scopeValuesFromRoles(rows: ScopeRoleRow[]): string[] {
  if (!rows.length) return [];
  if (rows.some(r => !r.branchId)) return [ALL_BRANCHES];
  const out: string[] = [];
  for (const r of rows) {
    const v = `b:${r.branchId}`;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Select values → the API payload, in the branch list's order. */
export function scopePayload(values: string[], branches: Branch[]): ScopePayload {
  if (values.includes(ALL_BRANCHES)) return { allBranches: true };
  const order = scopeOptions(branches).map(o => o.value);
  const sorted = [...values].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { branches: sorted.map(v => ({ branchId: v.slice(2) })) };
}

/** Tenant with exactly one branch → that branch is the only choice. */
export function soleScope(branches: Branch[]): string | null {
  return branches.length === 1 ? `b:${branches[0].id}` : null;
}

/** GET /api/users/branch-scopes row. */
export interface UserBranchScope {
  userId: string;
  allBranches: boolean;
  branches: { branchId: string; branchName: string }[];
}

/** Chip labels for the Users list: "All branches", or each branch. */
export function branchScopeChips(s: UserBranchScope | undefined | null): string[] {
  if (!s) return [];
  if (s.allBranches) return ['All branches'];
  return s.branches.map(b => b.branchName);
}

export const SCOPE_HINT = 'Pick one or more branches, or All branches. The first one listed is where they sign in.';
