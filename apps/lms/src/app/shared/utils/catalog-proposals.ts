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

/** One differing catalogue field of a request: the lab's value next to the
 *  Admin Test Master's current one (display text; null = not set). */
export interface ProposalField {
  field: string;
  label: string;
  yours?: string | null;
  master?: string | null;
}

export interface ProposalLike {
  id: string;
  catalogKey?: string | null;
  kind?: string | null;
  targetTestId?: string | null;
  branchId?: string | null;
  /** The test it is about (server-resolved; the grid row wins when loaded). */
  testName?: string | null;
  testCode?: string | null;
  /** When the master version on offer was made, and when the lab last
   *  changed its copy (ISO). */
  masterUpdatedAt?: string | null;
  yourChangedAt?: string | null;
  /** Every differing catalogue field (Field · Yours · Master). */
  fields?: readonly ProposalField[] | null;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Sep" (with the year when it is not `now`'s year); '' for a missing or
 *  unreadable date. Local calendar day. */
export function proposalDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const day = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? day : `${day} ${d.getFullYear()}`;
}

/** The request's one-line history: "Master updated 24 Sep, after your change on
 *  20 Sep" — or, when the lab edited its copy after the master moved, "Master
 *  updated 24 Sep · you changed your copy on 26 Sep". Missing dates drop out. */
export function proposalDatesLine(p: ProposalLike, now: Date = new Date()): string {
  const master = proposalDate(p.masterUpdatedAt, now);
  const yours = proposalDate(p.yourChangedAt, now);
  if (master && yours) {
    const after = new Date(p.masterUpdatedAt!).getTime() >= new Date(p.yourChangedAt!).getTime();
    return after
      ? `Master updated ${master}, after your change on ${yours}`
      : `Master updated ${master} \u00b7 you changed your copy on ${yours}`;
  }
  if (master) return `Master updated ${master}`;
  if (yours) return `You changed your copy on ${yours}`;
  return '';
}

/** The difference table rows, blanks shown as an em dash. */
export function proposalDiffRows(p: ProposalLike): { field: string; label: string; yours: string; master: string }[] {
  const dash = (v: string | null | undefined) => (v ?? '').trim() || '\u2014';
  return (p.fields ?? []).map(f => ({ field: f.field, label: f.label || f.field, yours: dash(f.yours), master: dash(f.master) }));
}
