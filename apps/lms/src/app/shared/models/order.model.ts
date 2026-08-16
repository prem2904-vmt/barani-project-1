import { Patient } from './patient.model';
import { Department } from './tenant.model';
import { Test } from './test.model';

export interface Order {
  id: string;
  /** Human-readable, module-prefixed order number, e.g. `LAB-2607-000042`.
   *  Generated at creation; null on legacy orders. */
  orderNumber?: string | null;
  /** Module that owns the order (lab/opd/ipd/…) — drives the OrderNumber prefix. */
  module?: string | null;
  patientId: string;
  branchId: string;
  refDoctorId?: string;
  refDoctorName?: string;
  refHospitalName?: string;
  priority: string;
  source: string;
  status: string;
  collectionType: string;
  customFields?: string;
  createdBy?: string;
  createdAt: string;
  totalAmount?: number;
  /** Server-computed: 'unbilled' | 'unpaid' | 'paid'. */
  billStatus?: 'unbilled' | 'unpaid' | 'paid' | null;
  /** Server-computed: true when the branch's require-bill gate is on and the
   *  bill isn't settled — a dispatch attempt WILL be rejected, so the UI
   *  offers "Bill" instead of Dispatch. */
  paymentHold?: boolean;
  patient?: Patient;
  samples: OrderSample[];
}

export interface OrderSample {
  id: string;
  orderId: string;
  departmentId: string;
  /** When set, this vial is destined for an outsourced/referral lab (null = in-house). */
  outsourcedVendorId?: string | null;
  /** The lab space this vial belongs to (grouping key with tubeColor). */
  spaceId?: string | null;
  /** Vial colour ('red'|'lavender'|'grey'|'blue') — the vial was grouped by
   *  (space, colour). Null = fall back to the department container colour. */
  tubeColor?: string | null;
  status: string;
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
  createdAt: string;
  department?: Department;
  tests: OrderTest[];
  order?: Order;
}

export interface OrderTest {
  id: string;
  subOrderId: string;
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
  /** Test CODE of the nearest profile (annotated by the samples endpoint) —
   *  picks profile-scoped reference bands at entry. */
  profileCode?: string | null;
  /** Resolved profile/package name (annotated by the samples endpoint). */
  packageName?: string;
  /** Display sequence within the tube (profile-authored order, never alphabetical). */
  position?: number;
  status: string;
  assignedTo?: string;
  currentResult?: string;
  resultedAt?: string;
  resultedBy?: string;
  validatedAt?: string;
  validatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
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
