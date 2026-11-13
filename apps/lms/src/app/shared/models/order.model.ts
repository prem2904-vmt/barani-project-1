import { Patient } from './patient.model';
import { Department } from './tenant.model';
import { Test } from './test.model';

export interface Order {
  id: string;
  /** Human-readable, module-prefixed order number, e.g. `LAB-2607-000042`.
   *  Generated at creation; null on legacy orders. */
  orderNumber?: string | null;
  /** Daily patient number for this visit (per branch per IST day) and its
   *  day, yyyy-MM-dd — on-screen only (utils/daily-no.ts). */
  dailyNo?: number | null;
  dailyNoDay?: string | null;
  /** Module that owns the order (lab/opd/ipd/…) — drives the OrderNumber prefix. */
  module?: string | null;
  patientId: string;
  branchId: string;
  refDoctorId?: string;
  refDoctorName?: string;
  /** The referral doctor's phone from the doctor record (server-stamped on desk reads; read-only). */
  refDoctorPhone?: string | null;
  /** The referral doctor's email from the doctor record (server-stamped on desk reads; read-only). */
  refDoctorEmail?: string | null;
  refHospitalName?: string;
  priority: string;
  source: string;
  status: string;
  collectionType: string;
  customFields?: string;
  createdBy?: string;
  createdAt: string;
  /** Last write to the order row itself (status flips included — stamped by
   *  OrderRepository.MutateOrderAsync / RecomputeStatusAsync). Used to tell a
   *  genuinely TODAY status change (validated / completed just now) apart
   *  from an order merely swept in by the today-feed's 30-day ready-for-
   *  handover floor (OrderRepository.TodayQuery) — see work-status-filter.ts
   *  `hadTodayActivity`. */
  updatedAt?: string | null;
  totalAmount?: number;
  /** Server-computed: 'unbilled' | 'unpaid' | 'paid'. */
  billStatus?: 'unbilled' | 'unpaid' | 'paid' | null;
  /** Server-computed: true when the branch's require-bill gate is on and the
   *  bill isn't settled — a dispatch attempt WILL be rejected, so the UI
   *  offers "Bill" instead of Dispatch. */
  paymentHold?: boolean;
  /** Server-computed (OPS-75): money currently held for the order (payments − refunds). Absent on un-annotated reads. */
  netPaid?: number | null;
  patient?: Patient;
  samples: OrderSample[];
}

/** Sibling tube of the same order (annotated by /api/samples/{id}/tests) —
 *  feeds the entry screen's "Also in this order" rail so multi-tube orders
 *  (FBS + PPBS) never look like "only the last test is available". */
export interface SampleSibling {
  id: string;
  barcode?: string | null;
  status?: string | null;
  repeatOffsetMin?: number | null;
  tests: string[];
  hasOpenWork?: boolean;
}

export interface OrderSample {
  id: string;
  orderId: string;
  departmentId: string;
  /** Lines on this tube not yet validated — set by My Work → Completed
   *  (`GET /api/results/completed`), which lists only the tech's own lines. */
  openLines?: number | null;
  /** When set, this vial is destined for an outsourced/referral lab (null = in-house). */
  outsourcedVendorId?: string | null;
  /** The lab space this vial belongs to (grouping key with tubeColor). */
  spaceId?: string | null;
  /** Vial colour ('red'|'lavender'|'grey'|'blue') — the vial was grouped by
   *  (space, colour). Null = fall back to the department container colour. */
  tubeColor?: string | null;
  status: string;
  /** 'external' = specimen brought in from outside (draw skipped); null/absent = drawn in-house. */
  source?: string | null;
  barcode?: string;
  qrCode?: string;
  collectedAt?: string;
  collectedBy?: string;
  dispatchedAt?: string;
  dispatchedBy?: string;
  pickedUpAt?: string;
  pickedUpBy?: string;
  receivedAtLab?: string;
  receivedBy?: string;
  rejectedReason?: string;
  rejectionCount: number;
  /** Repetitive mode: minutes after the series' anchor draw this tube is due
   *  (0 = the anchor itself). Null/absent = not a series tube. */
  repeatOffsetMin?: number | null;
  /** The profile test that generated this repeat series — groups the tube
   *  with its series siblings on the same order. */
  repeatProfileTestId?: string | null;
  /** When a tech scan-verified this tube (queue claim-by-scan or My-Work
   *  pick-scan; barcode matched server-side). While scanVerifiedBy is the
   *  current tech, My Work opens the tube without demanding a re-scan. */
  scanVerifiedAt?: string | null;
  scanVerifiedBy?: string | null;
  /** Server JSON metadata. A tube split out of a drawn tube (outsourcing
   *  changed after collection) carries { splitFrom: <barcode> }. */
  metadata?: string | null;
  createdAt: string;
  department?: Department;
  /** Every department whose tests ride on this tube, the representative
   *  (`department`) first — a SHARED tube (integrated lab: CBC + HbA1c on one
   *  EDTA) spans several. Annotated by the order / collection endpoints;
   *  absent on older payloads (fall back to `department`). */
  departments?: TubeDepartment[] | null;
  tests: OrderTest[];
  order?: Order;  /** Other tubes of the same order (see SampleSibling). */
  siblings?: SampleSibling[] | null;

}

/** A department on a (possibly shared) tube — display only. */
export interface TubeDepartment {
  id: string;
  name: string;
  code?: string | null;
}

export interface OrderTest {
  id: string;
  subOrderId: string;
  /** The department this line routes to — its own test's, in the tenant's
   *  terms (a SHARED tube spans several departments). Annotated by the queue
   *  / My Work / sample endpoints; absent on older payloads. */
  routingDepartment?: TubeDepartment | null;
  /** May the current user close this line as Not reported? Stamped by the
   *  server's ONE rule (sample-tests read): open, in-house, no saved value,
   *  unclaimed or own, inside a scoped validator's departments, not printed
   *  on the live final. Absent on older servers → the client's own check. */
  closable?: boolean | null;
  testId: string;
  name: string;
  packageTestId?: string;
  /** Bundle type of packageTestId ('profile'|'package') — resolved by the
   *  per-sample endpoint; lets legacy rows (no profileTestId) group right. */
  packageType?: string | null;
  /** Nearest enclosing PROFILE this leaf arrived through (null = arrived
   *  directly: standalone test, or a package's direct member). */
  profileTestId?: string | null;
  profileName?: string | null;
  /** The desk's outsourcing pick for this line (a partner id, 'inhouse', or
   *  null = the Test Master default) — shared/utils/order-outsourcing. */
  outsourcingOverride?: string | null;
  /** Where the line really goes (partner id; null = in-house). */
  effectivePartnerId?: string | null;
  /** Test CODE of the nearest profile (annotated by the samples endpoint) —
   *  picks profile-scoped reference bands at entry. */
  profileCode?: string | null;
  /** RESOLVED "tech picks what prints" (annotated by the result-entry
   *  endpoints): the profile's setting when ordered as part of a profile,
   *  else the test's own. Read via `resolvePrintPicker`. */
  printPicker?: boolean | null;
  /** RESOLVED "Start with" for the picker ('all' ticked | 'none' ticked),
   *  by the same ordered rule — read via `resolvePrintPickerDefault`. */
  printPickerDefault?: string | null;
  /** Resolved profile/package name (annotated by the samples endpoint). */
  packageName?: string;
  /** Display sequence within the tube (profile-authored order, never alphabetical). */
  position?: number;
  status: string;
  assignedTo?: string;
  /** Validator this entered result was auto-routed to (advisory — the
   *  pending-validation screen lists it first for them). */
  validatorAssignedTo?: string;
  currentResult?: string;
  resultedAt?: string;
  resultedBy?: string;
  /** Display name of the tech who entered the result (annotated by the samples endpoint). */
  resultedByName?: string;
  validatedAt?: string;
  validatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
  /** The line's specimen NAME (fixed: stamped by the server; choose: picked
   *  at the desk; editable at the culture bench); null = none, the Test
   *  Master's own specimen applies. */
  specimen?: string | null;
  /** Specimen master CODE of `specimen` (new orders; null on older lines). */
  specimenCode?: string | null;
  test?: Test;
  subOrder?: OrderSample;
}

export interface CreateOrderInput {
  patientId: string;
  refDoctorId?: string;
  refDoctorName?: string;
  priority: string;
  source: string;
  collectionType: string;
  testIds: string[];
  customFieldsJson?: string;
}

/** Logical test count for display: a PROFILE counts as ONE test (its members
 *  don't inflate the number), individually-ordered tests count as themselves.
 *  A PACKAGE is a commercial wrapper, not a bench unit — where the rows are
 *  enriched (profileTestId/packageType present), its contents count as their
 *  profiles + individual tests. Unenriched rows keep the legacy
 *  group-by-bundle count so screens without the extra data are unaffected. */
export function logicalTestCount(
  tests: Array<{ packageTestId?: string | null; profileTestId?: string | null; packageType?: string | null }>
    | null | undefined
): number {
  if (!tests?.length) return 0;
  const pkgs = new Set<string>();
  let singles = 0;
  for (const t of tests) {
    if (t.profileTestId) pkgs.add(t.profileTestId);
    else if (t.packageTestId && t.packageType === 'package') singles++;
    else if (t.packageTestId) pkgs.add(t.packageTestId);
    else singles++;
  }
  return singles + pkgs.size;
}

/** Sort tests for display: authored position first (profile member sequence),
 *  name as the legacy fallback. */
export function sortTestsForDisplay<T extends { position?: number; name?: string }>(tests: T[]): T[] {
  return tests.slice().sort((a, b) =>
    ((a.position ?? 0) - (b.position ?? 0)) || (a.name ?? '').localeCompare(b.name ?? ''));
}
