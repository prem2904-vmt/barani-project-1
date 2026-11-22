/**
 * Test Master "Pending changes" (beta `assistant`) — pure helpers, no Angular.
 *
 * A proposal is a change Cortex or an outside assistant (AI connector) ASKED
 * for. The person reviews them ONE BY ONE (owner rule: no select-all, no
 * approve-all anywhere — the server has no bulk route either). This file turns
 * the server's proposal into words: kind / status / source / confidence lines,
 * the before → after table (Field | Current | Proposed, plus "At proposal" for a
 * row that changed since it was suggested), clinical flags and the plain
 * reason a failed apply gives. The server stays the judge of every rule
 * (clinical confirm, staleness, permissions); these only describe.
 */
import { statusWords, type StatusWords } from './status-words';
import type { TmJson, TmProposal } from '../models/tm-proposal.model';
import { summarizeRanges, type RangeLike } from './reference-range';
import { agoWords } from '../instruments/instrument-config';

export const TM_PROPOSALS_URL = '/api/tm-proposals';
/** Settings access (owner 2026-11-18): Test Master CONTRIBUTORS' changes — the same proposals, NOT beta-gated, listing and
 *  resolving only `contributor` rows (prefrontal-mw SettingsChangesController). Used whenever beta `assistant` is off. */
export const TM_CONTRIBUTOR_CHANGES_URL = '/api/settings-changes/test-master';

/** The one action path per proposal. There is deliberately no bulk path. */
export function tmProposalPath(id: string, action?: 'approve' | 'reject' | 'withdraw' | 're-review', root: string = TM_PROPOSALS_URL): string {
  const base = `${root}/${encodeURIComponent(id)}`;
  return action ? `${base}/${action}` : base;
}

/** Statuses that still need a person (the "Needs review" list). */
export const TM_OPEN_STATUSES = ['pending', 'stale', 'failed'] as const;

export function isOpen(p: Pick<TmProposal, 'status'> | null | undefined): boolean {
  return !!p && (TM_OPEN_STATUSES as readonly string[]).includes(p.status);
}

// ── permissions (mirror of TmProposalService.CanSeeKind; the server enforces) ──

export const TM_TEST_PERMS = ['manage_tests', 'manage_test_master'] as const;
export const TM_ALL_PERMS = ['manage_tests', 'manage_test_master', 'manage_test_pricing'] as const;

/** Price kinds: a Test Master OR pricing permission; every other kind: a Test Master permission. */
export function tmCanSeeKind(has: (code: string) => boolean, kind: string): boolean {
  const tests = TM_TEST_PERMS.some(p => has(p));
  if (kind === 'price' || kind === 'offered') return tests || has('manage_test_pricing');
  return tests;
}

// ── words ──

const KIND: Record<string, string> = {
  price: 'Price',
  offered: 'Ordering',
  test_update: 'Test edit',
  test_create: 'New test',
  bundle_members: 'Members',
  partner_price: 'Partner price',
};
export function tmKindLabel(kind: string): string {
  return KIND[kind] ?? 'Change';
}

const STATUS: Record<string, string> = {
  pending: 'Waiting for review',
  stale: 'Changed since suggested',
  failed: 'Could not apply',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
};
export function tmStatusLabel(status: string): string {
  return STATUS[status] ?? status;
}

/** The proposal Status cell as words (design D): approved = done; failed / stale / expired = late (rose); the rest normal. Line 2 = "Affects results" when a clinical field changes. */
export function tmStatusWords(status: string, clinical = false): StatusWords {
  const tone = status === 'approved' ? 'done' : status === 'failed' || status === 'stale' || status === 'expired' ? 'late' : 'normal';
  return statusWords(tmStatusLabel(status), clinical ? 'Clinical' : null, tone);
}

/** Engine name from "gemini:gemini-2.5-flash" → "Gemini". */
export function tmEngine(sourceModel: string | null | undefined): string {
  const m = (sourceModel ?? '').trim().toLowerCase();
  if (m.startsWith('gemini')) return 'Gemini';
  if (m.startsWith('claude')) return 'Claude';
  return '';
}

/** Short "From" for the list: Cortex, or the outside assistant. */
export function tmSourceShort(p: Pick<TmProposal, 'source'>): string {
  return p.source === 'connector' ? 'Outside assistant' : 'Cortex';
}

/** Full source line for the side card: "Cortex (Gemini)" / "Outside assistant through the AI connector · claude-desktop". */
export function tmSourceLine(p: Pick<TmProposal, 'source' | 'sourceModel' | 'clientId'>): string {
  // Settings access: a Test Master contributor saved it for approval (the proposer's name rides on its own line).
  if (p.source === 'contributor') return 'Sent for approval by a Test Master contributor';
  if (p.source === 'connector') {
    const client = (p.clientId ?? '').trim();
    return 'Outside assistant through the AI connector' + (client ? ` · ${client}` : '');
  }
  const engine = tmEngine(p.sourceModel);
  return engine ? `Cortex (${engine})` : 'Cortex';
}

/** matchedBy values that are a guess (a model's pick or a fuzzy name match); code / name / panel / LOINC matches are exact. */
const TM_GUESS_MATCHES = ['model', 'similarity'];

export function tmIsGuess(p: Pick<TmProposal, 'matchedBy'>): boolean {
  return TM_GUESS_MATCHES.includes((p.matchedBy ?? '').trim().toLowerCase());
}

/** "Confidence 96" · "Cortex guessed this match (confidence 72)" · '' when a person typed it. */
export function tmConfidenceLine(p: Pick<TmProposal, 'confidence' | 'source' | 'matchedBy'>): string {
  const c = p.confidence;
  const has = c != null && Number.isFinite(c);
  if (tmIsGuess(p)) {
    const who = p.source === 'connector' ? 'The assistant' : 'Cortex';
    return has ? `${who} guessed this match (confidence ${c})` : `${who} guessed this match`;
  }
  return has ? `Confidence ${c}` : '';
}

/** "Suggested 2 min ago" / "Expires in 30 days". */
export function tmWhenLine(p: Pick<TmProposal, 'createdAt'>, now: number = Date.now()): string {
  const a = agoWords(p.createdAt, now);
  return a ? `Suggested ${a}` : '';
}

export function tmExpiresLine(p: Pick<TmProposal, 'expiresAt' | 'status'>, now: number = Date.now()): string {
  if (!isOpen(p)) return '';
  const t = Date.parse(p.expiresAt ?? '');
  if (Number.isNaN(t)) return '';
  const days = Math.ceil((t - now) / 86_400_000);
  if (days <= 0) return 'Expires today';
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

/** Who proposed + who resolved, both shown (the proposer may approve their own). */
export function tmPeopleLine(p: Pick<TmProposal, 'proposedBy' | 'isMine' | 'resolvedBy' | 'status'>): string {
  const by = p.isMine ? `${p.proposedBy || 'You'} (you)` : (p.proposedBy || 'Someone');
  const parts = [`Asked by ${by}`];
  if (p.resolvedBy && !isOpen(p)) parts.push(`${tmStatusLabel(p.status)} by ${p.resolvedBy}`);
  return parts.join(' · ');
}

/** A failed apply's code → what happened, in words. */
const FAILED: Record<string, string> = {
  range_invalid: 'A reference range is not valid: the bands overlap or are out of order. Fix it in the test editor or reject this change.',
  department_required: 'The test needs a department. Reject this change, or add the test by hand.',
  in_bundle: 'This test is part of a profile or package, so it cannot be changed this way.',
  family_via_profile: 'An option family can only be used inside a profile, not on a single test.',
  target_missing: 'The test this change was for no longer exists. Reject it.',
  invalid_branch: 'That branch does not belong to this lab, or you cannot open it.',
  payload_invalid: 'The stored change could not be read. Reject it.',
  kind_not_supported: 'This kind of change cannot be applied yet. Reject it.',
  reference_not_found: 'The change points at a department or referral lab that is not one of yours. Reject it.',
  code_taken: 'That test code is already in use.',
  name_taken: 'A test with this name already exists.',
  already_exists: 'A test with this name already exists.',
};
export function tmFailedWords(code: string | null | undefined): string {
  const c = (code ?? '').trim();
  return FAILED[c] ?? 'The change could not be applied. Check the values, then re-review or reject it.';
}

/**
 * The list's one line. The server already writes it in words ("Price ₹250 → ₹300",
 * "Edit: Unit, Reference range", "Tests in bundle 3 → 4", "Offer for ordering"), so
 * this passes it through; an empty summary falls back to the kind.
 */
export function tmChangeLine(p: Pick<TmProposal, 'kind' | 'summary'>): string {
  const s = (p.summary ?? '').trim();
  return s || tmKindLabel(p.kind);
}

// ── the before → after table ──

const LABELS: Record<string, string> = {
  name: 'Name', description: 'Description', flow: 'Workflow', departmentId: 'Department', sampleType: 'Sample type',
  tatHours: 'Turnaround', parametersJson: 'Parameters', conditionsJson: 'Flag conditions', outsourcedVendorId: 'Referral lab',
  outsourcedDepartmentId: 'Referral lab department', clearOutsource: 'Stop outsourcing', tubeColor: 'Tube', shortName: 'Short name',
  section: 'Section', sampleVolumeMl: 'Sample volume', fastingRequired: 'Fasting', methodology: 'Method', resultType: 'Result type',
  unit: 'Unit', reportFormat: 'Report format', adultReferenceRange: 'Reference range', criticalLow: 'Critical low',
  criticalHigh: 'Critical high', profile: 'Panel label', calculation: 'Formula', standardCode: 'Standard code',
  hsnSacCode: 'HSN / SAC code', type: 'Type', price: 'Price', taxSlab: 'Tax slab', isOffered: 'Ordering', specimenCode: 'Specimen',
};
export function tmFieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/Json$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Keys that only say WHICH row a change is for (never a diff line). */
const CONTEXT_KEYS = new Set(['testId', 'notPriced', 'specimenCode']);

export const DASH = '—';

/** Names for ids a payload may carry (departments, tests). */
export interface TmLookups {
  department?: (id: string) => string | null | undefined;
  test?: (idOrKey: string) => { name: string; code?: string | null } | null | undefined;
}

function isBlank(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

function rupees(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** One value as display text (never cut). */
export function tmValueText(key: string, v: unknown, look: TmLookups = {}, ctx: TmJson | null = null): string {
  if (key === 'price') {
    if (ctx && ctx['notPriced'] === true) return 'Not set';
    return isBlank(v) ? 'Not set' : typeof v === 'number' ? rupees(v) : String(v);
  }
  if (isBlank(v)) return DASH;
  switch (key) {
    case 'taxSlab': return `${v}%`;
    case 'isOffered': return v === true ? 'Offered' : 'Hidden from ordering';
    case 'tatHours': return `${v} h`;
    case 'sampleVolumeMl': return `${v} mL`;
    case 'fastingRequired': return v === true ? 'Yes' : v === false ? 'No' : String(v);
    case 'clearOutsource': return v === true ? 'Yes' : 'No';
    case 'tubeColor': { const s = String(v); return s.charAt(0).toUpperCase() + s.slice(1); }
    case 'departmentId': case 'outsourcedDepartmentId':
      return look.department?.(String(v)) ?? 'A department of your lab';
    case 'outsourcedVendorId':
      return 'A referral lab';
  }
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export interface TmDiffRow {
  /** Stable key (track by). */
  key: string;
  label: string;
  /** The value now (stale rows: the live value; otherwise the value it was measured against). */
  current: string;
  /** Stale rows only: the value when it was suggested. */
  atProposal?: string;
  proposed: string;
  clinical: boolean;
}

function parseBlob(s: unknown): Record<string, unknown> | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' && !Array.isArray(o) ? o as Record<string, unknown> : null;
  } catch { return null; }
}

interface ParamLike { name?: string; unit?: string; type?: string; referenceRanges?: unknown; options?: unknown; [k: string]: unknown }

function paramsOf(blob: Record<string, unknown> | null): ParamLike[] {
  return blob && Array.isArray(blob['parameters']) ? (blob['parameters'] as ParamLike[]).filter(p => p && typeof p === 'object') : [];
}

function rangeText(p: ParamLike | undefined): string {
  if (!p) return DASH;
  const r = Array.isArray(p.referenceRanges) ? p.referenceRanges as RangeLike[] : [];
  try { return summarizeRanges(r, p.unit, { keepLines: true }) || DASH; } catch { return DASH; }
}

function optionsText(p: ParamLike | undefined): string {
  const o = p?.options;
  if (!Array.isArray(o) || o.length === 0) return DASH;
  return o.map(x => (typeof x === 'string' ? x : (x as { label?: string; value?: string })?.label ?? (x as { value?: string })?.value ?? JSON.stringify(x))).join(', ');
}

/**
 * `parametersJson` is one long blob; show what changed in it per parameter
 * (unit, ranges, result type, options) instead of two walls of JSON. Anything
 * else that differs is one plain "Other settings" line. An unreadable blob
 * falls back to the raw text (wrapped, never cut).
 */
export function tmParameterRows(before: unknown, proposed: unknown, current?: unknown): TmDiffRow[] {
  const b = parseBlob(before), a = parseBlob(proposed), c = current === undefined ? undefined : parseBlob(current);
  const stale = current !== undefined;
  if (!a || (!b && !isBlank(before))) {
    return [{ key: 'parametersJson', label: 'Parameters', current: isBlank(stale ? current : before) ? DASH : String(stale ? current : before),
      ...(stale ? { atProposal: isBlank(before) ? DASH : String(before) } : {}), proposed: isBlank(proposed) ? DASH : String(proposed), clinical: true }];
  }
  const out: TmDiffRow[] = [];
  const bp = paramsOf(b), ap = paramsOf(a), cp = c ? paramsOf(c) : [];
  const nameOf = (p: ParamLike, i: number) => (p.name ?? '').trim() || `Parameter ${i + 1}`;
  const find = (list: ParamLike[], name: string, i: number) => list.find((p, j) => nameOf(p, j).toLowerCase() === name.toLowerCase()) ?? list[i];
  const names: string[] = [];
  ap.forEach((p, i) => names.push(nameOf(p, i)));
  bp.forEach((p, i) => { const n = nameOf(p, i); if (!names.some(x => x.toLowerCase() === n.toLowerCase())) names.push(n); });
  names.forEach((name, i) => {
    const pb = find(bp, name, i), pa = find(ap, name, i), pc = stale ? find(cp, name, i) : undefined;
    const sameName = (p?: ParamLike) => !!p && (p.name ?? '').trim().toLowerCase() === name.toLowerCase();
    const B = sameName(pb) || (!pb?.name && pb) ? pb : undefined;
    const A = sameName(pa) || (!pa?.name && pa) ? pa : undefined;
    const C = sameName(pc) || (!pc?.name && pc) ? pc : undefined;
    if (!A && B) { out.push(row(`p:${name}`, name, 'In use', 'Removed', stale ? (C ? 'In use' : DASH) : undefined)); return; }
    if (A && !B) { const r = rangeText(A); out.push(row(`p:${name}`, name, DASH, r === DASH ? 'Added' : `Added · ${r}`, stale ? DASH : undefined)); return; }
    if (!A || !B) return;
    const parts: [string, string, (p?: ParamLike) => string][] = [
      ['unit', 'Unit', p => (isBlank(p?.unit) ? DASH : String(p!.unit))],
      ['range', 'Range', rangeText],
      ['type', 'Result type', p => (isBlank(p?.type) ? DASH : String(p!.type))],
      ['options', 'Options', optionsText],
    ];
    let shown = false;
    for (const [k, lbl, f] of parts) {
      const was = f(B), will = f(A);
      if (was === will) continue;
      out.push(row(`p:${name}:${k}`, `${name} · ${lbl}`, was, will, stale ? f(C) : undefined));
      shown = true;
    }
    if (!shown && JSON.stringify(B) !== JSON.stringify(A)) {
      out.push(row(`p:${name}:other`, `${name} · Other settings`, 'As before', 'Changed', stale ? (JSON.stringify(C) === JSON.stringify(B) ? 'As before' : 'Changed') : undefined));
    }
  });
  // Other top-level keys of the blob (entry kind, items…).
  const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a)].filter(k => k !== 'parameters'));
  for (const k of keys) {
    const was = (b ?? {})[k], will = a[k];
    if (JSON.stringify(was) === JSON.stringify(will)) continue;
    const t = (v: unknown) => (v == null ? DASH : typeof v === 'string' ? v : JSON.stringify(v));
    out.push(row(`b:${k}`, `Parameters · ${tmFieldLabel(k)}`, t(was), t(will), stale ? t(c?.[k]) : undefined));
  }
  if (out.length === 0) out.push(row('parametersJson', 'Parameters', 'As before', 'No visible change', stale ? 'As before' : undefined));
  return out;

  function row(key: string, label: string, was: string, will: string, now?: string): TmDiffRow {
    return stale ? { key, label, current: now ?? DASH, atProposal: was, proposed: will, clinical: true }
                 : { key, label, current: was, proposed: will, clinical: true };
  }
}

function memberNames(list: unknown, look: TmLookups): string[] {
  if (!Array.isArray(list)) return [];
  return list.map(m => {
    const o = (m ?? {}) as { name?: string; code?: string; testId?: string; catalogKey?: string };
    if (o.name) return o.code ? `${o.name} (${o.code})` : o.name;
    const t = (o.testId && look.test?.(o.testId)) || (o.catalogKey && look.test?.(o.catalogKey)) || null;
    return t ? (t.code ? `${t.name} (${t.code})` : t.name) : 'A test not in your list';
  });
}

/** Profile / package members: Added + Removed lines, then the full list. */
export function tmMemberRows(p: Pick<TmProposal, 'payload' | 'before' | 'current' | 'status'>, look: TmLookups = {}): TmDiffRow[] {
  const was = memberNames((p.before ?? {})['members'], look);
  const blob = parseBlob((p.payload ?? {})['parametersJson']);
  const will = memberNames(blob?.['items'], look);
  const added = will.filter(n => !was.includes(n));
  const removed = was.filter(n => !will.includes(n));
  const stale = p.status === 'stale';
  const now = stale ? memberNames((p.current ?? {})['members'], look) : [];
  const out: TmDiffRow[] = [];
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : DASH);
  if (added.length) out.push({ key: 'added', label: 'Added', current: DASH, proposed: list(added), clinical: false, ...(stale ? { atProposal: DASH } : {}) });
  if (removed.length) out.push({ key: 'removed', label: 'Removed', current: list(removed), proposed: DASH, clinical: false, ...(stale ? { atProposal: list(removed) } : {}) });
  out.push(stale
    ? { key: 'members', label: `Members`, current: list(now), atProposal: list(was), proposed: list(will), clinical: false }
    : { key: 'members', label: `Members (${was.length} → ${will.length})`, current: list(was), proposed: list(will), clinical: false });
  return out;
}

/**
 * The detail table. Columns: Field | Current | Proposed; a STALE row adds
 * "At proposal" (what it was measured against) so the person sees what moved.
 */
export function tmDiffRows(p: TmProposal, look: TmLookups = {}): TmDiffRow[] {
  const payload = p.payload ?? {};
  const before = p.before ?? {};
  const stale = p.status === 'stale';
  const live = p.current ?? null;
  const clinical = new Set((p.clinicalFields ?? []).map(k => k.toLowerCase()));
  if (p.kind === 'bundle_members') return tmMemberRows(p, look);
  const out: TmDiffRow[] = [];
  for (const key of Object.keys(payload)) {
    if (CONTEXT_KEYS.has(key)) continue;
    if (p.kind === 'test_create' && (key === 'price' || key === 'taxSlab')) continue;   // a new test starts at ₹0; prices are set in Pricing
    if (key === 'parametersJson') {
      const rows = p.kind === 'test_create'
        ? tmParameterRows(undefined, payload[key])
        : tmParameterRows(before[key], payload[key], stale ? (live ?? {})[key] : undefined);
      out.push(...rows.map(r => ({ ...r, clinical: p.kind === 'test_create' ? clinical.has('parametersjson') : true })));
      continue;
    }
    const isNew = p.kind === 'test_create';
    // The server's plain-words line for this field (label, ₹, names) wins over formatting the raw payload here.
    const sc = (p.changes ?? []).find(c => c.field === key);
    const fromServer = (t: string | null | undefined, fallback: string) => (t == null || t === '' ? fallback : t);
    const cur = isNew ? DASH
      : stale && live ? tmValueText(key, live[key], look, live)
      : sc ? fromServer(sc.before, DASH) : tmValueText(key, before[key], look, before);
    const r: TmDiffRow = {
      key, label: sc?.label || tmFieldLabel(key), current: cur,
      proposed: sc ? fromServer(sc.after, DASH) : tmValueText(key, payload[key], look), clinical: clinical.has(key.toLowerCase()),
    };
    if (stale) r.atProposal = isNew ? DASH : sc ? fromServer(sc.before, DASH) : tmValueText(key, before[key], look, before);
    out.push(r);
  }
  // A price for one specimen says so in the label.
  const spec = payload['specimenCode'];
  if (p.kind === 'price' && typeof spec === 'string' && spec) for (const r of out) if (r.key === 'price' && !r.label.includes(`(${spec})`)) r.label = `Price (${spec})`;
  return out;
}

/** The clinical lines for the confirm dialog: "Unit: mg/dL → mmol/L". */
export function tmClinicalItems(rows: readonly TmDiffRow[]): string[] {
  return rows.filter(r => r.clinical).map(r => `${r.label}: ${r.current} → ${r.proposed}`);
}

/** Does approving need the clinical checkbox? (The server decides; this only opens the dialog first.) */
export function tmNeedsClinicalConfirm(p: Pick<TmProposal, 'clinicalFields'>): boolean {
  return (p.clinicalFields ?? []).length > 0;
}

/** Case-insensitive filter over the list's own words (band search). */
export function tmMatches(p: TmProposal, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [p.targetLabel, p.summary, tmKindLabel(p.kind), tmSourceShort(p), p.proposedBy, p.reason ?? '']
    .some(x => (x ?? '').toLowerCase().includes(s));
}

/** Newest first, then id (stable). */
export function tmSort(list: readonly TmProposal[]): TmProposal[] {
  return [...list].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id));
}
