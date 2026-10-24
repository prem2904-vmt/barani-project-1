/**
 * Family SUB-CHOICES are this profile's own member tests (owner 2026-10-23,
 * revision 2: "the test needs to be selected first then only it can come in
 * family … once selected it represents as a family in the lab and test order").
 *
 * Root answers (Absent / Present) stay typed. Any node BELOW the root is a
 * test: `node.test` = the test's CatalogKey (the stable link — survives code
 * changes, overrides and the clone), `node.code` = its test code, `node.label`
 * = its name (the server re-stamps the current name on save and on read), and
 * the amount is prefilled from the test's own answer choices + unit (still
 * editable). Older typed sub-choices keep working and can be linked later.
 *
 * Pure helpers — the editor and the profile host share them; the specs pin
 * the filtering / ordering / prefill rules.
 */
import type { PfSelectOption } from '../../../../shared/primitives/select.component';
import type { Test } from '../../../../shared/models/test.model';
import type { FamilyNode, FamilyQty } from '../../../../shared/utils/option-family';
import { codeFromLabel } from '../../../../shared/utils/option-family';
import { parseParametersBlob, readParameters } from '../../../../shared/utils/test-parameters';
import { choiceOptionsFor, compactType, resolveParamEntryKind } from '../../../../shared/utils/param-entry-kind';

/** One test the sub-choice picker offers — always a member of this profile. */
export interface SubtestChoice {
  /** The link: the test's CatalogKey. */
  key: string;
  id: string;
  code: string;
  name: string;
  /** The amount a pick starts with (the test's own answers + unit). */
  qty: FamilyQty | null;
}

export interface SubtestContext {
  /** Member test ids of the profile being edited, in its lab entry order. */
  memberIds: readonly string[];
  /** The profile's own family lines (never a sub-choice). */
  excludeIds?: readonly string[];
  /** CatalogKeys already linked in ANOTHER family line of this profile (a
   *  member belongs to at most one family). */
  takenElsewhere?: ReadonlySet<string>;
}

const clean = (s: unknown) => String(s ?? '').trim();
const up = (s: unknown) => clean(s).toUpperCase();

function paramsOf(t: Pick<Test, 'parameters'>) {
  const raw = t.parameters as unknown;
  const blob = typeof raw === 'string' ? parseParametersBlob(raw)
    : raw && typeof raw === 'object' ? (Array.isArray(raw) ? { parameters: raw } : raw) : null;
  return readParameters(blob as Parameters<typeof readParameters>[0]);
}

/** A profile's hidden family line (one `family` value) — never a sub-choice. */
export function isFamilyLineTest(t: Pick<Test, 'parameters'>): boolean {
  return paramsOf(t).some(p => compactType(p.type) === 'family');
}

/** The amount a picked test starts with: its answer list (option table /
 *  options) + unit, a number with its unit, or free text. Null = none. */
export function subtestQty(t: Pick<Test, 'parameters' | 'unit'>): FamilyQty | null {
  const p = paramsOf(t)[0];
  if (!p) return null;
  const unit = clean(p.unit) || clean(t.unit) || null;
  const withUnit = (q: FamilyQty): FamilyQty => (unit ? { ...q, unit } : q);
  switch (resolveParamEntryKind(p)) {
    case 'select': {
      const options = choiceOptionsFor(p).map(clean).filter(Boolean);
      return options.length ? withUnit({ kind: 'choice', options }) : null;
    }
    case 'number': return withUnit({ kind: 'number' });
    case 'text':
    case 'textarea': return withUnit({ kind: 'text' });
    default: return null;
  }
}

/** The tests a sub-choice may be (owner 2026-10-23, revision 2: "the test
 *  needs to be selected first"): ONLY this profile's own members — individual,
 *  linkable (a CatalogKey), not a family line, not already in another family
 *  of this profile — in the profile's lab entry order. No catalogue search. */
export function subtestChoices(tests: readonly Test[], ctx: SubtestContext): SubtestChoice[] {
  const byId = new Map(tests.map(t => [t.id, t] as const));
  const excluded = new Set(ctx.excludeIds ?? []);
  const taken = new Set([...(ctx.takenElsewhere ?? [])].map(up));
  const out: SubtestChoice[] = [];
  for (const id of new Set(ctx.memberIds)) {
    const t = byId.get(id);
    const key = clean(t?.catalogKey);
    if (!t || !key || excluded.has(id) || taken.has(up(key))) continue;
    if ((t.type ?? 'individual') !== 'individual' || isFamilyLineTest(t)) continue;
    out.push({ key, id: t.id, code: clean(t.testCode) || key, name: clean(t.name) || key, qty: subtestQty(t) });
  }
  return out;
}

/** The picker's rows (name + code). Tests already picked beside this one
 *  (`taken`) are shown but can't be picked twice. */
export function subtestOptions(choices: readonly SubtestChoice[], taken: ReadonlySet<string> = new Set(), current?: string | null): PfSelectOption<string>[] {
  return choices.map(c => {
    const off = taken.has(c.key) && c.key !== current;
    return { value: c.key, label: c.name, hint: off ? `${c.code} · Already picked here` : c.code, disabled: off };
  });
}

// ── Absorbed members (revision 2): a member linked into a family line is
// entered only through that family — it leaves the order lists as a row of
// its own and shows nested under its family line; it STAYS in items[] so
// un-linking puts it back where it was. The live family-line trees decide
// (the server's `inFamily` marker is stamped from the same trees).

/** Every CatalogKey a family tree links (any depth), in tree order. */
export function linkedKeys(nodes: readonly FamilyNode[] | null | undefined): string[] {
  const out: string[] = [];
  const walk = (ns: readonly FamilyNode[]) => ns.forEach(n => {
    if (clean(n.test)) out.push(clean(n.test));
    if (n.children?.nodes) walk(n.children.nodes);
  });
  walk(nodes ?? []);
  return out;
}

/** member test id → the family line (test id) that absorbs it. */
export function absorbedMembers(
  lines: readonly { testId: string; family: { nodes: readonly FamilyNode[] } }[],
  members: readonly { id: string; catalogKey?: string | null }[],
): Map<string, string> {
  const byKey = new Map<string, string>();
  for (const m of members) if (clean(m.catalogKey)) byKey.set(up(m.catalogKey), m.id);
  const out = new Map<string, string>();
  for (const l of lines) for (const k of linkedKeys(l.family.nodes)) {
    const id = byKey.get(up(k));
    if (id && id !== l.testId && !out.has(id)) out.set(id, l.testId);
  }
  return out;
}

/** The ids an order list shows as rows: absorbed members are left out. */
export function visibleOrder(ids: readonly string[], absorbed: ReadonlyMap<string, string>): string[] {
  return ids.filter(id => !absorbed.has(id));
}

/** Move a VISIBLE row (`from` → `to`, visible indexes); absorbed members keep
 *  their own slots in the full list, so un-linking restores their place. */
export function moveVisible(ids: readonly string[], absorbed: ReadonlyMap<string, string>, from: number, to: number): string[] {
  const vis = visibleOrder(ids, absorbed);
  if (from === to || from < 0 || to < 0 || from >= vis.length || to >= vis.length) return [...ids];
  const [moved] = vis.splice(from, 1);
  vis.splice(to, 0, moved);
  let k = 0;
  return ids.map(id => (absorbed.has(id) ? id : vis[k++]));
}

/** The members nested under a family line row, in the family's own order. */
export function nestedMembers(lineId: string, ids: readonly string[], absorbed: ReadonlyMap<string, string>): string[] {
  return ids.filter(id => absorbed.get(id) === lineId);
}

/** A node's code from a test code: the stable-key alphabet, unique among its
 *  siblings ("CLP030", then "CLP030-2"…). */
export function codeForTest(testCode: string, label: string, siblingCodes: readonly string[]): string {
  const used = new Set(siblingCodes.map(c => clean(c).toUpperCase()));
  const base = clean(testCode).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[-_]+|-+$/g, '').slice(0, 36);
  if (!base) return codeFromLabel(label, siblingCodes);
  if (!used.has(base.toUpperCase())) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`.toUpperCase())) return `${base}-${i}`;
}

/** Link a node to a test: code / label / link from the test, the amount
 *  prefilled from it (a test without answers keeps the node's own amount).
 *  Sub-choices under the node are kept. */
export function linkNodeToTest(node: FamilyNode, choice: SubtestChoice, siblingCodes: readonly string[]): FamilyNode {
  const { testMissing: _m, ...rest } = node;
  void _m;
  const others = siblingCodes.filter(c => clean(c) && clean(c).toUpperCase() !== clean(node.code).toUpperCase());
  const qty = choice.qty ? structuredClone(choice.qty) : node.qty ?? null;
  const out: FamilyNode = { ...rest, code: codeForTest(choice.code, choice.name, others), label: choice.name, test: choice.key };
  if (qty) out.qty = qty; else delete out.qty;
  return out;
}

/** A sub-choice still waiting for its test (new, nothing typed or picked). */
export function isPendingSubchoice(n: FamilyNode, depth: number): boolean {
  return depth > 1 && !clean(n.test) && !clean(n.label);
}

/** A sub-choice typed by hand before tests could be picked. */
export function isTypedSubchoice(n: FamilyNode, depth: number): boolean {
  return depth > 1 && !clean(n.test) && !!clean(n.label);
}

/** Problem text when a sub-choice is still waiting for its test. */
export function pendingSubchoiceIssue(nodes: readonly FamilyNode[], depth = 1): string | null {
  for (const n of nodes) {
    if (isPendingSubchoice(n, depth)) return 'Pick a test for every sub-choice — or remove the empty one.';
    const deeper = n.children ? pendingSubchoiceIssue(n.children.nodes, depth + 1) : null;
    if (deeper) return deeper;
  }
  return null;
}
