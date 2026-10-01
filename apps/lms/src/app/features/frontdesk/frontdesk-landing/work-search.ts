import { Order } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { matchesDailyNo } from '../../../shared/utils/daily-no';

/**
 * The work card's header search (In progress / Completed / Payments due):
 * case-insensitive substring over patient (name, phone, MRN, ABHA), order
 * number, sample IDs and test names — and a bare number ("12" / "#12") also
 * finds today's daily patient number #12. Empty query = everything.
 */
export function normaliseWorkQuery(q: string | null | undefined): string {
  return (q ?? '').trim().toLowerCase();
}

function patientHay(p: Patient | null | undefined): (string | null | undefined)[] {
  if (!p) return [];
  return [p.displayName, `${p.firstName ?? ''} ${p.fathersName ?? ''}`, p.phone, p.mrn, p.abhaId, p.abhaAddress];
}

export function orderMatchesWorkQuery(o: Order, q: string): boolean {
  const needle = normaliseWorkQuery(q);
  if (!needle) return true;
  if (matchesDailyNo(needle, o)) return true;
  const hay: (string | null | undefined)[] = [...patientHay(o.patient), o.orderNumber, o.refDoctorName];
  for (const s of o.samples ?? []) {
    hay.push(s.barcode);
    for (const t of s.tests ?? []) hay.push(t.name, t.profileName);
  }
  return hay.some(v => !!v && v.toLowerCase().includes(needle));
}

/** Drafts (parked carts) only carry the patient. */
export function patientMatchesWorkQuery(p: Patient | null | undefined, q: string): boolean {
  const needle = normaliseWorkQuery(q);
  if (!needle) return true;
  return patientHay(p).some(v => !!v && v.toLowerCase().includes(needle));
}

export function filterOrdersByWorkQuery<T extends Order>(orders: readonly T[], q: string): T[] {
  const needle = normaliseWorkQuery(q);
  return needle ? orders.filter(o => orderMatchesWorkQuery(o, needle)) : orders.slice();
}
