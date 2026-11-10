import { ConditionDef, FieldDef, FormDefinition, ShowWhenDef, allFields } from '../core/types';
import { ConditionOpWords } from './contract';
import { conditionOpsOf, conditionValueOf } from '../kinds/build-registry';
import { findField } from './doc';

/**
 * "Show when [Pain] [is] [Yes]": the tap-built condition model and the
 * plain sentence it reads as. Stored as the structured rule (`showWhen`),
 * so the API validates it and assistants can write it too. Nothing here
 * knows a kind: the words and value pickers come from each kind's
 * build descriptor.
 */

export interface ConditionRow {
  field: string;
  op: string;
  value?: unknown;
}

export interface ConditionSet {
  rows: ConditionRow[];
  /** all = every row must match; any = one is enough. */
  match: 'all' | 'any';
  /** show (default) or hide while they match. */
  visibility: 'show' | 'hide';
}

export function fromShowWhen(sw: ShowWhenDef | null | undefined): ConditionSet {
  return {
    rows: (sw?.conditions ?? []).map((c) => ({ field: c.field, op: c.op, ...(c.value !== undefined ? { value: c.value } : {}) })),
    match: sw?.logic === 'or' ? 'any' : 'all',
    visibility: sw?.visibility === 'hide' ? 'hide' : 'show',
  };
}

/** Back to the stored rule; no rows = always shown (null). Unfinished rows (no field) are dropped. */
export function toShowWhen(set: ConditionSet): ShowWhenDef | null {
  const conditions: ConditionDef[] = set.rows
    .filter((r) => r.field && r.op)
    .map((r) => (r.value === undefined ? { field: r.field, op: r.op } : { field: r.field, op: r.op, value: r.value }));
  if (!conditions.length) return null;
  const sw: ShowWhenDef = { conditions };
  if (set.match === 'any') sw.logic = 'or';
  else sw.logic = 'and';
  sw.visibility = set.visibility;
  return sw;
}

/** The fields a condition on `self` may read: every other field, not itself and nothing inside it. */
export function conditionSources(def: FormDefinition, selfKey: string | null): FieldDef[] {
  const self = selfKey ? findField(def, selfKey) : null;
  const inside = new Set<string>();
  if (self) {
    const walk = (f: FieldDef) => {
      inside.add(f.key);
      for (const o of f.options ?? []) for (const s of o.subFields ?? []) walk(s);
      for (const c of f.children ?? []) walk(c);
    };
    walk(self);
  }
  return allFields(def).filter((f) => !inside.has(f.key) && conditionOpsOf(f).length > 0);
}

export function opsFor(def: FormDefinition, fieldKey: string): ConditionOpWords[] {
  const f = findField(def, fieldKey);
  return f ? conditionOpsOf(f) : [];
}

/** What the value picker offers: option chips, Yes / No, a number, or nothing. */
export function valueChoices(def: FormDefinition, fieldKey: string): { kind: 'options' | 'yesno' | 'number' | 'none'; options: { value: string; label: string }[] } {
  const f = findField(def, fieldKey);
  if (!f) return { kind: 'none', options: [] };
  const kind = conditionValueOf(f);
  if (kind === 'options') return { kind, options: (f.options ?? []).map((o) => ({ value: o.key, label: o.label })) };
  if (kind === 'yesno') {
    const opts = (f.options ?? []).length
      ? f.options!.map((o) => ({ value: o.key, label: o.label }))
      : [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ];
    return { kind, options: opts };
  }
  return { kind, options: [] };
}

/** A new row on `fieldKey` with the first op and (when there is one) the first value. */
export function startRow(def: FormDefinition, fieldKey: string): ConditionRow {
  const ops = opsFor(def, fieldKey);
  const op = ops[0];
  if (!op) return { field: fieldKey, op: 'isNotEmpty' };
  if (op.noValue) return { field: fieldKey, op: op.op };
  const vc = valueChoices(def, fieldKey);
  return { field: fieldKey, op: op.op, value: vc.options[0]?.value ?? (vc.kind === 'number' ? 0 : undefined) };
}

/** Change the op; keep the value when the new op takes one, drop it when not. */
export function withOp(def: FormDefinition, row: ConditionRow, op: string): ConditionRow {
  const words = opsFor(def, row.field).find((o) => o.op === op);
  if (words?.noValue) return { field: row.field, op };
  if (row.value !== undefined) return { ...row, op };
  const vc = valueChoices(def, row.field);
  return { field: row.field, op, value: vc.options[0]?.value ?? (vc.kind === 'number' ? 0 : undefined) };
}

function label(def: FormDefinition, key: string): string {
  return findField(def, key)?.label || 'a question that was removed';
}

function valueWords(def: FormDefinition, fieldKey: string, value: unknown): string {
  const f = findField(def, fieldKey);
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  const opt = f?.options?.find((o) => o.key === value || o.key.toLowerCase() === String(value).toLowerCase());
  if (opt) return opt.label;
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  return value === undefined || value === null || value === '' ? '…' : String(value);
}

/** "Pain is Yes", "Chief complaints includes Nasal block", "Temperature is more than 38". */
export function describeCondition(def: FormDefinition, c: ConditionRow): string {
  const f = findField(def, c.field);
  const words = f ? conditionOpsOf(f).find((o) => o.op === c.op) : undefined;
  const opWords = words?.words ?? FALLBACK_WORDS[c.op] ?? c.op;
  if (words?.noValue || c.op === 'isEmpty' || c.op === 'isNotEmpty') return `${label(def, c.field)} ${opWords}`;
  return `${label(def, c.field)} ${opWords} ${valueWords(def, c.field, c.value)}`;
}

const FALLBACK_WORDS: Record<string, string> = {
  equals: 'is',
  notEquals: 'is not',
  contains: 'includes',
  notContains: 'does not include',
  isEmpty: 'is not answered',
  isNotEmpty: 'is answered',
  greaterThan: 'is more than',
  lessThan: 'is less than',
  greaterThanOrEqual: 'is at least',
  lessThanOrEqual: 'is at most',
};

/** The whole rule as one sentence: "Always shown", "Shown when Pain is Yes and Fever is more than 38". */
export function describeShowWhen(def: FormDefinition, sw: ShowWhenDef | null | undefined): string {
  const set = fromShowWhen(sw);
  if (!set.rows.length) return 'Always shown';
  const parts = set.rows.map((r) => describeCondition(def, r));
  const join = set.match === 'any' ? ' or ' : ' and ';
  const lead = set.visibility === 'hide' ? 'Hidden when' : 'Shown when';
  return `${lead} ${joinWords(parts, join)}`;
}

function joinWords(parts: string[], last: string): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return parts.slice(0, -1).join(', ') + last + parts[parts.length - 1];
}
