/**
 * Unified search (owner-approved "Option A") — the ONE pill in the hero band
 * of Order & Payments. Scope tiles on the left pick what the single input
 * searches; picking a match fills that tile and returns the scope to Tests.
 *
 * This file holds only the vocabulary (scopes, labels, placeholders, the
 * dropdown row shape). The data wiring lives in OrderCreateComponent, which
 * drives each scope from the SAME services the old separate boxes used.
 */
export type SearchScope = 'tests' | 'patient' | 'doctor' | 'hospital';

export const SEARCH_SCOPES: readonly SearchScope[] = ['tests', 'patient', 'doctor', 'hospital'];

export const SCOPE_LABELS: Record<SearchScope, string> = {
  tests: 'Tests',
  patient: 'Patient',
  doctor: 'Doctor',
  hospital: 'Hospital',
};

export const SCOPE_PLACEHOLDERS: Record<SearchScope, string> = {
  tests: 'Search tests, profiles or packages: name, code, department',
  patient: 'Find a patient by name, phone, MRN or ABHA',
  doctor: 'Find the referring doctor',
  hospital: 'Find the referring hospital or vendor',
};

/** Short placeholders for phones (the pill is narrow there). */
export const SCOPE_PLACEHOLDERS_SHORT: Record<SearchScope, string> = {
  tests: 'Search tests',
  patient: 'Find patient',
  doctor: 'Find doctor',
  hospital: 'Find hospital',
};

/** One row of the scope dropdown under the pill. `kind: 'new'` is the
 *  free-text "add as a new entry" row (the referral fields have always
 *  accepted any name — the backend stores the text). */
export interface ScopeRow {
  key: string;
  title: string;
  meta: string;
  kind: 'match' | 'new';
  /** Doctor rows: the doctor's name (the title may read "Dr X · Hospital Y"). */
  value?: string;
  /** Doctor rows: the affiliated hospital this row stands for, if any. */
  hospital?: string | null;
}

/** One referring-doctor match from GET /api/test-picker/doctors/options — one
 *  row per (doctor, hospital) affiliation, or one hospital-less row for an
 *  independent doctor. */
export interface DoctorOption {
  doctorId?: string | null;
  name: string;
  hospitalName?: string | null;
}

/** Normalise the picker payload (older servers answer plain names). */
export function toDoctorOptions(list: ReadonlyArray<DoctorOption | string> | null | undefined): DoctorOption[] {
  return (list ?? [])
    .map(x => (typeof x === 'string' ? { name: x, hospitalName: null } : x))
    .filter(x => !!x?.name?.trim());
}

/** "Dr X · Hospital Y" when the doctor is linked, else just "Dr X". */
export function doctorOptionLabel(o: DoctorOption): string {
  const h = o.hospitalName?.trim();
  return h ? `${o.name} · ${h}` : o.name;
}
