import { Answers, ConditionDef, FieldDef, FormDefinition, LinkDef, ShowWhenDef, TriggerDef, allFields } from './types';

/**
 * The rule engine (plan §3 "Prepare filling UI": ported ONCE as pure
 * functions; legacy had two copies). Mirrors the legacy filler
 * (resident-fe dynamic-form.ts) so imported forms behave as before:
 *  - show-when on pages and fields (and / or, show / hide),
 *  - links: a value typed in one field is mirrored into its linked fields,
 *  - triggers: "when X is Y, set Z" (chained up to 10 rounds).
 * The API stays the truth for the narrative; these only decide what the
 * doctor sees and which values are filled for them.
 */

/** A value lookup: the answers a condition can read (an instance page reads its own values first). */
export type Lookup = (key: string) => unknown;

export const lookupIn =
  (...scopes: Answers[]): Lookup =>
  (key) => {
    for (const s of scopes) if (s && Object.prototype.hasOwnProperty.call(s, key)) return s[key];
    return undefined;
  };

function norm(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v === true) return 'yes';
  if (v === false) return 'no';
  if (typeof v === 'object') return '';
  return String(v).toLowerCase().trim();
}

function num(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o['value'] !== null && o['value'] !== undefined) return Number(o['value']);
    if (o['amount'] !== null && o['amount'] !== undefined) return Number(o['amount']);
  }
  return Number(v);
}

function emptyObjectValue(v: object): boolean | null {
  const o = v as Record<string, unknown>;
  if ('value' in o || 'amount' in o) {
    const x = o['value'] ?? o['amount'];
    return x === null || x === undefined || x === '';
  }
  return null;
}

/** One comparison, with the legacy semantics (yes/no ≡ true/false, arrays = "any of", numbers out of {value|amount}). */
export function evaluateCondition(fieldValue: unknown, op: string, conditionValue: unknown): boolean {
  const fv = norm(fieldValue);
  const cv = norm(conditionValue);
  // a body map's tapped markers read like a multiple choice ("Painful sites includes Jaw")
  const areas = (fieldValue as { markers?: unknown } | null)?.markers;
  const arr = Array.isArray(fieldValue) ? (fieldValue as unknown[]) : Array.isArray(areas) ? (areas as unknown[]) : null;
  const inArr = () => !!arr && arr.some((x) => norm(x) === cv);
  switch (op) {
    case 'equals':
    case 'eq':
    case 'isSelected':
      return arr ? inArr() : fv === cv;
    case 'notEquals':
    case 'neq':
      return arr ? !inArr() : fv !== cv;
    case 'contains':
    case 'includes':
      return arr ? inArr() : fv.includes(cv);
    case 'notContains':
      return arr ? !inArr() : !fv.includes(cv);
    case 'isEmpty':
      return isEmptyValue(fieldValue);
    case 'isNotEmpty':
    case 'hasValue':
      return !isEmptyValue(fieldValue);
    case 'greaterThan':
      return num(fieldValue) > num(conditionValue);
    case 'lessThan':
      return num(fieldValue) < num(conditionValue);
    case 'greaterThanOrEqual':
      return num(fieldValue) >= num(conditionValue);
    case 'lessThanOrEqual':
      return num(fieldValue) <= num(conditionValue);
    default:
      return false;
  }
}

/** Legacy isEmpty: null, '', [] and {value: null}. */
export function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return emptyObjectValue(v) ?? false;
  return false;
}

/** Is a page / field shown? No rule = shown. A rule with no conditions = shown. */
export function isShown(rule: ShowWhenDef | null | undefined, get: Lookup): boolean {
  if (!rule || !rule.conditions?.length) return true;
  const results = rule.conditions.map((c: ConditionDef) => evaluateCondition(get(c.field), c.op, c.value));
  const match = (rule.logic ?? 'and') === 'or' ? results.some(Boolean) : results.every(Boolean);
  return rule.visibility === 'hide' ? !match : match;
}

/** A link / trigger reference → the answer key. `fieldKey::optionKey::subFieldKey` → the sub-field's own key (v2 stores sub-fields under their own keys). */
export function refToKey(ref: string | null | undefined): string {
  if (!ref) return '';
  const parts = ref.split('::');
  return parts.length === 3 ? parts[2] : ref;
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) => valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    );
  }
  return false;
}

/** Answer keys a doctor cannot edit because a link fills them (disableLinked: every field but the primary). */
export function linkDisabledKeys(def: FormDefinition): Set<string> {
  const out = new Set<string>();
  for (const l of def.links ?? []) {
    if (!l.disableLinked || (l.fields?.length ?? 0) < 2) continue;
    const primary = l.primary || l.fields[0];
    for (const ref of l.fields) if (ref !== primary) out.add(refToKey(ref));
  }
  return out;
}

/** Fit a value copied into a repeat / repeatPages target (legacy adaptLinkedValue): a number becomes a count. */
function adapt(value: unknown, target: FieldDef | undefined, current: unknown): unknown {
  if (!target) return value;
  const n = typeof value === 'number' ? value : typeof value === 'string' && value !== '' ? Number(value) : NaN;
  if (target.kind === 'repeat') {
    if (Array.isArray(value)) return value;
    if (!Number.isFinite(n)) return value;
    const rows = Array.isArray(current) ? [...(current as unknown[])] : [];
    while (rows.length < n) rows.push({});
    rows.length = Math.max(0, Math.floor(n));
    return rows;
  }
  if (target.kind === 'repeatPages') {
    let count = n;
    if (Array.isArray(value)) count = value.length;
    if (!Number.isFinite(count)) return value;
    return resizeInstances(target, current, Math.floor(count));
  }
  return value;
}

/** Uniform-mode instance list with `count` repetitions of the field's pages, keeping existing values. */
export function resizeInstances(field: FieldDef, current: unknown, count: number, onlyPage?: string) {
  const pages = ((field.config?.['pages'] as string[]) ?? []).filter(Boolean);
  const existing = (current as { instances?: { page: string; index: number; values: Answers }[] })?.instances ?? [];
  const want = (p: string) => (onlyPage && p !== onlyPage ? existing.filter((i) => i.page === p).length : count);
  // keep the repetitions that stay, in the order they are in (the doctor may have arranged them), then add the new ones
  const out = existing.filter((x) => pages.includes(x.page) && (x.index ?? 0) < want(x.page));
  for (const p of pages)
    for (let i = 0; i < want(p); i++)
      if (!out.some((x) => x.page === p && (x.index ?? 0) === i)) out.push({ page: p, index: i, values: {} });
  return { instances: out };
}

/**
 * Apply links after a change: `prev` → `next` (both full answer maps).
 * Mirror: whichever linked field changed is copied to the others.
 * Cascade: only the primary (or the first field) propagates.
 */
export function applyLinks(def: FormDefinition, prev: Answers, next: Answers): Answers {
  const links: LinkDef[] = def.links ?? [];
  if (!links.length) return next;
  const byKey = fieldIndex(def);
  const out = { ...next };
  for (const l of links) {
    const refs = l.fields ?? [];
    const primary = l.primary || refs[0];
    let from: string | null = null;
    for (const ref of refs) {
      const k = refToKey(ref);
      if (!k || valuesEqual(prev[k], next[k])) continue;
      if (l.mode === 'cascade' && ref !== primary) continue;
      from = ref;
      break;
    }
    if (from === null) continue;
    const v = next[refToKey(from)];
    for (const ref of refs) {
      if (ref === from) continue;
      const k = refToKey(ref);
      if (!k) continue;
      if (v === undefined) delete out[k];
      else out[k] = adapt(v, byKey.get(k), out[k]);
    }
  }
  return out;
}

/** Run every enabled trigger until nothing changes (max 10 rounds, like legacy, so a loop can never hang the tablet). */
export function applyTriggers(def: FormDefinition, answers: Answers): Answers {
  const triggers: TriggerDef[] = def.triggers ?? [];
  if (!triggers.length) return answers;
  const byKey = fieldIndex(def);
  const out = { ...answers };
  let changed = true;
  for (let round = 0; changed && round < 10; round++) {
    changed = false;
    for (const t of triggers) {
      if (t.enabled === false) continue;
      const results = (t.conditions ?? []).map((c) => evaluateCondition(out[refToKey(c.source)], c.op, c.value));
      const met = (t.logic ?? 'and') === 'or' ? results.some(Boolean) : results.length > 0 && results.every(Boolean);
      if (!met) continue;
      for (const a of t.actions ?? []) {
        const target = refToKey(a.target);
        if (!target) continue;
        let v: unknown = undefined;
        if (a.action === 'setValue') v = a.value;
        else if (a.action === 'copyValue' && a.source) v = out[refToKey(a.source)];
        if (v === undefined) continue;
        v = adapt(v, byKey.get(target), out[target]);
        if (!valuesEqual(out[target], v)) {
          out[target] = v;
          changed = true;
        }
      }
    }
  }
  return out;
}

/** One change from the doctor → links → triggers. The single entry point the filler uses. */
export function applyChange(def: FormDefinition, prev: Answers, next: Answers): Answers {
  return applyTriggers(def, applyLinks(def, prev, next));
}

const indexCache = new WeakMap<FormDefinition, Map<string, FieldDef>>();
export function fieldIndex(def: FormDefinition): Map<string, FieldDef> {
  let m = indexCache.get(def);
  if (!m) {
    m = new Map(allFields(def).map((f) => [f.key, f]));
    indexCache.set(def, m);
  }
  return m;
}
