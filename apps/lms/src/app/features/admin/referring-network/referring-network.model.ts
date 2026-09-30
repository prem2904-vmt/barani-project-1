/**
 * Referring network — doctor-first model (owner 2026-09-30).
 *
 * A doctor may exist with NO hospital (independent) and refer from one or
 * more hospitals; a hospital may have existing doctors attached. The server
 * owns the affiliations (`doctor_hospitals`); `hospitalId` on a doctor is its
 * PRIMARY hospital and is always one of `hospitals`.
 */

export interface Hospital {
  id: string;
  name: string;
  code?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
  notes?: string | null;
  isActive: boolean;
  doctorCount: number;
}

export interface HospitalRef { id: string; name: string; }

export interface Doctor {
  id: string;
  /** Primary hospital (legacy readers). */
  hospitalId?: string | null;
  hospitalName?: string | null;
  /** Every hospital the doctor refers from, primary first. Older servers
   *  omit it — {@link doctorHospitals} falls back to the primary. */
  hospitals?: HospitalRef[] | null;
  name: string;
  designation?: string | null;
  department?: string | null;
  qualification?: string | null;
  specialisation?: string | null;
  registrationNo?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive: boolean;
}

/** Hospital filter of the Doctors view. */
export const ALL_HOSPITALS = '__all__';
export const NO_HOSPITAL = '__none__';

/** The doctor's hospitals (primary first); tolerant of payloads without `hospitals`. */
export function doctorHospitals(d: Pick<Doctor, 'hospitals' | 'hospitalId' | 'hospitalName'>): HospitalRef[] {
  if (d.hospitals && d.hospitals.length) return d.hospitals;
  return d.hospitalId ? [{ id: d.hospitalId, name: d.hospitalName ?? '' }] : [];
}

export function doctorHospitalIds(d: Pick<Doctor, 'hospitals' | 'hospitalId' | 'hospitalName'>): string[] {
  return doctorHospitals(d).map(h => h.id);
}

/** "Apollo, Kauvery" — or "Independent" for a doctor with no hospital. */
export function doctorHospitalsLabel(d: Pick<Doctor, 'hospitals' | 'hospitalId' | 'hospitalName'>): string {
  const names = doctorHospitals(d).map(h => h.name).filter(Boolean);
  return names.length ? names.join(', ') : 'Independent';
}

/** Doctors at one hospital, or independent ones ({@link NO_HOSPITAL}), or all. */
export function filterDoctorsByHospital(doctors: readonly Doctor[], filter: string): Doctor[] {
  if (!filter || filter === ALL_HOSPITALS) return doctors.slice();
  if (filter === NO_HOSPITAL) return doctors.filter(d => doctorHospitalIds(d).length === 0);
  return doctors.filter(d => doctorHospitalIds(d).includes(filter));
}

/** What to attach / detach to go from `before` to `after` (a hospital's doctors). */
export function linkDiff(before: readonly string[], after: readonly string[]): { add: string[]; remove: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { add: [...a].filter(x => !b.has(x)), remove: [...b].filter(x => !a.has(x)) };
}
