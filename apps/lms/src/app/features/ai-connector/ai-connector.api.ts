import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

/**
 * The lab's AI connector switch (MCP Phase 0). The server is the ONE home of
 * the setting (per-tenant, DEFAULT OFF — an explicit opt-in, unlike module
 * entitlements' "no row = all on"); the UI only renders it.
 *
 *   GET /api/ai-connector            → any signed-in user of the lab
 *   PUT /api/ai-connector {enabled}  → lab admin only (the server decides)
 *   PUT /api/ai-connector {privacyLevel} → lab admin only; either field may be sent alone
 *   GET /api/ai-connector/resolve/{code} → "open in Prefrontal" links: P-xxxxx / T-n → the real record
 *     (only for the person the code was issued to; anything else is a 404)
 */
export type AiPrivacyLevel = 'counts' | 'results' | 'results_groups';
export interface AiConnectorState {
  enabled: boolean;
  /** The public MCP URL to paste into Claude (e.g. https://…/mcp). */
  connectorUrl: string;
  labName: string;
  /** How much an outside AI may see. Absent (older server) = 'counts', the safest. */
  privacyLevel?: AiPrivacyLevel;
}

/** What a code opens. Patients are masked as P-codes, staff as T-codes, outside Prefrontal. */
export type ResolvedCode =
  | { kind: 'patient'; patientId: string; orderIds: string[] }
  | { kind: 'staff'; userId: string; name: string };

export interface PrivacyLevelInfo { value: AiPrivacyLevel; label: string; summary: string }

/** The three levels in plain words (settings screen only; the server is the ONE enforcer). */
export const AI_PRIVACY_LEVELS: readonly PrivacyLevelInfo[] = [
  { value: 'counts', label: 'Counts only',
    summary: 'Totals and timings only — how many orders, how long things take, what is waiting. No test values and no patient rows.' },
  { value: 'results', label: 'Results, patients as codes',
    summary: 'Also test results and abnormal flags. Patients appear only as short expiring codes like P-K7Q2X — never a name, phone or ID.' },
  { value: 'results_groups', label: 'Results, with age group and sex',
    summary: 'Same as above, plus a broad age group (Child, Adult, Senior) and sex next to each coded patient. Still no names or exact ages.' },
];

/** Who may flip the switch in the UI. Mirrors the server's lab-settings admin
 *  gate (TenantsController settings PATCH: manage_tenant | manage_lab_settings);
 *  the server still refuses anyone else, and the screen says so in words. */
export const AI_CONNECTOR_ADMIN_PERMS = ['manage_tenant', 'manage_lab_settings'];

@Injectable({ providedIn: 'root' })
export class AiConnectorApi {
  private readonly api = inject(ApiService);

  get(): Observable<AiConnectorState> {
    return this.api.get<AiConnectorState>('/api/ai-connector');
  }

  setEnabled(enabled: boolean): Observable<AiConnectorState> {
    return this.api.put<AiConnectorState>('/api/ai-connector', { enabled });
  }

  setPrivacyLevel(privacyLevel: AiPrivacyLevel): Observable<AiConnectorState> {
    return this.api.put<AiConnectorState>('/api/ai-connector', { privacyLevel });
  }

  resolve(code: string): Observable<ResolvedCode> {
    return this.api.get<ResolvedCode>(`/api/ai-connector/resolve/${encodeURIComponent(code)}`);
  }
}

/** Plain-words list of what a connected AI app can read (consent + settings
 *  share it, so the two screens can never promise different things). */
export const AI_CONNECTOR_CAN_SEE: readonly string[] = [
  'Test and order counts for a date range',
  'Turnaround times by department or test',
  'Work waiting at each stage — collect, receive, result, validate, deliver',
  'Analyzer status — online, waiting or offline',
  'Work done per staff member (shown as codes like T-1 — names stay in Prefrontal)',
  'Your Test Master: tests, tubes, preparation, report times and normal ranges (prices only for people who can already see them)',
];

/** The three Claude steps on the settings screen. */
export const CLAUDE_STEPS: readonly string[] = [
  'In Claude, open Settings → Connectors and choose “Add custom connector”.',
  'Name it “Prefrontal”, paste the connector address above and press Add.',
  'Press Connect, sign in with your Prefrontal account and choose Allow.',
];
