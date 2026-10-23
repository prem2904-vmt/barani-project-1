/**
 * FAMILY (hierarchical) result options — the ONE home for the shapes and
 * pure rules every screen shares: the Test Master's Families editor, both
 * result-entry screens, the report and every view that prints a value.
 *
 * Contract (owner 2026-10-23, mirrored by mw `FamilyValue`):
 *  - A family is a reusable tenant vocabulary: the ROOT level is a single
 *    choice ("Absent" / "Present"); a chosen node may open a child list
 *    (`multi` = many picks), each pick with its own optional quantity
 *    (choice list / number / free text, optional unit); deeper levels up to
 *    FAMILY_MAX_DEPTH.
 *  - The stored result value is
 *      { family, v, label, items?: [{ v, label, qty?, unit?, items? }] }
 *    Codes are the stable keys; labels are stored too so a renamed / removed
 *    node never breaks an old result.
 *  - `familyValueText()` is the ONE single-line rendering
 *    ("Present — Hyaline 2–3 /LPF; Granular Few"); `familyReportLines()` is
 *    the report's one-line-per-item expansion (parent row, children indented).
 *  - The root node's `normal` flag drives the abnormal flag (normal=false →
 *    abnormal), the same rule mw applies.
 */

export type FamilyQtyKind = 'choice' | 'number' | 'text';

export interface FamilyQty {
  kind: FamilyQtyKind;
  /** `choice` only: the answers, in order. */
  options?: string[] | null;
  unit?: string | null;
}

export interface FamilyChildren {
  /** What the child list is called ("Cast type"). */
  label: string;
  /** true = many picks allowed (checkboxes); false = one pick. */
  multi: boolean;
  nodes: FamilyNode[];
}

export interface FamilyNode {
  code: string;
  label: string;
  /** Root level only: the expected (normal) answer. */
  normal?: boolean;
  qty?: FamilyQty | null;
  children?: FamilyChildren | null;
}

export interface OptionFamily {
  code: string;
  name: string;
  active: boolean;
  nodes: FamilyNode[];
  /** Read-only (GET): 'own' = this lab's row, 'master' = the template's. */
  source?: 'own' | 'master' | string | null;
  updatedAt?: string | null;
}

/** GET /api/option-families/{code}/usage — one row per test parameter. */
export interface FamilyUse { testId: string; testCode?: string | null; testName: string; paramName?: string | null }

/** One picked child (any depth below the root). */
export interface FamilyItem {
  v: string;
  label: string;
  qty?: string;
  unit?: string;
  items?: FamilyItem[];
}

/** The stored result value of a `family` parameter. */
export interface FamilyValue {
  family: string;
  v: string;
  label: string;
  items?: FamilyItem[];
  /** Server-stamped on save (= !root.normal). */
  abnormal?: boolean;
}

/** Root level = depth 1; a family may nest at most this deep. */
export const FAMILY_MAX_DEPTH = 4;

// ── Reading values ──────────────────────────────────────────────────────

/** True for a stored family value object. */
export function isFamilyValue(x: unknown): x is FamilyValue {
  return !!x && typeof x === 'object' && !Array.isArray(x)
    && typeof (x as FamilyValue).family === 'string'
    && 'v' in (x as object);
}

/** Any carrier of a family value → the value: the object itself, mw's
 *  enriched wrapper `{ value: <family>, flag, … }`, or either as JSON text
 *  (a resolved layout cell). Anything else → null. */
export function asFamilyValue(raw: unknown): FamilyValue | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s.startsWith('{') || !s.includes('"family"')) return null;
    try { return asFamilyValue(JSON.parse(s)); } catch { return null; }
  }
  if (isFamilyValue(raw)) return raw;
  if (typeof raw === 'object' && !Array.isArray(raw) && 'value' in (raw as object)) {
    const inner = (raw as { value: unknown }).value;
    return inner === raw ? null : asFamilyValue(inner);
  }
  return null;
}

/** A family value holding a real answer (a root pick). */
export function isFamilyFilled(v: unknown): boolean {
  const f = asFamilyValue(v);
  return !!f && String(f.v ?? '').trim() !== '';
}

const clean = (s: unknown) => String(s ?? '').trim();

/** "2–3 /LPF" — the quantity with its unit. */
export function itemQtyText(it: Pick<FamilyItem, 'qty' | 'unit'>): string {
  const q = clean(it.qty);
  if (!q) return '';
  const u = clean(it.unit);
  return u ? `${q} ${u}` : q;
}

function itemText(it: FamilyItem): string {
  const head = [clean(it.label), itemQtyText(it)].filter(Boolean).join(' ');
  const kids = (it.items ?? []).map(itemText).filter(Boolean);
  return kids.length ? `${head} (${kids.join('; ')})` : head;
}

/** THE single-line text of a family value:
 *  "Present — Hyaline 2–3 /LPF; Granular Few". Empty for a blank value. */
export function familyValueText(raw: unknown): string {
  const f = asFamilyValue(raw);
  if (!f || !clean(f.v)) return '';
  const root = clean(f.label) || clean(f.v);
  const items = (f.items ?? []).map(itemText).filter(Boolean);
  return items.length ? `${root} — ${items.join('; ')}` : root;
}

/** Any stored result value → display text. Plain strings / numbers pass
 *  through, a multi-pick joins with "; ", a family uses familyValueText —
 *  never "[object Object]". The one helper every value view should use. */
export function resultValueText(raw: unknown): string {
  if (raw == null) return '';
  if (Array.isArray(raw)) return raw.map(resultValueText).filter(s => s.trim() !== '').join('; ');
  if (typeof raw === 'object') {
    if (asFamilyValue(raw)) return familyValueText(raw);
    if ('value' in (raw as object)) return resultValueText((raw as { value: unknown }).value);
    return '';
  }
  return String(raw);
}

/** One printed report line of a family value. depth 0 = the parameter's own
 *  row (value = the root answer); depth ≥ 1 = a picked item, indented. */
export interface FamilyReportLine { depth: number; label: string; value: string }

/** The report's one-line-per-item expansion. Absent (no items) → one line. */
export function familyReportLines(raw: unknown): FamilyReportLine[] {
  const f = asFamilyValue(raw);
  if (!f || !clean(f.v)) return [];
  const out: FamilyReportLine[] = [{ depth: 0, label: '', value: clean(f.label) || clean(f.v) }];
  const walk = (items: FamilyItem[] | undefined, depth: number) => {
    for (const it of items ?? []) {
      out.push({ depth, label: clean(it.label) || clean(it.v), value: itemQtyText(it) });
      walk(it.items, depth + 1);
    }
  };
  walk(f.items, 1);
  return out;
}

// ── Definitions ─────────────────────────────────────────────────────────

/** The root node a value picked (null when unknown / removed). */
export function rootNodeOf(def: OptionFamily | null | undefined, v: FamilyValue | null | undefined): FamilyNode | null {
  if (!def || !v) return null;
  return def.nodes.find(n => n.code === v.v) ?? null;
}

/** Abnormal when the picked ROOT node is not marked normal (mw's rule).
 *  null = can't tell (no definition, no pick, or a removed node). */
export function familyIsAbnormal(def: OptionFamily | null | undefined, raw: unknown): boolean | null {
  const v = asFamilyValue(raw);
  if (!v || !clean(v.v)) return null;
  const node = rootNodeOf(def, v);
  // No definition (or a removed node): the server's stamped verdict.
  if (!node) return typeof v.abnormal === 'boolean' ? v.abnormal : null;
  return node.normal !== true;
}

/** mw's coded family errors (400 / 409) in plain words. Unknown → null. */
export function familyErrorText(code: string | null | undefined): string | null {
  switch ((code ?? '').trim()) {
    case 'family_nodes_empty': return 'Add at least one answer (and at least one option under every sub-list).';
    case 'family_node_code_duplicate': return 'Two answers at the same level share a code — give each a different one.';
    case 'family_depth': return 'Too deep — a family can nest at most 4 levels.';
    case 'family_qty_kind': return 'An amount must be a list, a number or text.';
    case 'family_qty_options': return 'An amount "from a list" needs at least one choice.';
    case 'family_label_required': return 'Every answer needs a label.';
    case 'family_name_required': return 'Give the family a name.';
    case 'family_name_too_long': return 'The family name is too long.';
    case 'family_code_exists': return 'A family with this code already exists — choose another name or code.';
    case 'family_in_use': return 'This family is used by a test, so it can\u2019t be deleted.';
    case 'family_value_invalid': return 'That answer doesn\u2019t fit the family — pick it again from the list.';
    case 'family_unknown_code': return 'An answer picked here no longer exists in the family — pick it again.';
    case 'family_qty_invalid': return 'An amount isn\u2019t valid — use a number or a range like 2–3.';
    case 'family_unknown': return 'The option family linked to this test isn\u2019t set up in this lab — pick another family.';
    default: return null;
  }
}

/** The node at a code path ([root, child, grandchild…]); null if missing. */
export function nodeAtPath(def: OptionFamily | null | undefined, path: readonly string[]): FamilyNode | null {
  if (!def || !path.length) return null;
  let nodes: FamilyNode[] = def.nodes;
  let node: FamilyNode | null = null;
  for (const code of path) {
    node = nodes.find(n => n.code === code) ?? null;
    if (!node) return null;
    nodes = node.children?.nodes ?? [];
  }
  return node;
}

// ── Building values (entry) — pure, immutable updates ────────────────────

/** Pick (or clear, with '') the root answer. Re-picking the same root keeps
 *  the items; another root drops them (they belonged to the old answer). */
export function chooseRoot(def: OptionFamily, cur: FamilyValue | null | undefined, code: string): FamilyValue | null {
  if (!clean(code)) return null;
  const node = def.nodes.find(n => n.code === code);
  if (!node) return null;
  if (cur && cur.v === code && cur.family === def.code) return { ...cur, label: node.label };
  return { family: def.code, v: node.code, label: node.label };
}

/** The picked items under a path (path[0] = the root code). */
export function itemsAt(v: FamilyValue | null | undefined, path: readonly string[]): FamilyItem[] {
  if (!v || !path.length || v.v !== path[0]) return [];
  let items = v.items ?? [];
  for (const code of path.slice(1)) {
    const it = items.find(i => i.v === code);
    if (!it) return [];
    items = it.items ?? [];
  }
  return items;
}

/** The picked item at a path (path[0] = root, last = the item). */
export function itemAt(v: FamilyValue | null | undefined, path: readonly string[]): FamilyItem | null {
  if (path.length < 2) return null;
  return itemsAt(v, path.slice(0, -1)).find(i => i.v === path[path.length - 1]) ?? null;
}

function withItemsAt(v: FamilyValue, path: readonly string[], fn: (items: FamilyItem[]) => FamilyItem[]): FamilyValue {
  const rec = (items: FamilyItem[], rest: readonly string[]): FamilyItem[] => {
    if (!rest.length) return fn(items);
    return items.map(it => {
      if (it.v !== rest[0]) return it;
      const next = rec(it.items ?? [], rest.slice(1));
      const { items: _drop, ...base } = it;
      void _drop;
      return next.length ? { ...base, items: next } : base;
    });
  };
  const next = rec(v.items ?? [], path.slice(1));
  const { items: _drop, ...base } = v;
  void _drop;
  return next.length ? { ...base, items: next } : base;
}

/** Tick / untick a child under `parentPath` ([root, …]). A single-pick list
 *  replaces its pick; a multi list keeps the definition's order. */
export function toggleItem(def: OptionFamily, v: FamilyValue, parentPath: readonly string[], code: string, on: boolean): FamilyValue {
  const parent = nodeAtPath(def, parentPath);
  const kids = parent?.children;
  const node = kids?.nodes.find(n => n.code === code);
  if (!kids || !node) return v;
  const order = (c: string) => kids.nodes.findIndex(n => n.code === c);
  return withItemsAt(v, parentPath, items => {
    const had = items.find(i => i.v === code);
    if (!on) return items.filter(i => i.v !== code);
    if (had) return items;
    const fresh: FamilyItem = { v: node.code, label: node.label };
    const unit = clean(node.qty?.unit);
    if (node.qty && unit) fresh.unit = unit;
    const next = kids.multi ? [...items, fresh] : [fresh];
    return next.sort((a, b) => order(a.v) - order(b.v));
  });
}

/** Set the quantity of the item at `path` ([root, …, item]); blank clears. */
export function setItemQty(def: OptionFamily, v: FamilyValue, path: readonly string[], qty: string): FamilyValue {
  if (path.length < 2) return v;
  const node = nodeAtPath(def, path);
  const code = path[path.length - 1];
  return withItemsAt(v, path.slice(0, -1), items => items.map(it => {
    if (it.v !== code) return it;
    const { qty: _q, ...rest } = it;
    void _q;
    const q = clean(qty);
    const unit = clean(node?.qty?.unit);
    const out: FamilyItem = q ? { ...rest, qty: q } : rest;
    if (unit) out.unit = unit;
    return out;
  }));
}

// ── Editor validation ───────────────────────────────────────────────────

export interface FamilyIssue { path: string; message: string }

/** Every problem that blocks saving a family definition (empty = valid). */
export function validateFamily(def: OptionFamily): FamilyIssue[] {
  const out: FamilyIssue[] = [];
  if (!clean(def.name)) out.push({ path: 'name', message: 'Give the family a name.' });
  if (!clean(def.code)) out.push({ path: 'code', message: 'The family needs a code.' });
  if (!def.nodes?.length) out.push({ path: 'nodes', message: 'Add at least one answer.' });
  const walk = (nodes: FamilyNode[], depth: number, where: string) => {
    if (depth > FAMILY_MAX_DEPTH) {
      out.push({ path: where, message: `Too deep — a family can nest at most ${FAMILY_MAX_DEPTH} levels.` });
      return;
    }
    const seen = new Set<string>();
    const seenLabel = new Set<string>();
    nodes.forEach((n, i) => {
      const at = `${where}[${i}]`;
      const name = clean(n.label) || `answer ${i + 1}`;
      if (!clean(n.label)) out.push({ path: at, message: `Answer ${i + 1}${where === 'nodes' ? '' : ` under ${where}`} has no label.` });
      const code = clean(n.code).toUpperCase();
      if (!code) out.push({ path: at, message: `"${name}" has no code.` });
      else if (seen.has(code)) out.push({ path: at, message: `Code "${code}" is used twice at the same level.` });
      seen.add(code);
      const lk = clean(n.label).toLowerCase();
      if (lk && seenLabel.has(lk)) out.push({ path: at, message: `"${n.label}" appears twice at the same level.` });
      if (lk) seenLabel.add(lk);
      if (n.qty?.kind === 'choice' && !(n.qty.options ?? []).some(o => clean(o)))
        out.push({ path: at, message: `"${name}" counts by a list — add at least one choice.` });
      if (n.children) {
        if (!n.children.nodes?.length) out.push({ path: at, message: `"${name}" opens a sub-list with no options — add one or remove the sub-list.` });
        else walk(n.children.nodes, depth + 1, `${at}.${clean(n.label) || 'children'}`);
      }
    });
  };
  if (def.nodes?.length) walk(def.nodes, 1, 'nodes');
  return out;
}

/** The deepest level a definition reaches (root = 1). */
export function familyDepth(nodes: FamilyNode[] | null | undefined): number {
  if (!nodes?.length) return 0;
  return 1 + Math.max(0, ...nodes.map(n => familyDepth(n.children?.nodes)));
}

/** A stable code from a label, unique among `taken` ("Hyaline" → "HYA",
 *  then "HYA2"…). */
export function codeFromLabel(label: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(t => clean(t).toUpperCase()));
  const base = (clean(label).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 3)) || 'OPT';
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

/** Family code from its name ("Casts" → "FAM-CASTS"), unique among `taken`. */
export function familyCodeFromName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(t => clean(t).toUpperCase()));
  const base = `FAM-${(clean(name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20)) || 'NEW'}`;
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}
