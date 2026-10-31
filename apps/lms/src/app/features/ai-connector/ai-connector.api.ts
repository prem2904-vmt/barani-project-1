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
 */
export interface AiConnectorState {
  enabled: boolean;
  /** The public MCP URL to paste into Claude (e.g. https://…/mcp). */
  connectorUrl: string;
  labName: string;
}

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
}

/** Plain-words list of what a connected AI app can read (consent + settings
 *  share it, so the two screens can never promise different things). */
export const AI_CONNECTOR_CAN_SEE: readonly string[] = [
  'Test and order counts for a date range',
  'Turnaround times by department or test',
  'Work waiting at each stage — collect, receive, result, validate, deliver',
  'Analyzer status — online, waiting or offline',
  'Work done per staff member',
];

/** The three Claude steps on the settings screen. */
export const CLAUDE_STEPS: readonly string[] = [
  'In Claude, open Settings → Connectors and choose “Add custom connector”.',
  'Name it “Prefrontal”, paste the connector address above and press Add.',
  'Press Connect, sign in with your Prefrontal account and choose Allow.',
];
