import { Patient } from './patient.model';
import { Department } from './tenant.model';
import { Test } from './test.model';

export interface Order {
  id: string;
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
