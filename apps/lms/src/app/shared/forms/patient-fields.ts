// Patient-identity field rules (registration form, QA #2 2026-09-27).
//
// Pure helpers shared by validateFieldValue (submit / blur errors) and the
// dynamic input (typing caps). Mirrored server-side by the mw
// PatientInputValidator so the API can't store what the form rejects.
//
//  • ABHA number   — exactly 14 digits (shown XX-XXXX-XXXX-XXXX). The field is
//                    digits-only (ABHA ADDRESSES like name@abdm are not
//                    accepted here: they live in attributes.abhaAddress,
//                    filled by the ABDM fetch, and /abha-link wants 14 digits).
//  • Aadhaar       — exactly 12 digits, first digit 2–9, Verhoeff checksum.
//  • Aadhaar last 4— exactly 4 digits (the standard field: full Aadhaar is
//                    never stored).
//  • Email         — optional; when filled, one @, a dot in the domain, no spaces.
//  • Age (DOB ⇄ age box) — Years 0–150, Months 0–1199 (a months-only age:
//                    under 100 years), Days 0–365 (a days-only age: newborns).

/** A number field that is really a phone number (by its name / label):
 *  "Additional contact", "Alternate mobile", "WhatsApp" … */
export function isContactNumberField(f: { type?: string; name?: string; title?: string } | null | undefined): boolean {
  if (!f || !['number', 'numeric'].includes(f.type ?? '')) return false;
  return /phone|mobile|contact|whats\s?app|(^|[^a-z])tel([^a-z]|$)/i.test(`${f.name ?? ''} ${f.title ?? ''}`);
}

/** Registration text fields that hold a person's name or a job title (by field
 *  name): letters only. Free-form custom fields are NOT in this list. */
const PERSON_NAME_FIELDS = new Set([
  'first_name', 'middle_name', 'last_name', 'fathers_name', 'father_name', 'guardian_name', 'occupation',
]);
export function isPersonNameField(f: { type?: string; name?: string } | null | undefined): boolean {
  if (!f || (f.type ?? 'text') !== 'text') return false;
  return PERSON_NAME_FIELDS.has((f.name ?? '').toLowerCase());
}

/** Letters (any script), spaces and . ' - only. Mirrored by the mw
 *  PatientInputValidator.NameError. */
export function validatePersonName(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M} .'\u2019-]*$/u.test(s) ? null : 'Use letters only (spaces, . \' and - are fine)';
}

export type IdentityKind = 'abha' | 'aadhaar' | 'aadhaar_last4';

/** Which identity number a TEXT field holds, by its name (same names the
 *  dynamic input groups / caps). null → not an identity field. */
export function identityKind(f: { type?: string; name?: string } | null | undefined): IdentityKind | null {
  if (!f || (f.type ?? 'text') !== 'text') return null;
  const n = (f.name ?? '').toLowerCase();
  if (n === 'aadhaar_last4' || n === 'aadhar_last4') return 'aadhaar_last4';
  if (n === 'aadhaar' || n === 'aadhar' || n === 'aadhaar_number' || n === 'aadhar_number') return 'aadhaar';
  if (n === 'abha_id' || n === 'abha' || n.includes('abha')) return 'abha';
  return null;
}

// ── Verhoeff (Aadhaar's check digit) ───────────────────────────────────
const V_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const V_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
/** True when the digit string (check digit last) passes Verhoeff. */
export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  const rev = digits.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = V_D[c][V_P[i % 8][+rev[i]]];
  return c === 0;
}

const digitsOf = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** ABHA number: 14 digits (hyphens/spaces ignored). */
export function validateAbhaNumber(v: unknown): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (/[^\d\s-]/.test(raw)) return 'ABHA number is 14 digits (XX-XXXX-XXXX-XXXX)';
  const d = digitsOf(raw);
  if (d.length !== 14) return `ABHA number must be 14 digits (${d.length} entered)`;
  return null;
}

/** Full Aadhaar: 12 digits, never starting 0/1, Verhoeff check digit. */
export function validateAadhaar(v: unknown): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (/[^\d\s-]/.test(raw)) return 'Aadhaar is 12 digits';
  const d = digitsOf(raw);
  if (d.length !== 12) return `Aadhaar must be 12 digits (${d.length} entered)`;
  if (/^[01]/.test(d)) return 'Not a valid Aadhaar number (cannot start with 0 or 1)';
  if (!verhoeffValid(d)) return 'Not a valid Aadhaar number — check the digits';
  return null;
}

/** Aadhaar last 4: exactly 4 digits. */
export function validateAadhaarLast4(v: unknown): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (!/^\d{4}$/.test(raw)) return 'Enter the last 4 digits of the Aadhaar';
  return null;
}

export function validateIdentity(kind: IdentityKind, v: unknown): string | null {
  switch (kind) {
    case 'abha': return validateAbhaNumber(v);
    case 'aadhaar': return validateAadhaar(v);
    case 'aadhaar_last4': return validateAadhaarLast4(v);
  }
}

/** Pragmatic email check (optional field; empty passes). */
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
export function validateEmail(v: unknown): string | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  if (raw.length > 254 || !EMAIL_RE.test(raw)) return 'Enter a valid email (name@example.com)';
  return null;
}

// ── Age (the DOB field's "or Age" box) ─────────────────────────────────
export type AgeUnit = 'years' | 'months' | 'days';
export const AGE_LIMITS: Record<AgeUnit, number> = { years: 150, months: 1199, days: 365 };

/** Error for an age typed in `unit`, or null when it's within range. */
export function validateAge(n: number | null | undefined, unit: AgeUnit): string | null {
  if (n == null) return null;
  if (!Number.isFinite(n) || n < 0 || Math.floor(n) !== n) return 'Age must be a whole number';
  const max = AGE_LIMITS[unit];
  if (n > max) {
    switch (unit) {
      case 'years': return `Age must be 0–${max} years`;
      case 'months': return `Months must be 0–${max} — switch to Yrs for older patients`;
      case 'days': return `Days must be 0–${max} — switch to Mo or Yrs for older babies`;
    }
  }
  return null;
}

/** DOB (yyyy-MM-dd, local midnight) for an age typed in `unit`, anchored to `now`.
 *  Years / months step by CALENDAR month and clamp to the target month's last
 *  day (29 Feb − 1 year = 28 Feb; 31 Mar − 1 month = 28/29 Feb) — never
 *  spill into the next month, which made a 1-year-old a day short of a year. */
export function dobFromAge(n: number, unit: AgeUnit, now: Date = new Date()): string {
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (unit === 'days') d.setDate(d.getDate() - n);
  else {
    const back = unit === 'years' ? n * 12 : n;
    const total = d.getFullYear() * 12 + d.getMonth() - back;
    const y = Math.floor(total / 12), m = total - y * 12;
    d = new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()));
  }
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
