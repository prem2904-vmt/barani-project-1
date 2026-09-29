/**
 * The critical-result acknowledgement record (NABL) — one row per critical
 * result VERSION, written by the backend with the result save
 * (`critical_result_events`, GET/POST /api/critical-results). The bell row is
 * only the alert; THIS is the record of who acknowledged and who was told.
 */
export type CriticalResultStatus = 'open' | 'acknowledged' | 'communicated';

/** Where an acknowledgement was made from (sent with the POST). */
export type CriticalAckVia = 'bell' | 'result_entry' | 'validate' | 'pathologist_queue' | 'register';

export type CriticalCommunicationMethod = 'phone' | 'in_person' | 'whatsapp' | 'other';

export interface CriticalValueLine {
  parameter: string;
  value?: string | null;
  unit?: string | null;
  flag: string;
  range?: string | null;
}

export interface CriticalAckEntry {
  userId: string;
  name: string;
  at: string;
  via: string;
}

export interface CriticalResultEvent {
  id: string;
  status: CriticalResultStatus;
  source: 'live' | 'legacy_notification_read' | string;
  orderTestId: string;
  orderId: string;
  orderNumber?: string | null;
  sampleBarcode?: string | null;
  resultVersion: number;
  patientId: string;
  patientName: string;
  patientMrn?: string | null;
  testId: string;
  testName: string;
  testCode?: string | null;
  /** "K 7.1 mmol/L CH, Hb 3.2 g/dL CL" */
  summary: string;
  values: CriticalValueLine[];
  branchId?: string | null;
  branchName?: string | null;
  detectedAt: string;
  detectedByName?: string | null;
  alertedAt?: string | null;
  alertedCount: number;
  acknowledgedBy?: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedVia?: string | null;
  acknowledgements: CriticalAckEntry[];
  communicationMethod?: string | null;
  communicatedToName?: string | null;
  communicatedToRole?: string | null;
  communicatedAt?: string | null;
  communicatedByName?: string | null;
  communicationNotes?: string | null;
}

export interface CriticalRegisterPage {
  items: CriticalResultEvent[];
  total: number;
  page: number;
  pageSize: number;
  openCount: number;
}

export interface CriticalRegisterFilter {
  status?: CriticalResultStatus | 'all';
  /** IST business days, yyyy-mm-dd inclusive. */
  from?: string | null;
  to?: string | null;
  branchId?: string | null;
  page?: number;
  pageSize?: number;
}

export interface RecordCommunicationInput {
  method: CriticalCommunicationMethod;
  toName: string;
  toRole?: string | null;
  /** ISO instant; omitted = now. */
  at?: string | null;
  notes?: string | null;
}

export const CRITICAL_METHOD_OPTIONS: ReadonlyArray<{ value: CriticalCommunicationMethod; label: string }> = [
  { value: 'phone', label: 'Phone call' },
  { value: 'in_person', label: 'In person' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'other', label: 'Other' },
];

export const CRITICAL_ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'referring_doctor', label: 'Referring doctor' },
  { value: 'patient', label: 'Patient' },
  { value: 'guardian', label: 'Guardian / relative' },
  { value: 'ward_nurse', label: 'Ward nurse' },
  { value: 'other', label: 'Other' },
];

const METHOD_LABEL: Record<string, string> = Object.fromEntries(CRITICAL_METHOD_OPTIONS.map(o => [o.value, o.label]));
const ROLE_LABEL: Record<string, string> = Object.fromEntries(CRITICAL_ROLE_OPTIONS.map(o => [o.value, o.label]));
const VIA_LABEL: Record<string, string> = {
  bell: 'from the bell', result_entry: 'at result entry', validate: 'while validating',
  pathologist_queue: 'from the pathologist queue', register: 'from the register', legacy: 'legacy (bell read)',
};

export function criticalMethodLabel(v?: string | null): string { return v ? (METHOD_LABEL[v] ?? v.replace(/_/g, ' ')) : ''; }
export function criticalRoleLabel(v?: string | null): string { return v ? (ROLE_LABEL[v] ?? v.replace(/_/g, ' ')) : ''; }
export function criticalViaLabel(v?: string | null): string { return v ? (VIA_LABEL[v] ?? v.replace(/_/g, ' ')) : ''; }

/** ONE status word per row (ND §6: dot + coloured word). */
export function criticalStatusWord(s: CriticalResultStatus | string): { label: string; tone: 'red' | 'amber' | 'green' } {
  switch (s) {
    case 'communicated': return { label: 'Communicated', tone: 'green' };
    case 'acknowledged': return { label: 'Acknowledged', tone: 'amber' };
    default: return { label: 'Not acknowledged', tone: 'red' };
  }
}

/** True when this user has not yet acknowledged the record. */
export function needsAckBy(e: CriticalResultEvent, userId: string | null | undefined): boolean {
  if (!userId) return e.status === 'open';
  return !(e.acknowledgements ?? []).some(a => a.userId === userId);
}
