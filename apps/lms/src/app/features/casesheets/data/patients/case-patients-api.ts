import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { api } from '../api-url';

/**
 * The personal space's own patients (public case-sheet site only, plan §3.5): `GET /api/casesheets/patients?q=` (search) and
 * `POST /api/casesheets/patients` (quick-create through the LMS PatientService: MRN, age from DOB, duplicate rule). A lab never
 * uses this — its sheets start from the LMS patient profile. Raw JSON + problem+json, like every case-sheet endpoint.
 */
export interface CasePatient {
  id: string;
  name: string;
  age: string | null;
  sex: string | null;
  phone: string | null;
  mrn: string | null;
}

export interface NewCasePatient {
  firstName: string;
  lastName?: string | null;
  sex?: string | null;
  /** `yyyy-mm-dd`; when set, age is worked out from it. */
  dateOfBirth?: string | null;
  age?: number | null;
  phone?: string | null;
  /** Register although a patient with the same first name + phone exists (after the person confirmed). */
  force?: boolean;
}

/** A quick-create the server refused. `duplicateOf` = the patient it thinks this already is (409 `duplicate_patient`). */
export class CasePatientError extends Error {
  constructor(message: string, readonly code: string, readonly duplicateOf: string | null = null) {
    super(message);
    this.name = 'CasePatientError';
  }
}

type Json = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export function toCasePatient(v: unknown): CasePatient {
  const p = (v && typeof v === 'object' ? v : {}) as Json;
  const name = s(p['name']) ?? [s(p['firstName']), s(p['lastName'])].filter(Boolean).join(' ');
  return { id: String(p['id'] ?? ''), name: name || 'Patient', age: s(p['age']), sex: s(p['sex']), phone: s(p['phone']), mrn: s(p['mrn']) };
}

/** What the patient step shows under a name: "34 yrs · Female · 98xxxx". */
export function patientMeta(p: CasePatient): string {
  return [p.age, p.sex, p.phone].filter(Boolean).join(' · ');
}

@Injectable({ providedIn: 'root' })
export class CasePatientsApi {
  private readonly http = inject(HttpClient);

  async search(q: string, limit = 20): Promise<CasePatient[]> {
    const r = await firstValueFrom(this.http.get<{ items?: unknown[] }>(api('/api/casesheets/patients'), { params: { q: q.trim(), limit } }));
    return (r?.items ?? []).map(toCasePatient).filter((p) => !!p.id);
  }

  async create(input: NewCasePatient): Promise<CasePatient> {
    const body: Json = { firstName: input.firstName.trim() };
    if (input.lastName?.trim()) body['lastName'] = input.lastName.trim();
    if (input.sex) body['sex'] = input.sex;
    if (input.dateOfBirth) body['dateOfBirth'] = input.dateOfBirth;
    else if (input.age != null) body['age'] = input.age;
    if (input.phone?.trim()) body['phone'] = input.phone.trim();
    if (input.force) body['force'] = true;
    try {
      return toCasePatient(await firstValueFrom(this.http.post(api('/api/casesheets/patients'), body)));
    } catch (e) {
      if (e instanceof HttpErrorResponse && e.status >= 400 && e.status < 500) {
        const p = (e.error && typeof e.error === 'object' ? e.error : {}) as Json;
        throw new CasePatientError(s(p['detail']) ?? "Couldn't add this patient. Check the details and try again.", s(p['code']) ?? 'invalid_patient',
          s(p['patientId']));
      }
      throw new CasePatientError("Couldn't reach Prefrontal right now. Check the connection and try again.", 'transient');
    }
  }
}
