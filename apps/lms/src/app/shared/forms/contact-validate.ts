// Pure rules for the admin contact forms (OPS-45): referring hospitals /
// doctors and vendors. Mirrored server-side by prefrontal-mw
// ContactInputValidator. Every rule passes an EMPTY value (what is mandatory
// is decided by the caller), and returns a plain-words message or null.

import { validateEmail, validatePersonName } from './patient-fields';

export const MAX_NAME = 120;
export const MAX_CODE = 30;
export const MAX_TEXT = 300;

export type FieldErrors = Record<string, string>;

const str = (v: unknown): string => String(v ?? '').trim();

export function validateContactPersonName(v: unknown, label = 'Name'): string | null {
  const s = str(v);
  if (!s) return null;
  if (s.length > MAX_NAME) return `${label} must be ${MAX_NAME} characters or fewer`;
  return validatePersonName(s) ? `${label}: use letters only (spaces, . ' and - are fine)` : null;
}

/** Hospital / vendor phone: an Indian mobile OR a landline with its STD code. */
export function validateOrgPhone(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (!/^\+?[\d\s\-()]+$/.test(s)) return 'Phone can only have digits, spaces, + - and ( )';
  const digits = s.replace(/\D/g, '').length;
  return digits >= 8 && digits <= 13 ? null : 'Enter a valid phone number (8–13 digits)';
}

export function validateGstin(v: unknown): string | null {
  const s = str(v).toUpperCase();
  if (!s) return null;
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s) ? null : 'GSTIN is 15 characters, like 33AABCA1234A1Z5';
}

export function validateMaxLen(v: unknown, max: number, label: string): string | null {
  return str(v).length > max ? `${label} must be ${max} characters or fewer` : null;
}

function collect(pairs: Array<[string, string | null]>): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, e] of pairs) if (e) out[k] = e;
  return out;
}

export function hospitalErrors(h: {
  name?: string | null; code?: string | null; address?: string | null;
  phone?: string | null; email?: string | null; gstin?: string | null;
}): FieldErrors {
  return collect([
    ['name', !str(h.name) ? 'Name is required' : validateMaxLen(h.name, MAX_NAME, 'Name')],
    ['code', validateMaxLen(h.code, MAX_CODE, 'Code')],
    ['address', validateMaxLen(h.address, MAX_TEXT, 'Address')],
    ['phone', validateOrgPhone(h.phone)],
    ['email', validateEmail(h.email)],
    ['gstin', validateGstin(h.gstin)],
  ]);
}

export function referralDoctorErrors(d: {
  name?: string | null; designation?: string | null; department?: string | null;
  qualification?: string | null; registrationNo?: string | null; phone?: string | null; email?: string | null;
}, validatePhone: (v: unknown) => string | null): FieldErrors {
  return collect([
    ['name', !str(d.name) ? 'Name is required' : validateContactPersonName(d.name, 'Doctor name')],
    ['designation', validateMaxLen(d.designation, MAX_NAME, 'Designation')],
    ['department', validateMaxLen(d.department, MAX_NAME, 'Department')],
    ['qualification', validateMaxLen(d.qualification, MAX_NAME, 'Qualification')],
    ['registrationNo', validateMaxLen(d.registrationNo, MAX_CODE, 'Registration #')],
    ['phone', validatePhone(d.phone)],
    ['email', validateEmail(d.email)],
  ]);
}

export function vendorErrors(v: {
  name?: string | null; code?: string | null; contactName?: string | null; contactPhone?: string | null;
  contactEmail?: string | null; gstin?: string | null; address?: string | null;
}): FieldErrors {
  return collect([
    ['name', !str(v.name) ? 'Name is required' : validateMaxLen(v.name, MAX_NAME, 'Name')],
    ['code', validateMaxLen(v.code, MAX_CODE, 'Code')],
    ['contactName', validateContactPersonName(v.contactName, 'Contact name')],
    ['contactPhone', validateOrgPhone(v.contactPhone)],
    ['contactEmail', validateEmail(v.contactEmail)],
    ['gstin', validateGstin(v.gstin)],
    ['address', validateMaxLen(v.address, MAX_TEXT, 'Address')],
  ]);
}
