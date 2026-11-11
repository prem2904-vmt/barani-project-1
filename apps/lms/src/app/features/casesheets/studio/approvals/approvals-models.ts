import type { FormDefinition } from '@prefrontal/forms-engine';
import { ChecksResult } from '../builder/builder-models';
import { toChecks } from '../builder/builder-api';
import { toProblem } from '../data/http-studio-api';
import { DiffChange, Problem } from '../data/studio-models';

/**
 * Case sheets follow the Test Master pattern (plan casesheet-masters-approvals.md, "Contract (built)"): suggestions from Cortex or a
 * connected app wait in "Pending changes" until a person approves ONE at a time (approving publishes straight away), and newer
 * Prefrontal master versions of the lab's own copies wait in "From Prefrontal". Wire shapes + plain words live here, once.
 */

export type ProposalStatus = 'building' | 'pending' | 'stale' | 'failed' | 'approved' | 'rejected' | 'withdrawn';
export type ProposalKind = 'create' | 'edit';
export type ProposalSource = 'cortex' | 'connector';
export type OfferStatus = 'pending' | 'accepted' | 'dismissed' | 'superseded';
/** The list filter: `open` = pending + stale + failed (the server default). */
export type ProposalFilter = 'open' | 'all' | 'approved' | 'rejected' | 'withdrawn';

export interface ProposalCounts { pending: number; stale: number; failed: number }

export interface ProposalCurrent { versionId: string; versionNo: number; state: string; definition: FormDefinition | null }

export interface ProposalDetail {
  /** The case sheet as it stands NOW (a master's live version for a shared master); null for a create. */
  current: ProposalCurrent | null;
  proposed: FormDefinition;
  /** "2 questions added, 1 sentence changed" (null for a create). */
  headline: string | null;
  changes: DiffChange[];
  problems: Problem[];
  checks: ChecksResult;
  canApprove: boolean;
}

export interface ProposalView {
  id: string;
  kind: ProposalKind;
  status: ProposalStatus;
  formId: string | null;
  catalogKey: string | null;
  title: string;
  departmentKey: string | null;
  /** Plain words, one line per change. */
  summary: string[];
  source: ProposalSource;
  clientId: string | null;
  appName: string | null;
  proposedBy: string;
  proposedByName: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  note: string | null;
  /** The code a failed approve was refused with. */
  error: string | null;
  appliedFormId: string | null;
  appliedVersionId: string | null;
  basisVersionId: string | null;
  /** An edit of a Prefrontal master the lab has not taken over (approving makes the lab's own copy). */
  sharedMaster: boolean;
  detail: ProposalDetail | null;
}

export interface ProposalPage { items: ProposalView[]; total: number; counts: ProposalCounts }

export interface OfferView {
  id: string;
  catalogKey: string;
  /** The lab's own copy. */
  formId: string;
  title: string;
  masterVersionId: string;
  masterVersionNo: number;
  masterPublishedAt: string | null;
  yourBasisVersionNo: number | null;
  status: OfferStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  youHaveADraft: boolean;
  headline: string | null;
  changes: DiffChange[];
}

/** A refusal from the approvals endpoints: `code` is the problem+json code, `message` plain words. */
export class ApprovalError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0, readonly detail = '') {
    super(message);
  }
}

/** Plain words per contract code (our own wording; the server's `detail` is used only for codes not listed). */
export const APPROVAL_WORDS: Record<string, string> = {
  changed_since_proposed: 'This case sheet changed after the suggestion was made, so it was not published. Look again to compare it with today’s version.',
  not_pending: 'Someone has already dealt with this suggestion.',
  not_stale: 'This suggestion is already up to date.',
  target_missing: 'The case sheet this suggestion is about is no longer there.',
  archived: 'That case sheet is archived. Bring it back in Case sheets first.',
  form_has_errors: 'This suggestion has problems that stop it being published. Reject it and ask for a corrected one.',
  title_missing: 'This suggestion has no case sheet name, so it can’t be published. Reject it and ask for a corrected one.',
  someone_else_saved: 'Someone saved this case sheet a moment ago. Look again, then decide.',
  draft_open: 'Your copy has a draft that is still being edited. Publish or discard that draft first, then take Prefrontal’s version.',
  offer_outdated: 'Prefrontal has published an even newer version. Refresh to see it.',
  nothing_changed: 'Cortex hasn’t changed anything yet, so there is nothing to send.',
  already_sent: 'This suggestion was already sent for approval.',
  not_found: 'That suggestion is no longer there.',
  connector_token_not_allowed: 'Connected apps can’t open Pending changes.',
};

/** Words for anything an approvals call throws. */
export function approvalWords(e: unknown, fallback = 'Couldn’t do that just now. Please try again.'): string {
  if (e instanceof ApprovalError) return e.message;
  if ((e as { status?: number })?.status === 0) return 'Can’t reach the server right now.';
  return fallback;
}

export const errorCode = (e: unknown): string => (e instanceof ApprovalError ? e.code : '');

/* ---------------- wire → models ---------------- */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const STATUSES: ProposalStatus[] = ['building', 'pending', 'stale', 'failed', 'approved', 'rejected', 'withdrawn'];
const OFFER_STATUSES: OfferStatus[] = ['pending', 'accepted', 'dismissed', 'superseded'];

export function toChange(v: unknown): DiffChange {
  const o = obj(v);
  return {
    type: str(o['type']),
    pageKey: strOrNull(o['pageKey']),
    pageTitle: strOrNull(o['pageTitle']),
    fieldKey: strOrNull(o['fieldKey']),
    fieldLabel: strOrNull(o['fieldLabel']),
    what: strOrNull(o['what']),
    before: strOrNull(o['before']),
    after: strOrNull(o['after']),
    words: str(o['words']),
  };
}

/** The `changeSummary` headline ("2 fields added"), or null when there is none. */
function headline(v: unknown): string | null {
  const h = str(obj(v)['headline']).trim();
  return h || null;
}

const definition = (v: unknown): FormDefinition | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as FormDefinition) : null);

export function toDetail(v: unknown): ProposalDetail | null {
  if (!v || typeof v !== 'object') return null;
  const d = obj(v);
  const c = d['current'] && typeof d['current'] === 'object' ? obj(d['current']) : null;
  return {
    current: c ? { versionId: str(c['versionId']), versionNo: num(c['versionNo']), state: str(c['state']), definition: definition(c['definition']) } : null,
    proposed: definition(d['proposed']) ?? ({ pages: [] } as unknown as FormDefinition),
    headline: headline(d['changeSummary']),
    changes: arr(d['changes']).map(toChange).filter((x) => x.words),
    problems: arr(d['problems']).map(toProblem),
    checks: toChecks(d['checks']),
    canApprove: d['canApprove'] === true,
  };
}

export function toProposal(v: unknown): ProposalView {
  const p = obj(v);
  const summary = str(p['summary']).split('\n').map((s) => s.trim()).filter(Boolean);
  return {
    id: str(p['id']),
    kind: p['kind'] === 'create' ? 'create' : 'edit',
    status: STATUSES.find((s) => s === p['status']) ?? 'pending',
    formId: strOrNull(p['formId']),
    catalogKey: strOrNull(p['catalogKey']),
    title: str(p['title']) || 'Untitled case sheet',
    departmentKey: strOrNull(p['departmentKey']),
    summary,
    source: p['source'] === 'connector' ? 'connector' : 'cortex',
    clientId: strOrNull(p['clientId']),
    appName: strOrNull(p['appName']),
    proposedBy: str(p['proposedBy']),
    proposedByName: strOrNull(p['proposedByName']),
    createdAt: str(p['createdAt']),
    updatedAt: str(p['updatedAt']) || str(p['createdAt']),
    decidedAt: strOrNull(p['decidedAt']),
    decidedByName: strOrNull(p['decidedByName']),
    note: strOrNull(p['note']),
    error: strOrNull(p['error']),
    appliedFormId: strOrNull(p['appliedFormId']),
    appliedVersionId: strOrNull(p['appliedVersionId']),
    basisVersionId: strOrNull(p['basisVersionId']),
    sharedMaster: p['sharedMaster'] === true,
    detail: toDetail(p['detail']),
  };
}

export function toCounts(v: unknown): ProposalCounts {
  const c = obj(v);
  return { pending: num(c['pending']), stale: num(c['stale']), failed: num(c['failed']) };
}

export function toPage(v: unknown): ProposalPage {
  const r = obj(v);
  const items = arr(r['items']).map(toProposal);
  return { items, total: typeof r['total'] === 'number' ? (r['total'] as number) : items.length, counts: toCounts(r['counts']) };
}

export function toOffer(v: unknown): OfferView {
  const o = obj(v);
  return {
    id: str(o['id']),
    catalogKey: str(o['catalogKey']),
    formId: str(o['formId']),
    title: str(o['title']) || 'Case sheet',
    masterVersionId: str(o['masterVersionId']),
    masterVersionNo: num(o['masterVersionNo']),
    masterPublishedAt: strOrNull(o['masterPublishedAt']),
    yourBasisVersionNo: typeof o['yourBasisVersionNo'] === 'number' ? (o['yourBasisVersionNo'] as number) : null,
    status: OFFER_STATUSES.find((s) => s === o['status']) ?? 'pending',
    createdAt: str(o['createdAt']),
    decidedAt: strOrNull(o['decidedAt']),
    decidedByName: strOrNull(o['decidedByName']),
    youHaveADraft: o['youHaveADraft'] === true,
    headline: headline(o['changeSummary']),
    changes: arr(o['changes']).map(toChange).filter((x) => x.words),
  };
}

export const toOffers = (v: unknown): OfferView[] => arr(obj(v)['items']).map(toOffer);

/* ---------------- plain words ---------------- */

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  building: 'Still being made',
  pending: 'Waiting for approval',
  stale: 'Changed since — look again',
  failed: 'Couldn’t be published',
  approved: 'Approved and published',
  rejected: 'Rejected',
  withdrawn: 'Taken back',
};

/** The dot tone of `.pf-sdot` (data, never decoration): red only for failed, amber for stale. */
export function statusTone(s: ProposalStatus): string {
  return s === 'failed' ? 'bad' : s === 'stale' ? 'warn' : s === 'approved' ? 'done' : '';
}

export const isOpen = (s: ProposalStatus): boolean => s === 'pending' || s === 'stale' || s === 'failed';

export const kindLabel = (p: Pick<ProposalView, 'kind' | 'sharedMaster'>): string =>
  p.kind === 'create' ? 'New case sheet' : p.sharedMaster ? 'Change to a Prefrontal case sheet' : 'Change';

/** "Cortex, for Priya Raman" / "Claude (connected app), for Priya Raman". Names are text, never markup. */
export function sourceLine(p: Pick<ProposalView, 'source' | 'appName' | 'proposedByName'>): string {
  const who = p.proposedByName?.trim();
  const by = p.source === 'cortex' ? 'Cortex' : `${p.appName?.trim() || 'A connected app'} (connected app)`;
  return who ? `${by}, for ${who}` : by;
}

/** The badge number: everything waiting for a person (suggestions + Prefrontal updates). */
export const openTotal = (c: ProposalCounts | null, offers = 0): number => (c ? c.pending + c.stale + c.failed : 0) + offers;

/** "3 waiting" style plural helper for the badges. */
export const waitingWords = (n: number): string => (n === 1 ? '1 waiting for approval' : `${n} waiting for approval`);

/** Why a failed suggestion failed, in plain words. */
export function failedWords(p: Pick<ProposalView, 'error'>): string {
  return (p.error && APPROVAL_WORDS[p.error]) || 'Publishing it was refused. Look again, then approve or reject it.';
}

/** The changes grouped by page, like Version history ("Whole case sheet" for the rest). */
export function groupChanges(changes: DiffChange[]): { title: string; changes: DiffChange[] }[] {
  const out: { title: string; changes: DiffChange[] }[] = [];
  for (const c of changes) {
    const title = c.pageTitle || 'Whole case sheet';
    let g = out.find((x) => x.title === title);
    if (!g) out.push((g = { title, changes: [] }));
    g.changes.push(c);
  }
  return out;
}
