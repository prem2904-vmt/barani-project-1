import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import {
  CodeMapDto, CodeMapUpsert, DeviceKeyDto, InstrumentDto, InstrumentUpsert,
  MessageDetailDto, MessagePage, MessageSummaryDto, SamplePrefillDto,
} from './instrument.models';

export type MessageStateFilter = 'unmatched' | 'qc' | 'matched' | 'superseded' | 'duplicate' | 'all';

export interface MessageQuery {
  state?: MessageStateFilter;
  instrumentId?: string | null;
  page?: number;
  /** Server clamps to ≤ 100. */
  pageSize?: number;
}

/** Query string for GET /api/instruments/messages (pure — spec'd). */
export function messagesUrl(q: MessageQuery = {}): string {
  const p = new URLSearchParams();
  if (q.state) p.set('state', q.state);
  if (q.instrumentId) p.set('instrumentId', q.instrumentId);
  p.set('page', String(Math.max(1, q.page ?? 1)));
  p.set('pageSize', String(Math.min(100, Math.max(1, q.pageSize ?? 50))));
  return `/api/instruments/messages?${p.toString()}`;
}

/**
 * Thin HTTP wrapper over ApiService for the instrument-connector admin +
 * result-entry endpoints (user JWT, tenant + branch scoped server-side).
 * The device endpoints (X-Instrument-Key) are the Electron connector's —
 * never called from here.
 */
@Injectable({ providedIn: 'root' })
export class InstrumentsApiService {
  private readonly api = inject(ApiService);

  list(): Observable<InstrumentDto[]> { return this.api.get<InstrumentDto[]>('/api/instruments'); }
  get(id: string): Observable<InstrumentDto> { return this.api.get<InstrumentDto>(`/api/instruments/${encodeURIComponent(id)}`); }
  create(body: InstrumentUpsert): Observable<InstrumentDto> { return this.api.post<InstrumentDto>('/api/instruments', body); }
  update(id: string, body: InstrumentUpsert): Observable<InstrumentDto> {
    return this.api.put<InstrumentDto>(`/api/instruments/${encodeURIComponent(id)}`, body);
  }
  remove(id: string): Observable<unknown> { return this.api.delete<unknown>(`/api/instruments/${encodeURIComponent(id)}`); }

  /** Plaintext key is returned ONCE; rotating invalidates the old key. */
  generateDeviceKey(id: string): Observable<DeviceKeyDto> {
    return this.api.post<DeviceKeyDto>(`/api/instruments/${encodeURIComponent(id)}/device-key`, {});
  }

  codeMaps(id: string): Observable<CodeMapDto[]> {
    return this.api.get<CodeMapDto[]>(`/api/instruments/${encodeURIComponent(id)}/code-maps`);
  }
  /** Replace-all. */
  saveCodeMaps(id: string, maps: CodeMapUpsert[]): Observable<CodeMapDto[]> {
    return this.api.put<CodeMapDto[]>(`/api/instruments/${encodeURIComponent(id)}/code-maps`, maps);
  }

  messages(q: MessageQuery = {}): Observable<MessagePage> { return this.api.get<MessagePage>(messagesUrl(q)); }
  message(messageId: string): Observable<MessageDetailDto> {
    return this.api.get<MessageDetailDto>(`/api/instruments/messages/${encodeURIComponent(messageId)}`);
  }
  attach(messageId: string, barcode: string): Observable<MessageSummaryDto> {
    return this.api.post<MessageSummaryDto>(`/api/instruments/messages/${encodeURIComponent(messageId)}/attach`, { barcode });
  }

  /** Result-entry prefill for one tube (runs newest first, QC excluded). */
  prefillForSample(orderSampleId: string): Observable<SamplePrefillDto> {
    return this.api.get<SamplePrefillDto>(`/api/instruments/results/by-sample/${encodeURIComponent(orderSampleId)}`);
  }
}
