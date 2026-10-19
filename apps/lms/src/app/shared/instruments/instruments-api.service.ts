import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import {
  CodeMapDto, CodeMapUpsert, DeviceKeyDto, ImageCodeDto, ImageMapUpsert, InstrumentDto, InstrumentUpsert,
  LoincSuggestionDto, MessageDetailDto, MessagePage, MessageSummaryDto, SamplePrefillDto,
} from './instrument.models';
import { DeviceOrdersDto, ordersPreviewUrl } from './instrument-two-way';

export type MessageStateFilter = 'unmatched' | 'qc' | 'matched' | 'superseded' | 'duplicate' | 'all';

export interface MessageQuery {
  state?: MessageStateFilter;
  instrumentId?: string | null;
  /** The as-reported (pre-match) sample id/barcode a message carries —
   *  "Fetch from analyzer" (sample result entry) narrows to the tube
   *  that's already open, so an unmatched run for it surfaces here. */
  sampleId?: string | null;
  page?: number;
  /** Server clamps to ≤ 100. */
  pageSize?: number;
}

/** Query string for GET /api/instruments/messages (pure — spec'd). */
export function messagesUrl(q: MessageQuery = {}): string {
  const p = new URLSearchParams();
  if (q.state) p.set('state', q.state);
  if (q.instrumentId) p.set('instrumentId', q.instrumentId);
  if (q.sampleId) p.set('sampleId', q.sampleId);
  p.set('page', String(Math.max(1, q.page ?? 1)));
  p.set('pageSize', String(Math.min(100, Math.max(1, q.pageSize ?? 50))));
  return `/api/instruments/messages?${p.toString()}`;
}

/** Query string for GET /api/instruments/{id}/code-map-suggestions (pure —
 *  spec'd). `units` (same order/length as `codes`) carries the analyzer's
 *  own OBX-6 unit for a code when the caller already has it (from a real
 *  message/preview); blank entries are fine, omitted entirely when nothing
 *  is known for any code. */
export function codeMapSuggestionsUrl(id: string, codes: readonly string[], units?: readonly (string | null | undefined)[]): string {
  const p = new URLSearchParams();
  p.set('codes', codes.join(','));
  if (units?.some((u) => !!u)) p.set('units', codes.map((_, i) => units[i] ?? '').join(','));
  return `/api/instruments/${encodeURIComponent(id)}/code-map-suggestions?${p.toString()}`;
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

  /** The image codes (graphs) the analyzer sends + the profiles each is mapped to. */
  imageMaps(id: string): Observable<ImageCodeDto[]> {
    return this.api.get<ImageCodeDto[]>(`/api/instruments/${encodeURIComponent(id)}/image-maps`);
  }
  /** Set which profiles each listed image code shows on (stored in each profile's layout JSON — page_layout.analyzerImages — on its effective row). */
  saveImageMaps(id: string, maps: ImageMapUpsert[]): Observable<ImageCodeDto[]> {
    return this.api.put<ImageCodeDto[]>(`/api/instruments/${encodeURIComponent(id)}/image-maps`, maps);
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

  /** "Test a barcode" (two-way): exactly what the analyzer would be told for
   *  this tube, using the instrument's SAVED settings (user auth, admin). */
  ordersPreview(id: string, sampleId: string): Observable<DeviceOrdersDto> {
    return this.api.get<DeviceOrdersDto>(ordersPreviewUrl(id, sampleId));
  }

  /** LOINC auto-match suggestions for codes with no code-map row yet (the
   *  editor's "Add unmapped codes" / a typed-code lookup). */
  codeMapSuggestions(id: string, codes: string[], units?: (string | null | undefined)[]): Observable<LoincSuggestionDto[]> {
    if (!codes.length) return of([]);
    return this.api.get<LoincSuggestionDto[]>(codeMapSuggestionsUrl(id, codes, units));
  }
}
