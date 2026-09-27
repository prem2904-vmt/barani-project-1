import { Branch } from '../../../shared/models/tenant.model';
import { PfSelectOption } from '../../../shared/primitives/select.component';

/**
 * Multi-branch user scope (owner, 2026-09-27): a user can belong to one, two
 * or three branches — or to every branch. Shared by Create user, Edit user
 * and the Users list.
 *
 * Select values:
 *   'all'      — All branches (tenant-wide);
 *   'b:<id>'   — the whole branch, every lab in it;
 *   'sb:<id>'  — one lab (sub-branch) of a branch only.
 *
 * Rules (mirrors the server's UserBranchScope):
 *   - All branches is exclusive: picking it clears the rest, picking a branch
 *     clears it;
 *   - picking a branch does NOT add its labs — the branch already covers
 *     them — and drops any lab of it already picked; picking a lab replaces
 *     its whole branch (narrowing) and any other lab of the same branch;
 *   - order on save = the list's order, so the FIRST one is the default
 *     branch the user signs in to.
 */
export const ALL_BRANCHES = 'all';

export interface ScopeRoleRow { branchId?: string | null; subBranchId?: string | null }
export interface ScopePayload {
  allBranches?: boolean;
  branches?: { branchId: string; subBranchId?: string }[];
}

export function scopeOptions(branches: Branch[]): PfSelectOption<string>[] {
  const out: PfSelectOption<string>[] = [{ value: ALL_BRANCHES, label: 'All branches (tenant-wide)' }];
  for (const b of branches) {
    out.push({ value: `b:${b.id}`, label: b.name });
    for (const sb of b.subBranches ?? []) out.push({ value: `sb:${sb.id}`, label: `  → ${sb.name}`, hint: b.name });
  }
  return out;
}

/** Parent branch id of every sub-branch. */
function parentOf(branches: Branch[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const b of branches) for (const sb of b.subBranches ?? []) m.set(sb.id, b.id);
  return m;
}

/** Apply the exclusivity rules to a multi-select change (prev → next). */
export function applyScopePick(prev: string[], next: string[], branches: Branch[]): string[] {
  const added = next.filter(v => !prev.includes(v));
  if (added.includes(ALL_BRANCHES)) return [ALL_BRANCHES];
  let out = next.filter(v => v !== ALL_BRANCHES);
  const parents = parentOf(branches);
  for (const v of added) {
    if (v.startsWith('b:')) {
      const bid = v.slice(2);
      out = out.filter(x => !(x.startsWith('sb:') && parents.get(x.slice(3)) === bid));
    } else if (v.startsWith('sb:')) {
      const bid = parents.get(v.slice(3));
      out = out.filter(x => x === v || !(x === `b:${bid}` || (x.startsWith('sb:') && parents.get(x.slice(3)) === bid)));
    }
  }
  return out;
}

/** A user's role rows → select values (any branch-less row = All branches). */
export function scopeValuesFromRoles(rows: ScopeRoleRow[]): string[] {
  if (!rows.length) return [];
  if (rows.some(r => !r.branchId && !r.subBranchId)) return [ALL_BRANCHES];
  const out: string[] = [];
  for (const r of rows) {
    const v = r.subBranchId ? `sb:${r.subBranchId}` : `b:${r.branchId}`;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** Select values → the API payload, in the branch list's order. */
export function scopePayload(values: string[], branches: Branch[]): ScopePayload {
  if (values.includes(ALL_BRANCHES)) return { allBranches: true };
  const order = scopeOptions(branches).map(o => o.value);
  const parents = parentOf(branches);
  const sorted = [...values].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return {
    branches: sorted.map(v => v.startsWith('sb:')
      ? { branchId: parents.get(v.slice(3)) ?? '', subBranchId: v.slice(3) }
      : { branchId: v.slice(2) }),
  };
}

/** Tenant with exactly one branch and no labs → that branch is the only choice. */
export function soleScope(branches: Branch[]): string | null {
  return branches.length === 1 && !(branches[0].subBranches?.length) ? `b:${branches[0].id}` : null;
}

/** GET /api/users/branch-scopes row. */
export interface UserBranchScope {
  userId: string;
  allBranches: boolean;
  branches: { branchId: string; branchName: string; subBranchId?: string | null; subBranchName?: string | null }[];
}

/** Chip labels for the Users list: "All branches", or each branch / lab. */
export function branchScopeChips(s: UserBranchScope | undefined | null): string[] {
  if (!s) return [];
  if (s.allBranches) return ['All branches'];
  return s.branches.map(b => b.subBranchName ? `${b.branchName} → ${b.subBranchName}` : b.branchName);
}

export const SCOPE_HINT = 'Pick one or more branches, or All branches. A branch covers all its labs; pick a lab (indented →) to limit the user to that lab. The first one listed is where they sign in.';
