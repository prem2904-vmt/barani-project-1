/**
 * Stored Parameters blob → the Test Master editor's FormField list.
 *
 * Pure (no Angular) so the conversion is unit-tested shape by shape. The
 * field TYPE comes from the shared result-entry resolver
 * (`shared/utils/param-entry-kind`) — the editor and lab Result Entry make
 * the SAME dropdown-or-free-text decision for every stored shape.
 *
 * The blob carries two twins: `parameters[]` (what result entry, flagging,
 * the report engine and the server's option-group mapping read/write) and
 * the editor's richer `fields[]` (showWhen, validation, …). The server's
 * option-group mapping rewrites `parameters[]` only, so a stored field can be
 * stale ("text", no rows) next to a parameter that is now a dropdown — the
 * parameter's answer list is authoritative; the field keeps its editor-only
 * metadata.
 */
import type { FieldOption, FormField, FormFieldType } from '../../../../shared/forms/form-field.model';
import type { TestParameter, TestParametersBlob } from '../../../../shared/models/test.model';
import {
  choiceOptionsFor,
  editorFieldTypeFor,
  fieldIsStaleForChoice,
  resolveParamEntryKind,
} from '../../../../shared/utils/param-entry-kind';

export function newFieldId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function toFieldOptions(values: string[]): FieldOption[] {
  return values.map((label, i) => ({
    id: `opt_${i}_${(label || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
    label: label ?? '',
    value: label ?? '',
    order: i,
  }));
}

/** The answers a stored parameter offers, as editor options. A qualitative
 *  parameter with no list of its own gets the SAME default pair result entry
 *  shows (e.g. Sickling Test → Positive / Negative), so saving it persists
 *  exactly what the tech already sees. */
function optionsForParam(p: TestParameter): FieldOption[] | null {
  const own = (p.options ?? []).filter(o => String(o ?? '').trim());
  if (own.length) return toFieldOptions(own);
  if (resolveParamEntryKind(p) !== 'select') return null;
  const derived = choiceOptionsFor(p);
  return derived.length ? toFieldOptions(derived) : null;
}

/** One stored parameter → an editor field (legacy blobs with no fields[]). */
export function legacyParamToField(p: TestParameter, order: number): FormField {
  return {
    id: p.id || newFieldId(),
    name: p.name,
    // Catalogue parameters often carry only `name`; falling back keeps the
    // editor from titling every seeded dropdown "Untitled parameter".
    label: p.title || p.name,
    type: editorFieldTypeFor(p),
    order,
    isRequired: false,
    isConditional: false,
    unit: p.unit,
    referenceRanges: p.referenceRanges ?? null,
    criticalLow: p.criticalLow ?? null,
    criticalHigh: p.criticalHigh ?? null,
    validLow: p.validLow ?? null,
    validHigh: p.validHigh ?? null,
    normalValue: p.normalValue ?? null,
    optionRows: p.optionRows ?? null,
    optionGroupName: p.optionGroupName ?? null,
    attachments: p.attachments === true || undefined,
    printOnReport: p.printOnReport === false ? false : undefined,
    options: optionsForParam(p),
  };
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Reconcile a stored editor field with its parameter twin. */
export function reconcileField(f: FormField, p: TestParameter | undefined): FormField {
  if (!p) return f;
  const paramIsChoice = resolveParamEntryKind(p) === 'select' && choiceOptionsFor(p).length > 0;
  if (!paramIsChoice) return f;

  const out: FormField = { ...f };
  // Stale plain-input field next to a dropdown parameter → take the type.
  if (fieldIsStaleForChoice(f.type, p)) out.type = editorFieldTypeFor(p);

  // The answer list: the parameter's copy is what the server's mapping /
  // group edits rewrite — take it whenever it differs from the field's.
  if (p.optionRows?.length && JSON.stringify(p.optionRows) !== JSON.stringify(f.optionRows ?? null)) {
    out.optionRows = p.optionRows;
  }
  const paramOpts = optionsForParam(p)?.map(o => o.label) ?? [];
  const fieldOpts = (f.options ?? []).map(o => o.label);
  if (paramOpts.length && !sameList(paramOpts, fieldOpts)) out.options = toFieldOptions(paramOpts);
  if ((p.normalValue ?? null) !== (f.normalValue ?? null) && (p.optionRows?.length || p.options?.length)) {
    out.normalValue = p.normalValue ?? null;
  }
  if (p.optionGroupName && !f.optionGroupName) out.optionGroupName = p.optionGroupName;
  return out;
}

/** Parameters JSON → editor fields. `fields[]` when present (reconciled
 *  against `parameters[]` by name; parameters with no field twin are
 *  appended), otherwise converted from `parameters[]`. */
export function loadEditorFields(draftJson: string): FormField[] {
  if (!draftJson) return [];
  let blob: TestParametersBlob & { fields?: FormField[] };
  try { blob = JSON.parse(draftJson); } catch { return []; }
  if (!blob || typeof blob !== 'object') return [];
  const params = (blob.parameters ?? []).filter(p => p && typeof p === 'object');
  if (!Array.isArray(blob.fields)) return params.map((p, i) => legacyParamToField(p, i));

  const key = (n: string | null | undefined) => String(n ?? '').trim().toLowerCase();
  const byName = new Map(params.map(p => [key(p.name), p] as const));
  const fields = (blob.fields as FormField[]).map(f => reconcileField(f, byName.get(key(f.name))));
  const seen = new Set(fields.map(f => key(f.name)));
  const extra = params.filter(p => !seen.has(key(p.name)));
  return [...fields, ...extra.map((p, i) => legacyParamToField(p, fields.length + i))];
}

/** Editor type → stored parameter type (older readers). */
const FORWARD_TYPE_MAP: Partial<Record<FormFieldType, string>> = {
  number: 'numeric',
  text: 'text',
  select: 'options',
  multiselect: 'options',
  radio: 'options',
  buttonSelect: 'options',
  imageSelect: 'options',
  checkbox: 'options',
  textarea: 'multiline',
  date: 'text',
  time: 'text'
};

/** Editor field → stored parameter (what result entry reads). */
export function fieldToParam(f: FormField): TestParameter {
  const legacyType = (FORWARD_TYPE_MAP[f.type] ?? 'text') as TestParameter['type'];
  return {
    id: f.id,
    name: f.name,
    title: f.label,
    type: legacyType,
    unit: f.unit ?? undefined,
    options: f.options?.map(o => o.label) ?? undefined,
    optionRows: f.optionRows ?? undefined,
    optionGroupName: f.optionGroupName ?? undefined,
    attachments: f.attachments === true || undefined,
    printOnReport: f.printOnReport === false ? false : undefined,
    referenceRanges: (f.referenceRanges ?? undefined) as TestParameter['referenceRanges'],
    normalValue: f.normalValue ?? undefined,
    criticalLow: f.criticalLow ?? undefined,
    criticalHigh: f.criticalHigh ?? undefined,
    validLow: f.validLow ?? undefined,
    validHigh: f.validHigh ?? undefined
  };
}
