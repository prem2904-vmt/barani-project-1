import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { formatAge } from '../../../shared/utils/patient-age';
import { PatientBlock } from './cases/case-models';

/** The LMS patient a lab sheet starts from (plan §3.5), and the snapshot printed on the sheet. */
export interface LabPatient {
  id: string;
  name: string;
  /** "34 years · M · DEL-2605-004217-3" (the header's second line). */
  meta: string;
  snapshot: PatientBlock;
}

/**
 * The patient block a lab sheet carries (case_sheets patient snapshot = PatientLabel / Age / Sex / Ref): the LMS
 * display name (with the title), the live age from the DOB (plan §3.5 "Age from DOB"; infants in months / days),
 * the sex, and the MRN as the reference. Lengths follow the API's limits (name 200, age 30, sex 20, ref 80).
 */
export function patientSnapshot(
  p: Pick<Patient, 'firstName' | 'fathersName' | 'displayName' | 'sex' | 'mrn'> & {
    title?: string | null;
    dateOfBirth?: string | null;
    age?: number | null;
    ageYears?: number | null;
  },
  now: Date = new Date(),
): PatientBlock {
  const cut = (s: string | null | undefined, n: number) => (s && s.trim() ? s.trim().slice(0, n) : null);
  return {
    name: cut(patientDisplayName(p), 200),
    age: cut(formatAge(p, 'long', '', now), 30),
    sex: cut(p.sex ?? null, 20),
    ref: cut(p.mrn ?? null, 80),
  };
}

/** Reads the LMS patient (GET /api/patients/{id}, the profile's own call) for a case sheet. */
@Injectable({ providedIn: 'root' })
export class LabPatientService {
  private readonly api = inject(ApiService);

  async load(id: string): Promise<LabPatient> {
    const r = await firstValueFrom(this.api.get<{ patient?: Patient } & Partial<Patient>>(`/api/patients/${encodeURIComponent(id)}`));
    const p = (r?.patient ?? r) as Patient;
    const snapshot = patientSnapshot(p);
    return {
      id,
      name: snapshot.name ?? '',
      meta: [snapshot.age, snapshot.sex, snapshot.ref].filter(Boolean).join(' · '),
      snapshot,
    };
  }
}
