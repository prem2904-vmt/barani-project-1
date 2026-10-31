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
    summary: 'Totals and timings, the Test Master and settings — how many orders, how long things take, what is waiting. Questions about one patient (results, reports, a bill) are refused. This is the default.' },
  { value: 'results', label: 'Results, patients as codes',
    summary: 'Also test results, flags, sample and report status and bills. Patients appear only as short expiring codes like P-K7Q2X that open inside Prefrontal — never a name, phone or ID.' },
  { value: 'results_groups', label: 'Results, with age groups',
    summary: 'Same as above, plus a broad age group (Child, Adult, Senior) next to each coded patient where it helps read a result. Still no names or exact ages.' },
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

/** One group of what a connected AI app can read, in plain words. */
export interface CanSeeGroup {
  title: string;
  /** Who / when, in a few words (shown next to the title). */
  when?: string;
  items: readonly string[];
}

/** What a connected AI app can read, grouped (consent + settings share it, so the
 *  two screens can never promise different things). Mirrors the server's 100
 *  read-only tools; the server's privacy gate is the ONE enforcer. */
export const AI_CONNECTOR_CAN_SEE: readonly CanSeeGroup[] = [
  {
    title: 'Test catalogue & lab info',
    items: [
      'Your Test Master: tests, tubes, preparation, report times, normal ranges and critical limits (prices only for people who can already see them)',
      'Profiles and packages and what is in them, and which tests go to a partner lab',
      'Your branches, booking hours, home-collection areas and the lab’s own public phone and email',
    ],
  },
  {
    title: 'Lab operations',
    items: [
      'Orders, tests and samples for a date range, turnaround times and late tests',
      'Work waiting at each step — collect, receive, result, validate, deliver — plus re-runs, rejections and recollections',
      'Analyzers, home collections, stock and expiring lots, alerts and critical-call follow-up',
      'Work per staff member, shown as codes like T-1 — names stay in Prefrontal',
    ],
  },
  {
    title: 'Billing totals',
    when: 'only for people who see money',
    items: [
      'Revenue, collections, dues, discounts, refunds and GST totals',
      'Prices and estimates from the same bill calculator as the counter — never cost prices',
      'How many orders each referring doctor sent (volume only, never money per doctor)',
    ],
  },
  {
    title: 'Patient results as codes',
    when: 'only when your lab’s privacy level allows',
    items: [
      'Results, trends, abnormal and critical values, with each patient shown only as a short expiring code like P-K7Q2X and a link that opens them inside Prefrontal',
      'Where a sample, report or bill is, and when a report is expected',
    ],
  },
  {
    title: 'Admin overview',
    when: 'for lab admins',
    items: [
      'Roles and what they allow, branches, analyzer setup and which modules are on',
      'Test Master health — tests missing ranges or prices, mapping gaps and recent changes',
    ],
  },
];

/** The promises that hold for every group above. */
export const AI_CONNECTOR_NEVER =
  'Never patient or staff names, phone numbers, exact ages or ID numbers, and never a patient’s or staff member’s address. Numbers under 5 show as “fewer than 5”. Each person only sees what their own role allows.';

/** The three Claude steps on the settings screen. */
export const CLAUDE_STEPS: readonly string[] = [
  'In Claude, open Settings → Connectors and choose “Add custom connector”.',
  'Name it “Prefrontal”, paste the connector address above and press Add.',
  'Press Connect, sign in with your Prefrontal account and choose Allow.',
];
