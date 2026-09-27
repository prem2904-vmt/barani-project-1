// Pure validator that runs a FormField's ValidationConfig + isRequired
// flag against a value snapshot. Returns the first failing message or null.
//
// Shared between the admin test-editor (previews what the rule will say)
// and result-entry (blocks submission on failure).

import { FormField, FormFieldType, ValidationConfig } from './form-field.model';
import { identityKind, isContactNumberField, validateEmail, validateIdentity } from './patient-fields';

export interface CountryPhoneRule {
  code: string;
  country: string;
  flag: string;
  name: string;
  maxDigits: number;
  pattern: RegExp;
  placeholder: string;
  errorMessage: string;
}

export const COUNTRY_PHONE_RULES: CountryPhoneRule[] = [
  {
    code: '+91',
    country: 'IN',
    flag: '🇮🇳',
    name: 'India',
    maxDigits: 10,
    pattern: /^[6-9]\d{9}$/,
    placeholder: '98765 43210',
    errorMessage: 'Must be a valid 10-digit Indian phone number starting with 6, 7, 8, or 9'
  },
  {
    code: '+1',
    country: 'US',
    flag: '🇺🇸',
    name: 'US / Canada',
    maxDigits: 10,
    pattern: /^[2-9]\d{9}$/,
    placeholder: '(555) 123-4567',
    errorMessage: 'Must be a valid 10-digit US/Canada phone number'
  },
  {
    code: '+44',
    country: 'GB',
    flag: '🇬🇧',
    name: 'UK',
    maxDigits: 11,
    pattern: /^(7\d{9}|\d{10,11})$/,
    placeholder: '7123 456789',
    errorMessage: 'Must be a valid UK phone number (10-11 digits)'
  },
  {
    code: '+971',
    country: 'AE',
    flag: '🇦🇪',
    name: 'UAE',
    maxDigits: 9,
    pattern: /^5[024568]\d{7}$/,
    placeholder: '50 123 4567',
    errorMessage: 'Must be a valid 9-digit UAE mobile number'
  },
  {
    code: '+966',
    country: 'SA',
    flag: '🇸🇦',
    name: 'Saudi Arabia',
    maxDigits: 9,
    pattern: /^5\d{8}$/,
    placeholder: '50 123 4567',
    errorMessage: 'Must be a valid 9-digit Saudi mobile number'
  },
  {
    code: '+65',
    country: 'SG',
    flag: '🇸🇬',
    name: 'Singapore',
    maxDigits: 8,
    pattern: /^[89]\d{7}$/,
    placeholder: '8123 4567',
    errorMessage: 'Must be a valid 8-digit Singapore mobile number'
  },
  {
    code: '+61',
    country: 'AU',
    flag: '🇦🇺',
    name: 'Australia',
    maxDigits: 9,
    pattern: /^4\d{8}$/,
    placeholder: '412 345 678',
    errorMessage: 'Must be a valid 9-digit Australian mobile number'
  },
  {
    code: '+49',
    country: 'DE',
    flag: '🇩🇪',
    name: 'Germany',
    maxDigits: 11,
    pattern: /^(1[567]\d{8,9}|\d{10,11})$/,
    placeholder: '171 1234567',
    errorMessage: 'Must be a valid German phone number'
  }
];

export function getCountryPhoneRule(code?: string): CountryPhoneRule {
  if (!code) return COUNTRY_PHONE_RULES[0];
  return COUNTRY_PHONE_RULES.find(r => r.code === code) ?? COUNTRY_PHONE_RULES[0];
}

export function validatePhoneNumber(raw: unknown, forcedCode?: string): string | null {
  if (raw == null || raw === '') return null;
  const str = String(raw).trim();
  if (!str) return null;

  let rule: CountryPhoneRule;
  let digits: string;

  if (forcedCode) {
    rule = getCountryPhoneRule(forcedCode);
    digits = str.replace(/\D/g, '');
    if (str.startsWith(rule.code)) {
      digits = str.slice(rule.code.length).replace(/\D/g, '');
    }
  } else {
    const matched = COUNTRY_PHONE_RULES.find(r => str.startsWith(r.code));
    if (matched) {
      rule = matched;
      digits = str.slice(matched.code.length).replace(/\D/g, '');
    } else {
      rule = COUNTRY_PHONE_RULES[0]; // default to +91
      digits = str.replace(/\D/g, '');
    }
  }

  if (!digits) return 'Phone number required';
  if (!rule.pattern.test(digits)) {
    return rule.errorMessage;
  }
  return null;
}

export interface GenericValidationRule {
  type?: string;
  value?: unknown;
  message?: string;
  errorMessage?: string | null;
  min?: number | null;
  max?: number | null;
  minLength?: number | null;
  maxLength?: number | null;
  pattern?: string | null;
}

export interface ValidatableField {
  type: string;
  /** Field name / label: identity numbers (ABHA / Aadhaar) and number fields
   *  that are really phone numbers ("Additional contact") are recognised by it. */
  name?: string;
  title?: string;
  isRequired?: boolean;
  validation?: ValidationConfig | GenericValidationRule[] | null;
}

export function validateFieldValue(field: ValidatableField, value: unknown): string | null {
  const empty = isEmpty(value);

  if (field.isRequired && empty) {
    return 'Required';
  }
  if (empty) return null;

  if (field.type === 'phone' || isContactNumberField(field)) {
    const phoneErr = validatePhoneNumber(value);
    if (phoneErr) return phoneErr;
  }
  if (field.type === 'email') {
    const emailErr = validateEmail(value);
    if (emailErr) return emailErr;
  }
  const idKind = identityKind(field);
  if (idKind) {
    const idErr = validateIdentity(idKind, value);
    if (idErr) return idErr;
  }

  const v = field.validation;
  if (!v) return null;

  if (Array.isArray(v)) {
    for (const rule of v) {
      if (!rule) continue;
      const type = rule.type;
      const val = rule.value;
      const msg = rule.message || rule.errorMessage || 'Invalid value';

      if (type === 'required' && empty) return msg;
      if (type === 'phone') {
        const phoneErr = validatePhoneNumber(value);
        if (phoneErr) return msg || phoneErr;
      }
      if (type === 'min' && typeof value === 'number' && value < Number(val)) return msg;
      if (type === 'max' && typeof value === 'number' && value > Number(val)) return msg;
      if (type === 'minLength' && typeof value === 'string' && value.length < Number(val)) return msg;
      if (type === 'maxLength' && typeof value === 'string' && value.length > Number(val)) return msg;
      if (type === 'pattern' && typeof value === 'string') {
        try {
          if (!new RegExp(String(val)).test(value)) return msg;
        } catch { /* skip */ }
      }
    }
  } else {
    if (isNumericType(field.type)) {
      const n = Number(value);
      if (!Number.isNaN(n)) {
        if (v.min != null && n < v.min) return v.errorMessage ?? `Must be at least ${v.min}`;
        if (v.max != null && n > v.max) return v.errorMessage ?? `Must not exceed ${v.max}`;
      }
    }

    if (typeof value === 'string') {
      if (v.minLength != null && value.length < v.minLength) {
        return v.errorMessage ?? `Must be at least ${v.minLength} characters`;
      }
      if (v.maxLength != null && value.length > v.maxLength) {
        return v.errorMessage ?? `Must not exceed ${v.maxLength} characters`;
      }
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(value)) return v.errorMessage ?? 'Invalid format';
        } catch { /* malformed pattern — skip */ }
      }
    }

    if (Array.isArray(value) && isMultiSelectType(field.type)) {
      const count = value.length;
      if (v.min != null && count < v.min) return v.errorMessage ?? `Pick at least ${v.min}`;
      if (v.max != null && count > v.max) return v.errorMessage ?? `Pick at most ${v.max}`;
    }
  }

  return null;
}

export function isNumericType(t: string): boolean {
  return t === 'number' || t === 'numeric';
}
export function isMultiSelectType(t: string): boolean {
  return t === 'multiselect' || t === 'multi_button_select';
}
export function supportsLengthValidation(t: string): boolean {
  return t === 'text' || t === 'textarea' || t === 'phone' || t === 'email';
}
export function supportsPatternValidation(t: string): boolean {
  return t === 'text' || t === 'phone' || t === 'email';
}

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'boolean') return false;
  return false;
}
