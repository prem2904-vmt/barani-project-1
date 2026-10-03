import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { ApiError } from '../../../shared/models/api-response.model';
import { environment } from '../../../../environments/environment';
import { OPD_API } from '../shared/opd-api';
import type {
  CheckoutRequest, CollectRequest, DeskData, DeskQuote, DoctorUnavailableResult, OpdVisitDetail, OpdVisitRow, OpdVitalsRow, PaymentDue, ProcedureToBook, QueueDoctor, VitalsInput,
} from './desk.models';

/** The OPD desk / vitals / queue endpoints (Agent B), through the app's ONE
 *  ApiService. Every call answers 404 unless OPD is visible — callers are all
 *  behind opdGuard. */
@Injectable({ providedIn: 'root' })
export class OpdDeskApi {
  private readonly api = inject(ApiService);
  private readonly http = inject(HttpClient);

  desk(): Observable<DeskData> { return this.api.get(`${OPD_API.visits}/desk`); }
  quote(doctorId: string, patientId?: string | null): Observable<DeskQuote> {
    const q = new URLSearchParams({ doctorId });
    if (patientId) q.set('patientId', patientId);
    return this.api.get(`${OPD_API.visits}/quote?${q}`);
  }
  checkout(req: CheckoutRequest): Observable<OpdVisitDetail> { return this.api.post(OPD_API.visits, req); }
  visits(opts: { date?: string; status?: string[]; doctorId?: string } = {}): Observable<OpdVisitRow[]> {
    const q = new URLSearchParams();
    if (opts.date) q.set('date', opts.date);
    if (opts.status?.length) q.set('status', opts.status.join(','));
    if (opts.doctorId) q.set('doctorId', opts.doctorId);
    const s = q.toString();
    return this.api.get(`${OPD_API.visits}${s ? `?${s}` : ''}`);
  }
  visit(id: string): Observable<OpdVisitDetail> { return this.api.get(`${OPD_API.visits}/${id}`); }
  /** Open visit bills to collect (consult after the consult, procedures). */
  paymentsDue(): Observable<PaymentDue[]> { return this.api.get(`${OPD_API.visits}/payments-due`); }
  /** Collect (part of) one visit bill — discount within the role cap, partial allowed. */
  pay(visitId: string, billId: string, body: CollectRequest): Observable<OpdVisitDetail> {
    return this.api.post(`${OPD_API.visits}/${visitId}/bills/${billId}/pay`, body);
  }
  move(id: string, to: string, reason?: string | null, refund?: { refund: boolean; refundMode: string; refundReference?: string | null }): Observable<OpdVisitDetail> {
    return this.api.post(`${OPD_API.visits}/${id}/status`, { to, reason: reason ?? null, ...(refund ?? {}) });
  }

  vitalsQueue(): Observable<OpdVisitRow[]> { return this.api.get(`${OPD_API.vitals}/queue`); }
  vitalsFor(visitId: string): Observable<OpdVitalsRow[]> { return this.api.get(`${OPD_API.vitals}/${visitId}`); }
  saveVitals(visitId: string, v: VitalsInput, sendToDoctor = true): Observable<OpdVitalsRow> {
    return this.api.post(`${OPD_API.vitals}/${visitId}`, { ...v, sendToDoctor });
  }
  skipVitals(visitId: string): Observable<OpdVisitDetail> { return this.api.post(`${OPD_API.vitals}/${visitId}/skip`, {}); }

  queue(opts: { doctorId?: string; all?: boolean } = {}): Observable<OpdVisitRow[]> {
    const q = new URLSearchParams();
    if (opts.doctorId) q.set('doctorId', opts.doctorId);
    if (opts.all) q.set('all', 'true');
    const s = q.toString();
    return this.api.get(`${OPD_API.queue}${s ? `?${s}` : ''}`);
  }
  board(): Observable<QueueDoctor[]> { return this.api.get(`${OPD_API.queue}/board`); }
  callNext(doctorUserId: string): Observable<OpdVisitDetail> { return this.api.post(`${OPD_API.queue}/call-next`, { doctorUserId }); }
  reassign(visitId: string, doctorUserId: string, reason?: string | null): Observable<OpdVisitDetail> {
    return this.api.post(`${OPD_API.queue}/${visitId}/reassign`, { doctorUserId, reason: reason ?? null });
  }
  reschedule(visitId: string, date: string, reason?: string | null): Observable<OpdVisitDetail> {
    return this.api.post(`${OPD_API.queue}/${visitId}/reschedule`, { date, reason: reason ?? null });
  }
  doctorUnavailable(doctorUserId: string, policy?: string | null, rescheduleTo?: string | null): Observable<DoctorUnavailableResult> {
    return this.api.post(`${OPD_API.queue}/doctor-unavailable`, { doctorUserId, policy: policy ?? null, rescheduleTo: rescheduleTo ?? null });
  }

  /** Procedures ordered for later (consult v6). `null` = this server doesn't
   *  have the endpoint yet (404) — the desk hides its tab. Feature-detected
   *  through HttpClient because the 404 status is the signal. */
  proceduresToBook(): Observable<ProcedureToBook[] | null> {
    return this.http.get<{ success: boolean; data?: ProcedureToBook[]; message?: string; error?: string }>(`${environment.apiUrl}/api/opd/procedures/to-book`).pipe(
      map(r => (r && typeof r === 'object' && 'success' in r ? (r.success ? r.data ?? [] : []) : (r as unknown as ProcedureToBook[]) ?? [])),
      catchError((e: HttpErrorResponse) => (e?.status === 404 ? of(null) : throwError(() => ApiError.from(e)))),
    );
  }
  /** Book a later procedure on a date (today … 90 days). 409 already_booked, 400 date_out_of_range. */
  bookProcedure(id: string, date: string, doctorId?: string | null): Observable<{ visitId: string; date: string }> {
    return this.api.post(`/api/opd/procedures/${id}/book`, { date, ...(doctorId ? { doctorId } : {}) });
  }
}
