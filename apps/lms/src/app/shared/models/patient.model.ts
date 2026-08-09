export interface Patient {
  id: string;
  tenantId: string;
  /** Lifetime patient MRN, e.g. `DEL-2605-004217-3`. Server-assigned on
   * registration; legacy rows (pre-2026-05-16) may have it null. Use
   * `patientMrnLabel(p)` to render with a fallback. */
  mrn?: string;
  firstName: string;
  fathersName: string;
  /** Server computes this. Falls back to `firstName + ' ' + fathersName` in the helper. */
  displayName?: string;
  phone?: string;
  email?: string;
  dateOfBirth?: string;
  age?: number;
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

/** Composes a display name for a patient. Tolerates missing fathersName. */
export function patientDisplayName(
  p: Pick<Patient, 'firstName' | 'fathersName' | 'displayName'> | null | undefined
): string {
  if (!p) return '';
  if (p.displayName) return p.displayName;
  return [p.firstName, p.fathersName].filter(Boolean).join(' ');
}

/** Renders an MRN with a graceful fallback for legacy NULL-MRN patients. */
export function patientMrnLabel(p: Pick<Patient, 'mrn'> | null | undefined): string {
  return p?.mrn?.trim() || '—';
}

/** Formats patient details consistently: <Name(First 15 characters followed by ellipsis)> | <age> /<sex> | <P-ID> */
export function formatPatientInfo(
  p: Pick<Patient, 'firstName' | 'fathersName' | 'displayName' | 'age' | 'sex' | 'mrn'> | null | undefined
): string {
  if (!p) return '—';
  const name = patientDisplayName(p);
  const truncatedName = name.length > 15 ? name.substring(0, 15) + '..' : name;
  const age = p.age != null ? p.age : '—';
  let sexCode = '—';
  if (p.sex) {
    const s = p.sex.trim().toLowerCase();
    if (s.startsWith('m')) sexCode = 'M';
    else if (s.startsWith('f')) sexCode = 'F';
    else if (s.startsWith('o')) sexCode = 'O';
    else sexCode = p.sex.charAt(0).toUpperCase();
  }
  const pid = p.mrn?.trim() || '—';
  return `${truncatedName} | ${age}/${sexCode} | ${pid}`;
}

/** Age/sex + MRN WITHOUT the name — "23/M · AA0040". For layouts that give the
 *  patient's name its own emphasis and trail the identifiers behind it, where
 *  formatPatientInfo's single "Name | 23/M | AA0040" string would repeat it. */
export function formatPatientMeta(
  p: Pick<Patient, 'age' | 'sex' | 'mrn'> | null | undefined
): string {
  if (!p) return '';
  const age = p.age != null ? String(p.age) : '—';
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
