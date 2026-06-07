import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Appointment, AppointmentConfig, HomeCollectionAgent, QueueResponse } from '../../shared/models/appointment.model';

/**
 * Front-desk collection-queue API: the live queue projection, the state-machine
 * transitions, walk-in quick-add, and the per-branch queue config.
 */
@Injectable({ providedIn: 'root' })
export class AppointmentQueueService {
  private readonly api = inject(ApiService);

  getQueue(): Observable<QueueResponse> {
    return this.api.get<QueueResponse>('/api/appointments/queue');
  }

  getConfig(): Observable<AppointmentConfig> {
    return this.api.get<AppointmentConfig>('/api/appointments/config');
  }
  saveConfig(cfg: AppointmentConfig): Observable<AppointmentConfig> {
    return this.api.put<AppointmentConfig>('/api/appointments/config', cfg);
  }

  checkIn(id: string): Observable<unknown> {
    return this.api.patch(`/api/appointments/${id}/checkin`);
  }
  cancel(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/cancel`);
  }
  start(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/start`);
  }
  complete(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/complete`);
  }
  noShow(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/no-show`);
  }
  skip(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/skip`);
  }
  markUrgent(id: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/mark-urgent`);
  }
  reschedule(id: string, appointmentDate: string, slotTime?: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/appointments/${id}/reschedule`, { appointmentDate, slotTime });
  }
  addWalkIn(patientId: string, type = 'walkin', notes?: string, testIds?: string): Observable<Appointment> {
    return this.api.post<Appointment>('/api/appointments/walkin', { patientId, type, notes, testIds });
  }

  // ── Home collection ──────────────────────────────────────────────────
  listAgents(): Observable<HomeCollectionAgent[]> {
    return this.api.get<HomeCollectionAgent[]>('/api/home-collection/agents');
  }
  upsertAgent(body: Partial<HomeCollectionAgent> & { userId: string; pincodes?: string[] }): Observable<HomeCollectionAgent> {
    return this.api.put<HomeCollectionAgent>('/api/home-collection/agents', body);
  }
  removeAgent(id: string): Observable<unknown> {
    return this.api.delete(`/api/home-collection/agents/${id}`);
  }
  myHomeCollections(): Observable<Appointment[]> {
    return this.api.get<Appointment[]>('/api/home-collection/my-queue');
  }
  unassignedHomeCollections(): Observable<Appointment[]> {
    return this.api.get<Appointment[]>('/api/home-collection/unassigned');
  }
  assignAgent(appointmentId: string, agentUserId: string): Observable<Appointment> {
    return this.api.patch<Appointment>(`/api/home-collection/appointments/${appointmentId}/assign`, { agentUserId });
  }
}
