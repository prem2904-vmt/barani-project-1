/**
 * Patient profile (new design) — pure helpers for the ND layout
 * (docs/PF-PATTERN.md → "Patient profile"). Labels, tones and the band's
 * context line live here so the template stays declarative and the spec can
 * pin them without rendering.
 */
import { Order, OrderTest } from '../../../shared/models/order.model';
import { Patient } from '../../../shared/models/patient.model';
import { workRowTone, WorkRowTone } from '../frontdesk-landing/work-selection';
import { ageInYears, formatAge } from '../../../shared/utils/patient-age';
import { lineStatusLabel, NOT_REPORTED } from '../../../shared/utils/line-status';

export type PpView = 'orders' | 'trends' | 'timeline';
export type PpRange = 'all' | '30' | '90' | 'custom';

/** Whole years from the DOB (live), else the stored age, else null —
 *  the shared patient-age helper. */
export function ageYears(p: Pick<Patient, 'dateOfBirth' | 'age'> | null | undefined, now = new Date()): number | null {
  return ageInYears(p, now);
}

/** M / F / O (or the first letter), '—' when unknown. */
export function sexInitial(sex: string | null | undefined): string {
  const s = (sex || '').trim().toLowerCase();
  if (!s) return '—';
  if (s.startsWith('m')) return 'M';
  if (s.startsWith('f')) return 'F';
  if (s.startsWith('o')) return 'O';
  return s.charAt(0).toUpperCase();
}

/** The band's quiet meta line: "22/M · AA0006 · +91 98765 43210". */
export function patientMetaLine(p: Patient | null | undefined, now = new Date()): string {
  if (!p) return '';
  const parts = [`${formatAge(p, 'num', '—', now)}/${sexInitial(p.sex)}`, p.mrn?.trim() || '—'];
  if (p.phone?.trim()) parts.push(p.phone.trim());
  return parts.join(' · ');
}

/** "37 years · Male" for the summary card. */
export function ageSexLong(p: Patient | null | undefined, now = new Date()): string {
  if (!p) return '—';
  const age = formatAge(p, 'long', '', now);
  const sex = (p.sex || '').trim();
  const sexLabel = sex ? sex.charAt(0).toUpperCase() + sex.slice(1).toLowerCase() : '';
  return [age, sexLabel].filter(Boolean).join(' · ') || '—';
}

/** Official 2-4-4-4 grouping of a 14-digit ABHA number. */
export function formatAbha(id: string | null | undefined): string {
  const d = (id || '').replace(/\D/g, '');
  return d.length === 14 ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10, 14)}` : (id || '');
}

export interface PatientFlag { key: string; label: string; tone: 'amber' | 'red' | 'neutral'; title: string; }

/** The patient's key flags for the pill — only facts the record really has. */
export function patientFlags(p: Patient | null | undefined, orders: Order[] = [], now = new Date()): PatientFlag[] {
  if (!p) return [];
  const out: PatientFlag[] = [];
  if (p.hasKnownAllergies) out.push({ key: 'allergy', label: 'Known allergies', tone: 'red', title: 'Recorded at registration' });
  if (p.isMinor) out.push({ key: 'minor', label: 'Minor', tone: 'amber', title: 'Guardian required' });
  const unpaid = orders.filter(o => o.billStatus === 'unpaid' && o.status !== 'cancelled').length;
  if (unpaid) out.push({ key: 'due', label: 'Payment due', tone: 'red', title: `${unpaid} order${unpaid === 1 ? '' : 's'} with a balance` });
  const yrs = ageYears(p, now);
  if (yrs != null && yrs > 60) out.push({ key: 'fall', label: 'Fall risk', tone: 'amber', title: 'Moderate fall risk (over 60)' });
  return out;
}

const ORDER_STATUS: Record<string, string> = {
  created: 'Created', billed: 'Billed', sample_collected: 'Collected', collected: 'Collected',
  dispatched: 'Dispatched', in_transit: 'Arrived at lab', received_in_lab: 'In lab', received: 'In lab',
  processing: 'Processing', in_progress: 'In progress', resulted: 'Resulted', validated: 'Validated',
  partially_validated: 'Partly ready', delivered: 'Delivered', rejected: 'Rejected',
  partially_rejected: 'Partly rejected', cancelled: 'Cancelled', completed: 'Completed',
};

/** Sentence-case status word for an order row. */
export function orderStatusLabel(status: string | null | undefined): string {
  const s = (status || '').trim();
  if (!s) return '—';
  return ORDER_STATUS[s] ?? (s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '));
}

/** Row tone in the Frontdesk rows' language (done green · dispatched blue ·
 *  in progress amber · cancelled / rejected red). */
export function orderTone(status: string | null | undefined): WorkRowTone {
  const s = status || '';
  if (s === 'resulted' || s === 'partially_validated') return 'amber';
  if (s === 'partially_rejected') return 'red';
  return workRowTone(s, orderStatusLabel(s));
}

/** Line status words — the one home (shared/utils/line-status). */
export function testStatusLabel(status: string | null | undefined): string {
  return lineStatusLabel(status);
}
export function testTone(status: string | null | undefined): WorkRowTone {
  switch (status) {
    case 'validated': case 'completed': case 'reported': return 'green';
    case 'rejected': case 'cancelled': return 'red';
    case NOT_REPORTED: return 'violet';
    default: return 'amber';
  }
}

export function orderTests(o: Order): OrderTest[] {
  return (o.samples ?? []).flatMap(s => s.tests ?? []);
}

/** The row's primary line: the tests, by name (at most four, then "+N more"). */
export function orderTitle(o: Order): string {
  const names = orderTests(o).map(t => (t.profileName || t.name || '').trim()).filter(Boolean);
  const uniq = [...new Set(names)];
  if (!uniq.length) return 'Lab order';
  return uniq.length > 4 ? `${uniq.slice(0, 4).join(', ')} +${uniq.length - 4} more` : uniq.join(', ');
}

/** Orders filtered by the card search (test / order number / doctor) and the
 *  date range, newest first. */
export function filterOrders(orders: Order[], q: string, from: string, to: string): Order[] {
  const term = q.trim().toLowerCase();
  return (orders ?? []).filter(o => {
    const d = (o.createdAt || '').slice(0, 10);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (term) {
      const hay = [
        ...orderTests(o).map(t => `${t.name || ''} ${t.profileName || ''} ${t.test?.code || ''}`),
        o.orderNumber || '', o.refDoctorName || '',
      ].join(' ').toLowerCase();
      if (!hay.includes(term)) return false;
    }
    return true;
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/** yyyy-mm-dd for `days` ago (local). */
export function isoDaysAgo(days: number, now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
