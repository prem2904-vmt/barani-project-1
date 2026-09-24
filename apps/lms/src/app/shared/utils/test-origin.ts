/**
 * Where a Test Master row comes from (Test Master single source, phases 3 + 5).
 *
 * The Admin Test Master is THE source; a tenant stores nothing for tests it
 * hasn't changed (copy-on-write). Every test DTO carries `origin`:
 *   - `master`     — read straight from the Admin Test Master (unchanged here);
 *   - `customised` — this lab's own copy of a master test (tenant-wide);
 *   - `branch`     — a branch's own copy (branch isolation ON);
 *   - `local`      — a test this lab created itself ("Own test").
 *
 * Every row also carries `catalogMode` — `clone` (the lab still holds its own
 * copy of the whole catalogue: a `master` origin then means "your copy, still
 * the same as the master", and nothing can be reverted) or `reference`.
 *
 * Test codes are server-assigned and read-only: see `test-code.ts`.
 *
 * Pure helpers, no Angular: the admin console keeps a byte-identical copy.
 */

export type TestOrigin = 'master' | 'customised' | 'branch' | 'local';

/** Loose on purpose: callers pass full `Test` rows, grid rows, API rows. */
export interface OriginLike {
  origin?: string | null;
  /** 'clone' | 'reference' (absent on older payloads = reference wording). */
  catalogMode?: string | null;
}

/** True when the row belongs to a lab still on its own full catalogue copy. */
export function isCloneMode(t: OriginLike | null | undefined): boolean {
  return (t?.catalogMode ?? '').toString().trim().toLowerCase() === 'clone';
}

const LABELS: Record<TestOrigin, string> = {
  master: 'Master',
  customised: 'Customised',
  branch: 'Branch',
  local: 'Own test',
};

const HINTS: Record<TestOrigin, string> = {
  master: 'Read from the Admin Test Master. Editing it saves your lab\'s own copy.',
  customised: 'Your lab\'s own copy of a Test Master test. Revert to go back to the master.',
  branch: 'This branch\'s own copy of a Test Master test. Revert to go back to the master.',
  local: 'A test your lab created. It is not part of the Admin Test Master.',
};

/** Clone mode: the lab holds a copy of every test — nothing is "read from"
 *  the master, and there is no revert. */
const CLONE_LABELS: Record<TestOrigin, string> = { ...LABELS, master: 'Master copy' };
const CLONE_HINTS: Record<TestOrigin, string> = {
  master: 'Your lab\'s copy of this Admin Test Master test. It still matches the master.',
  customised: 'Your lab\'s copy of a Test Master test, changed here.',
  branch: 'This branch\'s copy of a Test Master test, changed here.',
  local: HINTS.local,
};

/** Stroked 24×24 SVG path per origin (never emoji). */
export const ORIGIN_ICON_PATHS: Record<TestOrigin, string> = {
  // layers: the shared master catalogue
  master: 'M12 2 2 7l10 5 10-5-10-5Z M2 17l10 5 10-5 M2 12l10 5 10-5',
  // pencil: edited here
  customised: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  // map pin: one branch only
  branch: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  // flask: the lab's own test
  local: 'M9 3h6 M10 3v6l-5.4 9.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9V3',
};

/** Normalised origin, or null when the row carries none (older payloads). */
export function originOf(t: OriginLike | null | undefined): TestOrigin | null {
  const o = (t?.origin ?? '').toString().trim().toLowerCase();
  return o === 'master' || o === 'customised' || o === 'branch' || o === 'local' ? o : null;
}

/** "Master" | "Customised" | "Branch" | "Own test" | '' (no origin);
 *  "Master copy" for an unchanged row of a clone-mode lab. */
export function originLabel(t: OriginLike | null | undefined): string {
  const o = originOf(t);
  if (!o) return '';
  return (isCloneMode(t) ? CLONE_LABELS : LABELS)[o];
}

/** One-line explanation for the badge tooltip (clone-mode wording when the
 *  lab still holds its own copy of the catalogue). */
export function originHint(t: OriginLike | null | undefined): string {
  const o = originOf(t);
  if (!o) return '';
  return (isCloneMode(t) ? CLONE_HINTS : HINTS)[o];
}

/** Only a lab's copy of a master test can go back to the master — and only
 *  once the lab reads the Admin Test Master (not in clone mode). */
export function canRevertToMaster(t: OriginLike | null | undefined): boolean {
  const o = originOf(t);
  return (o === 'customised' || o === 'branch') && !isCloneMode(t);
}

/** `POST` target that drops the lab's (or branch's) copy. */
export function revertToMasterPath(testId: string): string {
  return `/api/tests/${testId}/revert-to-master`;
}

/** "Restore to default" confirmation. Prices are KEPT (they live in the
 *  pricing table); what goes is the lab's own copies of Test Master tests. */
export function restoreDefaultsMessage(who: 'lab' | 'tenant'): string {
  const whose = who === 'lab' ? 'Your lab\'s' : 'This tenant\'s';
  return `${whose} own copies of Test Master tests are removed, so every test follows the Admin Test Master default again. `
    + 'Prices and "not offered" settings are kept. Copies already used by orders or bills are kept for history, '
    + 'deactivated. This cannot be undone.';
}

/** Toast after a restore: reference-mode labs drop copies, clone-mode labs reload the default. */
export function restoreDefaultsSummary(r: { deleted?: number; parked?: number; cloned?: number; mode?: string } | null | undefined): string {
  const removed = (r?.deleted ?? 0) + (r?.parked ?? 0);
  if (r?.mode === 'reference' || !r?.cloned) {
    return removed === 0 ? 'Nothing to restore — every test already follows the Admin Test Master.'
      : `Restored — ${removed} lab ${removed === 1 ? 'copy' : 'copies'} removed; prices kept.`;
  }
  return `Catalogue restored — ${r.cloned} default tests loaded (${r.deleted ?? 0} removed, ${r.parked ?? 0} archived); prices kept.`;
}

/** Departments are master-provided (owner rule 4): labs place, enable or
 *  disable them, never create one (server: 403 `departments_master_only`). */
export const DEPARTMENTS_FROM_MASTER =
  'Departments come from the Admin Test Master. Place them in spaces and turn them on or off here; new ones are added there.';

/** The server's refusal when a lab tries to create a department. */
export const DEPARTMENTS_MASTER_ONLY_ERROR = 'departments_master_only';
