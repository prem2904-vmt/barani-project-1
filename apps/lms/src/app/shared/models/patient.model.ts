export interface Patient {
  id: string;
  tenantId: string;
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
