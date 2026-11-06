/**
 * Profile member names in the test editor (owner 2026-10-25: "(unknown
 * test)" inside profiles). A profile stores its members as test ids, but the
 * server resolves them by CATALOG KEY (`Resolver.ResolveMembersAsync`), so a
 * member stored as the master's id still orders fine in reference mode while
 * the tenant's list holds an override row with a different id. Inactive
 * members and hidden family lines aren't in the editor's lists either.
 *
 *   GET /api/tests/{profileId}/members →
 *     [{ testId, catalogKey, name, code, status: active|inactive|family_line|missing, type }]
 *
 * Resolve by catalog key first, then by id; whatever is still unresolved
 * says WHY in plain words — never "(unknown test)".
 */

export type MemberStatus = 'active' | 'inactive' | 'family_line' | 'missing';

export interface ProfileMemberInfo {
  /** The RESOLVED row's id (the tenant's override row in reference mode). */
  testId: string;
  /** The id AS AUTHORED in the profile's items[] — what the editor holds. Absent on an older server. */
  memberId?: string | null;
  catalogKey?: string | null;
  name?: string | null;
  code?: string | null;
  status?: MemberStatus | string | null;
  type?: string | null;
}

export type MembersState = 'loading' | 'loaded' | 'none';

export interface MemberListRow {
  id: string;
  name: string;
  catalogKey?: string | null;
  testCode?: string | null;
}

/**
 * stored member id → the server's row for it. The server answers in authored
 * order with BOTH ids: `memberId` (as stored in the profile) and `testId`
 * (the resolved row — a different id whenever the lab customised the member).
 * Indexing by `testId` alone left every customised member unmatched, so the
 * editor called it unknown. Keyed by the authored id first; the resolved id
 * stays as a second key (an id the picker handed out from the lists). An older
 * server without `memberId`: pair by position with the ids the profile was
 * loaded with (same order, same length) when `authoredIds` is given.
 */
export function memberInfoIndex(
  infos: readonly ProfileMemberInfo[] | null | undefined,
  authoredIds?: readonly string[],
): Map<string, ProfileMemberInfo> {
  const m = new Map<string, ProfileMemberInfo>();
  const rows = (infos ?? []).filter(Boolean);
  const hasAuthored = rows.some(i => !!i.memberId);
  if (!hasAuthored && authoredIds && authoredIds.length === rows.length)
    rows.forEach((i, ix) => { if (authoredIds[ix]) m.set(authoredIds[ix], i); });
  for (const i of rows) if (i.memberId) m.set(i.memberId, i);
  for (const i of rows) if (i.testId && !m.has(i.testId)) m.set(i.testId, i);
  return m;
}

/**
 * The id → row map the editor reads, with every STORED member id that isn't
 * in the lists aliased to the list row sharing its catalog key (reference
 * mode: the profile holds the master id, the list the tenant's override).
 */
export function aliasByCatalogKey<T extends MemberListRow>(
  byId: ReadonlyMap<string, T>,
  memberIds: readonly string[],
  infos: ReadonlyMap<string, ProfileMemberInfo>,
): Map<string, T> {
  const out = new Map(byId);
  let byKey: Map<string, T> | null = null;
  for (const id of memberIds) {
    if (out.has(id)) continue;
    const key = (infos.get(id)?.catalogKey ?? '').trim();
    if (!key) continue;
    if (!byKey) {
      byKey = new Map();
      for (const t of byId.values()) {
        const k = (t.catalogKey ?? '').trim();
        if (k && !byKey.has(k)) byKey.set(k, t);
      }
    }
    const hit = byKey.get(key);
    if (hit) out.set(id, hit);
  }
  return out;
}

/**
 * The member's label. `local` = the row the editor's lists resolved (by id,
 * or aliased by catalog key); `familyName` = a family line of this profile;
 * `info` = the server's row; `state` = the members call: 'loading',
 * 'loaded', or 'none' (failed / an older server / an unsaved bundle).
 */
export function memberDisplayName(opts: {
  local?: { name?: string | null } | null;
  familyName?: string | null;
  info?: ProfileMemberInfo | null;
  state: MembersState;
}): string {
  const { local, familyName, info } = opts;
  const status = (info?.status ?? '').toLowerCase();
  const infoName = (info?.name ?? '').trim() || (info?.code ?? '').trim();
  if (status === 'inactive') return `Inactive: ${infoName || (local?.name ?? '').trim() || 'test'}`;
  if (local?.name) return local.name;
  if (familyName) return familyName;
  if (info) {
    if (status === 'family_line') return infoName || 'Family line';
    if (status === 'missing') return 'Removed from Test Master';
    if (infoName) return infoName;
  }
  if (opts.state === 'loaded') return 'Removed from Test Master';
  return opts.state === 'loading' ? 'Loading…' : 'Not in the test list';
}
