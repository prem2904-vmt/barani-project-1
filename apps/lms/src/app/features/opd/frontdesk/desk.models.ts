/**
 * OPD front desk / vitals / queue wire shapes (Agent B) — the TS mirror of
 * prefrontal-mw Services/Opd/Frontdesk/OpdDeskDtos.cs. Consult (C) and
 * pharmacy (D) read `OpdVisitDetail` and `OpdVitalsRow`; change both sides
 * together.
 */
import type { OpdRefund, OpdVisitStatus } from '../shared/opd.models';

export interface DeskWorkflow { vitals: 'desk' | 'station' | 'off'; labTestsAtDesk: boolean; billing: 'before_consult' | 'after_consult'; }
export interface DeskQueueCfg { organise: 'per_doctor' | 'per_room' | 'per_department'; tokenPrefix?: string | null; doctorUnavailable: 'manual' | 'auto_move' | 'reschedule'; }

export interface DeskDoctor {
  id: string; name: string; department?: string | null; departmentIds: string[];
  waiting: number; estWaitMinutes: number; fee?: number | null; tokenPrefix: string; nowServing?: string | null;
}
export interface DeskDepartment { id: string; name: string; code: string; waiting: number; doctorIds: string[]; }
export interface DeskData { today: string; config: { workflow: DeskWorkflow; queue: DeskQueueCfg }; doctors: DeskDoctor[]; departments: DeskDepartment[]; }

export interface ServiceQuote {
  serviceId: string | null; name: string; code?: string | null; category: 'consultation' | 'procedure';
  priceSource: 'common' | 'per_doctor' | 'doctor_fee'; price: number; taxSlab: number;
  isFollowUp: boolean; followUpFee?: number | null; followUpWithinDays?: number | null; quoted: number;
  /** The ONE fee resolver's rule (Admin.OpdFeeRules): new | service_follow_up | tenant_tier | assisted_ceiling. */
  rule?: 'new' | 'service_follow_up' | 'tenant_tier' | 'assisted_ceiling';
  /** Assisted tenant tier: the most the desk may take off (%). */
  maxDiscountPercent?: number | null;
  followUpOfVisitId?: string | null;
}
export interface LastVisit { visitId: string; visitDate: string; doctorName: string; departmentName?: string | null; }
export interface DeskQuote { doctorId: string; services: ServiceQuote[]; lastWithDoctor?: LastVisit | null; lastVisit?: LastVisit | null; }

export interface PaymentPart { mode: 'cash' | 'upi' | 'card' | 'other'; amount: number; reference?: string | null; }

export interface VitalsInput {
  bpSys?: number | null; bpDia?: number | null; pulse?: number | null; spo2?: number | null; tempF?: number | null;
  respRate?: number | null; weightKg?: number | null; heightCm?: number | null; grbs?: number | null; painScore?: number | null;
  note?: string | null;
}
export interface VitalFlag { key: string; level: 'high' | 'low'; label: string; }
export interface OpdVitalsRow extends VitalsInput {
  id: string; visitId: string; bmi?: number | null; bmiBand?: string | null; flags: VitalFlag[];
  recordedAt: string; recordedBy: string; recordedByName?: string | null;
}

export interface CheckoutRequest {
  patientId: string; doctorUserId?: string | null; departmentId?: string | null; serviceId?: string | null;
  purpose?: string | null; feeOverride?: number | null; feeOverrideReason?: string | null;
  labTestIds?: string[]; urgent?: boolean; vitals?: VitalsInput | null; payments?: PaymentPart[];
  /** testId → the picked specimen (choose-mode tests only) — see
   *  `features/opd/shared/opd-specimen.ts`. Missing for a choose-mode test →
   *  400 `specimen_required`, thrown before anything OPD is written. */
  labTestSpecimens?: Record<string, string> | null;
}

export interface OpdBillLineRow { sourceType: string; sourceId?: string | null; description: string; qty: number; unitPrice: number; discount: number; taxSlab: number; total: number; }
export interface OpdBillView {
  id: string; kind: string; invoiceNumber?: string | null; lines: OpdBillLineRow[]; subTotal: number; discount: number;
  taxable: number; tax: number; roundOff: number; totalPayable: number; totalPaid: number; balance: number; status: string;
  payments: { amount: number; mode: string; reference?: string | null; createdAt: string }[];
  /** Credit notes (opd_refunds) — money given back; the bill never changes. */
  refunds?: OpdRefund[] | null; refunded?: number;
}
export interface LabOrderBrief { id: string; orderNumber?: string | null; status: string; tests: number; billId?: string | null; invoiceNumber?: string | null; payable: number; paid: number; balance: number; }
export interface TimelineStep { key: string; label: string; at?: string | null; state: 'done' | 'current' | 'upcoming' | 'skipped'; }

export interface OpdVisitDetail {
  id: string; visitNumber?: string | null; visitDate: string; token: number; tokenLabel: string; status: OpdVisitStatus;
  purpose?: string | null; source: string; isFollowUp: boolean; followUpOfVisitId?: string | null;
  quotedFee: number; feeOverride?: number | null; feeOverrideReason?: string | null;
  patient: { id: string; name: string; mrn?: string | null; age?: string | null; sex?: string | null; phone?: string | null };
  doctor: { id: string; name: string; department?: string | null };
  department?: { id: string; name: string; code?: string | null } | null;
  service?: { id: string; name: string; code?: string | null } | null;
  bill?: OpdBillView | null; labOrder?: LabOrderBrief | null; latestVitals?: OpdVitalsRow | null;
  timeline: TimelineStep[]; reassignedFromDoctorUserId?: string | null; cancelReason?: string | null; createdAt: string;
}

export interface OpdVisitRow {
  id: string; patientId: string; patientName: string; patientMeta?: string | null; doctorUserId: string; doctorName: string;
  departmentId?: string | null; departmentName?: string | null; serviceName?: string | null; visitNumber?: string | null;
  visitDate: string; token: number; tokenLabel: string; status: OpdVisitStatus; purpose?: string | null; isFollowUp: boolean;
  charged: number; billStatus?: string | null; hasLabOrder: boolean; createdAt: string; checkedInAt?: string | null;
  vitalsSummary?: string | null; vitalsFlagged: boolean;
}

export interface QueueDoctor { id: string; name: string; department?: string | null; waiting: number; vitals: number; inConsult: number; done: number; nowServing?: string | null; next?: string | null; }
export interface MovedVisit { visitId: string; patientName: string; from: string; to: string; tokenLabel: string; visitDate: string; }
export interface DoctorUnavailableResult { policy: 'manual' | 'auto_move' | 'reschedule'; moved: MovedVisit[]; unmoved: OpdVisitRow[]; }
