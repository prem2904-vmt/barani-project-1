// Pure validator that runs a FormField's ValidationConfig + isRequired
// flag against a value snapshot. Returns the first failing message or null.
//
// Shared between the admin test-editor (previews what the rule will say)
// and result-entry (blocks submission on failure).

import { FormField, FormFieldType } from './form-field.model';

export function validateFieldValue(field: FormField, value: unknown): string | null {
  const v = field.validation;
  const empty = isEmpty(value);

  if (field.isRequired && empty) {
    return v?.errorMessage ?? 'Required';
  }
  if (empty) return null;

  if (isNumericType(field.type)) {
    const n = Number(value);
    if (!Number.isNaN(n)) {
      if (v?.min != null && n < v.min) return v.errorMessage ?? `Must be at least ${v.min}`;
      if (v?.max != null && n > v.max) return v.errorMessage ?? `Must not exceed ${v.max}`;
    }
  }

  if (typeof value === 'string') {
    if (v?.minLength != null && value.length < v.minLength) {
      return v.errorMessage ?? `Must be at least ${v.minLength} characters`;
    }
    if (v?.maxLength != null && value.length > v.maxLength) {
      return v.errorMessage ?? `Must not exceed ${v.maxLength} characters`;
    }
    if (v?.pattern) {
      try {
        if (!new RegExp(v.pattern).test(value)) return v.errorMessage ?? 'Invalid format';
      } catch { /* malformed pattern — skip */ }
    }
  }

  // Multiselect array bounds piggy-back on min/max (count of selections)
  if (Array.isArray(value) && isMultiSelectType(field.type)) {
    const count = value.length;
    if (v?.min != null && count < v.min) return v.errorMessage ?? `Pick at least ${v.min}`;
    if (v?.max != null && count > v.max) return v.errorMessage ?? `Pick at most ${v.max}`;
  }

  return null;
}

export function isNumericType(t: FormFieldType): boolean {
  return t === 'number';
}
export function isMultiSelectType(t: FormFieldType): boolean {
  return t === 'multiselect';
}
export function supportsLengthValidation(t: FormFieldType): boolean {
  return t === 'text' || t === 'textarea' || t === 'phone' || t === 'email';
}
export function supportsPatternValidation(t: FormFieldType): boolean {
  return t === 'text' || t === 'phone' || t === 'email';
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'boolean') return false;
  return false;
}
