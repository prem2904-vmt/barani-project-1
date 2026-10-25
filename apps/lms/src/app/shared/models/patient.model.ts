import { formatAge } from '../utils/patient-age';

export interface Patient {
  id: string;
  tenantId: string;
  /** Lifetime patient MRN, e.g. `DEL-2605-004217-3`. Server-assigned on
   * registration; legacy rows (pre-2026-05-16) may have it null. Use
   * `patientMrnLabel(p)` to render with a fallback. */
  mrn?: string;
  /** Honorific printed before the name ("Mr.", "Mrs.", "Ms.", "Dr.",
   *  "Master", "Baby", "Baby of"). Optional; server DisplayName already
   *  includes it. "Baby" = the baby's OWN name follows ("Baby Arjun Kumar");
   *  "Baby of" = an unnamed newborn, the name fields hold the MOTHER's name
   *  ("Baby of Priya Kumar"). See PATIENT_TITLES. */
  title?: string | null;
  firstName: string;
  fathersName: string;
  /** Server computes this (now WITH the title). Falls back to
   *  `title + firstName + fathersName` in the helper. */
  displayName?: string;
  phone?: string;
  email?: string;
  /** The single source of age (server-canonical: UTC midnight of the date).
   *  An ESTIMATE when only an age was entered (`dobEstimated`). */
  dateOfBirth?: string;
  /** Whole years, server-derived from the DOB on every write. For display
   *  use `formatAge(p)` (shared/utils/patient-age) — it stays current and
   *  shows infants in months / days. */
  age?: number;
  /** The DOB was estimated from an entered age. */
  dobEstimated?: boolean;
  /** Server: live age, "34 Y" / "8 M" / "12 D". */
  ageDisplay?: string | null;
  /** Server: live FRACTIONAL age (days / 365.25) — the band-pick metric. */
  ageYears?: number | null;
  sex?: string;
  /** ABO/Rh blood group, e.g. "O+". Optional. */
  bloodGroup?: string;
  isMinor: boolean;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelationship?: string;
  abhaId?: string;
  abhaAddress?: string;
  abhaVerified: boolean;
  abhaVerifiedAt?: string;
  aadhaarLast4?: string;
  aadhaarVerified: boolean;
  source: string;
  hasKnownAllergies: boolean;
  attributes?: string;
  createdAt: string;
  updatedAt?: string;
}

/** The honorifics, in pill order (mirrors the server WorkflowSeeder +
 *  PatientsController.NormalizeTitle). */
export const PATIENT_TITLES = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Master', 'Baby', 'Baby of'] as const;

/** Unnamed newborn: the name fields hold the mother's name. */
export const BABY_OF_TITLE = 'Baby of';

/** True for the "Baby of" title (tolerates case and the B/O shorthand). */
export function isBabyOfTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim().toLowerCase().replace(/\.$/, '');
  return t === 'baby of' || t === 'baby-of' || t === 'b/o';
}

/** Composes a display name for a patient. Tolerates missing fathersName.
 *  Prefers the server displayName (which already carries the title), so the
 *  manual fallback prefixing here can never double up. */
export function patientDisplayName(
  p: Pick<Patient, 'firstName' | 'fathersName' | 'displayName'> & { title?: string | null } | null | undefined
): string {
  if (!p) return '';
  if (p.displayName) return p.displayName;
  return [p.title, p.firstName, p.fathersName].filter(Boolean).join(' ');
}

/** Renders an MRN with a graceful fallback for legacy NULL-MRN patients. */
export function patientMrnLabel(p: Pick<Patient, 'mrn'> | null | undefined): string {
  return p?.mrn?.trim() || '—';
}

/** Formats patient details consistently: <Name> | <age> /<sex> | <P-ID> */
export function formatPatientInfo(
  p: Pick<Patient, 'firstName' | 'fathersName' | 'displayName' | 'age' | 'sex' | 'mrn'> & { dateOfBirth?: string | null } | null | undefined
): string {
  if (!p) return '—';
  const name = patientDisplayName(p);
    const age = formatAge(p, 'num', '—');
  let sexCode = '—';
  if (p.sex) {
    const s = p.sex.trim().toLowerCase();
    if (s.startsWith('m')) sexCode = 'M';
    else if (s.startsWith('f')) sexCode = 'F';
    else if (s.startsWith('o')) sexCode = 'O';
    else sexCode = p.sex.charAt(0).toUpperCase();
  }
  const pid = p.mrn?.trim() || '—';
  return `${name} | ${age}/${sexCode} | ${pid}`;
}

/** Age/sex + MRN WITHOUT the name — "23/M · AA0040". For layouts that give the
 *  patient's name its own emphasis and trail the identifiers behind it, where
 *  formatPatientInfo's single "Name | 23/M | AA0040" string would repeat it. */
export function formatPatientMeta(
  p: Pick<Patient, 'age' | 'sex' | 'mrn'> & { dateOfBirth?: string | null } | null | undefined
): string {
  if (!p) return '';
  const age = formatAge(p, 'num', '—');
  let sexCode = '—';
  if (p.sex) {
    const t = p.sex.trim().toLowerCase();
    sexCode = t.startsWith('m') ? 'M' : t.startsWith('f') ? 'F' : t.startsWith('o') ? 'O'
            : p.sex.charAt(0).toUpperCase();
  }
  return [`${age}/${sexCode}`, p.mrn?.trim() || '—'].join(' · ');
}

export interface RegisterPatientInput {
  firstName: string;
  fathersName: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  age?: number;
  sex?: string;
  abhaId?: string;
  aadhaarLast4?: string;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelationship?: string;
  hasKnownAllergies?: boolean;
  attributes?: string;
}

export interface PatientProfile {
  patient: Patient;
  history: unknown[];
}
