import { AuditLog, AuditRef } from '../../../shared/models/audit.model';
import { LAB_TIME_ZONE, addDays, istDateOf } from '../../../shared/utils/lab-clock';

/**
 * AUDIT TRAIL TEXT — the ONE mapping table (owner 2026-11-19).
 *
 * Every word the Audit trail shows comes from this file: the area an entity
 * belongs to, the sentence for each entity type + action (+ the field that
 * changed), the friendly label of every field, the plain word for every stored
 * value (statuses, priorities, payment modes …) and the fields that are pure
 * plumbing (ids, timestamps, concurrency stamps) and never show.
 *
 * IDs never show: an id is printed through the server's `refs` (order number +
 * patient, sample number, test / person / role / branch name) or, when the
 * record can't be named (deleted, another branch), as a plain noun ("a sample").
 * Unknown entity types fall back to a generic but readable sentence
 * ("Admin User changed a branch (Name: Main → Main Road)").
 */

// ── Areas ("What changed" in the side card) ────────────────────────────────

export type AuditArea = 'orders' | 'samples' | 'results' | 'tm' | 'settings' | 'people' | 'other';

export interface AuditAreaDef {
  key: AuditArea;
  label: string;
  /** The dot colour — a theme token, never a hex. */
  dot: string;
}

export const AUDIT_AREAS: readonly AuditAreaDef[] = [
  { key: 'orders', label: 'Orders & billing', dot: 'var(--violet-text)' },
  { key: 'samples', label: 'Samples', dot: 'var(--sky-text)' },
  { key: 'results', label: 'Results & reports', dot: 'var(--green-text)' },
  { key: 'tm', label: 'Test Master', dot: 'var(--color-violet-400)' },
  { key: 'settings', label: 'Settings', dot: 'var(--blue-text)' },
  { key: 'people', label: 'People & access', dot: 'var(--pink-text)' },
];
export const OTHER_AREA: AuditAreaDef = { key: 'other', label: 'Other', dot: 'var(--text-tertiary)' };

export function areaDef(key: AuditArea): AuditAreaDef {
  return AUDIT_AREAS.find(a => a.key === key) ?? OTHER_AREA;
}

// ── Plain words for stored values ──────────────────────────────────────────

/** Every workflow status the lab stores, in plain words. */
export const STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: 'Draft', created: 'Registered', pending: 'Waiting', ordered: 'Ordered', booked: 'Booked',
  billed: 'Billed', sample_collected: 'Sample collected', collected: 'Sample collected',
  dispatched: 'Sent to the lab', in_transit: 'On the way to the lab', picked_up: 'Picked up',
  received: 'Received in the lab', received_in_lab: 'Received in the lab',
  in_progress: 'In progress', processing: 'In progress', entered: 'Result entered', re_entry: 'Sent back for re-entry',
  partially_validated: 'Partly validated', validated: 'Validated', rejected: 'Rejected', cancelled: 'Cancelled',
  delivered: 'Report delivered', completed: 'Completed', done: 'Done',
  paid: 'Paid', partial: 'Part paid', partially_paid: 'Part paid', unpaid: 'Not paid', refunded: 'Refunded',
  generated: 'Generated', published: 'Published', superseded: 'Replaced by a newer report', amended: 'Corrected',
  sent: 'Sent', failed: 'Failed', queued: 'Queued', merged: 'Poured into another tube', outsourced: 'Sent to a partner lab',
  missed: 'Missed', skipped: 'Skipped', open: 'Not acknowledged', acknowledged: 'Acknowledged', communicated: 'Communicated',
  active: 'Active', inactive: 'Inactive', held: 'On hold', accepted: 'Accepted', uploaded: 'Uploaded', not_reported: 'Not reported',
  checked_in: 'Checked in', waiting: 'Waiting', no_show: 'Did not come',
};

const PRIORITY_WORDS: Readonly<Record<string, string>> = { stat: 'Urgent', urgent: 'Urgent', high: 'Urgent', normal: 'Normal', routine: 'Normal' };
const MODE_WORDS: Readonly<Record<string, string>> = {
  cash: 'Cash', upi: 'UPI', card: 'Card', cheque: 'Cheque', bank: 'Bank transfer', bank_transfer: 'Bank transfer', neft: 'Bank transfer',
  wallet: 'Wallet', credit: 'On credit', online: 'Online',
};
const CHANNEL_WORDS: Readonly<Record<string, string>> = { whatsapp: 'WhatsApp', email: 'Email', sms: 'SMS', print: 'Print', portal: 'Patient link', manual: 'By hand' };
const RESULT_ACTION_WORDS: Readonly<Record<string, string>> = {
  entered: 'Entered', validated: 'Validated', rejected: 'Rejected', amended: 'Corrected', re_entry: 'Sent back for re-entry', reentered: 'Entered again',
};
const REPORT_TYPE_WORDS: Readonly<Record<string, string>> = { final: 'Final', preliminary: 'Preliminary', partial: 'Partial', amended: 'Corrected' };

// ── Fields ─────────────────────────────────────────────────────────────────

type FieldFormat = 'text' | 'money' | 'date' | 'bool' | 'ref' | 'result' | 'number';

export interface FieldRule {
  label: string;
  format?: FieldFormat;
  /** Plain words for stored values. */
  values?: Readonly<Record<string, string>>;
  /** For `ref`: the noun when the record can't be named. */
  noun?: string;
}

/** Pure plumbing: never in the friendly view (the Technical details still show them). */
export const TECHNICAL_FIELDS: ReadonlySet<string> = new Set([
  'id', 'tenantId', 'updatedAt', 'createdAt', 'rowVersion', 'xmin', 'concurrencyStamp', 'concurrencyToken', 'version',
  'searchVector', 'catalogHash', 'catalogKey', 'metadata', 'customFields', 'position', 'dailyNo', 'dailyNoDay', 'isDemo',
  'qrCode', 'qrToken', 'qrExpiresAt', 'storedPdfKey', 'storedLetterpadPdfKey', 'authId', 'authEmail', 'pinHash', 'passwordHash',
  'pinSetAt', 'passwordSetAt', 'presenceStatus', 'signatureDataUrl', 'sampleIdsJson', 'attachmentsJson', 'reportHiddenJson',
  'reportNotesJson', 'pendingProposalId', 'origin', 'catalogMode', 'mustChangePassword', 'priceIsDefault', 'module', 'source',
  'scanVerifiedAt', 'scanVerifiedBy', 'collectedAtCounter', 'collectedByCounter', 'isPreSeeded', 'kind', 'scope',
  'assignable', 'assignableToSelf', 'aadhaarToken', 'abhaVerifiedAt', 'aadhaarVerifiedAt', 'data', 'parameters', 'conditions',
  'calculation', 'derivedReferenceRange', 'derivedUnit',
]);

/** Friendly field labels + value words (shared by every entity type). */
export const FIELD_RULES: Readonly<Record<string, FieldRule>> = {
  status: { label: 'Status', values: STATUS_WORDS },
  billStatus: { label: 'Billing', values: STATUS_WORDS },
  deliveryStatus: { label: 'Delivery', values: STATUS_WORDS },
  priority: { label: 'Priority', values: PRIORITY_WORDS },
  mode: { label: 'Paid by', values: MODE_WORDS },
  deliveredVia: { label: 'Sent by', values: CHANNEL_WORDS },
  action: { label: 'Step', values: RESULT_ACTION_WORDS },
  type: { label: 'Kind', values: REPORT_TYPE_WORDS },
  // Money
  price: { label: 'Price', format: 'money' }, discount: { label: 'Discount', format: 'money' },
  amount: { label: 'Amount', format: 'money' }, netPaid: { label: 'Paid', format: 'money' },
  totalPaid: { label: 'Paid', format: 'money' }, balance: { label: 'Balance', format: 'money' },
  totalPayable: { label: 'Bill total', format: 'money' }, subTotal: { label: 'Subtotal', format: 'money' },
  totalDiscount: { label: 'Discount', format: 'money' }, overrideDiscount: { label: 'Extra discount', format: 'money' },
  totalTax: { label: 'GST', format: 'money' }, totalTaxable: { label: 'Taxable amount', format: 'money' },
  totalCgst: { label: 'CGST', format: 'money' }, totalSgst: { label: 'SGST', format: 'money' }, totalIgst: { label: 'IGST', format: 'money' },
  taxSlab: { label: 'GST rate (%)', format: 'number' },
  // Dates
  collectedAt: { label: 'Collected at', format: 'date' }, receivedAtLab: { label: 'Received at', format: 'date' },
  dispatchedAt: { label: 'Sent at', format: 'date' }, pickedUpAt: { label: 'Picked up at', format: 'date' },
  resultedAt: { label: 'Result entered at', format: 'date' }, validatedAt: { label: 'Validated at', format: 'date' },
  rejectedAt: { label: 'Rejected at', format: 'date' }, paidAt: { label: 'Paid at', format: 'date' },
  refundedAt: { label: 'Refunded at', format: 'date' }, actionedAt: { label: 'At', format: 'date' },
  assignedAt: { label: 'Given at', format: 'date' }, dateOfBirth: { label: 'Date of birth', format: 'date' },
  expiresAt: { label: 'Expires', format: 'date' }, supersededAt: { label: 'Replaced at', format: 'date' },
  acknowledgedAt: { label: 'Acknowledged at', format: 'date' }, communicatedAt: { label: 'Communicated at', format: 'date' },
  detectedAt: { label: 'Found at', format: 'date' },
  // Yes / no
  isActive: { label: 'Active', format: 'bool' }, isEnabled: { label: 'Turned on', format: 'bool' },
  isOffered: { label: 'Offered', format: 'bool' }, fastingRequired: { label: 'Fasting needed', format: 'bool' },
  paymentHold: { label: 'Payment on hold', format: 'bool' }, isMinor: { label: 'Minor', format: 'bool' },
  whatsappOptOut: { label: 'No WhatsApp', format: 'bool' }, emailOptOut: { label: 'No email', format: 'bool' },
  dobEstimated: { label: 'Age estimated', format: 'bool' }, hasKnownAllergies: { label: 'Known allergies', format: 'bool' },
  abhaVerified: { label: 'ABHA verified', format: 'bool' }, aadhaarVerified: { label: 'Aadhaar verified', format: 'bool' },
  // Results
  currentResult: { label: 'Result', format: 'result' }, result: { label: 'Result', format: 'result' },
  // Plain text
  name: { label: 'Name' }, firstName: { label: 'First name' }, fathersName: { label: 'Last name' }, title: { label: 'Title' },
  phone: { label: 'Phone' }, email: { label: 'Email' }, sex: { label: 'Sex' }, age: { label: 'Age', format: 'number' },
  bloodGroup: { label: 'Blood group' }, mrn: { label: 'Patient number' }, username: { label: 'Username' },
  registrationId: { label: 'Registration number' }, guardianName: { label: 'Guardian' }, guardianPhone: { label: 'Guardian phone' },
  abhaId: { label: 'ABHA number' }, abhaAddress: { label: 'ABHA address' }, aadhaarLast4: { label: 'Aadhaar' },
  barcode: { label: 'Sample number' }, orderNumber: { label: 'Order number' }, invoiceNumber: { label: 'Invoice number' },
  referenceNo: { label: 'Reference' }, reason: { label: 'Reason' }, rejectedReason: { label: 'Reason' },
  rejectionReason: { label: 'Reason' }, amendmentReason: { label: 'Reason for the change' }, note: { label: 'Note' },
  deliveryNote: { label: 'Delivery note' }, overrideDiscountReason: { label: 'Discount reason' },
  refDoctorName: { label: 'Referred by' }, refHospitalName: { label: 'Referring hospital' }, refDoctorPhone: { label: 'Doctor phone' },
  collectionType: { label: 'Collection' }, rejectionCount: { label: 'Times rejected', format: 'number' },
  testCode: { label: 'Test code' }, shortName: { label: 'Short name' }, section: { label: 'Section' }, profile: { label: 'Profile' },
  description: { label: 'Description' }, sampleType: { label: 'Specimen' }, specimen: { label: 'Specimen' },
  sampleVolumeMl: { label: 'Volume (ml)', format: 'number' }, methodology: { label: 'Method' }, unit: { label: 'Unit' },
  resultType: { label: 'Result type' }, reportFormat: { label: 'Report format' }, adultReferenceRange: { label: 'Normal range' },
  criticalLow: { label: 'Critical low', format: 'number' }, criticalHigh: { label: 'Critical high', format: 'number' },
  tubeColor: { label: 'Tube colour' }, tatHours: { label: 'Turnaround (hours)', format: 'number' },
  hsnSacCode: { label: 'HSN / SAC code' }, standardCode: { label: 'Standard code' }, flow: { label: 'Flow' },
  outsourcingOverride: { label: 'Partner lab choice' }, repeatOffsetMin: { label: 'Draw at (minutes)', format: 'number' },
  code: { label: 'Code' }, summary: { label: 'Values' }, communicationMethod: { label: 'Told by', values: CHANNEL_WORDS },
  communicatedToName: { label: 'Told to' }, communicatedToRole: { label: 'Their role' }, communicationNotes: { label: 'Notes' },
  // Links (named by the server's refs)
  orderId: { label: 'Order', format: 'ref', noun: 'an order' },
  subOrderId: { label: 'Sample', format: 'ref', noun: 'a sample' }, sampleId: { label: 'Sample', format: 'ref', noun: 'a sample' },
  orderTestId: { label: 'Test', format: 'ref', noun: 'a test' },
  testId: { label: 'Test', format: 'ref', noun: 'a test' }, profileTestId: { label: 'Profile', format: 'ref', noun: 'a profile' },
  packageTestId: { label: 'Package', format: 'ref', noun: 'a package' }, repeatProfileTestId: { label: 'Series', format: 'ref', noun: 'a series' },
  patientId: { label: 'Patient', format: 'ref', noun: 'a patient' }, userId: { label: 'Person', format: 'ref', noun: 'someone' },
  createdBy: { label: 'Created by', format: 'ref', noun: 'someone' }, collectedBy: { label: 'Collected by', format: 'ref', noun: 'someone' },
  dispatchedBy: { label: 'Sent by', format: 'ref', noun: 'someone' }, pickedUpBy: { label: 'Picked up by', format: 'ref', noun: 'someone' },
  receivedBy: { label: 'Received by', format: 'ref', noun: 'someone' }, assignedTo: { label: 'Assigned to', format: 'ref', noun: 'someone' },
  validatorAssignedTo: { label: 'Validator', format: 'ref', noun: 'someone' }, resultedBy: { label: 'Entered by', format: 'ref', noun: 'someone' },
  validatedBy: { label: 'Validated by', format: 'ref', noun: 'someone' }, rejectedBy: { label: 'Rejected by', format: 'ref', noun: 'someone' },
  actionedBy: { label: 'By', format: 'ref', noun: 'someone' }, amendedBy: { label: 'Corrected by', format: 'ref', noun: 'someone' },
  generatedBy: { label: 'Made by', format: 'ref', noun: 'someone' }, refundedBy: { label: 'Refunded by', format: 'ref', noun: 'someone' },
  assignedBy: { label: 'Given by', format: 'ref', noun: 'someone' }, overrideBy: { label: 'Discount by', format: 'ref', noun: 'someone' },
  acknowledgedBy: { label: 'Acknowledged by', format: 'ref', noun: 'someone' }, communicatedBy: { label: 'Told by', format: 'ref', noun: 'someone' },
  detectedBy: { label: 'Found by', format: 'ref', noun: 'someone' },
  roleId: { label: 'Role', format: 'ref', noun: 'a role' }, permissionId: { label: 'Permission', format: 'ref', noun: 'a permission' },
  branchId: { label: 'Branch', format: 'ref', noun: 'a branch' }, departmentId: { label: 'Department', format: 'ref', noun: 'a department' },
  outsourcedDepartmentId: { label: 'Partner department', format: 'ref', noun: 'a department' },
  outsourcedVendorId: { label: 'Partner lab', format: 'ref', noun: 'a partner lab' }, vendorId: { label: 'Partner lab', format: 'ref', noun: 'a partner lab' },
  billId: { label: 'Bill', format: 'ref', noun: 'a bill' }, reportId: { label: 'Report', format: 'ref', noun: 'a report' },
  supersededByReportId: { label: 'Replaced by', format: 'ref', noun: 'a newer report' },
  refDoctorId: { label: 'Referring doctor', format: 'ref', noun: 'a doctor' }, spaceId: { label: 'Lab space', format: 'ref', noun: 'a lab space' },
  resultVersionId: { label: 'Result version', format: 'ref', noun: 'a result' },
};

// ── Entity rules (the sentence table) ──────────────────────────────────────

/** Everything a sentence template may read. */
export interface AuditCtx {
  log: AuditLog;
  /** The parsed change document ({} for free text). */
  ch: Record<string, unknown>;
  refs: Readonly<Record<string, AuditRef>>;
  /** refs[entityId]. */
  self: AuditRef | undefined;
}

export interface Sentence { verb: string; what: string; rest: string; danger?: boolean }

interface EntityRule {
  area: AuditArea;
  /** "order" — used in "Also updated: 2 orders" and generic sentences. */
  noun: string;
  plural?: string;
  /** Primary-row priority when rows of one moment merge (higher wins). */
  weight: number;
  /** The "What" (bold) — a human name, never an id. */
  what: (c: AuditCtx) => string;
  /** The sentence; return null to use the generic create / update / delete words. */
  say?: (c: AuditCtx) => Sentence | null;
  /** Where "Open …" goes. */
  link?: (c: AuditCtx) => { label: string; url: string } | null;
}

// Helpers for the table ─────────────────────────────────────────────────────

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
/** The `new` side of an update (or the value itself on create / delete). */
export function nv(v: unknown): unknown {
  return v && typeof v === 'object' && !Array.isArray(v) && 'new' in (v as object) ? (v as { new: unknown }).new : v;
}
export function ov(v: unknown): unknown {
  return v && typeof v === 'object' && !Array.isArray(v) && 'old' in (v as object) ? (v as { old: unknown }).old : undefined;
}
const changed = (c: AuditCtx, f: string) => c.log.action === 'update' && f in c.ch;
const becomes = (c: AuditCtx, f: string, ...vals: string[]) => changed(c, f) && vals.includes(str(nv(c.ch[f])));

/** The order a row hangs off (its own ref, the change document, or itself for an order row). */
export function orderIdOf(log: AuditLog, refs: Readonly<Record<string, AuditRef>>, ch?: Record<string, unknown>): string | null {
  if (log.entityType === 'OrderEntity') return log.entityId;
  const self = refs[log.entityId];
  if (self?.orderId) return self.orderId;
  const c = ch ?? parseChanges(log.changes);
  const o = str(nv(c['orderId']));
  return o || null;
}

function orderRef(c: AuditCtx): AuditRef | undefined {
  const id = orderIdOf(c.log, c.refs, c.ch);
  return id ? c.refs[id] : undefined;
}
function orderNumber(c: AuditCtx): string {
  return orderRef(c)?.label || str(nv(c.ch['orderNumber'])) || '';
}
/** "for Mr. Kumar Prem · LAB-2611-000016" (only the parts that resolved). */
function forOrder(c: AuditCtx, withNumber = true): string {
  const o = orderRef(c);
  const parts = [o?.patient, withNumber ? (o?.label || '') : ''].filter(Boolean);
  return parts.length ? 'for ' + parts.join(' · ') : '';
}
function refLabel(c: AuditCtx, id: unknown, noun: string): string {
  const k = str(id);
  return (k && c.refs[k]?.label) || noun;
}
function person(c: AuditCtx, field: string): string {
  return refLabel(c, nv(c.ch[field]), 'someone');
}
const openOrder = (c: AuditCtx) => {
  const id = orderIdOf(c.log, c.refs, c.ch);
  return id && c.refs[id] ? { label: 'Open order', url: `/o/${id}` } : null;
};
const fullName = (c: AuditCtx) => [nv(c.ch['title']), nv(c.ch['firstName']), nv(c.ch['fathersName'])].map(str).filter(Boolean).join(' ');

/**
 * The sentence table: entity type → area, noun, the bold "What", the verb per
 * action / changed field, and the record link. Order = the merge priority
 * (weight) when several rows of one moment collapse into one event.
 */
export const ENTITY_RULES: Readonly<Record<string, EntityRule>> = {
  OrderEntity: {
    area: 'orders', noun: 'order', weight: 100,
    what: c => c.self?.label || str(nv(c.ch['orderNumber'])) || 'an order',
    say: c => {
      const rest = forOrder(c, false);
      if (c.log.action === 'create') return { verb: 'created order', what: '', rest };
      if (c.log.action === 'delete') return { verb: 'deleted order', what: '', rest, danger: true };
      if (becomes(c, 'status', 'cancelled')) return { verb: 'cancelled order', what: '', rest, danger: true };
      if (becomes(c, 'status', 'billed')) return { verb: 'billed order', what: '', rest };
      if (becomes(c, 'status', 'collected', 'sample_collected')) return { verb: 'collected the samples of order', what: '', rest };
      if (becomes(c, 'status', 'delivered')) return { verb: 'delivered the report of order', what: '', rest };
      if (changed(c, 'priority')) return { verb: 'changed the priority of order', what: '', rest };
      if (changed(c, 'refDoctorId') || changed(c, 'refDoctorName')) return { verb: 'changed the referral of order', what: '', rest };
      return { verb: 'updated order', what: '', rest };
    },
    link: openOrder,
  },
  BillEntity: {
    area: 'orders', noun: 'bill', weight: 95,
    what: c => orderNumber(c) || 'an order',
    say: c => {
      const rest = forOrder(c, false);
      if (c.log.action === 'create') return { verb: 'billed order', what: '', rest };
      if (c.log.action === 'delete') return { verb: 'deleted the bill of order', what: '', rest, danger: true };
      if (becomes(c, 'status', 'cancelled')) return { verb: 'cancelled the bill of order', what: '', rest, danger: true };
      if (changed(c, 'overrideDiscount')) return { verb: 'changed the discount on order', what: '', rest };
      if (changed(c, 'totalPaid') || becomes(c, 'status', 'paid')) return { verb: 'updated the payment on order', what: '', rest };
      return { verb: 'updated the bill of order', what: '', rest };
    },
    link: openOrder,
  },
  PaymentEntity: {
    area: 'orders', noun: 'payment', weight: 92,
    what: c => orderNumber(c) || 'an order',
    say: c => {
      const amt = money(nv(c.ch['amount']));
      const mode = MODE_WORDS[str(nv(c.ch['mode'])).toLowerCase()] ?? str(nv(c.ch['mode']));
      const paid = [amt, mode ? `by ${mode}` : ''].filter(Boolean).join(' ');
      const rest = [paid, forOrder(c, false)].filter(Boolean).join(' · ');
      if (c.log.action === 'delete') return { verb: 'removed a payment from order', what: '', rest, danger: true };
      if (c.log.action === 'create') return { verb: 'took a payment for order', what: '', rest };
      return { verb: 'changed a payment on order', what: '', rest };
    },
    link: openOrder,
  },
  RefundEntity: {
    area: 'orders', noun: 'refund', weight: 92,
    what: c => orderNumber(c) || 'an order',
    say: c => {
      const rest = [money(nv(c.ch['amount'])), forOrder(c, false)].filter(Boolean).join(' · ');
      if (c.log.action === 'delete') return { verb: 'removed a refund from order', what: '', rest, danger: true };
      return { verb: c.log.action === 'create' ? 'refunded order' : 'changed a refund on order', what: '', rest };
    },
    link: openOrder,
  },
  PatientEntity: {
    area: 'orders', noun: 'patient', weight: 60,
    what: c => c.self?.label || fullName(c) || 'a patient',
    say: c => {
      if (c.log.action === 'create') return { verb: 'registered', what: '', rest: 'as a new patient' };
      if (c.log.action === 'delete') return { verb: 'removed the patient', what: '', rest: '', danger: true };
      if (changed(c, 'abhaId') || changed(c, 'abhaAddress')) return { verb: 'changed the ABHA of', what: '', rest: '' };
      return { verb: 'updated the details of', what: '', rest: '' };
    },
    link: c => (c.self ? { label: 'Open patient', url: `/p/${c.log.entityId}` } : null),
  },
  OrderSampleEntity: {
    area: 'samples', noun: 'sample', plural: 'samples', weight: 50,
    what: c => c.self?.label || str(nv(c.ch['barcode'])) || 'a sample',
    say: c => {
      const rest = forOrder(c);
      if (c.log.action === 'create') return { verb: 'added sample', what: '', rest };
      if (c.log.action === 'delete') return { verb: 'removed sample', what: '', rest, danger: true };
      if (becomes(c, 'status', 'collected', 'sample_collected')) return { verb: 'collected', what: '', rest };
      if (becomes(c, 'status', 'dispatched', 'in_transit')) return { verb: 'sent to the lab', what: '', rest };
      if (becomes(c, 'status', 'received', 'received_in_lab')) return { verb: 'received', what: '', rest };
      if (becomes(c, 'status', 'rejected')) return { verb: 'rejected', what: '', rest, danger: true };
      if (becomes(c, 'status', 'merged')) return { verb: 'poured', what: '', rest: ['into another tube', rest].filter(Boolean).join(' ') };
      if (becomes(c, 'status', 'missed')) return { verb: 'marked as missed', what: '', rest };
      if (changed(c, 'barcode')) return { verb: 'changed the sample number of', what: '', rest };
      return { verb: 'updated sample', what: '', rest };
    },
    link: openOrder,
  },
  OrderSampleMerge: {
    area: 'samples', noun: 'sample', plural: 'samples', weight: 52,
    what: c => c.self?.label || 'a sample',
    say: c => ({ verb: 'poured', what: '', rest: ['into another tube', forOrder(c)].filter(Boolean).join(' ') }),
    link: openOrder,
  },
  OrderTestEntity: {
    area: 'results', noun: 'test', plural: 'tests', weight: 40,
    what: c => c.self?.label || refLabel(c, nv(c.ch['testId']), 'a test'),
    say: c => {
      const rest = forOrder(c);
      if (c.log.action === 'create') return { verb: 'added the test', what: '', rest };
      if (c.log.action === 'delete') return { verb: 'removed the test', what: '', rest, danger: true };
      if (becomes(c, 'status', 'validated')) return { verb: 'validated', what: '', rest };
      if (becomes(c, 'status', 'partially_validated')) return { verb: 'partly validated', what: '', rest };
      if (becomes(c, 'status', 'entered')) return { verb: 'entered the result of', what: '', rest };
      if (becomes(c, 'status', 're_entry')) return { verb: 'sent back for re-entry', what: '', rest, danger: true };
      if (becomes(c, 'status', 'rejected')) return { verb: 'rejected', what: '', rest, danger: true };
      if (becomes(c, 'status', 'cancelled')) return { verb: 'cancelled the test', what: '', rest, danger: true };
      if (changed(c, 'assignedTo')) return { verb: 'assigned', what: '', rest: ['to ' + person(c, 'assignedTo'), rest].filter(Boolean).join(' · ') };
      if (changed(c, 'validatorAssignedTo')) return { verb: 'chose the validator for', what: '', rest };
      if (changed(c, 'currentResult')) return { verb: 'changed the result of', what: '', rest };
      if (changed(c, 'outsourcingOverride')) return { verb: 'changed the partner lab for', what: '', rest };
      return { verb: 'updated the test', what: '', rest };
    },
    link: openOrder,
  },
  OrderTestResultEntity: {
    area: 'results', noun: 'result', plural: 'results', weight: 45,
    what: c => c.self?.label || 'a test',
    say: c => {
      const rest = forOrder(c);
      const act = str(nv(c.ch['action']));
      if (c.log.action === 'delete') return { verb: 'removed a result of', what: '', rest, danger: true };
      if (act === 'validated') return { verb: 'validated', what: '', rest };
      if (act === 'amended') return { verb: 'corrected the result of', what: '', rest };
      if (act === 'rejected') return { verb: 'rejected the result of', what: '', rest, danger: true };
      if (act === 're_entry') return { verb: 'sent back for re-entry', what: '', rest, danger: true };
      return { verb: 'entered the result of', what: '', rest };
    },
    link: openOrder,
  },
  OrderTestOutsourcing: {
    area: 'samples', noun: 'test', plural: 'tests', weight: 41,
    what: c => c.self?.label || 'a test',
    say: c => ({ verb: c.log.action === 'outsourcing_split' ? 'sent to a partner lab' : 'brought back in-house', what: '', rest: forOrder(c) }),
    link: openOrder,
  },
  OrderTestExternalReport: {
    area: 'results', noun: 'partner report', weight: 42,
    what: c => c.self?.label || 'a test',
    say: c => ({ verb: c.log.action === 'external_report_reopened' ? 'reopened the partner report of' : 'attached the partner report of', what: '', rest: forOrder(c) }),
    link: openOrder,
  },
  ReportEntity: {
    area: 'results', noun: 'report', plural: 'reports', weight: 70,
    what: c => orderNumber(c) || 'an order',
    say: c => {
      const pt = orderRef(c)?.patient;
      const to = pt ? `to ${pt}` : '';
      if (c.log.action === 'create') return { verb: 'made the report of', what: '', rest: forOrder(c, false) };
      if (c.log.action === 'delete') return { verb: 'deleted the report of', what: '', rest: forOrder(c, false), danger: true };
      if (changed(c, 'deliveredVia') || becomes(c, 'deliveryStatus', 'sent', 'delivered')) {
        const via = CHANNEL_WORDS[str(nv(c.ch['deliveredVia'])).toLowerCase()];
        return { verb: 'sent the report', what: '', rest: [to, via ? `on ${via}` : ''].filter(Boolean).join(' ') };
      }
      if (becomes(c, 'status', 'superseded') || changed(c, 'supersededByReportId')) return { verb: 'replaced the report of', what: '', rest: forOrder(c, false) };
      if (changed(c, 'amendmentReason')) return { verb: 'corrected the report of', what: '', rest: forOrder(c, false) };
      return { verb: 'updated the report of', what: '', rest: forOrder(c, false) };
    },
    link: openOrder,
  },
  CriticalResultEventEntity: {
    area: 'results', noun: 'critical value', weight: 65,
    what: c => c.self?.label || str(nv(c.ch['testName'])) || 'a test',
    say: c => {
      const rest = forOrder(c);
      if (c.log.action === 'create') return { verb: 'recorded a critical value in', what: '', rest };
      if (becomes(c, 'status', 'communicated') || changed(c, 'communicatedAt')) {
        const to = str(nv(c.ch['communicatedToName']));
        return { verb: 'told someone about the critical value in', what: '', rest: [to ? `(${to})` : '', rest].filter(Boolean).join(' ') };
      }
      if (becomes(c, 'status', 'acknowledged') || changed(c, 'acknowledgedAt')) return { verb: 'acknowledged the critical value in', what: '', rest };
      return { verb: 'updated the critical value in', what: '', rest };
    },
    link: openOrder,
  },
  TestEntity: {
    area: 'tm', noun: 'test', plural: 'tests', weight: 30,
    what: c => c.self?.label || str(nv(c.ch['name'])) || str(ov(c.ch['name'])) || 'a test',
    say: c => {
      if (c.log.action === 'create') {
        const p = nv(c.ch['price']);
        return { verb: 'created the test', what: '', rest: Number(p) > 0 ? `and set its price to ${money(p)}` : 'in Test Master' };
      }
      if (c.log.action === 'delete') return { verb: 'deleted the test', what: '', rest: 'from Test Master', danger: true };
      if (changed(c, 'price')) return { verb: 'changed the price of', what: '', rest: `${money(ov(c.ch['price'])) || '—'} → ${money(nv(c.ch['price'])) || '—'}` };
      if (becomes(c, 'isEnabled', 'false') || becomes(c, 'isActive', 'false')) return { verb: 'turned off the test', what: '', rest: 'in Test Master' };
      if (becomes(c, 'isEnabled', 'true') || becomes(c, 'isActive', 'true')) return { verb: 'turned on the test', what: '', rest: 'in Test Master' };
      if (changed(c, 'name')) return { verb: 'renamed the test', what: '', rest: `(was ${str(ov(c.ch['name']))})` };
      return { verb: 'changed the test', what: '', rest: 'in Test Master' };
    },
    link: c => (c.self && c.log.action !== 'delete' ? { label: 'Open test', url: `/admin/tests/${c.log.entityId}/edit` } : null),
  },
  OptionFamilyEntity: {
    area: 'tm', noun: 'option list', weight: 28,
    what: c => str(nv(c.ch['name'])) || 'an option list',
    say: c => ({ verb: c.log.action === 'create' ? 'created the option list' : c.log.action === 'delete' ? 'deleted the option list' : 'changed the option list', what: '', rest: 'in Test Master', danger: c.log.action === 'delete' }),
  },
  TmProposal: {
    area: 'tm', noun: 'suggested change', weight: 27,
    what: () => 'a suggested Test Master change',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? 'handled', what: '', rest: '' }),
  },
  UserEntity: {
    area: 'people', noun: 'user', plural: 'users', weight: 35,
    what: c => c.self?.label || fullName(c) || 'a user',
    say: c => {
      if (c.log.action === 'create') return { verb: 'added', what: '', rest: 'as a user' };
      if (c.log.action === 'delete') return { verb: 'removed the user', what: '', rest: '', danger: true };
      if (becomes(c, 'isActive', 'false')) return { verb: 'turned off sign-in for', what: '', rest: '', danger: true };
      if (becomes(c, 'isActive', 'true')) return { verb: 'turned on sign-in for', what: '', rest: '' };
      return { verb: 'updated the details of', what: '', rest: '' };
    },
    link: c => (c.self && c.log.action !== 'delete' ? { label: 'Open user', url: `/admin/users/${c.log.entityId}/edit` } : null),
  },
  UserRoleEntity: {
    area: 'people', noun: 'role', plural: 'roles', weight: 34,
    what: c => c.self?.label || person(c, 'userId'),
    say: c => {
      const role = roleWithBranch(c);
      const the = role === 'a role' ? role : `the ${role}`;
      if (c.log.action === 'delete') return { verb: 'removed', what: '', rest: `from ${the}`, danger: true };
      if (c.log.action === 'create') return { verb: 'gave', what: '', rest: the };
      return { verb: 'changed the role of', what: '', rest: `(${role})` };
    },
  },
  RoleEntity: {
    area: 'people', noun: 'role', plural: 'roles', weight: 33,
    what: c => c.self?.label || str(nv(c.ch['name'])) || 'a role',
    say: c => ({ verb: c.log.action === 'create' ? 'created the role' : c.log.action === 'delete' ? 'deleted the role' : 'changed the role', what: '', rest: '', danger: c.log.action === 'delete' }),
    link: c => (c.self && c.log.action !== 'delete' ? { label: 'Open role', url: `/admin/roles/${c.log.entityId}/edit` } : null),
  },
  RolePermissionEntity: {
    area: 'people', noun: 'permission', plural: 'permissions', weight: 32,
    what: c => {
      const [role] = c.log.entityId.split(':');
      return refLabel(c, role, 'a role');
    },
    say: c => {
      const [, perm] = c.log.entityId.split(':');
      const p = refLabel(c, perm, 'a permission');
      return c.log.action === 'delete'
        ? { verb: 'took “' + p + '” away from the role', what: '', rest: '', danger: true }
        : { verb: 'allowed the role', what: '', rest: `to “${p}”` };
    },
  },
  Auth: {
    area: 'people', noun: 'sign-in', weight: 10,
    what: () => '',
    say: c => {
      switch (c.log.action) {
        case 'login': return { verb: 'signed in', what: '', rest: '' };
        case 'login_failed': return { verb: 'could not sign in', what: '', rest: '(wrong password)', danger: true };
        case 'password_changed': return { verb: 'changed their password', what: '', rest: '' };
        case 'pin_changed': return { verb: 'changed their PIN', what: '', rest: '' };
        case 'pin_failed': return { verb: 'entered a wrong PIN', what: '', rest: '', danger: true };
        default: return { verb: humanize(c.log.action).toLowerCase(), what: '', rest: '' };
      }
    },
  },
  SupportSession: {
    area: 'people', noun: 'support session', weight: 9,
    what: () => 'a support session',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? 'used', what: '', rest: '' }),
  },
  SettingsAccess: {
    area: 'settings', noun: 'setting', weight: 20,
    what: () => 'who can open Settings',
    say: () => ({ verb: 'changed', what: '', rest: '' }),
  },
  DepartmentEntity: {
    area: 'settings', noun: 'department', plural: 'departments', weight: 20,
    what: c => c.self?.label || str(nv(c.ch['name'])) || 'a department',
    say: c => ({ verb: c.log.action === 'create' ? 'added the department' : c.log.action === 'delete' ? 'removed the department' : 'changed the department', what: '', rest: '', danger: c.log.action === 'delete' }),
  },
  TenantCommunicationSettingsEntity: {
    area: 'settings', noun: 'setting', weight: 20,
    what: () => 'Communication settings',
    say: () => ({ verb: 'changed', what: '', rest: '' }),
  },
  WhatsAppSender: {
    area: 'settings', noun: 'setting', weight: 20,
    what: () => 'WhatsApp',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? 'changed', what: '', rest: '' }),
  },
  InstrumentEntity: {
    area: 'settings', noun: 'analyzer', plural: 'analyzers', weight: 20,
    what: c => str(nv(c.ch['name'])) || 'an analyzer',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? genericVerb(c.log.action).verb, what: '', rest: '', danger: c.log.action === 'delete' }),
  },
  BridgeEntity: {
    area: 'settings', noun: 'Bridge', weight: 20,
    what: c => str(nv(c.ch['name'])) || 'a Bridge',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? genericVerb(c.log.action).verb, what: '', rest: '', danger: c.log.action === 'delete' }),
  },
  AiConnector: {
    area: 'settings', noun: 'AI connector', weight: 19,
    what: () => 'the AI connector',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? 'used', what: '', rest: '' }),
  },
  AiConnectorGrant: {
    area: 'settings', noun: 'AI connector', weight: 19,
    what: () => 'the AI connector',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? 'used', what: '', rest: '' }),
  },
  CaseSheetFormEntity: {
    area: 'settings', noun: 'case sheet', weight: 18,
    what: c => str(nv(c.ch['name'])) || 'a case sheet',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? genericVerb(c.log.action).verb, what: '', rest: '', danger: c.log.action === 'delete' }),
  },
  ExpenseEntryEntity: {
    area: 'orders', noun: 'expense', plural: 'expenses', weight: 25,
    what: c => str(nv(c.ch['description'])) || str(nv(c.ch['note'])) || 'an expense',
    say: c => ({ verb: c.log.action === 'create' ? 'added the expense' : c.log.action === 'delete' ? 'deleted the expense' : 'changed the expense', what: '', rest: money(nv(c.ch['amount'])), danger: c.log.action === 'delete' }),
  },
  DayClosureEntity: {
    area: 'orders', noun: 'day closing', weight: 25,
    what: () => 'the day',
    say: c => ({ verb: c.log.action === 'delete' ? 'reopened' : 'closed', what: '', rest: '' }),
  },
  AiCall: {
    area: 'other', noun: 'Cortex request', weight: 5,
    what: () => 'Cortex',
    say: () => ({ verb: 'used', what: '', rest: '' }),
  },
  AnalyticsExport: {
    area: 'other', noun: 'export', weight: 5,
    what: () => 'an Insights list',
    say: () => ({ verb: 'exported', what: '', rest: '' }),
  },
  OfficeFileEntity: {
    area: 'other', noun: 'file', plural: 'files', weight: 5,
    what: c => str(nv(c.ch['name'])) || str(nv(c.ch['title'])) || 'a file',
    say: c => ({ verb: ACTION_VERBS[c.log.action] ?? genericVerb(c.log.action).verb, what: '', rest: '', danger: c.log.action === 'delete' }),
  },
};

/** "Phlebotomist role at Chennai Main" — from the server's ref ("Phlebotomist at Chennai Main") or the change document. */
function roleWithBranch(c: AuditCtx): string {
  const sub = c.self?.sub;
  if (sub) {
    const i = sub.lastIndexOf(' at ');
    return i > 0 ? `${sub.slice(0, i)} role at ${sub.slice(i + 4)}` : `${sub} role`;
  }
  const role = refLabel(c, nv(c.ch['roleId']), '');
  const b = str(nv(c.ch['branchId']));
  const branch = b ? c.refs[b]?.label : '';
  if (!role) return 'a role';
  return branch ? `${role} role at ${branch}` : `${role} role`;
}

/** Custom (non create / update / delete) actions, in plain words. */
export const ACTION_VERBS: Readonly<Record<string, string>> = {
  'tm.proposed': 'suggested', 'tm.approved': 'approved', 'tm.rejected': 'turned down', 'tm.withdrawn': 'withdrew',
  'tm.expired': 'let expire', 'tm.stale': 'marked out of date', 'tm.re_reviewed': 'sent back for another look', 'tm.apply_failed': 'could not apply',
  'support.start': 'started', 'support.stop': 'ended', 'support.tool': 'used', 'support.session_summary': 'summed up',
  'ai_connector.grant_set': 'gave access to', 'ai_connector.grant_removed': 'took away access to', 'ai_connector.grants_wiped': 'cleared every grant of',
  'ai_connector.tool': 'used', 'ai_connector.resolve': 'opened a record through', 'ai_connector.casesheet_build_switch': 'changed the case-sheet switch of',
  whatsapp_connected: 'connected', whatsapp_disconnected: 'disconnected', whatsapp_settings_changed: 'changed the settings of',
  whatsapp_credits_adjusted: 'adjusted the credits of', whatsapp_billing_settings_changed: 'changed the billing of',
  whatsapp_credits_threshold: 'changed the low-credit alert of', whatsapp_balance_confirmed: 'confirmed the balance of',
  assign_instrument: 'linked', unassign_instrument: 'unlinked', test_alias_route: 'mapped a code on', test_alias_reingest: 're-read results on',
  test_session_start: 'started a test on', test_session_stop: 'ended a test on', claim: 'claimed', claim_completed: 'set up', claim_failed: 'could not set up',
  command_issued: 'sent a command to', command_failed: 'could not send a command to', reservation_expired: 'let the reservation lapse on',
  rotate_key: 'changed the key of', revoke: 'removed', move_branch: 'moved', rename: 'renamed', share_added: 'shared', share_removed: 'stopped sharing',
  external_ai_refused: 'kept from an outside assistant', 'form.published': 'published', 'form.key_renamed': 'renamed a field in',
  'communication.email_settings_updated': 'changed the email settings in', 'communication.sms_settings_updated': 'changed the SMS settings in',
  stock_override: 'went past the stock check for', tubes_merged: 'poured', outsourcing_split: 'sent to a partner lab', outsourcing_regrouped: 'brought back in-house',
  'settings_access.changed': 'changed',
};

function genericVerb(action: string): { verb: string; danger: boolean } {
  switch (action) {
    case 'create': return { verb: 'created', danger: false };
    case 'update': return { verb: 'changed', danger: false };
    case 'delete': return { verb: 'deleted', danger: true };
    default: return { verb: ACTION_VERBS[action] ?? humanize(action).toLowerCase(), danger: /fail|delete|remove|revoke/.test(action) };
  }
}

// ── Value + field formatting ───────────────────────────────────────────────

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
export const isGuid = (s: unknown): boolean => typeof s === 'string' && GUID.test(s);

export function money(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** "tatHours" → "Tat hours"; "TenantCommunicationSettingsEntity" → "Tenant communication settings". */
export function humanize(s: string): string {
  const words = s.replace(/Entity$/, '').replace(/[._]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

export function istTime(iso: string): string {
  try { return new Intl.DateTimeFormat('en-IN', { timeZone: LAB_TIME_ZONE, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)).toUpperCase(); }
  catch { return ''; }
}
function istStamp(iso: string): string {
  try { return new Intl.DateTimeFormat('en-IN', { timeZone: LAB_TIME_ZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)); }
  catch { return iso; }
}

/** A stored result ({"values":{…}} or plain text) as one short line. */
function resultText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  let o: unknown = v;
  if (typeof v === 'string') { try { o = JSON.parse(v); } catch { return v.length > 80 ? v.slice(0, 80) + '…' : v; } }
  if (o && typeof o === 'object') {
    const values = (o as { values?: Record<string, unknown> }).values ?? (o as Record<string, unknown>);
    const parts = Object.entries(values).filter(([k]) => k !== 'draft')
      .map(([k, x]) => `${k} ${x && typeof x === 'object' ? str((x as { label?: unknown; v?: unknown }).label ?? (x as { v?: unknown }).v) : str(x)}`.trim());
    return parts.length ? parts.slice(0, 6).join(', ') + (parts.length > 6 ? ' …' : '') : 'Draft';
  }
  return str(o);
}

/** One value in plain words for its field. IDs come out as names (or a noun), never raw. */
export function plainValue(field: string, v: unknown, refs: Readonly<Record<string, AuditRef>>): string {
  const rule = FIELD_RULES[field];
  if (v === null || v === undefined || v === '') return '—';
  if (v === '***') return 'Hidden';
  switch (rule?.format) {
    case 'money': return money(v) || str(v);
    case 'date': return typeof v === 'string' && ISO.test(v) ? istStamp(v) : str(v);
    case 'bool': return v === true || v === 'true' ? 'Yes' : 'No';
    case 'ref': return (typeof v === 'string' && refs[v]?.label) || rule.noun || 'a linked record';
    case 'result': return resultText(v);
    case 'number': return str(v);
  }
  if (rule?.values) { const w = rule.values[str(v).toLowerCase()]; if (w) return w; }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    if (isGuid(v)) return refs[v]?.label || 'a linked record';
    if (ISO.test(v)) return istStamp(v);
    if (/^[\[{]/.test(v.trim())) return 'Changed';
    return v.length > 120 ? v.slice(0, 120) + '…' : v;
  }
  if (typeof v === 'object') return 'Changed';
  return str(v);
}

export interface FriendlyChange { field: string; label: string; from: string | null; to: string }

/** The change document parsed ({} when it is free text or empty). */
export function parseChanges(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : {};
  } catch { return {}; }
}

/** The field changes in plain words — technical fields left out. Create / delete list the set values. */
export function friendlyChanges(log: AuditLog, refs: Readonly<Record<string, AuditRef>>): FriendlyChange[] {
  const ch = parseChanges(log.changes);
  const out: FriendlyChange[] = [];
  for (const [field, raw] of Object.entries(ch)) {
    if (TECHNICAL_FIELDS.has(field)) continue;
    const label = FIELD_RULES[field]?.label ?? humanize(field);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && ('old' in raw || 'new' in raw)) {
      const o = raw as { old?: unknown; new?: unknown };
      const from = plainValue(field, o.old, refs), to = plainValue(field, o.new, refs);
      if (from === to) continue;
      out.push({ field, label, from, to });
    } else {
      if (raw === null || raw === '' || raw === false || raw === 0) continue;  // a create's empty columns are noise
      out.push({ field, label, from: null, to: plainValue(field, raw, refs) });
    }
  }
  return out;
}

// ── One row → one sentence ─────────────────────────────────────────────────

export interface DescribedRow {
  who: string;
  verb: string;
  what: string;
  rest: string;
  danger: boolean;
  area: AuditArea;
  noun: string;
  plural: string;
  weight: number;
  link: { label: string; url: string } | null;
}

export function whoOf(log: AuditLog, refs: Readonly<Record<string, AuditRef>>): string {
  const named = log.userId ? refs[log.userId]?.label : undefined;
  const raw = (log.userName || '').trim();
  if (named) return named;
  if (raw && !isGuid(raw) && !raw.startsWith('service:')) return raw;
  return raw.startsWith('service:') ? 'Prefrontal' : 'System';
}

export function areaOf(entityType: string): AuditArea {
  return ENTITY_RULES[entityType]?.area ?? 'other';
}

/** The entity types of an area (the server's `entityTypes` filter). */
export function entityTypesOf(area: AuditArea): string[] {
  return Object.entries(ENTITY_RULES).filter(([, r]) => r.area === area).map(([t]) => t);
}

export function describeRow(log: AuditLog, refs: Readonly<Record<string, AuditRef>> = {}): DescribedRow {
  const ch = parseChanges(log.changes);
  const c: AuditCtx = { log, ch, refs, self: refs[log.entityId] };
  const who = whoOf(log, refs);
  const rule = ENTITY_RULES[log.entityType];
  if (rule) {
    const what = rule.what(c);
    const s = rule.say?.(c) ?? null;
    const g = genericVerb(log.action);
    return {
      who, what: s?.what || what, verb: s?.verb ?? g.verb, rest: s?.rest ?? '', danger: s ? !!s.danger : g.danger,
      area: rule.area, noun: rule.noun, plural: rule.plural ?? rule.noun + 's', weight: rule.weight, link: rule.link?.(c) ?? null,
    };
  }
  // Unknown type: "Admin User changed a branch (Name: Main → Main Road)".
  const g = genericVerb(log.action);
  const type = humanize(log.entityType) || 'Record';
  const article = /^[aeiou]/i.test(type) ? 'an' : 'a';
  const first = friendlyChanges(log, refs).slice(0, 2)
    .map(f => (f.from === null ? `${f.label}: ${f.to}` : `${f.label}: ${f.from} → ${f.to}`)).join(' · ');
  return {
    who, verb: g.verb, what: `${article} ${type.toLowerCase()}`, rest: first ? `(${first})` : '', danger: g.danger,
    area: 'other', noun: type.toLowerCase(), plural: type.toLowerCase() + 's', weight: 1, link: null,
  };
}

// ── Merge noise: one event per request / transaction ───────────────────────

export interface AuditEvent {
  id: string;
  at: string;
  /** IST yyyy-MM-dd. */
  day: string;
  time: string;
  who: string;
  initials: string;
  verb: string;
  what: string;
  rest: string;
  danger: boolean;
  area: AuditArea;
  changes: FriendlyChange[];
  /** "1 sample, 2 tests" — the other rows of the same moment. */
  also: string | null;
  link: { label: string; url: string } | null;
  /** Every raw row of the event (Technical details + export). */
  rows: AuditLog[];
}

/** Rows of one save land within milliseconds; allow a little drift between the rows of one request. */
export const MERGE_WINDOW_MS = 3000;

/** What ties rows of one moment together: the order they hang off, the role / person they change, else the record. */
export function scopeKey(log: AuditLog, refs: Readonly<Record<string, AuditRef>>): string {
  const o = orderIdOf(log, refs);
  if (o) return 'o:' + o;
  if (log.entityType === 'RolePermissionEntity') return 'r:' + log.entityId.split(':')[0];
  if (log.entityType === 'RoleEntity') return 'r:' + log.entityId;
  if (log.entityType === 'UserRoleEntity') {
    const u = str(nv(parseChanges(log.changes)['userId'])) || refs[log.entityId]?.label || log.entityId;
    return 'u:' + u;
  }
  if (log.entityType === 'UserEntity' || log.entityType === 'Auth') return 'u:' + log.entityId;
  return log.entityType + ':' + log.entityId;
}

export function initialsOf(name: string): string {
  const parts = name.replace(/^(dr|mr|mrs|ms|miss)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return (parts.map(p => p[0]).join('').slice(0, 2) || '?').toUpperCase();
}

function alsoText(rows: { d: DescribedRow }[]): string | null {
  const counts = new Map<string, { n: number; noun: string; plural: string }>();
  for (const { d } of [...rows].sort((a, b) => b.d.weight - a.d.weight)) {
    const k = d.noun;
    const cur = counts.get(k) ?? { n: 0, noun: d.noun, plural: d.plural };
    cur.n++; counts.set(k, cur);
  }
  const parts = [...counts.values()].map(c => `${c.n} ${c.n === 1 ? c.noun : c.plural}`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Collapse the rows one request wrote (same person, same moment, the same
 * order / role / record) into ONE event. The heaviest row (order > bill >
 * report > … > sample) speaks; the rest become "Also updated: 1 sample".
 * Several rows of the SAME kind and verb read as one plural sentence
 * ("collected 2 samples"). Input newest first; output newest first.
 */
export function groupEvents(logs: readonly AuditLog[], refs: Readonly<Record<string, AuditRef>> = {}): AuditEvent[] {
  const sorted = [...logs].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const groups: AuditLog[][] = [];
  const open = new Map<string, { rows: AuditLog[]; last: number }>();
  for (const log of sorted) {
    const t = Date.parse(log.at);
    const key = (log.userId || log.userName || '') + '|' + scopeKey(log, refs);
    const g = open.get(key);
    if (g && Math.abs(g.last - t) <= MERGE_WINDOW_MS) { g.rows.push(log); g.last = t; continue; }
    const fresh = { rows: [log], last: t };
    open.set(key, fresh);
    groups.push(fresh.rows);
  }
  return groups.map(rows => toEvent(rows, refs));
}

function toEvent(rows: AuditLog[], refs: Readonly<Record<string, AuditRef>>): AuditEvent {
  const described = rows.map(log => ({ log, d: describeRow(log, refs) }));
  // Primary: the heaviest row; among equals the one with the most to say.
  const primary = [...described].sort((a, b) =>
    b.d.weight - a.d.weight || friendlyChanges(b.log, refs).length - friendlyChanges(a.log, refs).length)[0];
  const others = described.filter(x => x !== primary);
  const same = others.filter(x => x.log.entityType === primary.log.entityType && x.d.verb === primary.d.verb);
  let { verb, what, rest } = primary.d;
  let rest2 = others.filter(x => !same.includes(x));
  if (same.length > 0) {
    // "collected 2 samples" instead of "collected LAB-1 … Also updated: 1 sample".
    const n = same.length + 1;
    what = `${n} ${primary.d.plural}`;
  } else {
    rest2 = others;
  }
  const head = primary.log;
  return {
    id: head.id,
    at: rows[0].at,
    day: istDateOf(rows[0].at),
    time: istTime(rows[0].at),
    who: primary.d.who,
    initials: initialsOf(primary.d.who),
    verb, what, rest,
    danger: primary.d.danger,
    area: primary.d.area,
    changes: friendlyChanges(head, refs),
    also: alsoText(rest2),
    link: primary.d.link,
    rows,
  };
}

// ── Day headings ───────────────────────────────────────────────────────────

/** "Today" · "Yesterday · 18 Nov" · "Mon · 16 Nov" (the IST day; shown in capitals). */
export function dayLabel(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const dm = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(date);
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return `Yesterday · ${dm}`;
  const wd = new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', weekday: 'short' }).format(date);
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return `${wd} · ${dm}${sameYear ? '' : ' ' + y}`;
}

export interface AuditDay { day: string; label: string; events: AuditEvent[] }

export function groupByDay(events: readonly AuditEvent[], today: string): AuditDay[] {
  const out: AuditDay[] = [];
  for (const e of events) {
    let d = out[out.length - 1];
    if (!d || d.day !== e.day) { d = { day: e.day, label: dayLabel(e.day, today), events: [] }; out.push(d); }
    d.events.push(e);
  }
  return out;
}

/** The whole sentence as one line (CSV, screen readers). */
export function sentenceText(d: Pick<DescribedRow, 'who' | 'verb' | 'what' | 'rest'>): string {
  return [d.who, d.verb, d.what, d.rest].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

// ── Export ─────────────────────────────────────────────────────────────────

export const CSV_HEADER = ['When (IST)', 'Who', 'What happened', 'Area', 'Changes', 'Entity type', 'Entity id', 'Action', 'User id', 'Audit row id'];

/** One CSV row per audit row: the human sentence + its friendly changes, then the raw ids for support. */
export function csvRow(log: AuditLog, refs: Readonly<Record<string, AuditRef>>): string[] {
  const d = describeRow(log, refs);
  const changes = friendlyChanges(log, refs).map(f => (f.from === null ? `${f.label}: ${f.to}` : `${f.label}: ${f.from} → ${f.to}`)).join('; ');
  return [istStamp(log.at), d.who, sentenceText(d), areaDef(d.area).label, changes, log.entityType, log.entityId, log.action, log.userId ?? '', log.id];
}
