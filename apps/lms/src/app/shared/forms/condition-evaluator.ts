// Pure evaluator for ShowWhen/ConditionRule. Runs on a { fieldId → value }
// snapshot so it's framework-agnostic — callable from templates, services,
// or the narrative generator later on.

import { ConditionOperator, ConditionRule, ShowWhen } from './form-field.model';

export type FieldValues = Record<string, unknown>;

export function evaluateCondition(rule: ConditionRule, values: FieldValues): boolean {
  const actual = values[rule.fieldId];
  const expected = rule.value;
  return applyOperator(rule.operator, actual, expected);
}

export function evaluateShowWhen(showWhen: ShowWhen | null | undefined, values: FieldValues): boolean {
  // No rule means the field is always visible.
  if (!showWhen || !showWhen.conditions?.length) return true;

  const results = showWhen.conditions.map(c => evaluateCondition(c, values));
  const combined = showWhen.logic === 'OR'
    ? results.some(Boolean)
    : results.every(Boolean);

  // 'hide' flips the result: true means "match → hide", so visible = !combined.
  return showWhen.visibility === 'hide' ? !combined : combined;
}

function applyOperator(op: ConditionOperator, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'equals':             return looseEquals(actual, expected);
    case 'notEquals':          return !looseEquals(actual, expected);
    case 'contains':           return toArrayOrString(actual).includes(String(expected));
    case 'notContains':        return !toArrayOrString(actual).includes(String(expected));
    case 'isEmpty':            return isEmpty(actual);
    case 'isNotEmpty':         return !isEmpty(actual);
    case 'greaterThan':        return toNumber(actual) >  toNumber(expected);
    case 'lessThan':           return toNumber(actual) <  toNumber(expected);
    case 'greaterThanOrEqual': return toNumber(actual) >= toNumber(expected);
    case 'lessThanOrEqual':    return toNumber(actual) <= toNumber(expected);
    default:                   return false;
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a)) return a.map(String).includes(String(b));
  return String(a) === String(b);
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

function toArrayOrString(v: unknown): string[] | string {
  if (Array.isArray(v)) return v.map(x => String(x));
  return v == null ? '' : String(v);
}
