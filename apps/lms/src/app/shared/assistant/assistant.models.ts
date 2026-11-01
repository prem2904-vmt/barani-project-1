/**
 * In-app AI assistant (BETA, dev only — `pf.assistant()` + the server's
 * RequireBeta("assistant")). The contract with mw:
 *
 *   GET  /api/assistant/providers            → AssistantProvider[]
 *   POST /api/assistant/<page>/chat          → AssistantReply
 *
 * The assistant only SUGGESTS. Nothing it says is applied anywhere until a
 * person does it in the existing screen (and saves there). Everything the
 * model sends back is UNTRUSTED text: it is rendered as text (never HTML),
 * links only http(s), never opened on their own.
 */

import type { Observable } from 'rxjs';

export type AssistantProviderId = 'gemini' | 'claude';

export interface AssistantProvider {
  id: AssistantProviderId;
  label: string;
  /** False when the server has no key / the provider is switched off. */
  available: boolean;
}

/** Which assistant a page talks to. Instruments is the first home; a new
 *  page adds its id here + a server endpoint `/api/assistant/<id>/chat`
 *  (Insights: the dashboard builder, which sends its own request through
 *  {@link AssistantPageContext.chat}). */
export type AssistantPage = 'instruments' | 'insights' | 'test-master';

export type AssistantRole = 'user' | 'assistant';

export interface AssistantTurn {
  role: AssistantRole;
  text: string;
}

export interface AssistantTestRef {
  testId: string;
  code: string;
  name: string;
}

export interface SettingSuggestion {
  kind: 'setting';
  label: string;
  value: string;
  note?: string | null;
}

export interface MappingSuggestion {
  kind: 'mapping';
  analyzerCode: string;
  unit?: string | null;
  tests: AssistantTestRef[];
  confidence: 'high' | 'medium' | 'low';
  why?: string | null;
}

export interface ActionSuggestion {
  kind: 'action';
  text: string;
}

/**
 * A proposed change set the HOST page made from a model answer (Insights: a
 * dashboard recipe shown as a live preview). Never parsed from model text —
 * `normaliseSuggestions` drops this kind; only a host `chat` transport adds
 * it, after its own shape checks. The panel shows the plain list + Keep / Undo
 * and reports the press; the host owns what happens.
 */
export interface ChangesSuggestion {
  kind: 'changes';
  /** Host id of the proposal (status lookup + the Keep / Undo outputs). */
  ref: string;
  changes: string[];
}

/** A Test Master change Cortex saved as a PENDING suggestion (never applied): the card says where to review it. */
export interface ProposalSuggestion {
  kind: 'proposal';
  /** The proposal id (Pending changes). */
  id: string;
  /** One plain line: "CBC ₹250 → ₹300". */
  label: string;
  /** price | test_create | test_update | ... (shown as a small tag). */
  note?: string | null;
}

export type AssistantSuggestion = SettingSuggestion | MappingSuggestion | ActionSuggestion | ChangesSuggestion | ProposalSuggestion;

/** What one "Read a rate card" produced (`POST /api/assistant/test-master/rate-card/{id}/read`). */
export interface RateCardSummary {
  batchId: string;
  pages: number;
  pagesRead: number;
  lines: number;
  priceSuggestions: number;
  newTestSuggestions: number;
  /** Rows added to Pending (price + new test). */
  suggestions: number;
  /** Lines whose test already has that price. */
  alreadyCurrent: number;
  /** Matched lines with no price printed. */
  noPrice: number;
  unmatched: { n: number; text: string; reason: string }[];
  notes: string[];
  provider: string;
  model: string;
}

/** An upload the panel sends to the rate-card endpoints (JPEG pages made in the browser). */
export interface RateCardUpload { uploadId: string; pages: number; }

/** Where a host's proposal stands (drives the Keep / Undo card). */
export type ProposalStatus = 'pending' | 'kept' | 'undone' | 'replaced';

export interface AssistantUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AssistantReply {
  reply: string;
  suggestions: AssistantSuggestion[];
  provider: AssistantProviderId | string;
  model: string;
  usage?: AssistantUsage | null;
}

export interface AssistantChatRequest {
  provider: AssistantProviderId;
  instrumentId?: string | null;
  messages: AssistantTurn[];
  /** Desktop only: this PC's network check (electronAPI.instruments.diag.snapshot()). */
  diag?: unknown;
}

/** One "Add to mapping" hand-off: the row the mapping editor opens prefilled.
 *  The person checks it and presses Save — never saved for them. */
export interface MappingPrefill {
  instrumentId?: string | null;
  analyzerCode: string;
  unit?: string | null;
  testId?: string | null;
  testCode?: string | null;
  testName?: string | null;
}

/** Router-state key the instrument editor reads a hand-off from. */
export const MAP_PREFILL_STATE_KEY = 'pfMapPrefill';

/** An instrument the assistant may be asked about (list page picker). */
export interface AssistantInstrumentRef {
  id: string;
  name: string;
}

/**
 * What the HOST page tells the panel. Reusable: a future page passes its own
 * `page` + starters; the panel itself knows nothing about instruments beyond
 * the optional instrument picker.
 */
export interface AssistantPageContext {
  page: AssistantPage;
  /** Shown under the panel title ("Sysmex XN", "Connect an analyzer"). */
  subject?: string | null;
  /** The instrument this page is about (editor; wizard once created). */
  instrumentId?: string | null;
  /** List page: the instruments the person can pick to ask about. */
  instruments?: AssistantInstrumentRef[] | null;
  /** False ⇒ mapping cards show why they can't be added yet. */
  canAddMapping?: boolean;
  /** Why "Add to mapping" is off (shown under the button). */
  addMappingHint?: string | null;
  /** A network check the page already has (connect wizard); else the panel
   *  asks the desktop app for one itself. Instruments only. */
  diag?: unknown;
  /** The page's own transport (Insights sends its recipe with the turns).
   *  Absent = the default `/api/assistant/<page>/chat` instruments request. */
  chat?: (req: { provider: AssistantProviderId; messages: AssistantTurn[] }) => Observable<AssistantReply>;
  /** Status per `changes` card ref (Insights proposals). */
  proposals?: Readonly<Record<string, ProposalStatus>>;
  /** Test Master: the composer gets Attach + camera and a rate card can be read (photos / PDF → JPEG pages in the browser). */
  attachments?: 'rate-card';
}

/** Starter prompts per page (plain words). */
export const ASSISTANT_STARTERS: Readonly<Record<AssistantPage, readonly string[]>> = {
  instruments: [
    'Why is this analyzer offline?',
    'What should I set on the analyzer?',
    'Suggest mappings for unmapped codes',
  ],
  insights: [
    'Morning view for the lab owner',
    'Patient flow by hour today',
    'Revenue and dues this month',
  ],
  'test-master': [
    'Which tests have no price yet?',
    'Set the CBC price to 300',
    'Which tests are missing a reference range?',
  ],
};

/** Display names per page (panel title). */
export const ASSISTANT_TITLES: Readonly<Record<AssistantPage, string>> = {
  instruments: 'Instruments assistant',
  insights: 'Dashboard assistant',
  'test-master': 'Test Master assistant',
};

/** The line above the starters, the composer placeholder and the fine print. */
export const ASSISTANT_COPY: Readonly<Record<AssistantPage, { lead: string; placeholder: string; fine: string }>> = {
  instruments: {
    lead: 'Ask about this lab’s analyzers — why one is offline, what to set on it, or which test an analyzer code should fill.',
    placeholder: 'Ask about this analyzer…',
    fine: 'Suggestions only — nothing changes until you change it and save.',
  },
  insights: {
    lead: 'Say what you want to see — “add patient flow by hour, make revenue a line chart, last 30 days”. The dashboard updates as a preview; keep it or undo it.',
    placeholder: 'Describe a change to this dashboard…',
    fine: 'Cortex only sees the list of charts, never your lab’s numbers. Nothing is saved until you save.',
  },
  'test-master': {
    lead: 'Add a photo or PDF of a rate card and Cortex will suggest price changes and new tests. Or ask about your tests — “set CBC to 300”. Everything waits in Pending for you to approve.',
    placeholder: 'Ask about your tests or prices…',
    fine: 'Cortex never saves a change itself. Suggestions wait in Pending until you approve them one by one.',
  },
};
