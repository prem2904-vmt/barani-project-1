/**
 * Pure rules for a profile's FAMILY LINES (owner 2026-10-23: a family lives
 * inside a profile — "+ Add family" in the profile members card). The line
 * is a hidden profile-only test the server creates/updates/deletes; these
 * helpers keep the editor's member list in step with what the server did.
 */
import { codeFromLabel, validateFamily, type FamilyNode, type OptionFamily } from '../../../../shared/utils/option-family';
import { fillCodes } from './family-tree';

/** The starting tree of a new line: Absent (normal) / Present. */
export function newLineDraft(name = ''): OptionFamily {
  return { code: 'NEW', name, active: true, nodes: [
    { code: 'ABS', label: 'Absent', normal: true },
    { code: 'PRS', label: 'Present', normal: false },
  ] };
}

/** The tree as it is SENT: every labelled node coded, no empty leftovers. */
export function lineNodes(draft: OptionFamily): FamilyNode[] {
  return fillCodes(draft, codeFromLabel).nodes;
}

/** Problems that block saving a line (the server re-validates). */
export function lineIssues(draft: OptionFamily | null | undefined): string[] {
  if (!draft) return [];
  const out = validateFamily({ ...fillCodes(draft, codeFromLabel), code: draft.code || 'NEW' })
    .map(i => i.path === 'name' ? 'Give the family line a name.' : i.message);
  return [...new Set(out)];
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
