import { Injectable, inject } from '@angular/core';
import { Observable, map, of } from 'rxjs';
import { ApiService } from './api.service';
import {
  CriticalAckVia, CriticalRegisterFilter, CriticalRegisterPage, CriticalResultEvent, RecordCommunicationInput,
} from '../../shared/models/critical-result.model';

/**
 * The critical-result acknowledgement record's API (`/api/critical-results`)
 * — shared by the bell, the result screens, the pathologist queue and the
 * register so every "Acknowledge" hits the same endpoint with its channel.
 */
@Injectable({ providedIn: 'root' })
export class CriticalResultsService {
  private readonly api = inject(ApiService);

  static query(f: CriticalRegisterFilter): string {
    const q = new URLSearchParams();
    if (f.status && f.status !== 'all') q.set('status', f.status);
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    if (f.branchId) q.set('branchId', f.branchId);
    if (f.page) q.set('page', String(f.page));
    if (f.pageSize) q.set('pageSize', String(f.pageSize));
    const s = q.toString();
    return s ? '?' + s : '';
  }

  list(f: CriticalRegisterFilter): Observable<CriticalRegisterPage> {
    return this.api.get<CriticalRegisterPage>('/api/critical-results' + CriticalResultsService.query(f));
  }

  /** Open / acknowledged records for these result rows (the badge lookup — a
   *  read, so it never lands among a screen's writes). */
  lookupOpen(orderTestIds: string[]): Observable<CriticalResultEvent[]> {
    const ids = [...new Set(orderTestIds.filter(Boolean))];
    if (ids.length === 0) return of([]);
    return this.api.get<CriticalResultEvent[]>('/api/critical-results/lookup?orderTestIds=' + ids.map(encodeURIComponent).join(','))
      .pipe(map(l => (Array.isArray(l) ? l : [])));
  }

  acknowledge(id: string, via: CriticalAckVia): Observable<CriticalResultEvent> {
    return this.api.post<CriticalResultEvent>(`/api/critical-results/${id}/acknowledge`, { via });
  }

  /** The bell / a result row key by the order test: every record of it. */
  acknowledgeOrderTest(orderTestId: string, via: CriticalAckVia): Observable<CriticalResultEvent[]> {
    return this.api.post<CriticalResultEvent[]>(`/api/critical-results/order-test/${orderTestId}/acknowledge`, { via });
  }

  recordCommunication(id: string, input: RecordCommunicationInput): Observable<CriticalResultEvent> {
    return this.api.post<CriticalResultEvent>(`/api/critical-results/${id}/communication`, input);
  }

  /** The server's CSV (every filtered row, IST times) as a Blob. */
  exportCsv(f: CriticalRegisterFilter): Observable<Blob> {
    const { page: _p, pageSize: _s, ...rest } = f;
    return this.api.getBlob('/api/critical-results/export.csv' + CriticalResultsService.query(rest));
  }
}
