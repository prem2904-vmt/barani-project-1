/**
 * OPD + Pharmacy shared contracts (OPD dark build foundation). The TS mirror
 * of prefrontal-mw Models/Opd/* and the JSON columns' shapes. Feature agents
 * import from here; a change here is a CONTRACT change — coordinate through the
 * integrator (and change the C# side in the same PR).
 */
import type { RxSchedule, DrugForm } from './rx-schedule';
import type { OpdFormDoc } from '../admin/forms/form-schema';

// DrugForm is a SHARED wire vocabulary — the ONE definition is rx-schedule.ts
// FORMS (mirrored server-side by RxScheduleMath.AllForms); re-exported here
// so every OPD/pharmacy contract importing from opd.models.ts stays in sync.
export type { DrugForm };

// Form schema v2 (Agent A) is THE consult-form contract — it superseded the
// foundation's v1 OpdFormSchema / OpdFormField (integrator). Types + pure
// helpers live in admin/forms/form-schema.ts; the renderer reads v1 too.
export type {
  OpdFormDoc, OpdFormDocSection, OpdQuestion, OpdQType, OpdAnswers, OpdMediaRef,
} from '../admin/forms/form-schema';

// ── Vocabularies (mirror Models/Opd/OpdConstants.cs) ─────────────────────
export type OpdVisitStatus = 'booked' | 'vitals' | 'waiting' | 'in_consult' | 'completed' | 'cancelled' | 'no_show';
export const OPD_OPEN_STATUSES: readonly OpdVisitStatus[] = ['booked', 'vitals', 'waiting', 'in_consult'];
/** Mirror of OpdVisitStatus.CanMove (C#). */
export function canMoveVisit(from: OpdVisitStatus, to: OpdVisitStatus): boolean {
  const fwd: Record<string, OpdVisitStatus[]> = {
    booked: ['vitals', 'waiting', 'cancelled', 'no_show'],
    vitals: ['waiting', 'cancelled', 'no_show'],
    waiting: ['in_consult', 'cancelled', 'no_show'],
    in_consult: ['completed', 'waiting'],
  };
  return (fwd[from] ?? []).includes(to);
}
export type OpdServiceCategory = 'consultation' | 'procedure';
export type OpdPriceMode = 'common' | 'per_doctor';
export type OpdVisitSource = 'walk_in' | 'appointment' | 'follow_up';
export type OpdNoteVisibility = 'doctor' | 'department' | 'all_doctors';
export type OpdBillKind = 'consult' | 'pharmacy';
export type OpdBillStatus = 'draft' | 'pending' | 'partial' | 'paid' | 'cancelled';
export type PharmacyDispenseKind = 'rx' | 'walk_in';
export type DrugSchedule = 'none' | 'G' | 'H' | 'H1' | 'X';

// ── Admin masters (Agent A) ──────────────────────────────────────────────
export interface OpdDepartment { id: string; name: string; code: string; defaultFormId?: string | null; sortOrder: number; isActive: boolean; }
export interface OpdService {
  id: string; departmentId: string; name: string; code: string;
  category: OpdServiceCategory; priceMode: OpdPriceMode; commonPrice: number;
  taxSlab: number; hsnSacCode?: string | null;
  followUpWithinDays?: number | null; followUpFee?: number | null;
  /** Integrator: % off the new-visit price as the follow-up fee (window set, no fee). */
  followUpPercent?: number | null;
  formId?: string | null; durationMinutes?: number | null; sortOrder: number; isActive: boolean;
}
export interface OpdServiceDoctorPrice { id: string; serviceId: string; doctorUserId: string; price: number; followUpFee?: number | null; isActive: boolean; }

export interface OpdFormDefinition { id: string; name: string; code: string; description?: string | null; currentVersionId?: string | null; isActive: boolean; }
/** A form version (opd_form_versions.SchemaJson = schema v2). Built-in consult
 *  sections (vitals, diagnosis, Rx, investigations, follow-up) are NEVER questions. */
export interface OpdFormVersion { id: string; formId: string; version: number; status: 'draft' | 'published'; schema: OpdFormDoc; publishedAt?: string | null; }

/** opd_settings.WorkflowJson — which steps run and where (owner: configurable
 *  like the lab Process Builder; every step opt-in/out per lab). */
export interface OpdWorkflowConfig {
  /** Where vitals are captured. */
  vitals: 'desk' | 'station' | 'off';
  /** Lab tests may be added at the desk (become a normal lab order). */
  labTestsAtDesk: boolean;
  /** When the consult fee is collected. */
  billing: 'before_consult' | 'after_consult';
  /** What the consult pre-fills from the desk (purpose → chief complaint, …). */
  prefill: { purposeToComplaint: boolean; vitalsToHeader: boolean };
  /** Who reads a doctor's private notes by default (the consult can narrow it per record). */
  privateNotesVisibility: OpdNoteVisibility;
  /** Who takes vitals (Agent A). */
  vitalsBy?: 'nurse' | 'front_desk';
  /** Prescriptions go to the in-house pharmacy (Agent A). */
  pharmacy?: { enabled: boolean };
  /** Internal run marker of the starter set (Agent A) — never edited. */
  starterSeededAt?: string | null;
}
export const DEFAULT_OPD_WORKFLOW: OpdWorkflowConfig = {
  vitals: 'desk', labTestsAtDesk: true, billing: 'before_consult',
  prefill: { purposeToComplaint: true, vitalsToHeader: true },
  privateNotesVisibility: 'doctor', vitalsBy: 'nurse', pharmacy: { enabled: true },
};

/** opd_settings.QueueJson — token / queue organisation. */
export interface OpdQueueConfig {
  /** per_room counts like per_doctor (each doctor sits in a room). */
  organise: 'per_doctor' | 'per_room' | 'per_department';
  tokenPrefix?: string;
  /** Show the token board on the waiting-room screen (Agent A). */
  showOnScreen?: boolean;
  /** Per doctor: room, own token prefix (wins over tokenPrefix), availability days (Agent A). */
  doctors?: Record<string, { room?: string | null; tokenPrefix?: string | null; days?: string[] }>;
  /** Doctor unavailable: move patients manually, auto-move to another doctor of
   *  the department, or reschedule. */
  doctorUnavailable: 'manual' | 'auto_move' | 'reschedule';
}
export const DEFAULT_OPD_QUEUE: OpdQueueConfig = { organise: 'per_doctor', doctorUnavailable: 'manual' };

/** opd_settings.PharmacyJson. */
export interface PharmacyConfig {
  batchPick: 'earliest_expiry' | 'pharmacist';
  walkInBillEditable: boolean;
  enforceSchedules: boolean;
}
export const DEFAULT_PHARMACY_CONFIG: PharmacyConfig = { batchPick: 'earliest_expiry', walkInBillEditable: true, enforceSchedules: true };

// ── Front desk / vitals / queue / billing (Agent B) ──────────────────────
export interface OpdVisit {
  id: string; patientId: string; doctorUserId: string; departmentId?: string | null; serviceId?: string | null;
  visitNumber?: string | null; visitDate: string; token: number; status: OpdVisitStatus; purpose?: string | null;
  source?: OpdVisitSource; isFollowUp?: boolean; followUpOfVisitId?: string | null;
  quotedFee: number; feeOverride?: number | null; feeOverrideReason?: string | null;
  billId?: string | null; labOrderId?: string | null;
}
export interface OpdVitals {
  id?: string; visitId: string; bpSys?: number | null; bpDia?: number | null; pulse?: number | null; spo2?: number | null;
  tempF?: number | null; respRate?: number | null; weightKg?: number | null; heightCm?: number | null;
  grbs?: number | null; painScore?: number | null; extra?: Record<string, unknown>; recordedAt?: string;
}
export interface OpdBillLine { sourceType: 'service' | 'drug' | 'misc'; sourceId?: string | null; description: string; qty: number; unitPrice: number; discount: number; taxSlab: number; total?: number; }
/** A credit note (opd_refunds) — money given back; the bill itself never changes. */
export type OpdRefundKind = 'visit_cancel' | 'pharmacy_return';
export interface OpdRefund {
  id: string; billId: string; kind: OpdRefundKind; sourceId?: string | null; creditNoteNumber: string;
  amount: number; mode: string; reference?: string | null; reason?: string | null; createdAt: string;
}
export interface OpdBill { id: string; kind: OpdBillKind; invoiceNumber?: string | null; lines: OpdBillLine[]; discount: number; totalPayable: number; totalPaid: number; balance: number; status: OpdBillStatus; }

// ── Consult (Agent C) ────────────────────────────────────────────────────
export interface OpdDiagnosis { code?: string; label: string; primary?: boolean; }
export interface OpdConsultRecord {
  id: string; visitId: string; patientId: string; doctorUserId: string; formVersionId?: string | null;
  answers?: Record<string, unknown>; chiefComplaint?: string | null; diagnoses: OpdDiagnosis[]; advice?: string | null;
  privateNotes?: string | null; privateNotesVisibility: OpdNoteVisibility;
  followUpDate?: string | null; followUpNote?: string | null; status: 'draft' | 'completed';
}
/** One Rx line on the wire — `schedule` is the shared model (./rx-schedule.ts);
 *  `quantity` is computed by the SERVER (RxScheduleMath.Quantity). */
export interface OpdRxLineDto {
  id?: string; drugId?: string | null; drugName: string; form: DrugForm; dose: number; site?: string | null;
  schedule: RxSchedule; durationDays: number; food?: 'Before' | 'After' | null;
  quantity?: number; allergyAck?: boolean; allergyAckNote?: string | null; notes?: string | null;
  dispenseStatus?: 'pending' | 'partial' | 'dispensed' | 'not_dispensed';
  /** Pregnancy-safety guard (night/safety, critic P0 #1c) — mirrors allergyAck/allergyAckNote. */
  pregnancyAck?: boolean; pregnancyAckNote?: string | null;
}
export interface OpdInvestigation { id?: string; items: { testId: string; name: string }[]; labOrderId?: string | null; status: 'draft' | 'ordered' | 'cancelled'; }
export interface OpdPatientAllergy { id?: string; patientId: string; allergen: string; drugId?: string | null; generic?: string | null; reaction?: string | null; severity?: 'mild' | 'moderate' | 'severe' | null; status: 'active' | 'inactive'; }

/** Pregnancy-safety guard (night/safety, critic P0 #1b) — the resolved status
 *  the server computes (Services/Opd/Consult/PregnancyStatus.cs). `source` is
 *  a short human label ("form answer", "diagnosis O80", "today's consult"…). */
export interface OpdPregnancy { status: 'pregnant' | 'lactating'; source?: string | null; since?: string | null; }

// ── Pharmacy (Agent D) ───────────────────────────────────────────────────
export interface PharmacyDrug {
  id: string; catalogKey: string; name: string; generic?: string | null; strength?: string | null; form: DrugForm;
  unit?: string | null; packSize?: number | null; manufacturer?: string | null; schedule: DrugSchedule;
  hsnCode?: string | null; taxSlab: number; defaultMrp?: number | null; isMaster: boolean; isActive: boolean;
  /** Topical / local site kind (eye, ear, nose, skin …) — integrator. */
  siteKind?: string | null;
  /** The usual prescription (doctor favourites): { dose, schedule, durationDays, food } — integrator. */
  usual?: Record<string, unknown> | null;
  /** Pregnancy-safety guard (night/safety, critic P0 #1a). */
  pregnancyRisk?: 'safe' | 'caution' | 'avoid' | 'contraindicated' | null; pregnancyNote?: string | null;
}
export interface PharmacyBatch { id: string; drugId: string; batchNo: string; expiryDate: string; mrp: number; purchasePrice: number; qtyOnHand: number; }
