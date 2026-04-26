import { Patient } from './patient.model';
import { Department } from './tenant.model';
import { Test } from './test.model';

export interface Order {
  id: string;
  patientId: string;
  branchId: string;
  refDoctorId?: string;
  refDoctorName?: string;
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
