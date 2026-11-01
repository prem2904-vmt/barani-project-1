/**
 * Test Master change proposals ("Pending changes", beta `assistant`) — the
 * wire shapes of prefrontal-mw `api/tm-proposals` (TmProposalsController /
 * TmProposalService.TmProposalView). A proposal is a change someone (Cortex,
 * an outside assistant through the AI connector) ASKED for; nothing applies
 * itself — a person approves or rejects each one, one at a time.
 */

export type TmProposalKind = 'price' | 'offered' | 'test_update' | 'test_create' | 'bundle_members' | 'partner_price';
export type TmProposalStatus = 'pending' | 'stale' | 'failed' | 'approved' | 'rejected' | 'withdrawn' | 'expired';
/** `pf_sense` = Cortex inside the app (code name unchanged); `connector` = an outside assistant. */
export type TmProposalSource = 'pf_sense' | 'connector';

/** JSON object as the server stored it (payload / before / current). */
export type TmJson = Record<string, unknown>;

export interface TmProposal {
  id: string;
  kind: TmProposalKind | string;
  status: TmProposalStatus | string;
  targetTestId?: string | null;
  /** "CBC (HEM001)" / "New test: Vitamin B12" — snapshot at proposal time. */
  targetLabel: string;
  /** One server line for the list ("Price 250 → 300", "Edit: unit, tatHours"). */
  summary: string;
  /** Flagged clinical field names (camelCase payload keys). */
  clinicalFields: string[];
  /** 0–100 from the matcher / model; null = typed by a person. */
  confidence?: number | null;
  source: TmProposalSource | string;
  /** "gemini:gemini-2.5-flash" / "claude:…" / null (outside assistant). */
  sourceModel?: string | null;
  /** OAuth client of an outside assistant (AI connector); null in-app. */
  clientId?: string | null;
  batchId?: string | null;
  reason?: string | null;
  proposedBy: string;
  isMine: boolean;
  createdAt: string;
  expiresAt: string;
  reviewedAt?: string | null;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
  appliedTestId?: string | null;
  /** Apply failure code (status `failed`). */
  error?: string | null;
  branchId?: string | null;
  /** How the test was found: code | name | short_name | panel | loinc | similarity | model | manual. */
  matchedBy?: string | null;
  /** The server's plain-words change lines (labels, ₹ formatting): prefer these over formatting payload keys. */
  changes?: TmChange[] | null;
  // ── detail only (GET /{id}) ──
  payload?: TmJson | null;
  /** The touched fields' values when it was suggested (or last re-reviewed). */
  before?: TmJson | null;
  /** The same fields' values RIGHT NOW (pending / stale / failed only). */
  current?: TmJson | null;
  changedSinceProposed?: boolean | null;
}

/** One line of "what changes", already in words by the server (prefrontal-mw TmChange). */
export interface TmChange {
  /** Payload key (to key on). */
  field: string;
  label: string;
  before?: string | null;
  after?: string | null;
  clinical: boolean;
}

/** Open items by status for the caller's scope, counted after the stale flip; not narrowed by the list filters. */
export interface TmProposalCounts {
  pending: number;
  stale: number;
  failed: number;
}

export interface TmProposalPage {
  items: TmProposal[];
  total: number;
  /** Pending rows the caller may see (the server's own count). */
  pendingCount: number;
  counts?: TmProposalCounts | null;
}
