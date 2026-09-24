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
 * Code shapes (owner rule 5): `^[A-Z]{3}[0-9]+$` (BIO019, HEM012) is RESERVED
 * for the Admin Test Master. A lab's own tests always carry a hyphen — typed,
 * or the server's automatic `<SHORT>-0001` when the code is left blank.
 *
 * Pure helpers, no Angular: the admin console keeps a byte-identical copy.
 */

export type TestOrigin = 'master' | 'customised' | 'branch' | 'local';

/** Loose on purpose: callers pass full `Test` rows, grid rows, API rows. */
export interface OriginLike {
  origin?: string | null;
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

/** "Master" | "Customised" | "Branch" | "Own test" | '' (no origin). */
export function originLabel(t: OriginLike | null | undefined): string {
  const o = originOf(t);
  return o ? LABELS[o] : '';
}

/** One-line explanation for the badge tooltip. */
export function originHint(t: OriginLike | null | undefined): string {
  const o = originOf(t);
  return o ? HINTS[o] : '';
}

/** Only a lab's copy of a master test can go back to the master. */
export function canRevertToMaster(t: OriginLike | null | undefined): boolean {
  const o = originOf(t);
  return o === 'customised' || o === 'branch';
}

/** `POST` target that drops the lab's (or branch's) copy. */
export function revertToMasterPath(testId: string): string {
  return `/api/tests/${testId}/revert-to-master`;
}

/** The Admin Test Master's code shape: 3 letters + digits, no separator. */
export const MASTER_CODE_RE = /^[A-Z]{3}[0-9]+$/;

/** True when `code` has the master shape (case-insensitive, trimmed). */
export function isMasterCodeShape(code: string | null | undefined): boolean {
  return MASTER_CODE_RE.test((code ?? '').trim().toUpperCase());
}

/** Friendly wording for a lab typing a master-shaped code. */
export const RESERVED_CODE_MESSAGE =
  'Codes like BIO019 (3 letters + digits) are reserved for the Admin Test Master. '
  + 'Use a code with a hyphen (e.g. MW-0001), or leave it blank and one is assigned for you.';

/** The server's error code for a master-shaped code on a lab test. */
export const RESERVED_CODE_ERROR = 'reserved_code';

/**
 * A lab may keep a master test's OWN code on its copy (editing HEM012 keeps
 * HEM012) but may never type a NEW master-shaped code. `original` = the code
 * the row carried when loaded.
 */
export function isReservedForTenant(code: string | null | undefined, original?: string | null): boolean {
  const c = (code ?? '').trim();
  if (!c || !isMasterCodeShape(c)) return false;
  return c.toUpperCase() !== (original ?? '').trim().toUpperCase();
}

/** Departments are master-provided (owner rule 4): labs place, enable or
 *  disable them, never create one (server: 403 `departments_master_only`). */
export const DEPARTMENTS_FROM_MASTER =
  'Departments come from the Admin Test Master. Place them in spaces and turn them on or off here; new ones are added there.';

/** The server's refusal when a lab tries to create a department. */
export const DEPARTMENTS_MASTER_ONLY_ERROR = 'departments_master_only';
