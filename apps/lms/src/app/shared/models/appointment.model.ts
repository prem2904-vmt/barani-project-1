import { Patient } from './patient.model';

/** Appointment / queue entry type — drives priority + colour. */
export type AppointmentType = 'appointment' | 'walkin' | 'followup' | 'urgent' | 'emergency' | string;

/** Lifecycle: booked → checked_in → in_progress → completed (+ cancelled/no_show/skipped). */
export type AppointmentStatus =
  | 'booked' | 'checked_in' | 'in_progress' | 'completed'
  | 'cancelled' | 'no_show' | 'skipped';

export interface Appointment {
  id: string;
  tenantId: string;
  patientId: string;
  branchId: string;
  departmentId?: string;
  type: AppointmentType;
  collectionType: string;
  appointmentDate: string;
  slotTime?: string;
  tokenNumber?: number;
  status: AppointmentStatus;
  consultationFee: number;
  refDoctorId?: string;
  refDoctorName?: string;
  notes?: string;
  checkedInAt?: string;
  startedAt?: string;
  completedAt?: string;
  noShowAt?: string;
  /** Comma-separated test ids pre-booked with the appointment. */
  testIds?: string;
  // Home collection
  address?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  assignedAgentId?: string;
  createdAt: string;
  patient?: Patient;
}

/** A home-collection agent + their coverage area. */
export interface HomeCollectionAgent {
  id: string;
  userId: string;
  branchId: string;
  areaMode: 'radius' | 'pincode';
  centerLat?: number | null;
  centerLng?: number | null;
  radiusKm?: number | null;
  pincodesJson?: string | null;
  weightage: number;
  isActive: boolean;
  user?: { id: string; name?: string; displayName?: string; firstName?: string; fathersName?: string; email?: string };
}

export interface BookAppointmentInput {
  patientId: string;
  departmentId?: string;
  type: string;
  collectionType: string;
  appointmentDate: string;
  slotTime?: string;
  tokenNumber?: number;
  consultationFee: number;
  refDoctorId?: string;
  refDoctorName?: string;
  notes?: string;
  address?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
}

/** Admin-selectable queue model per branch. */
export type QueueMode = 'token_queue' | 'walk_up' | 'home_collection';

/** Priority engine tunables (mirror the backend AppointmentQueueOptions). */
export interface AppointmentQueueOptions {
  appointmentGraceMinutes: number;
  noShowThresholdMinutes: number;
  avgCollectionMinutes: number;
  waitWeight: number;
  baseAppointment: number;
  baseWalkin: number;
  baseFollowup: number;
  urgentOverrideScore: number;
  latePenalty: number;
}

export interface AppointmentConfig {
  branchId: string;
  slotMinutes: number;
  open24h: boolean;
  weeklyScheduleJson?: string | null;
  maxConcurrentSlots: number;
  queueMode: QueueMode;
  queueOptions: AppointmentQueueOptions;
}

/** One row in the live queue projection. */
export interface QueueItem {
  id: string;
  patientId: string;
  patientName: string;
  phone?: string;
  type: AppointmentType;
  status: AppointmentStatus;
  tokenNumber?: number;
  appointmentDate: string;
  slotTime?: string;
  checkedInAt?: string;
  score: number;
  waitMinutes: number;
  isLate: boolean;
  estimatedWaitMinutes: number;
}

export interface QueueResponse {
  mode: QueueMode;
  avgCollectionMinutes: number;
  nowUtc: string;
  items: QueueItem[];
}
