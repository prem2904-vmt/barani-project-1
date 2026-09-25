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
}
