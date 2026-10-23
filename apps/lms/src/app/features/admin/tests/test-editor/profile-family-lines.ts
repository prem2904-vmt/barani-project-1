/**
 * Pure rules for a profile's FAMILY LINES (owner 2026-10-23: a family lives
 * inside a profile — "+ Add family" in the profile members card). The line
 * is a hidden profile-only test the server creates/updates/deletes; these
 * helpers keep the editor's member list in step with what the server did.
 */
import { codeFromLabel, validateFamily, type FamilyNode, type OptionFamily } from '../../../../shared/utils/option-family';
import { fillCodes } from './family-tree';
import { pendingSubchoiceIssue } from './family-subtest';

/** The starting tree of a new line: Absent (normal) / Present. */
export function newLineDraft(name = ''): OptionFamily {
  return { code: 'NEW', name, active: true, nodes: [
    { code: 'ABS', label: 'Absent', normal: true },
    { code: 'PRS', label: 'Present', normal: false },
  ] };
}

/** The tree as it is SENT: every labelled node coded, no empty leftovers. */
export function lineNodes(draft: OptionFamily): FamilyNode[] {
  // `testMissing` is read-only (GET) — never sent back.
  const strip = (nodes: FamilyNode[]): FamilyNode[] => nodes.map(n => {
    const { testMissing: _m, ...rest } = n;
    void _m;
    return rest.children ? { ...rest, children: { ...rest.children, nodes: strip(rest.children.nodes) } } : rest;
  });
  return strip(fillCodes(draft, codeFromLabel).nodes);
}

/** Problems that block saving a line (the server re-validates). */
export function lineIssues(draft: OptionFamily | null | undefined): string[] {
  if (!draft) return [];
  const pending = pendingSubchoiceIssue(draft.nodes);
  const out = validateFamily({ ...fillCodes(draft, codeFromLabel), code: draft.code || 'NEW' })
    .map(i => i.path === 'name' ? 'Give the family line a name.' : i.message);
  return [...new Set(pending ? [pending, ...out] : out)];
}

/** The member list after the server ADDED a line (at `position`, else last). */
export function withLineMember(items: readonly string[], testId: string, position?: number | null): string[] {
  if (items.includes(testId)) return [...items];
  const next = [...items];
  const at = position == null || position < 0 || position > next.length ? next.length : position;
  next.splice(at, 0, testId);
  return next;
}

/** The member list after the server REMOVED a line. */
export function withoutLineMember(items: readonly string[], testId: string): string[] {
  return items.filter(id => id !== testId);
}

/** After a save: the line's member id `was` becomes `now` (copy-on-write can
 *  re-key it) in place; a line not yet listed is added (at `position`). */
export function replaceLineMember(items: readonly string[], was: string, now: string, position?: number | null): string[] {
  const i = items.indexOf(was);
  if (i < 0) return withLineMember(items, now, position);
  const next = items.filter((id, k) => k === i || id !== now);
  next[next.indexOf(was)] = now;
  return next;
}
