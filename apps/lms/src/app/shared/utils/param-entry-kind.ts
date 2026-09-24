/**
 * ONE resolver for "what does the tech enter for this parameter?" — shared by
 * BOTH result-entry screens AND the Test Master editor so they can never drift
 * again.
 *
 * Owner bug (2026-09-24): tests with a mapped dropdown showed as FREE TEXT in
 * the Test Master editor while lab Result Entry showed the dropdown. Result
 * entry decided "dropdown" from the stored parameter (choice-ish type string
 * in any spelling, OR any options/optionRows, OR a qualitative type), while
 * the editor only honoured a handful of exact registry type strings and
 * otherwise fell back to 'text' — and it trusted a stale `fields[]` twin that
 * the server's option-group mapping never rewrites.
 *
 * Stored shapes this has to cover (real tenant catalogues):
 *  - 'select' + optionRows/options            (CLP / micro catalogues)
 *  - 'options'                                 (what the editor itself saves)
 *  - 'choice' / 'dropdown' / 'radio' / 'button_select' / 'multiselect' …
 *  - capitalised / spaced spellings ('Select', 'Drop-down', 'Button Select')
 *  - 'qualitative' + options[]                 (haematology catalogue: RBC Size…)
 *  - 'qualitative' with NO options             (Sickling Test → Positive/Negative)
 *  - 'text' / unknown type + options[] or optionRows (option-group mapping)
 */
import type { FormFieldType } from '../forms/form-field.model';
import { getFieldType } from '../forms/field-registry';
import { qualitativeOptionsFor } from './qualitative';

export type ParamEntryKind = 'number' | 'textarea' | 'select' | 'checkbox' | 'date' | 'text';

/** The subset of a stored parameter the resolver reads. */
export interface ParamKindInput {
  type?: string | null;
  options?: (string | null | undefined)[] | null;
  optionRows?: { value?: string | null; active?: boolean | null }[] | null;
}

/** 'Button Select' / 'button_select' / 'buttonSelect' → 'buttonselect'. */
export const compactType = (t: string | null | undefined): string =>
  String(t ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');

const NUMBER_TYPES = new Set(['numeric', 'numericwithrange', 'number', 'decimal', 'float', 'integer', 'int']);
const CHOICE_TYPES = new Set([
  'select', 'dropdown', 'options', 'option', 'choice', 'list', 'radio',
  'buttonselect', 'multiselect', 'imageselect',
]);
const TEXTAREA_TYPES = new Set(['textarea', 'multiline']);
const CHECKBOX_TYPES = new Set(['yesno', 'toggle', 'checkbox']);

/** True when the parameter carries its own curated answer list. */
export function hasOwnOptions(p: ParamKindInput): boolean {
  return (p.optionRows?.length ?? 0) > 0
    || (p.options ?? []).some(o => String(o ?? '').trim().length > 0);
}

/** How result entry renders this parameter. Explicit number/textarea/date/
 *  yes-no types win; a choice-ish type in any spelling, or ANY parameter that
 *  carries options/optionRows, or a qualitative type is a dropdown. */
export function resolveParamEntryKind(p: ParamKindInput): ParamEntryKind {
  const t = compactType(p.type);
  if (NUMBER_TYPES.has(t)) return 'number';
  if (TEXTAREA_TYPES.has(t)) return 'textarea';
  if (CHOICE_TYPES.has(t)) return 'select';
  if (CHECKBOX_TYPES.has(t)) return 'checkbox';
  if (t === 'date') return 'date';
  if (hasOwnOptions(p)) return 'select';
  return qualitativeOptionsFor({ type: p.type ?? undefined, options: cleanOptions(p) }) ? 'select' : 'text';
}

/** The dropdown's answers: the test's OWN option table (active rows, in
 *  order) wins; else the qualitative list / default pair; else options[]. */
export function choiceOptionsFor(p: ParamKindInput): string[] {
  const rows = (p.optionRows ?? []).filter(r => r.active !== false && String(r.value ?? '').trim());
  if (rows.length) return rows.map(r => String(r.value));
  const opts = cleanOptions(p);
  return qualitativeOptionsFor({ type: p.type ?? undefined, options: opts }) ?? opts;
}

function cleanOptions(p: ParamKindInput): string[] {
  return (p.options ?? []).map(o => String(o ?? '')).filter(o => o.trim().length > 0);
}

// Registry types that ARE a choice list — a stored one is kept verbatim so a
// radio/button-select test never silently turns into a plain dropdown.
const CHOICE_REGISTRY: Record<string, FormFieldType> = {
  select: 'select', multiselect: 'multiselect', radio: 'radio',
  buttonselect: 'buttonSelect', imageselect: 'imageSelect',
};
const LEGACY_ALIASES: Record<string, FormFieldType> = {
  numeric: 'number', multiline: 'textarea', text: 'text',
};

/** The Test Master editor's field type for a stored parameter — the SAME
 *  decision result entry makes, expressed in the editor's vocabulary. */
export function editorFieldTypeFor(p: ParamKindInput): FormFieldType {
  const kind = resolveParamEntryKind(p);
  const t = compactType(p.type);
  if (kind === 'number') return 'number';
  if (kind === 'select') return CHOICE_REGISTRY[t] ?? 'select';
  if (LEGACY_ALIASES[t]) return LEGACY_ALIASES[t];
  const raw = String(p.type ?? '') as FormFieldType;
  return getFieldType(raw) ? raw : kind === 'textarea' ? 'textarea' : 'text';
}

/** A stored editor `fields[]` entry of this type that sits next to a
 *  parameter result entry renders as a dropdown is STALE (the server's
 *  option-group mapping rewrites parameters[] only) — the parameter wins.
 *  Deliberately narrow: only plain input types are overridden, never a
 *  checkbox/yes-no/layout field that legitimately saves as 'options'. */
export function fieldIsStaleForChoice(fieldType: string | null | undefined, p: ParamKindInput): boolean {
  const ft = compactType(fieldType);
  if (!(ft === '' || ft === 'text' || ft === 'textarea' || ft === 'number' || ft === 'voicetext')) return false;
  return resolveParamEntryKind(p) === 'select' && choiceOptionsFor(p).length > 0;
}
