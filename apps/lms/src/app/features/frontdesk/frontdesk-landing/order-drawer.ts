import { Patient, patientDisplayName } from '../../../shared/models/patient.model';
import { Order } from '../../../shared/models/order.model';

type DrawerPatient = Pick<Patient, 'firstName' | 'fathersName' | 'displayName' | 'age' | 'sex'> | null | undefined;

/** The patient's FULL display name for a drawer header — never shortened
 *  (formatPatientInfo cuts at 15 chars; ND §5 forbids that here). */
export function drawerName(p: DrawerPatient): string {
  return patientDisplayName(p) || 'Patient';
}

/** "22/M" for the quiet meta line; '' when neither age nor sex is known. */
export function drawerAgeSex(p: DrawerPatient): string {
  if (!p) return '';
  const age = p.age != null && `${p.age}`.trim() !== '' ? `${p.age}` : '';
  const t = (p.sex ?? '').trim().toLowerCase();
  const sex = !t ? '' : t.startsWith('m') ? 'M' : t.startsWith('f') ? 'F' : t.startsWith('o') ? 'O' : t.charAt(0).toUpperCase();
  if (!age && !sex) return '';
  return `${age || '—'}/${sex || '—'}`;
}

/** Order status → the ND chip's dot. The chip itself is always neutral;
 *  the dot is violet while in flight / done, muted before billing and red
 *  only for a real stop (cancelled / rejected). */
export type OrderStatusState = 'idle' | 'active' | 'done' | 'stopped';
export function orderStatusState(o: Pick<Order, 'status'>): OrderStatusState {
  switch (o.status) {
    case 'cancelled':
    case 'rejected': return 'stopped';
    case 'completed':
    case 'validated':
    case 'delivered': return 'done';
    case 'draft':
    case 'created': return 'idle';
    default: return 'active';
  }
}
