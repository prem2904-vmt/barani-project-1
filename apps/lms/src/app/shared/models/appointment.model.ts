import { Patient } from './patient.model';

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  branchId: string;
  departmentId?: string;
  // 'walkin' is no longer a UI choice — silently defaulted server-side for
  // backwards compatibility. Keep the union loose so the backend's value
  // (e.g. legacy 'walkin' rows) still type-checks.
  type: 'appointment' | 'emergency' | 'followup' | string;
  collectionType: 'home_collection' | string;
  appointmentDate: string;
  slotTime?: string;
  tokenNumber?: string;
  status: 'booked' | 'checked_in' | 'completed' | 'cancelled' | 'no_show';
  consultationFee: number;
  refDoctorId?: string;
  refDoctorName?: string;
  notes?: string;
  createdAt: string;
  patient?: Patient;
}

export interface BookAppointmentInput {
  patientId: string;
  departmentId?: string;
  type: string;
  collectionType: string;
  appointmentDate: string;
  slotTime?: string;
  tokenNumber?: string;
  consultationFee: number;
  refDoctorId?: string;
  refDoctorName?: string;
  notes?: string;
}
