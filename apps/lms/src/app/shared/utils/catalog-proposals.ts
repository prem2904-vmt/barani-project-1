/**
 * Test Master proposals (copy-on-write, phase 5) — pure helpers.
 *
 * When the Admin Test Master changes a test that a lab (or one of its
 * branches) has its own copy of, the change is offered as a proposal — one per
 * copy: `targetTestId` = the copy, `branchId` = the branch that owns it (null
 * = the lab-wide copy). Tests the lab never changed need no proposal: they
 * read the master live.
 *
 * Pure, no Angular: the admin console keeps a byte-identical copy.
 */

export interface ProposalLike {
  id: string;
  catalogKey?: string | null;
  kind?: string | null;
  targetTestId?: string | null;
  branchId?: string | null;
}

export interface ProposalTestLike {
  id: string;
  catalogKey?: string | null;
  branchId?: string | null;
  pendingProposal?: { id: string } | null;
}

/** Tenant endpoints. `id` null → the bulk actions (accept-all / dismiss-all). */
export function proposalPath(id: string | null, action: 'accept' | 'dismiss' | 'accept-all' | 'dismiss-all'): string {
  return id ? `/api/catalog-proposals/${id}/${action}` : `/api/catalog-proposals/${action}`;
}

/** The test a proposal is about: its target copy, else the (branch's) row
 *  with the same catalogue key. */
export function proposalTest<T extends ProposalTestLike>(p: ProposalLike, tests: readonly T[]): T | undefined {
  if (p.targetTestId) {
    const byId = tests.find(t => t.id === p.targetTestId);
    if (byId) return byId;
  }
  const key = (p.catalogKey ?? '').trim().toLowerCase();
  if (!key) return undefined;
  const sameKey = tests.filter(t => (t.catalogKey ?? '').trim().toLowerCase() === key);
  return sameKey.find(t => (t.branchId ?? null) === (p.branchId ?? null)) ?? sameKey[0];
}

/** "All branches" for the lab-wide copy, the branch's name otherwise. */
export function proposalBranchLabel(p: ProposalLike, branchNames: ReadonlyMap<string, string>): string {
  if (!p.branchId) return 'All branches';
  return branchNames.get(p.branchId) ?? 'One branch';
}

/** Short wording for the proposal kind. */
export function proposalKindLabel(p: ProposalLike): string {
  return p.kind === 'new' ? 'New master test' : 'Master changed';
}

/** Distinct pending proposals across the loaded list and the rows' own
 *  `pendingProposal` markers (either source may be the only one present). */
export function pendingProposalIds(proposals: readonly ProposalLike[], tests: readonly ProposalTestLike[]): Set<string> {
  const ids = new Set<string>();
  for (const p of proposals) if (p?.id) ids.add(p.id);
  for (const t of tests) if (t.pendingProposal?.id) ids.add(t.pendingProposal.id);
  return ids;
}
