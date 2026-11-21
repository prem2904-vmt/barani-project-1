import type { OpdVisitRow, PaymentDue } from '../../opd/frontdesk/desk.models';
import { statusWord } from '../../opd/frontdesk/visit-status';
import { opdVisitRingSteps } from '../../../shared/components/journey-ring/journey-ring';
import { CurrencyInrPipe } from '../../../shared/pipes/currency-inr.pipe';
import { durationText } from '../../../shared/utils/work-grid';
import type { WorkStatus } from './work-status-filter';
import { LATE_AFTER_MIN, type FlowRow, type FlowTone } from './flow-grid/flow-row';

/**
 * OPD visits in the COMMON Frontdesk (owner 2026-11-20: "an OPD order should land in this front desk"). When OPD is
 * on for the user (the Services shelf's own rule: OPD gate + desk permission), the landing loads the OPD desk's
 * existing feeds — GET /api/opd/visits (today's visits) and /api/opd/visits/payments-due — and maps each visit to a
 * flow-grid row here: token, patient, the OPD journey ring, Where now, Waiting, Payment, and ONE Next that opens the
 * existing visit screen (/opd/visit/:id — status moves, billing, consult links all live there). No new data.
 */
const inr = new CurrencyInrPipe();
const OPEN = new Set(['booked', 'vitals', 'waiting', 'in_consult']);

export const opdVisitOpen = (v: Pick<OpdVisitRow, 'status'>): boolean => OPEN.has(v.status);

/** Balance still to collect per visit (payments-due feed). */
export function opdDueByVisit(dues: readonly PaymentDue[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const d of dues) m.set(d.visitId, (m.get(d.visitId) ?? 0) + (d.balance ?? 0));
  return m;
}

/** Which work status a visit sits under: open → In progress; finished with a balance → Payments due; else Completed. */
export function opdVisitStatus(v: Pick<OpdVisitRow, 'status'>, due: number): WorkStatus {
  if (opdVisitOpen(v)) return 'ip';
  return due > 0 ? 'billing' : 'done';
}

const toneOf = (s: string): FlowTone =>
  s === 'completed' ? 'green' : s === 'cancelled' || s === 'no_show' ? 'rose' : s === 'booked' ? 'neutral' : 'violet';

export function opdVisitFlowRow(v: OpdVisitRow, now: number, opts: { due?: number; vitals?: boolean } = {}): FlowRow {
  const due = opts.due ?? 0;
  const open = opdVisitOpen(v);
  const since = Date.parse(v.checkedInAt ?? v.createdAt) || Date.parse(v.createdAt) || now;
  const waitMin = open ? Math.max(0, Math.round((now - since) / 60000)) : null;
  const late = waitMin !== null && waitMin >= LATE_AFTER_MIN;
  const status = opdVisitStatus(v, due);
  const pay = due > 0 ? `${inr.transform(due)} due`
    : v.billStatus === 'paid' ? 'Paid'
    : v.billStatus ? (v.billStatus === 'pending' || v.billStatus === 'partial' ? 'Unpaid' : v.billStatus)
    : v.charged > 0 ? 'Paid' : 'Not billed';
  const label = due > 0 ? 'Collect' : 'Open';
  const next = { id: 'opd-open' as const, label, aria: `${label} OPD visit ${v.tokenLabel}` };
  return {
    id: `opd:${v.id}`, kind: 'visit', order: null, draft: null, merged: null, visit: v,
    status, service: 'opd', urgent: false,
    name: v.patientName, meta: v.patientMeta ?? '', tags: ['OPD'],
    where: statusWord(v.status), whereSub: [v.doctorName, v.departmentName].filter(Boolean).join(' · '),
    tone: toneOf(v.status), journey: [], journeyLabel: '',
    ring: opdVisitRingSteps(v.status, { late, vitals: opts.vitals }),
    waitMin, wait: waitMin === null ? '—' : waitMin < 1 ? 'Just now' : durationText(waitMin),
    late,
    pay, payDue: due > 0 || v.billStatus === 'pending' || v.billStatus === 'partial', due,
    createdMs: Date.parse(v.createdAt) || 0, dailyNo: null, dailyNoDay: null,
    next, more: [], tubes: [],
  };
}

/** The head search over a visit (name, meta / MRN, token, visit number). */
export function opdVisitMatches(v: Pick<OpdVisitRow, 'patientName' | 'patientMeta' | 'tokenLabel' | 'visitNumber'>, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return v.patientName.toLowerCase().includes(s) || (v.patientMeta ?? '').toLowerCase().includes(s)
    || v.tokenLabel.toLowerCase() === s || (v.visitNumber ?? '').toLowerCase().includes(s);
}
