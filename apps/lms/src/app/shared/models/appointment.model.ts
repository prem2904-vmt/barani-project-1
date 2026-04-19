import { Patient } from './patient.model';

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  branchId: string;
  departmentId?: string;
  type: 'appointment' | 'walkin' | 'emergency' | 'followup';
  collectionType: 'walkin' | 'home_collection';
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
