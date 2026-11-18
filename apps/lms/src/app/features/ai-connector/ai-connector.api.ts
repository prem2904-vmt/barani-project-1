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
 *   PUT /api/ai-connector {proposals} → lab admin only: "let connected assistants SUGGEST Test Master changes"
 *     (default OFF; the changes wait in Test Master → Pending changes, nothing applies by itself)
 *   GET /api/ai-connector/grants → the CALLER's own allowed apps (never anyone else's)
 *   PUT /api/ai-connector/grants/{clientId} {propose} → allow (true) / stop allowing (false = removes the row) ONE app to
 *     suggest Test Master changes; normal sessions only, for yourself only. DELETE …/grants/{clientId} = revoke.
 *   GET /api/ai-connector/resolve/{code} → "open in Prefrontal" links: P-xxxxx / T-n → the real record
 *     (only for the person the code was issued to; anything else is a 404)
 */
export type AiPrivacyLevel = 'counts' | 'results' | 'results_groups';
export interface AiConnectorState {
  enabled: boolean;
  /** The public MCP URL to paste into Claude (e.g. https://…/mcp). */
  connectorUrl: string;
  labName: string;
  /** How much a connected app may see. Absent (older server) = 'counts', the safest. */
  privacyLevel?: AiPrivacyLevel;
  /** Connected assistants may suggest Test Master changes (they wait for a person to approve). Absent (older server) = off. */
  proposals?: boolean;
  /** The lab's "let connected apps build case sheets" switch. Absent (older server) = off. */
  caseSheetBuild?: boolean;
  /** Offer the per-app grant "Can suggest Test Master and case sheet changes" (= proposals || caseSheetBuild). */
  offerAppGrant?: boolean;
}

/** Offer the ONE per-app grant: the server's `offerAppGrant`, or (older server) either switch. */
export function offersAppGrant(s: AiConnectorState | null | undefined): boolean {
  return !!s && (s.offerAppGrant === true || s.proposals === true || s.caseSheetBuild === true);
}

/** One app the signed-in person allowed to suggest Test Master changes (their own list only). */
export interface AiConnectorGrant { clientId: string; propose: boolean; createdAt: string; updatedAt: string }

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

  setProposals(proposals: boolean): Observable<AiConnectorState> {
    return this.api.put<AiConnectorState>('/api/ai-connector', { proposals });
  }

  setPrivacyLevel(privacyLevel: AiPrivacyLevel): Observable<AiConnectorState> {
    return this.api.put<AiConnectorState>('/api/ai-connector', { privacyLevel });
  }

  listGrants(): Observable<AiConnectorGrant[]> {
    return this.api.get<AiConnectorGrant[]>('/api/ai-connector/grants');
  }

  /** propose=true allows the app; propose=false removes any earlier grant. */
  putGrant(clientId: string, propose: boolean): Observable<unknown> {
    return this.api.put<unknown>(`/api/ai-connector/grants/${encodeURIComponent(clientId)}`, { propose });
  }

  deleteGrant(clientId: string): Observable<unknown> {
    return this.api.delete<unknown>(`/api/ai-connector/grants/${encodeURIComponent(clientId)}`);
  }

  resolve(code: string): Observable<ResolvedCode> {
    return this.api.get<ResolvedCode>(`/api/ai-connector/resolve/${encodeURIComponent(code)}`);
  }
}

/** One group of what a connected app can read, in plain words. */
export interface CanSeeGroup {
  title: string;
  /** Who / when, in a few words (shown next to the title). */
  when?: string;
  /** The group in one short line (settings screen's compact Can list; the full items open on demand). */
  brief: string;
  items: readonly string[];
}

/** What a connected app can read, and suggest, grouped (consent + settings share it, so the
 *  two screens can never promise different things). Mirrors the server's connector tools:
 *  reads, plus "suggest a Test Master change" tools that only ever store a pending suggestion;
 *  the server's privacy gate and the lab's suggestion switch are the ONE enforcer. */
export const AI_CONNECTOR_CAN_SEE: readonly CanSeeGroup[] = [
  {
    title: 'Test catalogue & lab info',
    brief: 'Test Master, profiles and packages, branches and hours',
    items: [
      'Your Test Master: tests, tubes, preparation, report times, normal ranges and critical limits (prices only for people who can already see them)',
      'Profiles and packages and what is in them, and which tests go to a partner lab',
      'Your branches, booking hours, home-collection areas and the lab’s own public phone and email',
    ],
  },
  {
    title: 'Lab operations',
    brief: 'Orders, turnaround, work waiting, analyzers and stock',
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
    brief: 'Revenue, dues, discounts and GST totals',
    items: [
      'Revenue, collections, dues, discounts, refunds and GST totals',
      'Prices and estimates from the same bill calculator as the counter — never cost prices',
      'How many orders each referring doctor sent (volume only, never money per doctor)',
    ],
  },
  {
    title: 'Patient results as codes',
    when: 'only when your lab’s privacy level allows',
    brief: 'Results and report status, each patient as a code',
    items: [
      'Results, trends, abnormal and critical values, with each patient shown only as a short expiring code like P-K7Q2X and a link that opens them inside Prefrontal',
      'Where a sample, report or bill is, and when a report is expected',
    ],
  },
  {
    title: 'Admin overview',
    when: 'for lab admins',
    brief: 'Roles, analyzer setup and Test Master health',
    items: [
      'Roles and what they allow, branches, analyzer setup and which modules are on',
      'Test Master health — tests missing ranges or prices, mapping gaps and recent changes',
    ],
  },
];

/** What an app that is ALLOWED to suggest can do (settings shows it as a sixth group; the consent screen shows it only
 *  when the app asked for the suggest scope). Never listed as something every app can do. */
export const AI_CONNECTOR_CAN_SUGGEST: CanSeeGroup = {
  title: 'Suggested Test Master changes',
  when: 'only if your lab allows it',
  brief: 'Suggestions that wait for a person to approve',
    items: [
    'It can suggest new prices, a new test, an edit to a test or a change to what is in a profile',
    'Each suggestion waits in Test Master, Pending changes. Nothing changes until someone with Test Master permission approves it there',
  ],
};

/** The promises that hold for every group above. */
export const AI_CONNECTOR_NEVER =
  'Never patient or staff names, phone numbers, exact ages or ID numbers, and never a patient’s or staff member’s address. Numbers under 5 show as “fewer than 5”. Each person only sees what their own role allows. An app can never approve or apply a change itself.';

/** The same promises as {@link AI_CONNECTOR_NEVER}, as short lines (settings screen's compact Never list). */
export const AI_CONNECTOR_NEVER_ITEMS: readonly string[] = [
  'Patient or staff names',
  'Phone numbers, exact ages or ID numbers',
  'A patient’s or staff member’s address',
  'Exact numbers under 5 — they show as “fewer than 5”',
  'More than the person’s own role allows',
  'Approve or apply a change by itself',
];

/** What the app is promised on the "suggest" switch, in plain words (one home for settings + consent). */
export const AI_CONNECTOR_SUGGEST_TITLE = 'Let connected assistants suggest Test Master changes';
export const AI_CONNECTOR_SUGGEST_ON =
  'On — a connected assistant can suggest changes to the Test Master. Each one waits in Test Master, Pending changes until someone with Test Master permission approves it.';
export const AI_CONNECTOR_SUGGEST_OFF = 'Off — connected assistants can read, but can’t suggest any changes.';
/** Owner rule (2026-11-01): turning suggestions OFF wipes every app's suggest permission on the server, so the
 *  switch's helper text and its confirm both say so, in these exact words. */
export const AI_CONNECTOR_SUGGEST_OFF_EFFECT =
  'Turning this off removes every app’s permission to suggest. People will need to allow it again.';
export const AI_CONNECTOR_SUGGEST_REQUESTED =
  'This app can suggest changes to your Test Master and case sheets. Nothing is applied until someone with permission approves it in Prefrontal.';
/** The consent-screen choice (unticked by default; shown only when the lab allows suggestions). ONE per-app grant covers both
 *  Test Master and case sheet suggestions (`ai_connector_grants.Propose`, approvals 2026-11-11). */
export const AI_CONNECTOR_SUGGEST_OPTION = 'Also let this app suggest Test Master and case sheet changes';
/** What one allowed app may do (the per-app grant, Settings → AI connectors → Your apps). */
export const AI_CONNECTOR_GRANT_LABEL = 'Can suggest Test Master and case sheet changes';

/** Per-browser convenience: the app's name, remembered when the person allows it, so the "apps allowed" list can show a name
 *  (the server keeps only the app's id). Never trusted for anything but display; always rendered as text. */
const APP_NAMES_KEY = 'pf.aic.appnames';
export function rememberAppName(clientId: string, name: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(APP_NAMES_KEY) ?? '{}') as Record<string, string>;
    map[clientId] = name.slice(0, 80);
    localStorage.setItem(APP_NAMES_KEY, JSON.stringify(map));
  } catch { /* private window / blocked storage: the list falls back to a generic label */ }
}
export function rememberedAppName(clientId: string): string | null {
  try {
    const v = (JSON.parse(localStorage.getItem(APP_NAMES_KEY) ?? '{}') as Record<string, unknown>)[clientId];
    return typeof v === 'string' && v.trim() ? v : null;
  } catch { return null; }
}

/** One app the lab can connect. `{url}` in a step is replaced with the lab's connector address. */
export interface ConnectApp {
  id: string;
  name: string;
  /** One plain line under "Steps" (who can do this / where). */
  note: string;
  steps: readonly string[];
}

/** Apps that can connect, with each one's own steps (the address is the same for all). Plain words for lab staff. */
export const CONNECT_APPS: readonly ConnectApp[] = [
  { id: 'claude', name: 'Claude', note: 'On a Team or Enterprise plan an owner adds it once; everyone else just presses Connect.',
    steps: [
      'In Claude, open Customize → Connectors and choose + Add, then Add custom connector.',
      'Name it “Prefrontal”, paste the connector address above and press Continue, then Add.',
      'Press Connect, sign in with your Prefrontal account and choose Allow.',
      'Team or Enterprise: an owner first opens Organization settings → Connectors, chooses Add → Custom → Web and enters the same name and address.',
    ] },
  { id: 'chatgpt', name: 'ChatGPT', note: 'Use ChatGPT in a web browser. Your ChatGPT plan or workspace must allow custom connectors.',
    steps: [
      'In ChatGPT on the web, open chatgpt.com/plugins and press the plus button, then Add custom MCP server.',
      'Name it “Prefrontal”, paste the connector address above as the Server URL, and set sign-in to OAuth.',
      'Read the warning, choose “I understand and want to continue”, then Create as a plugin.',
      'Install it, sign in with your Prefrontal account and choose Allow. In a chat, type @ and pick Prefrontal.',
    ] },
  { id: 'copilot', name: 'Microsoft Copilot', note: 'Everyday Microsoft Copilot has no place to add one. It is added to an agent in Copilot Studio, usually by an admin.',
    steps: [
      'In Copilot Studio, open your agent, go to Tools, press Add a tool, then New tool, then Model Context Protocol.',
      'Enter a name such as “Prefrontal”, a short description, and paste the connector address above as the Server URL.',
      'Under Authentication choose OAuth 2.0, then Dynamic discovery, and press Create.',
      'Press Next, then Create a new connection, sign in with your Prefrontal account and choose Allow. Finish with Add to agent.',
    ] },
  { id: 'codex', name: 'OpenAI Codex', note: 'Codex runs in a terminal window on your computer.',
    steps: [
      'Open a terminal and run: codex mcp add prefrontal --url {url}',
      'Sign in by running: codex mcp login prefrontal',
      'A browser window opens. Sign in with your Prefrontal account and choose Allow.',
      'Check it with: codex mcp list. You can also add it by hand in the file ~/.codex/config.toml under a [mcp_servers.prefrontal] heading with url = "{url}".',
    ] },
  { id: 'gemini', name: 'Gemini', note: 'This works in Gemini CLI, Google’s command-line tool, on your computer.',
    steps: [
      'Open a terminal and run: gemini mcp add --transport http -s user prefrontal {url}',
      'Start Gemini CLI and type: /mcp auth prefrontal',
      'A browser window opens. Sign in with your Prefrontal account and choose Allow.',
      'Type /mcp to check that Prefrontal is connected. You can also add it by hand in ~/.gemini/settings.json under mcpServers, with "httpUrl": "{url}".',
    ] },
  { id: 'cursor', name: 'Cursor', note: 'You add it in Cursor’s mcp.json file.',
    steps: [
      'Open the file ~/.cursor/mcp.json on your computer (create it if it is missing). Use .cursor/mcp.json inside a project to connect for that project only.',
      'Add an entry named “prefrontal” with the connector address as its url: {"mcpServers": {"prefrontal": {"url": "{url}"}}}',
      'Save the file. Cursor asks you to sign in: use your Prefrontal account and choose Allow.',
    ] },
  { id: 'other', name: 'Other (any app that supports MCP connectors)', note: 'Look for “connectors”, “tools” or “MCP” in the app’s settings.',
    steps: [
      'In the app, find where you add a connector or a remote MCP server.',
      'Choose a remote server that works over the web (HTTP), then paste the connector address above.',
      'If it asks how to sign in, choose OAuth and leave any key or client fields empty.',
      'Sign in with your Prefrontal account and choose Allow.',
    ] },
];
