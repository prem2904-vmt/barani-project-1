export interface Patient {
  id: string;
  tenantId: string;
  name: string;
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

export interface RegisterPatientInput {
  name: string;
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
