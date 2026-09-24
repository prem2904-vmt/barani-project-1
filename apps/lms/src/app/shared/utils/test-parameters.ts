/**
 * A test's result fields — ONE list, `parameters[]` inside the Parameters
 * JSON. Every reader (result entry, sample result entry, the Test Master
 * editor) and every writer goes through here.
 *
 * History (owner bug 2026-09-24): the editor used to save a second, richer
 * `fields[]` copy next to `parameters[]`. The server's option-group mapping
 * rewrote `parameters[]` only, so the editor (which preferred `fields[]`)
 * showed a mapped dropdown as FREE TEXT while result entry showed the
 * dropdown. The duplicate was the defect: the editor-only properties
 * (required, showWhen, validation, rich type, …) now live on the parameter
 * objects themselves and `fields[]` is never written again.
 *
 * Legacy blobs that still carry `fields[]` are folded ONCE on read
 * (`readParameters`): the field's editor-only props are merged onto the
 * parameter with the same name, while the parameter's lab data — answer
 * list, normals, ranges, units — wins. The next save writes parameters only.
 */
import type { FieldOption, FormField, FormFieldType } from '../forms/form-field.model';
import type { TestParameter, TestParametersBlob } from '../models/test.model';
import { choiceOptionsFor, editorFieldTypeFor, fieldIsStaleForChoice, resolveParamEntryKind } from './param-entry-kind';

/** Editor/entry-form properties carried on a parameter (formerly fields[]-only). */
const EDITOR_PROPS = [
  'isRequired', 'isConditional', 'showWhen', 'validation', 'placeholder', 'helperText',
  'icon', 'width', 'defaultValue', 'defaultUnit', 'imageGalleryConfig', 'scribblePadConfig',
  'sizeConfig', 'measureConfig', 'disabled',
] as const;
/** Flags whose `false` is the default — not worth storing. */
const DEFAULT_FALSE = new Set(['isRequired', 'isConditional', 'disabled']);

export function newFieldId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Parse a Parameters JSON string (or pass an already-parsed blob through). */
export function parseParametersBlob(json: string | null | undefined): TestParametersBlob | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return { parameters: v };           // bare-array legacy shape
    return v && typeof v === 'object' ? (v as TestParametersBlob) : null;
  } catch { return null; }
}

const nameKey = (n: string | null | undefined) => String(n ?? '').trim().toLowerCase();

/** The stored `type` for an editor field type. Numbers keep the catalogue's
 *  'numeric' (older readers compare against it); every other editor type is
 *  stored as-is — no lossy mapping (yes/no, date, radio… survive). */
export function storedTypeFor(t: FormFieldType): string {
  return t === 'number' ? 'numeric' : t;
}

/** Copy the non-default editor props from `src` onto `dst`. */
function copyEditorProps(dst: Record<string, unknown>, src: Record<string, unknown>) {
  for (const k of EDITOR_PROPS) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (DEFAULT_FALSE.has(k) && v === false) continue;
    dst[k] = v;
  }
}

/** Fold one legacy `fields[]` entry into its parameter twin. The parameter's
 *  lab data wins; the field contributes editor-only props and its richer type
 *  — unless the field is a stale plain input next to a parameter the server
 *  mapped to an option list (then the parameter's choice type wins). */
export function foldLegacyField(p: TestParameter | undefined, f: FormField): TestParameter {
  if (!p) return fieldToParam(f);
  const out: Record<string, unknown> = { ...p };
  copyEditorProps(out, f as unknown as Record<string, unknown>);
  if (!out['id'] && f.id) out['id'] = f.id;
  if (!out['title'] && f.label) out['title'] = f.label;
  // The old save mapped types lossily (yes/no, date → 'text'; radio,
  // checkbox → 'options'), so the field's type is the richer truth.
  if (f.type && !fieldIsStaleForChoice(f.type, p)) out['type'] = storedTypeFor(f.type);
  // Lab data the field has but the parameter lacks (never overrides).
  for (const k of ['unit', 'referenceRanges', 'criticalLow', 'criticalHigh', 'validLow', 'validHigh',
                   'normalValue', 'optionRows', 'optionGroupName', 'attachments', 'printOnReport'] as const) {
    const fv = (f as unknown as Record<string, unknown>)[k];
    if ((out[k] === undefined || out[k] === null) && fv !== undefined && fv !== null) out[k] = fv;
  }
  if ((!p.options || p.options.length === 0) && f.options?.length && !(p.optionRows?.length)) {
    out['options'] = f.options.map(o => o.label);
  }
  return out as unknown as TestParameter;
}

/** THE reader: a blob's single list of result fields. Legacy `fields[]`
 *  entries are folded into their parameter (by name); a field with no
 *  parameter twin is converted and appended. */
export function readParameters(blob: TestParametersBlob | null | undefined): TestParameter[] {
  if (!blob) return [];
  const params = (Array.isArray(blob.parameters) ? blob.parameters : [])
    .filter(p => p && typeof p === 'object');
  const legacy = Array.isArray(blob.fields) ? blob.fields.filter(f => f && typeof f === 'object') : [];
  if (legacy.length === 0) return params;
  const fieldByName = new Map(legacy.map(f => [nameKey(f.name), f] as const));
  const seen = new Set<string>();
  const out = params.map(p => {
    const k = nameKey(p.name);
    seen.add(k);
    const f = fieldByName.get(k);
    return f ? foldLegacyField(p, f) : p;
  });
  for (const f of legacy) if (!seen.has(nameKey(f.name))) out.push(fieldToParam(f));
  return out;
}

function toFieldOptions(values: string[]): FieldOption[] {
  return values.map((label, i) => ({
    id: `opt_${i}_${(label || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)}`,
    label: label ?? '',
    value: label ?? '',
    order: i,
  }));
}

/** A parameter's answers as editor options. A qualitative parameter with no
 *  list of its own gets the SAME default pair result entry shows (Sickling
 *  Test → Positive / Negative), so saving persists what the tech sees. */
function optionsForParam(p: TestParameter): FieldOption[] | null {
  const own = (p.options ?? []).filter(o => String(o ?? '').trim());
  if (own.length) return toFieldOptions(own);
  if (resolveParamEntryKind(p) !== 'select') return null;
  const derived = choiceOptionsFor(p);
  return derived.length ? toFieldOptions(derived) : null;
}

/** Parameter → the in-memory form model the editor and result entry use. */
export function paramToField(p: TestParameter, order: number): FormField {
  const f: FormField = {
    id: p.id || newFieldId(),
    name: p.name,
    // Catalogue parameters often carry only `name`; falling back keeps the
    // editor from titling every seeded dropdown "Untitled parameter".
    label: p.title || p.name,
    type: editorFieldTypeFor(p),
    order,
    isRequired: p.isRequired === true,
    isConditional: p.isConditional === true,
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
  copyEditorProps(f as unknown as Record<string, unknown>, p as unknown as Record<string, unknown>);
  f.isRequired = p.isRequired === true;
  f.isConditional = p.isConditional === true;
  return f;
}

/** Form model → the stored parameter. Lossless for every editor property. */
export function fieldToParam(f: FormField): TestParameter {
  const p: Record<string, unknown> = {
    id: f.id,
    name: f.name,
    title: f.label,
    type: storedTypeFor(f.type),
  };
  const put = (k: string, v: unknown) => { if (v !== undefined && v !== null) p[k] = v; };
  put('unit', f.unit ?? undefined);
  put('options', f.options?.map(o => o.label));
  put('optionRows', f.optionRows);
  put('optionGroupName', f.optionGroupName);
  if (f.attachments === true) p['attachments'] = true;
  if (f.printOnReport === false) p['printOnReport'] = false;
  put('referenceRanges', f.referenceRanges);
  put('normalValue', f.normalValue);
  put('criticalLow', f.criticalLow);
  put('criticalHigh', f.criticalHigh);
  put('validLow', f.validLow);
  put('validHigh', f.validHigh);
  copyEditorProps(p, f as unknown as Record<string, unknown>);
  return p as unknown as TestParameter;
}

/** Parameters JSON → the editor's form list. */
export function loadEditorFields(json: string | null | undefined): FormField[] {
  return readParameters(parseParametersBlob(json)).map((p, i) => paramToField(p, i));
}

/** Keys `fieldToParam` owns; anything else on a stored parameter (seeded
 *  `methodology`, catalogue tags, …) is carried through a save untouched. */
const MANAGED_KEYS = new Set<string>([
  'id', 'name', 'title', 'type', 'unit', 'options', 'optionRows', 'optionGroupName',
  'attachments', 'printOnReport', 'referenceRanges', 'normalValue', 'criticalLow',
  'criticalHigh', 'validLow', 'validHigh', ...EDITOR_PROPS,
]);

/** True when the blob still carries the legacy `fields` twin. */
export function hasLegacyFields(json: string | null | undefined): boolean {
  const b = parseParametersBlob(json) as Record<string, unknown> | null;
  return !!b && 'fields' in b;
}

/** Write the form list back into the blob: `parameters` only — any legacy
 *  `fields` key is dropped. Other blob keys (microFormat, attachments,
 *  sampleType, …) and unknown keys on each stored parameter are kept. */
export function writeParameters(existingJson: string | null | undefined, fields: FormField[]): string {
  const existing = parseParametersBlob(existingJson) ?? ({} as TestParametersBlob);
  const { fields: _legacy, ...rest } = existing as TestParametersBlob & Record<string, unknown>;
  void _legacy;
  const prior = readParameters(existing);
  const byId = new Map(prior.filter(p => p.id).map(p => [p.id, p] as const));
  const byName = new Map(prior.map(p => [nameKey(p.name), p] as const));
  const params = fields.map(f => {
    const { _optionsDraft, ...keep } = f as FormField & { _optionsDraft?: string };
    void _optionsDraft;
    const orig = (f.id && byId.get(f.id)) || byName.get(nameKey(f.name));
    const carried: Record<string, unknown> = {};
    if (orig) {
      for (const [k, v] of Object.entries(orig)) if (!MANAGED_KEYS.has(k)) carried[k] = v;
    }
    return { ...carried, ...fieldToParam(keep as FormField) } as TestParameter;
  });
  return JSON.stringify({ ...rest, parameters: params });
}
