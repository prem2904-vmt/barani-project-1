/**
 * "Share to Messages" — the ONE card model (pure, unit-tested).
 *
 * A chat message can carry a shared-record card: patient · order · sample
 * (tube) · report · result value · validation item · analyzer run ·
 * Insights view. The SERVER builds the title / subtitle (it never trusts
 * client text) and decides where a tap goes for the RECEIVER
 * (`GET /api/chat/cards/resolve`). This file only:
 *  - normalises a message into a card (generic columns, legacy report columns);
 *  - names the card (eyebrow, SVG icon, status chip) — never emoji;
 *  - turns a pasted Prefrontal link into a share candidate (cheap shape check
 *    before the server's `POST /api/chat/cards/from-url`);
 *  - a LOCAL fallback route for an older server without `/cards/resolve`.
 * Every HTTP call lives in `core/services/share.service.ts`.
 */

export const SHARE_CARD_TYPES = ['patient', 'order', 'sample', 'report', 'result', 'validation', 'analyzer', 'insights'] as const;
export type ShareCardType = (typeof SHARE_CARD_TYPES)[number];

export function isShareCardType(v: unknown): v is ShareCardType {
  return typeof v === 'string' && (SHARE_CARD_TYPES as readonly string[]).includes(v);
}

/** Small, typed per card (no free text beyond what is on screen). Every key optional. */
export interface ShareCardMeta {
  /** result / validation: the ordered line. */
  orderTestId?: string;
  /** result / sample: the tube id (route /lab/sample/:id). */
  sampleId?: string;
  /** The tube's printed Sample ID (26105). */
  sampleBarcode?: string;
  /** result: the parameter name (Haemoglobin) + what is on screen. */
  parameter?: string;
  value?: string;
  unit?: string;
  /** result: critical | critical_low | critical_high | low | high | abnormal | normal. */
  flag?: string;
  /** order / sample / validation: a status word the server stamped. */
  status?: string;
  /** analyzer: unmatched | qc (which tab). */
  tab?: string;
  /** insights: the view (section id / dash:<id>) + its period / range / branch. */
  section?: string;
  period?: string;
  from?: string;
  to?: string;
  branch?: string;
  [k: string]: string | undefined;
}

/** The ONLY client meta the server reads (everything else is ignored, and
 *  never sent): a result's parameter (the server reads the saved value / unit /
 *  flag itself) and an Insights view. */
export function wireMeta(t: Pick<ShareTarget, 'type' | 'meta'>): ShareCardMeta | null {
  const m = parseCardMeta(t.meta);
  if (!m) return null;
  const pick = (keys: string[]) => {
    const out: ShareCardMeta = {};
    for (const k of keys) if (m[k]) out[k] = m[k];
    return Object.keys(out).length ? out : null;
  };
  if (t.type === 'result') return pick(['parameter']);
  if (t.type === 'insights') return pick(['section', 'period', 'from', 'to', 'branch']);
  return null;
}

/** What a share call sends (the server builds the rest). */
export interface ShareTarget {
  type: ShareCardType;
  id: string;
  meta?: ShareCardMeta | null;
}

/** A card as the UI draws it. */
export interface ShareCard extends ShareTarget {
  title: string;
  subtitle: string;
}

/** The message fields a card reads (generic + legacy report columns). */
export interface CardMessage {
  sharedRecordType?: string | null;
  sharedRecordId?: string | null;
  sharedRecordTitle?: string | null;
  sharedRecordSubtitle?: string | null;
  /** Object, or the jsonb as a string from an older relay. */
  sharedRecordMeta?: Record<string, unknown> | string | null;
  sharedReportId?: string | null;
  sharedReportPatientName?: string | null;
  sharedReportTestSummary?: string | null;
}

/** Meta from the wire: an object, a JSON string, or junk → a clean string map. */
export function parseCardMeta(raw: unknown): ShareCardMeta | null {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: ShareCardMeta = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === null || val === undefined || val === '') continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[k] = String(val);
  }
  return Object.keys(out).length ? out : null;
}

/** The card a message carries, or null. Generic columns first; legacy
 *  SharedReport* rows (before the generic refactor) still render. An unknown
 *  future type is dropped rather than drawn wrong. */
export function cardOf(m: CardMessage | null | undefined): ShareCard | null {
  if (!m) return null;
  if (m.sharedRecordType && m.sharedRecordId) {
    if (!isShareCardType(m.sharedRecordType)) return null;
    return {
      type: m.sharedRecordType,
      id: m.sharedRecordId,
      title: m.sharedRecordTitle || cardEyebrow(m.sharedRecordType),
      subtitle: m.sharedRecordSubtitle ?? '',
      meta: parseCardMeta(m.sharedRecordMeta),
    };
  }
  if (m.sharedReportId) {
    return {
      type: 'report',
      id: m.sharedReportId,
      title: m.sharedReportPatientName || 'Lab report',
      subtitle: m.sharedReportTestSummary ?? '',
      meta: null,
    };
  }
  return null;
}

export function cardEyebrow(type: string): string {
  switch (type) {
    case 'patient': return 'Patient';
    case 'order': return 'Order';
    case 'sample': return 'Sample';
    case 'report': return 'Lab report';
    case 'result': return 'Result';
    case 'validation': return 'For validation';
    case 'analyzer': return 'Analyzer run';
    case 'insights': return 'Insights';
    default: return 'Record';
  }
}

/** Stroked SVG path data per card type (24×24, stroke = currentColor). */
export const CARD_ICONS: Record<ShareCardType, string> = {
  patient: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  order: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  sample: '<path d="M9 2h6"/><path d="M10 2v15.5a2 2 0 0 0 4 0V2"/><path d="M10 11h4"/>',
  report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/>',
  result: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  validation: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  analyzer: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10M12 16v4M7 10h2l1.5-3 3 6 1.5-3h2"/>',
  insights: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
};

export function cardIcon(type: string): string {
  return isShareCardType(type) ? CARD_ICONS[type] : CARD_ICONS.report;
}

export type CardChipTone = 'critical' | 'flag' | 'neutral';

/** The small status chip on a card: a result's flag in words (never a raw
 *  code), or a status word the server stamped. Null = no chip. */
export function cardChip(card: Pick<ShareCard, 'type' | 'meta'>): { label: string; tone: CardChipTone } | null {
  const m = card.meta ?? null;
  if (!m) return null;
  const f = (m.flag ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (f) {
    const map: Record<string, { label: string; tone: CardChipTone }> = {
      critical: { label: 'Critical', tone: 'critical' },
      critical_low: { label: 'Critical low', tone: 'critical' },
      cl: { label: 'Critical low', tone: 'critical' },
      critical_high: { label: 'Critical high', tone: 'critical' },
      ch: { label: 'Critical high', tone: 'critical' },
      low: { label: 'Low', tone: 'flag' },
      l: { label: 'Low', tone: 'flag' },
      high: { label: 'High', tone: 'flag' },
      h: { label: 'High', tone: 'flag' },
      abnormal: { label: 'Abnormal', tone: 'flag' },
    };
    if (map[f]) return map[f];
  }
  const s = (m.status ?? '').trim();
  if (s) return { label: humanStatus(s), tone: 'neutral' };
  return null;
}

/** snake_case / lower status → words ("not_reported" → "Not reported"). */
function humanStatus(s: string): string {
  const w = s.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return w ? w[0].toUpperCase() + w.slice(1) : '';
}

/** The server's auto text on cards written by the legacy share-patient /
 *  share-report endpoints ("📄 Shared report: …") — the card already says it,
 *  so it is never shown as a caption (and never as an emoji). */
export function isAutoCardBody(body: string | null | undefined): boolean {
  const b = (body ?? '').trim();
  return /^(?:\S+\s+)?Shared (?:report|patient):/u.test(b);
}

/** The caption to show under a card ('' = none). */
export function cardCaption(m: CardMessage & { body?: string | null }): string {
  const b = (m.body ?? '').trim();
  return b && !isAutoCardBody(b) ? b : '';
}

/** One-line summary for alerts / previews ("Order: LAB-2610-000200"). */
export function cardPreview(card: { type: string; title: string }): string {
  return `${cardEyebrow(card.type)}: ${card.title}`;
}

/** Client-side preview while composing (before the server names it). */
export function draftCard(t: ShareTarget & { title?: string; subtitle?: string }): ShareCard {
  return { type: t.type, id: t.id, meta: t.meta ?? null, title: t.title || cardEyebrow(t.type), subtitle: t.subtitle ?? '' };
}

/** A navigation the UI may take: an IN-APP path only (never a protocol / host). */
export interface CardRoute { route: string; queryParams?: Record<string, string> }

export function safeAppRoute(route: unknown): string | null {
  if (typeof route !== 'string') return null;
  const r = route.trim();
  if (!r.startsWith('/') || r.startsWith('//') || /^\/\\/.test(r) || /[\s<>"']/.test(r)) return null;
  return r;
}

/** Older server (no /cards/resolve): where the card opens, by the app's own
 *  routes. The route guards + the API stay the real gate. */
export function localCardRoute(card: ShareTarget): CardRoute | null {
  const id = encodeURIComponent(card.id);
  const m = card.meta ?? {};
  switch (card.type) {
    case 'patient': return { route: `/p/${id}` };
    case 'order': return { route: `/o/${id}`, queryParams: { view: 'detail' } };
    case 'sample': return { route: `/lab/sample/${id}`, queryParams: { view: '1' } };
    case 'report': return { route: `/reports/view/${id}` };
    case 'result':
      return m.sampleId
        ? { route: `/lab/sample/${encodeURIComponent(m.sampleId)}`, queryParams: { view: '1', ...(m.parameter ? { param: m.parameter } : {}) } }
        : null;
    case 'validation': return { route: `/pathologist/validate/${id}` };
    case 'analyzer': return { route: '/lab/analyzer-results', queryParams: { message: card.id, ...(m.tab ? { tab: m.tab } : {}) } };
    case 'insights': {
      const qp: Record<string, string> = { section: m.section || card.id };
      for (const k of ['period', 'from', 'to', 'branch'] as const) if (m[k]) qp[k] = m[k]!;
      return { route: '/insights', queryParams: qp };
    }
    default: return null;
  }
}

// ── Pasted links ───────────────────────────────────────────────────────

/** In-app paths that name ONE record (or an Insights view). */
const LINK_PATTERNS: RegExp[] = [
  /^\/o\/[^/?#]+/,
  /^\/p\/[^/?#]+/,
  /^\/patients\/[^/?#]+/,
  /^\/frontdesk\/patients\/(?!new)[^/?#]+/,
  /^\/reports\/view\/[^/?#]+/,
  /^\/lab\/sample\/[^/?#]+/,
  /^\/lab\/result\/[^/?#]+/,
  /^\/pathologist\/validate\/[^/?#]+/,
  /^\/lab\/analyzer-results\?(?:.*&)?message=[^&#]+/,
  /^\/insights(?:\?|$)/,
];

/** Hosts whose links are ours: this app's own origin + the Prefrontal domain. */
export function isPrefrontalHost(host: string, ownHost?: string | null): boolean {
  const h = host.toLowerCase();
  if (ownHost && h === ownHost.toLowerCase()) return true;
  return h === 'prefrontal.health' || h.endsWith('.prefrontal.health');
}

/** The in-app path (+ query) of a Prefrontal link, `#/` (desktop hash routing)
 *  unwrapped; null when it isn't one of ours or names no record. */
export function prefrontalPath(url: string, ownHost?: string | null): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (!isPrefrontalHost(u.host, ownHost)) return null;
  let path = u.pathname + u.search;
  if (u.hash.startsWith('#/')) path = u.hash.slice(1);
  return LINK_PATTERNS.some(p => p.test(path)) ? path : null;
}

/** The first Prefrontal record link in pasted / typed text, or null. */
export function findPrefrontalLink(text: string, ownHost?: string | null): string | null {
  const urls = (text ?? '').match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const raw of urls) {
    const url = raw.replace(/[).,;:!?]+$/, '');
    if (prefrontalPath(url, ownHost)) return url;
  }
  return null;
}

/** The caption left after the pasted link becomes a card. */
export function captionWithoutLink(text: string, url: string): string {
  return (text ?? '').split(url).join(' ').replace(/[ \t]{2,}/g, ' ').replace(/\s+\n/g, '\n').trim();
}

// ── @mentions in a caption ────────────────────────────────────────────

/** `@Priya Nair` (as typed in the note box) → `@<authId>` on the wire, plus
 *  the mention list. Longest names first so "Priya Nair" wins over "Priya". */
export function encodeMentions(text: string, people: ReadonlyArray<{ id: string; name: string }>): { body: string; mentions: string[] } {
  let body = text ?? '';
  const mentions: string[] = [];
  const sorted = [...people].filter(p => p.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const token = '@' + p.name.trim();
    if (!body.includes(token)) continue;
    body = body.split(token).join('@' + p.id);
    if (!mentions.includes(p.id)) mentions.push(p.id);
  }
  return { body, mentions };
}
