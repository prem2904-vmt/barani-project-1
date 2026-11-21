import type { FlowRow } from '../../frontdesk/frontdesk-landing/flow-grid/flow-row';
import type { FlowGridContext } from '../../frontdesk/frontdesk-landing/flow-grid/flow-cells';
import type { Order } from '../../../shared/models/order.model';
import type { OpdVisitRow } from '../../opd/frontdesk/desk.models';
import { ringSteps, type RingStep } from '../../../shared/components/journey-ring/journey-ring';
import type { FdModule } from '../../../shared/utils/fd-grid-columns';

/**
 * Sample rows for the Work grid columns PREVIEW (fake data only — never a real patient). They are real FlowRows, so
 * the preview draws them with the Frontdesk's own column definitions and cell renderers (flow-grid), not a copy.
 */

const MIN = 60000;
const iso = (minsAgo: number, now: number) => new Date(now - minsAgo * MIN).toISOString();

interface Sample {
  name: string; meta: string; token: string; where: string; whereSub: string; tone: FlowRow['tone'];
  ring: RingStep[]; wait: number; pay: string; payDue: boolean; next: string; urgent?: boolean;
  tubes?: string[]; doctor?: string; dept?: string; vitals?: string; followUp?: boolean; status?: string; refDoctor?: string;
  collectionType?: string; source?: string;
}

const LAB_STEPS = ['Billing', 'Sample', 'Dispatch', 'Result', 'Report'];
const OPD_STEPS = ['Check-in', 'Vitals', 'Consult', 'Billing'];
const IPD_STEPS = ['Admitted', 'Care', 'Discharge'];
const ER_STEPS = ['Triage', 'Doctor', 'Observation'];
const SCAN_STEPS = ['Billing', 'Scan', 'Report'];

const SAMPLES: Record<FdModule, Sample[]> = {
  lab: [
    { name: 'Nithin Ragav Gopalakrishnan', meta: '32/M · AA0004', token: '1', where: 'In the lab', whereSub: 'Waiting for validation', tone: 'rose',
      ring: ringSteps(LAB_STEPS, 2, { late: true }), wait: 41, pay: '₹450 due', payDue: true, next: 'Bill', urgent: true, tubes: ['pending', 'pending'],
      refDoctor: 'Dr. Menon', collectionType: 'walkin', source: 'walkin' },
    { name: 'Ms. Arya Stark', meta: '30/F · AA0002', token: '2', where: 'Sample collected', whereSub: 'Next: send to lab', tone: 'violet',
      ring: ringSteps(LAB_STEPS, 1), wait: 12, pay: 'Paid', payDue: false, next: 'Collect', tubes: ['collected'], source: 'appointment', collectionType: 'walkin' },
    { name: 'Mr. Sathish Kumar', meta: '41/M · AA0003', token: '3', where: 'Billed', whereSub: '0 of 2 tubes collected', tone: 'violet',
      ring: ringSteps(LAB_STEPS, 1), wait: 22, pay: 'Paid', payDue: false, next: 'Dispatch', tubes: ['collected', 'collected'],
      refDoctor: 'Dr. Rao', collectionType: 'home_collection', source: 'walkin' },
  ],
  opd: [
    { name: 'Nithin Ragav Gopalakrishnan', meta: '32/M · AA0004', token: 'R-1', where: 'Waiting for doctor', whereSub: 'Dr. Rao · 3 ahead', tone: 'rose',
      ring: ringSteps(OPD_STEPS, 2, { late: true }), wait: 41, pay: '₹450 due', payDue: true, next: 'Open', doctor: 'Dr. Rao', dept: 'General medicine',
      vitals: 'BP 120/80', status: 'waiting' },
    { name: 'Ms. Arya Stark', meta: '30/F · AA0002', token: 'M-2', where: 'With doctor', whereSub: 'Dr. Menon', tone: 'violet',
      ring: ringSteps(OPD_STEPS, 2), wait: 12, pay: 'Paid', payDue: false, next: 'Open', doctor: 'Dr. Menon', dept: 'Diabetology', followUp: true, status: 'in_consult',
      vitals: 'BP 130/85' },
    { name: 'Mr. Sathish Kumar', meta: '41/M · AA0003', token: 'R-3', where: 'Vitals', whereSub: 'Nurse Priya', tone: 'violet',
      ring: ringSteps(OPD_STEPS, 1), wait: 22, pay: 'Paid', payDue: false, next: 'Open', doctor: 'Dr. Rao', dept: 'General medicine', status: 'vitals' },
  ],
  ipd: [
    { name: 'Nithin Ragav Gopalakrishnan', meta: '32/M · AA0004', token: 'A-1', where: 'Bed allocation', whereSub: 'Ward B', tone: 'violet',
      ring: ringSteps(IPD_STEPS, 0), wait: 41, pay: '₹4,500 due', payDue: true, next: 'Open', refDoctor: 'Dr. Rao' },
    { name: 'Ms. Arya Stark', meta: '30/F · AA0002', token: 'A-2', where: 'Admitted', whereSub: 'Rounds at 4 PM', tone: 'violet',
      ring: ringSteps(IPD_STEPS, 1), wait: 12, pay: 'Paid', payDue: false, next: 'Open', refDoctor: 'Dr. Menon' },
    { name: 'Mr. Sathish Kumar', meta: '41/M · AA0003', token: 'A-3', where: 'Discharge planned', whereSub: 'Bill pending', tone: 'rose',
      ring: ringSteps(IPD_STEPS, 2, { late: true }), wait: 22, pay: '₹1,200 due', payDue: true, next: 'Bill', refDoctor: 'Dr. Rao' },
  ],
  er: [
    { name: 'Unknown male', meta: '~40/M · ER0007', token: 'E-1', where: 'Triage', whereSub: 'Urgent', tone: 'rose',
      ring: ringSteps(ER_STEPS, 0, { late: true }), wait: 18, pay: 'Not billed', payDue: false, next: 'Open', urgent: true, refDoctor: 'Dr. Sam' },
    { name: 'Ms. Arya Stark', meta: '30/F · AA0002', token: 'E-2', where: 'With doctor', whereSub: 'Dr. Sam', tone: 'violet',
      ring: ringSteps(ER_STEPS, 1), wait: 12, pay: 'Paid', payDue: false, next: 'Open', refDoctor: 'Dr. Sam' },
    { name: 'Mr. Sathish Kumar', meta: '41/M · AA0003', token: 'E-3', where: 'Observation', whereSub: 'Bay 3', tone: 'violet',
      ring: ringSteps(ER_STEPS, 2), wait: 22, pay: 'Paid', payDue: false, next: 'Open', refDoctor: 'Dr. Sam' },
  ],
  scan: [
    { name: 'Nithin Ragav Gopalakrishnan', meta: '32/M · AA0004', token: '1', where: 'Scanning', whereSub: 'Room 6', tone: 'violet',
      ring: ringSteps(SCAN_STEPS, 1), wait: 41, pay: 'Paid', payDue: false, next: 'Open' },
    { name: 'Ms. Arya Stark', meta: '30/F · AA0002', token: '2', where: 'Waiting', whereSub: 'Fasting since 7 AM', tone: 'neutral',
      ring: ringSteps(SCAN_STEPS, 1), wait: 12, pay: '₹900 due', payDue: true, next: 'Bill' },
    { name: 'Mr. Sathish Kumar', meta: '41/M · AA0003', token: '3', where: 'Report ready', whereSub: 'Not shared yet', tone: 'green',
      ring: ringSteps(SCAN_STEPS, -1), wait: 22, pay: 'Paid', payDue: false, next: 'Share' },
  ],
};

function waitText(m: number): string { return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }

/** Three sample rows for a module (now = the preview's clock). */
export function previewRows(module: FdModule, now = Date.now()): FlowRow[] {
  return SAMPLES[module].map((s, i) => {
    const id = `preview-${module}-${i + 1}`;
    const created = iso(s.wait + 20, now);
    const isVisit = module === 'opd';
    const order = isVisit ? null : ({
      id, orderNumber: `${module.toUpperCase()}-2611-00${26 + i}`, dailyNo: i + 1, dailyNoDay: created.slice(0, 10), module, patientId: `pp${i}`,
      branchId: 'preview-branch', refDoctorName: s.refDoctor, priority: s.urgent ? 'Urgent' : 'Normal', source: s.source ?? 'walkin',
      collectionType: s.collectionType ?? 'walkin', status: 'billed', createdAt: created,
      samples: (s.tubes ?? []).map((st, k) => ({ id: `${id}-s${k}`, orderId: id, departmentId: 'd', status: st, rejectionCount: 0, createdAt: created })),
    } as unknown as Order);
    const visit = isVisit ? ({
      id, patientId: `pv${i}`, patientName: s.name, patientMeta: s.meta, doctorUserId: s.doctor === 'Dr. Menon' ? 'dm' : 'dr', doctorName: s.doctor ?? '',
      departmentName: s.dept, visitNumber: `OPD-00${41 + i}`, visitDate: created.slice(0, 10), token: i + 1, tokenLabel: s.token,
      status: (s.status ?? 'waiting') as OpdVisitRow['status'], isFollowUp: !!s.followUp, charged: 500, billStatus: s.payDue ? 'pending' : 'paid',
      hasLabOrder: false, createdAt: created, checkedInAt: iso(s.wait, now), vitalsSummary: s.vitals ?? null, vitalsFlagged: false,
    } as OpdVisitRow) : null;
    return {
      id, kind: isVisit ? 'visit' : 'order', order, draft: null, merged: null, visit, status: 'ip', service: module, urgent: !!s.urgent,
      name: s.name, meta: s.meta, tags: [], where: s.where, whereSub: s.whereSub, tone: s.tone, journey: [], journeyLabel: s.where, ring: s.ring,
      waitMin: s.wait, wait: waitText(s.wait), late: s.wait >= 30, pay: s.pay, payDue: s.payDue, due: s.payDue ? 450 : 0,
      createdMs: Date.parse(created), dailyNo: isVisit ? null : i + 1, dailyNoDay: isVisit ? null : created.slice(0, 10),
      next: { id: 'open', label: s.next, aria: `${s.next} ${s.name}` }, more: [], tubes: [],
    } satisfies FlowRow;
  });
}

/** A preview grid does nothing when a sample row or its button is pressed. */
export function previewContext(extra: Partial<FlowGridContext> = {}): FlowGridContext {
  return {
    act: () => undefined, open: () => undefined, busy: () => false, selectable: () => false, selected: () => false, toggle: () => undefined,
    ringLabels: () => false, ...extra,
  };
}
