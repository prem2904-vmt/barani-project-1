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
  isMinor: boolean;
  guardianName?: string;
  guardianPhone?: string;
  guardianRelationship?: string;
  abhaId?: string;
  abhaVerified: boolean;
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
