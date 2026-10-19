import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import type { InstrumentDto } from '../instruments/instrument.models';
import {
  BridgeCommandDto, BridgeCommandType, BridgeDetailDto, BridgeDto, BridgePatch, BridgeRemoveResult, ClaimNonceDto,
  ClaimRequest, ClaimResultDto, DetectedSourceDto, DetectedSourceLinkRequest, DetectedSourceLinkResult,
  DetectedSourceState, NearbyBridgeDto,
} from './bridge.models';

const enc = encodeURIComponent;

/** GET /api/bridges query (pure — spec'd). */
export function bridgesUrl(branchId?: string | null): string {
  return branchId ? `/api/bridges?branchId=${enc(branchId)}` : '/api/bridges';
}

/**
 * HTTP for the Bridge user API (bridge-api v1, B.2): JWT + the active branch
 * header, tenant / branch scoped on the server. Thin — every rule lives on
 * the server; the UI only reflects it. The device API (B.1) is the Bridge's
 * and is never called from here.
 */
@Injectable({ providedIn: 'root' })
export class BridgesApiService {
  private readonly api = inject(ApiService);

  list(branchId?: string | null): Observable<BridgeDto[]> { return this.api.get<BridgeDto[]>(bridgesUrl(branchId)); }
  get(id: string): Observable<BridgeDetailDto> { return this.api.get<BridgeDetailDto>(`/api/bridges/${enc(id)}`); }
  patch(id: string, body: BridgePatch): Observable<BridgeDto> { return this.api.patch<BridgeDto>(`/api/bridges/${enc(id)}`, body); }
  /** Revoke: instruments are unassigned, queued messages on the Bridge are discarded. */
  remove(id: string): Observable<BridgeRemoveResult> { return this.api.delete<BridgeRemoveResult>(`/api/bridges/${enc(id)}`); }

  /** Unclaimed Bridges behind the caller's public IP (offer + admin confirm). */
  nearby(): Observable<NearbyBridgeDto[]> { return this.api.get<NearbyBridgeDto[]>('/api/bridges/nearby'); }
  /** 5-minute nonce for a `local` (mDNS) claim, bound to this user + tenant. */
  claimNonce(): Observable<ClaimNonceDto> { return this.api.post<ClaimNonceDto>('/api/bridges/claim/nonce', {}); }
  claim(body: ClaimRequest): Observable<ClaimResultDto> { return this.api.post<ClaimResultDto>('/api/bridges/claim', body); }

  sendCommand(id: string, type: BridgeCommandType, payload: Record<string, unknown> = {}): Observable<BridgeCommandDto> {
    return this.api.post<BridgeCommandDto>(`/api/bridges/${enc(id)}/commands`, { type, payload });
  }
  commands(id: string, limit = 20): Observable<BridgeCommandDto[]> {
    return this.api.get<BridgeCommandDto[]>(`/api/bridges/${enc(id)}/commands?limit=${Math.min(100, Math.max(1, limit))}`);
  }
  command(id: string, commandId: string): Observable<BridgeCommandDto> {
    return this.api.get<BridgeCommandDto>(`/api/bridges/${enc(id)}/commands/${enc(commandId)}`);
  }

  detectedSources(id: string, state: DetectedSourceState | 'all' = 'new'): Observable<DetectedSourceDto[]> {
    return this.api.get<DetectedSourceDto[]>(`/api/bridges/${enc(id)}/detected-sources?state=${enc(state)}`);
  }
  linkSource(id: string, sourceId: string, body: DetectedSourceLinkRequest): Observable<DetectedSourceLinkResult<InstrumentDto>> {
    return this.api.post<DetectedSourceLinkResult<InstrumentDto>>(`/api/bridges/${enc(id)}/detected-sources/${enc(sourceId)}/link`, body);
  }
  ignoreSource(id: string, sourceId: string): Observable<DetectedSourceDto> {
    return this.api.post<DetectedSourceDto>(`/api/bridges/${enc(id)}/detected-sources/${enc(sourceId)}/ignore`, {});
  }

  /** Assign an analyzer to a Bridge (or `null` = back to this computer). */
  assignInstrument(instrumentId: string, bridgeId: string | null): Observable<InstrumentDto> {
    return this.api.put<InstrumentDto>(`/api/instruments/${enc(instrumentId)}/bridge`, { bridgeId });
  }
}
